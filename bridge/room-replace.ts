// Room replacement and working-folder moves.
// Contents:
// - AGY metadata and conversation forks
// - Folder validation and Claude memory
// - Replace a stale room and hand over its work
// - Move a room and adopt its session

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { partyName, type Bench, type BenchParty } from './bench';

// AGY metadata and conversation forks: copy a conversation and update its identity and folder.
const validUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value >>> 0;
  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

function readVarint(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos };
    shift += 7;
    if (shift > 35) break;
  }
  throw new Error('Invalid protobuf varint');
}

const encodeBytesField = (fieldNo: number, payload: Buffer): Buffer =>
  Buffer.concat([encodeVarint((fieldNo << 3) | 2), encodeVarint(payload.length), payload]);

const agyFormatChangedError = 'AGY 的對話資料格式有變，暫時未能更改工作資料夾';

const expectedAgySchema: ReadonlyArray<readonly [table: string, columns: readonly string[]]> = [
  ['trajectory_meta', ['trajectory_id', 'cascade_id']],
  ['trajectory_metadata_blob', ['id', 'data']],
  ['steps', ['idx', 'metadata', 'error_details', 'permissions', 'task_details', 'render_info', 'step_payload']],
  ['gen_metadata', ['idx', 'data']],
  ['executor_metadata', ['idx', 'data']],
  ['parent_references', ['idx', 'data']],
  ['battle_mode_infos', ['idx', 'data']],
];

function assertAgySchema(db: DatabaseSync): void {
  for (const [table, columns] of expectedAgySchema) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[];
    if (!info.length) throw new Error(agyFormatChangedError);
    const names = new Set(info.map(col => col.name));
    if (columns.some(col => !names.has(col))) throw new Error(agyFormatChangedError);
  }
}

/**
 * Rewrites an AGY `trajectory_metadata_blob` protobuf so the forked conversation carries the new conversation ID
 * (`cascade_id`, field 6) and the new working folder (`WorkspaceInfo`, field 1, and `workspace_uri`, field 7)
 * while preserving the existing project ID and timestamps.
 * If a non-empty blob cannot be parsed as valid protobuf wire format, refuses instead of fabricating a project.
 */
export function rewriteAgyMetadataBlob(raw: Uint8Array | undefined, newSessionId: string, realNewFolder: string): Buffer {
  const uriBuf = Buffer.from(pathToFileURL(realNewFolder).href, 'utf8');
  const wsEntry = Buffer.concat([encodeBytesField(1, uriBuf), Buffer.from([0x1a, 0x00])]);
  const kept: Buffer[] = [];
  if (raw && raw.byteLength > 0) {
    const buf = Buffer.from(raw);
    try {
      let pos = 0;
      while (pos < buf.length) {
        const start = pos;
        const tag = readVarint(buf, pos);
        pos = tag.next;
        const fieldNo = tag.value >>> 3;
        if (fieldNo === 0) throw new Error('Invalid field number 0');
        const wire = tag.value & 7;
        if (wire === 0) pos = readVarint(buf, pos).next;
        else if (wire === 1) pos += 8;
        else if (wire === 2) { const len = readVarint(buf, pos); pos = len.next + len.value; }
        else if (wire === 5) pos += 4;
        else throw new Error(`Unsupported wire type ${wire}`);
        if (pos > buf.length) throw new Error('Truncated protobuf field');
        if (fieldNo !== 1 && fieldNo !== 6 && fieldNo !== 7) kept.push(buf.subarray(start, pos));
      }
    } catch {
      throw new Error(agyFormatChangedError);
    }
    if (!kept.length) throw new Error(agyFormatChangedError);
  } else {
    const projectBuf = Buffer.from('default-cli-project', 'utf8');
    kept.push(
      encodeBytesField(3, Buffer.from(randomUUID(), 'utf8')),
      Buffer.concat([Buffer.from([0x92, 0x01]), encodeVarint(projectBuf.length), projectBuf]),
    );
  }
  return Buffer.concat([
    encodeBytesField(1, wsEntry),
    encodeBytesField(6, Buffer.from(newSessionId, 'utf8')),
    encodeBytesField(7, uriBuf),
    ...kept,
  ]);
}

/**
 * Forks an AGY conversation on disk to a new conversation UUID and maps the new working folder to it:
 * 1. Validates the SQLite schema on `conversations/<oldId>.db`, runs `VACUUM INTO` to produce a consistent copy at
 *    `conversations/<newId>.db` that includes any uncheckpointed `-wal` transactions, and rewrites `trajectory_meta`,
 *    `trajectory_metadata_blob`, and UUID references in step blobs.
 * 2. Copies `brain/<oldId>/.system_generated/logs` to `brain/<newId>/.system_generated/logs` so the transcript history is immediately readable.
 * 3. Copies `annotations/<oldId>.pbtxt` if present, and maps `newFolder` (and its `realpath`) to `newSessionId` in `cache/last_conversations.json`.
 * Returns a rollback function that removes all created files (including `-wal`/`-shm`) and restores `cache/last_conversations.json` if a later step fails.
 */
export async function forkAgyConversation(
  sessionHome: string,
  oldSessionId: string,
  newSessionId: string,
  newFolder: string,
): Promise<() => Promise<void>> {
  if (!validUuid.test(oldSessionId) || !validUuid.test(newSessionId) || oldSessionId === newSessionId) {
    throw new Error('AGY Session ID 無效，未能分叉對話。');
  }
  const agyRoot = join(sessionHome, '.gemini/antigravity-cli');
  const realNewFolder = await realpath(newFolder).catch(() => newFolder);
  const srcDb = join(agyRoot, 'conversations', `${oldSessionId}.db`);
  const srcBrain = join(agyRoot, 'brain', oldSessionId);
  const [hasDb, hasBrain] = await Promise.all([
    stat(srcDb).then(info => info.isFile()).catch(() => false),
    stat(srcBrain).then(info => info.isDirectory()).catch(() => false),
  ]);
  if (!hasDb && !hasBrain) {
    throw new Error('找不到這間 AGY 房的本地對話紀錄，未能更改工作資料夾。');
  }

  const dstDb = join(agyRoot, 'conversations', `${newSessionId}.db`);
  const dstBrain = join(agyRoot, 'brain', newSessionId);
  const dstAnnotation = join(agyRoot, 'annotations', `${newSessionId}.pbtxt`);
  const cacheDir = join(agyRoot, 'cache');
  const cachePath = join(cacheDir, 'last_conversations.json');
  let cacheTouched = false;
  const previousCacheEntries = new Map<string, string | undefined>();

  const rollback = async () => {
    await Promise.all([
      rm(dstDb, { force: true }).catch(() => {}),
      rm(`${dstDb}-wal`, { force: true }).catch(() => {}),
      rm(`${dstDb}-shm`, { force: true }).catch(() => {}),
      rm(dstBrain, { recursive: true, force: true }).catch(() => {}),
      rm(dstAnnotation, { force: true }).catch(() => {}),
    ]);
    if (!cacheTouched) return;
    try {
      const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const mapping = parsed as Record<string, string>;
      for (const [key, prev] of previousCacheEntries) {
        if (mapping[key] !== newSessionId) continue;
        if (prev === undefined) delete mapping[key];
        else mapping[key] = prev;
      }
      const tmpCache = `${cachePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmpCache, JSON.stringify(mapping, null, 2), { mode: 0o600 });
        await rename(tmpCache, cachePath);
      } finally {
        await unlink(tmpCache).catch(() => {});
      }
    } catch { /* Best-effort cache rollback. */ }
  };

  try {
    if (hasDb) {
      const convDir = join(agyRoot, 'conversations');
      await mkdir(convDir, { recursive: true });
      const source = new DatabaseSync(srcDb);
      try {
        assertAgySchema(source);
        await rm(dstDb, { force: true }).catch(() => {});
        source.prepare('VACUUM INTO ?').run(dstDb);
      } finally {
        source.close();
      }
      const db = new DatabaseSync(dstDb);
      try {
        db.prepare('UPDATE trajectory_meta SET trajectory_id = ?, cascade_id = ?').run(randomUUID(), newSessionId);
        const metaRow = db.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get() as { data?: Uint8Array } | undefined;
        const rewrittenMeta = rewriteAgyMetadataBlob(metaRow?.data, newSessionId, realNewFolder);
        if (metaRow) {
          db.prepare("UPDATE trajectory_metadata_blob SET data = ? WHERE id = 'main'").run(rewrittenMeta);
        } else {
          db.prepare("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)").run(rewrittenMeta);
        }
        const oldBuf = Buffer.from(oldSessionId, 'utf8');
        const newBuf = Buffer.from(newSessionId, 'utf8');
        for (const [table, col, pk] of [
          ['steps', 'metadata', 'idx'], ['steps', 'error_details', 'idx'], ['steps', 'permissions', 'idx'],
          ['steps', 'task_details', 'idx'], ['steps', 'render_info', 'idx'], ['steps', 'step_payload', 'idx'],
          ['gen_metadata', 'data', 'idx'], ['executor_metadata', 'data', 'idx'],
          ['parent_references', 'data', 'idx'], ['battle_mode_infos', 'data', 'idx'],
        ] as const) {
          const rows = db.prepare(`SELECT ${pk} AS id, ${col} AS blob FROM ${table}`).all() as { id: number | string; blob: Uint8Array | null }[];
          const update = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${pk} = ?`);
          for (const row of rows) {
            if (!row.blob) continue;
            const b = Buffer.from(row.blob);
            if (!b.includes(oldBuf)) continue;
            const out = Buffer.from(b);
            let idx = 0;
            while ((idx = out.indexOf(oldBuf, idx)) !== -1) {
              newBuf.copy(out, idx);
              idx += newBuf.length;
            }
            update.run(out, row.id);
          }
        }
      } finally {
        db.close();
      }
    }

    if (hasBrain) {
      const srcLogs = join(srcBrain, '.system_generated/logs');
      const dstLogs = join(dstBrain, '.system_generated/logs');
      const hasLogsDir = await stat(srcLogs).then(info => info.isDirectory()).catch(() => false);
      if (hasLogsDir) {
        await mkdir(dstLogs, { recursive: true });
        for (const name of ['transcript_full.jsonl', 'transcript.jsonl']) {
          const from = join(srcLogs, name);
          if (await stat(from).then(info => info.isFile()).catch(() => false)) {
            await copyFile(from, join(dstLogs, name));
          }
        }
      } else {
        await cp(srcBrain, dstBrain, { recursive: true });
      }
    }

    const srcAnnotation = join(agyRoot, 'annotations', `${oldSessionId}.pbtxt`);
    if (await stat(srcAnnotation).then(info => info.isFile()).catch(() => false)) {
      await mkdir(join(agyRoot, 'annotations'), { recursive: true });
      await copyFile(srcAnnotation, dstAnnotation);
    }

    await mkdir(cacheDir, { recursive: true });
    let mapping: Record<string, string> = {};
    try {
      const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mapping = parsed as Record<string, string>;
    } catch { /* Start a fresh mapping file if none exists yet. */ }
    for (const key of new Set([newFolder, realNewFolder])) {
      previousCacheEntries.set(key, Object.hasOwn(mapping, key) ? mapping[key] : undefined);
      mapping[key] = newSessionId;
    }
    const tmpCache = `${cachePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpCache, JSON.stringify(mapping, null, 2), { mode: 0o600 });
      await rename(tmpCache, cachePath);
      cacheTouched = true;
    } finally {
      await unlink(tmpCache).catch(() => {});
    }
    return rollback;
  } catch (error) {
    await rollback();
    throw error;
  }
}

// Folder validation and Claude memory: check the destination and optionally copy its memory files.
/** Maps a working folder path to the folder name Claude uses under `~/.claude/projects/`. */
export const claudeProjectSlug = (folder: string) => folder.replace(/[^a-zA-Z0-9]/g, '-');

/**
 * Validates the target folder for moving a room, using the same workspace limit rule as the folder picker:
 * no `..`, must exist and be a directory inside `workspace`, and symlink aliases under `workspace` keep their lexical path.
 */
export async function validateMoveFolder(workspace: string, requested: unknown): Promise<string> {
  if (typeof requested !== 'string' || !isAbsolute(requested.trim())) {
    throw new Error('請輸入 Mac 絕對路徑。');
  }
  const trimmed = requested.trim();
  if (trimmed.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('工作資料夾路徑不可以包含 .. 或相對路徑。');
  }
  const real = await realpath(trimmed).catch(() => {
    throw new Error('找不到這個資料夾。請先確認路徑存在和磁碟已掛載。');
  });
  const info = await stat(real).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error('工作目錄須是實際資料夾，不是檔案。');
  }
  const outside = (from: string, to: string) => {
    const inside = relative(from, to);
    return inside.startsWith('..') || isAbsolute(inside);
  };
  const lexical = resolve(trimmed);
  const limitLexical = resolve(workspace);
  const base = await realpath(workspace).catch(() => limitLexical);
  if (!outside(limitLexical, lexical)) return lexical;
  if (!outside(base, real)) return real;
  throw new Error('工作資料夾須在允許的工作區內。');
}

export interface MemoryCopyResult {
  copied: number;
  skipped: number;
  missing: boolean;
}

const realOrSelf = async (folder: string) => realpath(folder).catch(() => folder);

/**
 * Copies `*.md` files from the old folder's Claude memory directory to the new folder's Claude memory directory.
 * Uses `realpath` of each folder to compute the project slug (matching the physical cwd the CLI runs in).
 * Copy only: never moves, never deletes, and never overwrites an existing file in the target folder.
 */
export async function copyClaudeMemory(
  fromFolder: string,
  toFolder: string,
  projectsRoot = join(homedir(), '.claude/projects'),
): Promise<MemoryCopyResult> {
  const [realFrom, realTo] = await Promise.all([realOrSelf(fromFolder), realOrSelf(toFolder)]);
  const sourceDir = join(projectsRoot, claudeProjectSlug(realFrom), 'memory');
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return { copied: 0, skipped: 0, missing: true };
  const mdFiles = entries.filter(entry => entry.isFile() && /\.md$/i.test(entry.name)).map(entry => entry.name).sort();
  if (!mdFiles.length) return { copied: 0, skipped: 0, missing: false };
  const targetDir = join(projectsRoot, claudeProjectSlug(realTo), 'memory');
  await mkdir(targetDir, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const name of mdFiles) {
    try {
      await copyFile(join(sourceDir, name), join(targetDir, name), constants.COPYFILE_EXCL);
      copied++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') skipped++;
      else throw error;
    }
  }
  return { copied, skipped, missing: false };
}

// Replace a stale room and hand over its work: preserve group membership and pending tickets.
/**
 * A Claude room that was left alone for hours stops at "Resume this conversation?" and nothing moves until someone answers.
 * A member of a group (not its lead) is replaced instead: a new room with the same name, folder, model and effort takes its seat,
 * its unfinished tickets, and its place in the group; the lead is told; the old room is closed and put away.
 */
export interface ReplaceDeps {
  rooms: {
    clone(old: TerminalRoom): Promise<TerminalRoom>;
    close(room: TerminalRoom): Promise<void>;
    archive(room: TerminalRoom): Promise<void>;
    find(roomId: string): TerminalRoom | undefined;
    /** Say a first word to the new room: a Claude conversation has no record, and so no session ID of its own, until a message has been sent. */
    greet(room: TerminalRoom): Promise<void>;
  };
  groups: { snapshot(): GroupChat[]; replaceRoom(oldId: string, newId: string): number };
  bench: Bench;
  successors: { set(from: string, to: string | null): boolean };
  /** A quiet line in a room's conversation. */
  note(roomId: string, text: string): void;
  /** Waits between looks for the new room's own session ID (default: a timer). */
  pause?(ms: number): Promise<void>;
}

export type ReplaceVerdict = { replace: true } | { replace: false; why: 'not-claude' | 'no-group' | 'lead' };

export function replaceVerdict(groups: GroupChat[], room: TerminalRoom): ReplaceVerdict {
  if (room.modelId !== 'CLAUDE') return { replace: false, why: 'not-claude' };
  const homes = groups.filter(group => group.members.some(member => member.roomId === room.id));
  if (!homes.length) return { replace: false, why: 'no-group' };
  if (homes.some(group => group.orchestratorRoomId === room.id)) return { replace: false, why: 'lead' };
  return { replace: true };
}

const partyOf = (room: TerminalRoom): BenchParty => ({ sessionId: room.sessionId ?? room.id, roomName: room.roomName, modelId: room.modelId });

export type ReplaceResult = { replaced: true; room: TerminalRoom; moved: number[] } | { replaced: false; why: string };

interface HandoverNotice {
  roomLine: (movedList: string) => string;
  leadTitle: string;
  leadBody: (movedList: string, oldSessionKey: string) => string;
  greetPrompt?: string;
  greetFailNote: string;
  closeBeforeGreet?: boolean;
}

async function handOverRoom(
  deps: Omit<ReplaceDeps, 'rooms'> & {
    rooms: Pick<ReplaceDeps['rooms'], 'close' | 'archive' | 'find'> & {
      greet(room: TerminalRoom, prompt?: string): Promise<void>;
    };
  },
  old: TerminalRoom,
  next: TerminalRoom,
  notice: HandoverNotice,
): Promise<{ room: TerminalRoom; moved: number[] }> {
  const oldKeys = [...new Set([old.sessionId, old.id].filter((key): key is string => Boolean(key)))];
  deps.groups.replaceRoom(old.id, next.id);
  const named = next.sessionId ?? next.id;
  const moved = deps.bench.retarget(oldKeys, partyOf(next), { from: old.id, to: next.id });
  // What is still aimed at the old room goes to the new one (a reply to an old ticket, a message to the old name).
  try { deps.successors.set(oldKeys[0], named); } catch { /* A loop or a missing key: the tickets were moved above anyway. */ }

  const list = moved.length ? moved.map(id => `#${id}`).join(' ') : '沒有';
  const line = notice.roomLine(list);
  deps.note(next.id, line);
  for (const group of deps.groups.snapshot().filter(item => item.members.some(member => member.roomId === next.id))) {
    const lead = group.orchestratorRoomId ? deps.rooms.find(group.orchestratorRoomId) : undefined;
    if (!lead || lead.id === next.id) continue;
    deps.note(lead.id, line);
    try {
      deps.bench.send({
        groupId: group.id, from: partyOf(next), to: partyOf(lead), kind: 'notice', title: notice.leadTitle,
        body: notice.leadBody(list, oldKeys[0]),
      });
    } catch { /* The note above already tells the lead's room; a refused ticket must not undo the move. */ }
  }

  if (notice.closeBeforeGreet) {
    try { await deps.rooms.archive(old); } catch { deps.note(old.id, '換房後封存舊房失敗，請手動封存。'); }
  }

  // One word to the new room makes the CLI write its record, so the room binds its new session ID.
  try { await deps.rooms.greet(next, notice.greetPrompt); } catch { deps.note(next.id, notice.greetFailNote); }
  await adoptSession(deps, next, named, oldKeys[0]);

  if (!notice.closeBeforeGreet) {
    try { await deps.rooms.close(old); } catch { /* The room is archived below either way. */ }
    try { await deps.rooms.archive(old); } catch { deps.note(old.id, '換房後封存舊房失敗，請手動封存。'); }
  }
  return { room: next, moved };
}

export async function replaceStaleRoom(deps: ReplaceDeps, old: TerminalRoom): Promise<ReplaceResult> {
  const verdict = replaceVerdict(deps.groups.snapshot(), old);
  if (!verdict.replace) return { replaced: false, why: verdict.why };
  let next: TerminalRoom;
  try { next = await deps.rooms.clone(old); }
  catch (error) { return { replaced: false, why: error instanceof Error ? error.message : '新房未能啟動。' }; }

  const { room, moved } = await handOverRoom(deps, old, next, {
    roomLine: list => `${partyName(partyOf(next))} 閒置太久，已自動換房：身份、崗位同方向不變。未完成工單已轉去新房：${list}。舊房已封存。`,
    leadTitle: `換房通知：${next.roomName}`,
    leadBody: (list, oldKey) =>
      `${partyName(partyOf(next))} 換咗房，身份、崗位、方向不變。\n` +
      `原因：舊房閒置太久，停在 Resume 選單。\n` +
      `新房 Session ID：${next.sessionId ?? next.id}\n舊房 Session ID：${oldKey}（已封存，唔好再派單去舊房）\n` +
      `已轉去新房嘅未完成工單：${list}。\n之後照舊用 @崗位 或房名派單就得。`,
    greetFailNote: '自動換房後未能送出第一句，請喺呢間房講一句話，Session 先會建立。',
  });
  return { replaced: true, room, moved };
}

// Move a room and adopt its session: fork into the destination and bind its new identity.
export interface MoveRoomDeps {
  workspace: string;
  claudeProjectsRoot?: string;
  rooms: {
    isBusy(room: TerminalRoom): boolean;
    fork(old: TerminalRoom, folder: string): Promise<TerminalRoom>;
    close(room: TerminalRoom): Promise<void>;
    reopen(room: TerminalRoom): Promise<void>;
    archive(room: TerminalRoom): Promise<void>;
    find(roomId: string): TerminalRoom | undefined;
    greet(room: TerminalRoom, prompt?: string): Promise<void>;
  };
  groups: { snapshot(): GroupChat[]; replaceRoom(oldId: string, newId: string): number };
  bench: Bench;
  successors: { set(from: string, to: string | null): boolean };
  note(roomId: string, text: string): void;
  pause?(ms: number): Promise<void>;
}

export interface MoveRoomResult {
  room: TerminalRoom;
  folder: string;
  moved: number[];
  memory?: MemoryCopyResult;
}

/**
 * Forks an idle room (Claude, Codex, or AGY) into a new working folder,
 * optionally copies Claude's `*.md` memory files without overwriting (other memory stays in the configured workspace),
 * hands over group seat/role/direction/tickets/claims, archives the old room, and tells the agent in the new room.
 * If the new room fails to start after the old room was closed, the old room is reopened on its own session.
 */
export async function moveRoom(
  deps: MoveRoomDeps,
  old: TerminalRoom,
  options: { folder: unknown; copyMemory?: boolean },
): Promise<MoveRoomResult> {
  if (old.modelId !== 'CLAUDE' && old.modelId !== 'CODEX' && old.modelId !== 'AGY') {
    throw new Error('目前不支援這個 CLI 更改工作資料夾。');
  }
  if (deps.rooms.isBusy(old)) {
    throw new Error('CLI 工作中。要等它回到輸入提示，才可以更改工作資料夾（會分叉對話到新資料夾）。');
  }
  if (!old.sessionId || old.resumable === false || !validUuid.test(old.sessionId)) {
    throw new Error('這間房未有可續接的對話，暫時未能更改工作資料夾。請先講一句話再試。');
  }
  const folder = await validateMoveFolder(deps.workspace, options.folder);
  if (folder === old.repoPath) {
    throw new Error('這間房已經在這個工作資料夾。');
  }

  const wasLive = Boolean(old.live);
  if (wasLive) {
    await deps.rooms.close(old);
  }

  let memory: MemoryCopyResult | undefined;
  let memoryError: string | undefined;
  if (old.modelId === 'CLAUDE' && options.copyMemory === true) {
    try {
      memory = await copyClaudeMemory(old.repoPath, folder, deps.claudeProjectsRoot);
    } catch (error) {
      memoryError = error instanceof Error ? error.message : String(error);
    }
  }

  let next: TerminalRoom;
  try {
    next = await deps.rooms.fork(old, folder);
  } catch (error) {
    if (wasLive) {
      try { await deps.rooms.reopen(old); } catch { /* Leave the error below for the Founder if reopen also fails. */ }
    }
    throw error;
  }

  const memoryLine = memoryError
    ? ` 記憶複製失敗：${memoryError}，已略過。`
    : !memory
      ? ''
      : memory.missing
        ? ' 舊資料夾未有記憶資料夾，已略過複製記憶。'
        : ` 已複製 ${memory.copied} 個記憶檔${memory.skipped ? `（略過 ${memory.skipped} 個同名現有檔案）` : ''}。`;

  const agentPrompt = `呢間房由「${old.roomName}」分叉過嚟，而家嘅工作資料夾係 ${folder}。舊對話入面指向舊資料夾（${old.repoPath}）嘅路徑唔再適用。`;
  const { room, moved } = await handOverRoom(deps, old, next, {
    roomLine: list =>
      `已由「${old.roomName}」（${old.repoPath}）分叉至新工作資料夾：${folder}。舊對話入面指向舊資料夾嘅路徑唔再適用。${memoryLine}${movedCountNote(list)}舊房已封存。`,
    leadTitle: `更改資料夾通知：${next.roomName}`,
    leadBody: (list, oldKey) =>
      `${partyName(partyOf(next))} 已更改工作資料夾至 ${folder}（舊資料夾：${old.repoPath}），身份、崗位、方向不變。\n` +
      `新房 Session ID：${next.sessionId ?? next.id}\n舊房 Session ID：${oldKey}（已封存，唔好再派單去舊房）\n` +
      `已轉去新房嘅未完成工單：${list}。`,
    greetPrompt: agentPrompt,
    greetFailNote: '已切換到新工作資料夾，但未能自動送出第一句通知；請講一句話以建立新 Session。',
    closeBeforeGreet: true,
  });

  return { room, folder, moved, ...(memory ? { memory } : {}) };
}

export const moveClaudeRoom = moveRoom;

const movedCountNote = (list: string) => (list === '沒有' ? ' ' : ` 未完成工單已轉去新房：${list}。`);

/**
 * Until the first word is written the new room is known by its room ID. When its own session ID appears, the tickets that name it follow
 * (a ticket routed to a verified session is refused otherwise). It looks for a short while; a room with no session yet is left as it is.
 */
async function adoptSession(
  deps: Pick<ReplaceDeps, 'bench' | 'successors' | 'pause'> & { rooms: Pick<ReplaceDeps['rooms'], 'find'> },
  next: TerminalRoom,
  named: string,
  oldKey?: string,
) {
  const pause = deps.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let look = 0; look < 10; look++) {
    const current = deps.rooms.find(next.id);
    if (current?.sessionId && current.sessionId !== named) {
      try { deps.bench.retarget([named, next.id], partyOf(current), { from: next.id, to: next.id }); } catch { /* The tickets still name the room ID, which still finds the room. */ }
      if (oldKey) { try { deps.successors.set(oldKey, current.sessionId); } catch { /* Ignore loop */ } }
      return;
    }
    if (current?.sessionId) return;
    await pause(1_000);
  }
}
