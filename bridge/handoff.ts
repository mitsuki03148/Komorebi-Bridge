import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import type { FixedBenchWake, LaunchModes, ServerEvent } from '../src/types/bridge';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';
import { followSuccessor } from './successors';
import { roomAutoMode } from '../src/utils/launchMode';

/** Exit codes of `komorebi-room`: 0 sent, 1 failed, 2 bad usage, 3 stopped by a rule (tell the Founder, do not wait). */
export type HandoffOutcome = { code: 0 | 1 | 2 | 3; lines: string[] };

export const nativeTestFile = (workspace: string) => join(workspace, '.komorebi-native-test-room.json');

/** The AGY rooms native tests may go to, in the Founder's order of preference (the first one that is free is used). */
export function readNativeTestRooms(workspace: string): string[] {
  try {
    const saved = JSON.parse(readFileSync(nativeTestFile(workspace), 'utf8'));
    return Array.isArray(saved?.roomIds) ? saved.roomIds.filter((id: unknown): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

/** Only the Founder sets this. */
export function writeNativeTestRooms(workspace: string, roomIds: string[]) {
  const path = nativeTestFile(workspace);
  if (!roomIds.length) { try { unlinkSync(path); } catch { /* Already cleared. */ } return; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ roomIds }), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch { /* The rename removed it. */ } }
}

export type Found = { room: TerminalRoom } | { error: string };

/** A room by id, session id, exact name, or a unique part of its name. */
export function findRoom(rooms: TerminalRoom[], query: string): Found {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return { error: '請指明房間。' };
  const exact = rooms.filter(room => room.id.toLowerCase() === wanted || room.sessionId?.toLowerCase() === wanted);
  const byName = rooms.filter(room => room.roomName.toLowerCase() === wanted);
  const partial = rooms.filter(room => room.roomName.toLowerCase().includes(wanted));
  const hits = exact.length ? exact : byName.length ? byName : partial;
  if (hits.length === 1) return { room: hits[0] };
  if (!hits.length) return { error: `找不到房間「${query}」。` };
  return { error: `「${query}」對應多間房，請用房名全名或 Session ID：\n${hits.map(room => `  ${room.modelId} · ${room.roomName} · ${room.sessionId ?? room.id}`).join('\n')}` };
}

/** Designated rooms are kept by Session ID (the CLI's own id), so they survive Komorebi renumbering its rooms. */
const designatedRoom = (rooms: Map<string, TerminalRoom>, entry: string) =>
  [...rooms.values()].find(room => room.sessionId?.toLowerCase() === entry.toLowerCase() || room.id === entry);

/** The rooms (any CLI) the Founder gave the native-test role in the sender's own groups. The role is set only from the group menu, so it is the group's own list: a new group needs no change to the workspace file. */
export function groupNativeTestRooms(rooms: Map<string, TerminalRoom>, groups: GroupChat[], from?: string): TerminalRoom[] {
  if (!from) return [];
  const sender = findRoom([...rooms.values()], from);
  if ('error' in sender) return [];
  const found = new Map<string, TerminalRoom>();
  for (const group of groups) {
    if (!group.members.some(member => member.roomId === sender.room.id)) continue;
    for (const member of group.members) {
      const room = rooms.get(member.roomId);
      if (room && member.role?.key === 'native-test') found.set(room.id, room);
    }
  }
  return [...found.values()];
}

export const roomState = (room: TerminalRoom) =>
  !room.live ? '未開' : room.pendingApproval ? '等待審批' : room.ready ? '閒' : room.steerable ? '工作中（可 steer）' : '忙';

export function listLines(rooms: TerminalRoom[], modes: LaunchModes | null, nativeTestRooms: string[] = []) {
  const rank = (room: TerminalRoom) => nativeTestRooms.findIndex(entry => entry.toLowerCase() === room.sessionId?.toLowerCase() || entry === room.id);
  return rooms.map(room => [
    room.modelId.padEnd(6), roomState(room).padEnd(12),
    (modes ? (roomAutoMode(room, modes) ? '免審批' : '逐項審批') : '模式未知').padEnd(8),
    rank(room) >= 0 ? `[native-test ${rank(room) + 1}]` : '', room.roomName, `(${room.sessionId ?? room.id})`,
  ].filter(Boolean).join(' '));
}

/** Below these the Orchestrator does not hand work to 響 or 瞳: MP (the 5-hour allowance) under 10%, or HP (the weekly one) under 5%, left. */
export const dispatchFloor = { mp: 10, hp: 5 } as const;

export type DispatchQuota = Readonly<{ hp: number | null; mp: number | null }>;
const quotaPercent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

/** HP is weekly and MP is 5-hour; no display rounding enters a routing decision. */
export const remainingDispatchQuota = (character: CharacterProfile | undefined): DispatchQuota =>
  ({ hp: quotaPercent(character?.mpWeekly?.current), mp: quotaPercent(character?.hp5h?.current) });

export function lowDispatchQuota(modelId: CLIModelId, { hp, mp }: DispatchQuota) {
  return modelId !== 'CODEX' && ((hp !== null && hp < dispatchFloor.hp) || (mp !== null && mp < dispatchFloor.mp));
}

/**
 * The allowance each character has left, as the Komorebi cards show it: HP is the weekly one, MP the 5-hour one.
 * For 響 and 瞳 a line says plainly when work should not be handed to them.
 */
export function quotaLines(characters: Partial<Record<CLIModelId, CharacterProfile>>): string[] {
  const order: [CLIModelId, string][] = [['AGY', '瞳'], ['CODEX', '光'], ['CLAUDE', '響']];
  const pct = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : undefined;
  const lines = ['額度（剩餘；HP＝週，MP＝5 小時）：'];
  for (const [id, name] of order) {
    const character = characters[id];
    if (!character) continue;
    const hp = pct(character.mpWeekly?.current), mp = pct(character.hp5h?.current);
    const low = id !== 'CODEX' && ((mp !== undefined && mp < dispatchFloor.mp) || (hp !== undefined && hp < dispatchFloor.hp));
    const unknown = id !== 'CODEX' && (hp === undefined || mp === undefined);
    lines.push(`  ${name}  HP ${hp ?? '—'}%  MP ${mp ?? '—'}%${low ? `  ⚠ 唔派工（MP 低於 ${dispatchFloor.mp}% 或 HP 低於 ${dispatchFloor.hp}%）` : unknown ? '  （額度未知，寫「額度未核」）' : ''}`);
  }
  return lines.length > 1 ? lines : [];
}

export interface SendOptions {
  url: string;
  query: string;
  text: string;
  from?: string;
  /** The message hands a native (Xcode / Simulator) test to a room the Founder named for it (any CLI): only the Founder's rooms, and only one that is free. Use the room "native-test" to take the first free one. */
  nativeTest?: boolean;
  /** Send even if the room asks for approval (only when the Founder is watching). */
  allowAsk?: boolean;
  /** How long to wait for a busy CLI that cannot be steered, and for a closed room to open. */
  waitSeconds?: number;
  /** A stored named workbench ticket has already resolved its recipient. */
  benchRecipient?: boolean;
}

type Snapshot = Extract<ServerEvent, { type: 'SNAPSHOT' }>;

class Link {
  rooms = new Map<string, TerminalRoom>();
  modes: LaunchModes | null = null;
  characters: Partial<Record<CLIModelId, CharacterProfile>> = {};
  groups: GroupChat[] = [];
  roleRoutingSupported = false;
  successors: Record<string, string> = {};
  workspace = join(homedir(), 'Komorebi');
  private waiters = new Set<(event: ServerEvent) => void>();
  private constructor(private readonly socket: WebSocket) {}

  static async open(url: string): Promise<Link> {
    const target = new URL(url);
    const socket = new WebSocket(`${target.protocol === 'https:' ? 'wss' : 'ws'}://${target.host}/ws`, { origin: target.origin });
    const link = new Link(socket);
    socket.on('message', data => {
      let event: ServerEvent;
      try { event = JSON.parse(data.toString()); } catch { return; }
      link.apply(event);
      for (const waiter of [...link.waiters]) waiter(event);
    });
    await link.until(event => event.type === 'SNAPSHOT', 10, 'Bridge 沒有回應（未開或網址錯？）', socket);
    return link;
  }

  private apply(event: ServerEvent) {
    if (event.type === 'SNAPSHOT') {
      const snapshot = event as Snapshot;
      this.rooms = new Map(snapshot.rooms.map(room => [room.id, room]));
      this.modes = snapshot.launchModes ?? null;
      this.groups = snapshot.groups ?? [];
      this.roleRoutingSupported = snapshot.roleRoutingSupported === true;
      this.characters = snapshot.characters ?? {};
      this.successors = snapshot.successors ?? {};
      this.workspace = snapshot.workspaceRoot ?? this.workspace;
    } else if (event.type === 'ROOM' || event.type === 'SYNC_UPDATE') {
      if (event.room) this.rooms.set(event.room.id, event.room);
    } else if (event.type === 'ROOM_REMOVED') this.rooms.delete(event.roomId);
    else if (event.type === 'LAUNCH_MODES') this.modes = event.launchModes;
    else if (event.type === 'SUCCESSORS') this.successors = event.successors;
    else if (event.type === 'GROUP') this.groups = [...this.groups.filter(group => group.id !== event.group.id), event.group];
  }

  send(event: object) { this.socket.send(JSON.stringify(event)); }
  close() { this.socket.close(); }

  /** Wait for an event (not poll): resolves on the first event the test accepts, fails after the time limit. */
  until(test: (event: ServerEvent) => boolean, seconds: number, onTimeout: string, socket: WebSocket = this.socket) {
    return new Promise<ServerEvent>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(waiter); socket.off('error', failed); socket.off('close', closed); };
      const waiter = (event: ServerEvent) => { if (test(event)) { done(); resolve(event); } };
      const failed = (error: Error & { code?: string }) => { done(); reject(new Error(`連不到 Bridge（${error.code ?? error.message ?? '未知原因'}），請確認 Bridge 有開、KOMOREBI_URL／KOMOREBI_PORT 正確。`)); };
      const closed = () => { done(); reject(new Error('Bridge 連線已斷開。')); };
      const timer = setTimeout(() => { done(); reject(new Error(onTimeout)); }, seconds * 1000);
      this.waiters.add(waiter);
      socket.on('error', failed);
      socket.on('close', closed);
    });
  }
}

const stop = (message: string): HandoffOutcome => ({ code: 3, lines: [`STOP：${message}`] });

const roomKey = (room: TerminalRoom) => room.sessionId ?? room.id;
const roomByKey = (rooms: Map<string, TerminalRoom>, key: string) => [...rooms.values()].find(room => room.sessionId?.toLowerCase() === key.toLowerCase() || room.id === key);

/** The room a message is really for: `@orchestrator` is the sender's group's current lead; a room that was taken over is replaced by its successor. */
export function resolveTarget(rooms: Map<string, TerminalRoom>, groups: GroupChat[], successors: Record<string, string>, query: string, from?: string): { room: TerminalRoom; notes: string[] } | { error: string } {
  const all = [...rooms.values()];
  let found: Found;
  if (query.trim().toLowerCase() === '@orchestrator') {
    if (!from) return { error: '@orchestrator 要配 --from <你自己的房名或 Session ID>，先知你係邊個群組。' };
    const sender = findRoom(all, from);
    if ('error' in sender) return { error: sender.error };
    const leads = new Map<string, TerminalRoom>();
    for (const group of groups) {
      if (!group.members.some(member => member.roomId === sender.room.id) || !group.orchestratorRoomId) continue;
      const lead = rooms.get(group.orchestratorRoomId);
      if (lead) leads.set(lead.id, lead);
    }
    if (!leads.size) return { error: '你所屬群組未有現任總指揮 ♛。請 Founder 喺群組選單揀一個，或者用房名／Session ID 直接指明。' };
    if (leads.size > 1) return { error: `你喺幾個群組都有總指揮 ♛，唔知邊個：\n${[...leads.values()].map(lead => `  ${lead.roomName} · ${roomKey(lead)}`).join('\n')}\n請用 Session ID 指明。` };
    found = { room: [...leads.values()][0] };
    if (found.room.id === sender.room.id) return { error: '你自己就係現任總指揮 ♛，冇人可以交。' };
  } else found = findRoom(all, query);
  if ('error' in found) return found;
  const notes: string[] = [];
  const next = followSuccessor(successors, roomKey(found.room));
  const target = next.via.length ? roomByKey(rooms, next.key) : undefined;
  if (target && target.id !== found.room.id) {
    notes.push(`「${found.room.roomName}」已由「${target.roomName}」接手，改送「${target.roomName}」。`);
    return { room: target, notes };
  }
  return { room: found.room, notes };
}

/** After a message did not arrive: say so plainly, and point at where the work may have moved. */
function routeHint(link: Link, room: TerminalRoom, from?: string): string[] {
  const lines = ['未送達：訊息冇入對方房，唔好當已送。'];
  const lead = link.groups.filter(group => group.members.some(member => member.roomId === room.id) && group.orchestratorRoomId && group.orchestratorRoomId !== room.id)
    .map(group => link.rooms.get(group.orchestratorRoomId!)).find((item): item is TerminalRoom => Boolean(item));
  if (lead) lines.push(`「${room.roomName}」所屬群組嘅現任總指揮 ♛ 係「${lead.roomName}」（${roomKey(lead)}）。對方如果已換房，改用：komorebi-room send @orchestrator --from ${from ?? '<你>'} "<訊息>"。`);
  lines.push('用 komorebi-room list 核對對方而家係邊間房。');
  return lines;
}

/** Tell the Bridge how a handoff ended, so a failure can be read back later. Best effort: it never changes the outcome or holds it up. */
async function reportHandoff(url: string, report: { from?: string; to?: string; code: number; ms: number; note: string }) {
  await new Promise<void>(resolve => {
    let socket: WebSocket;
    const done = () => { clearTimeout(timer); try { socket.close(); } catch { /* Already closed. */ } resolve(); };
    const timer = setTimeout(done, 2_000);
    try {
      const target = new URL(url);
      socket = new WebSocket(`${target.protocol === 'https:' ? 'wss' : 'ws'}://${target.host}/ws`, { origin: target.origin });
      socket.on('open', () => socket.send(JSON.stringify({ type: 'HANDOFF_REPORT', ...report }), done));
      socket.on('error', done);
    } catch { clearTimeout(timer); resolve(); }
  });
}

/** Hand a message to another agent's room through the Bridge, under that room's own permission mode. */
export async function sendHandoff(options: SendOptions): Promise<HandoffOutcome> {
  const started = Date.now();
  const meta: { to?: string } = {};
  const outcome = await sendHandoffInner(options, meta);
  const note = outcome.lines.filter(line => !/^已叫醒/.test(line)).join(' ｜ ');
  await reportHandoff(options.url, { from: options.from, to: meta.to ?? options.query, code: outcome.code, ms: Date.now() - started, note });
  return outcome;
}

async function sendHandoffInner(options: SendOptions, meta: { to?: string }): Promise<HandoffOutcome> {
  const query = options.query.trim().toLowerCase();
  if (query.startsWith('@') && query !== '@orchestrator') {
    return { code: 2, lines: ['@崗位只供 bench send 派新工單。直接交接請用房名或 Session ID。'] };
  }
  const wait = options.waitSeconds ?? 120;
  let link: Link;
  try { link = await Link.open(options.url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    // A room is free for a native test when nobody is using it: closed, or open and back at its input.
    const free = (candidate: TerminalRoom) => !candidate.live || (candidate.ready === true && !candidate.pendingApproval);
    let found: Found;
    const redirected: string[] = [];
    if (options.nativeTest) {
      const listed = readNativeTestRooms(link.workspace).map(entry => designatedRoom(link.rooms, entry)).filter((item): item is TerminalRoom => Boolean(item));
      const designated = [...groupNativeTestRooms(link.rooms, link.groups, options.from), ...listed].filter((room, index, all) => all.findIndex(other => other.id === room.id) === index);
      if (!designated.length) return stop('Founder 未指定 native test 用的房（群組裏冇人有 native-test 崗位，名單亦冇可用的房）。請向 Founder 核對，請勿自行選擇房。');
      if (options.query === 'native-test') {
        const next = designated.find(free);
        if (!next) return stop(`Founder 指定的 native test 房全部都正在使用中：${designated.map(item => `「${item.roomName}」${roomState(item)}`).join('、')}。請勿插入進行中的測試。`);
        found = { room: next };
      } else {
        found = findRoom([...link.rooms.values()], options.query);
        if ('room' in found) {
          if (!designated.some(item => item.id === (found as { room: TerminalRoom }).room.id)) return stop(`「${found.room.roomName}」不是 Founder 指定的 native test 房。`);
          if (!free(found.room)) return stop(`native test 房「${found.room.roomName}」現在${roomState(found.room)}，請勿插入進行中的測試（可改用 native-test 自動選擇下一間）。`);
        }
      }
    } else if (options.benchRecipient) {
      const exact = [...link.rooms.values()].find(room => room.sessionId === options.query || room.id === options.query);
      if (!exact) return { code: 2, lines: ['原收件房已不在 Bridge。'] };
      found = { room: exact };
    } else {
      const target = resolveTarget(link.rooms, link.groups, link.successors, options.query, options.from);
      if ('error' in target) return { code: 2, lines: [target.error] };
      found = { room: target.room };
      redirected.push(...target.notes);
    }
    if ('error' in found) return { code: 2, lines: [found.error] };
    const { room } = found;
    const label = `${room.modelId} · ${room.roomName}`;
    meta.to = `${label}（${roomKey(room)}）`;
    if (room.pendingApproval) return stop(`「${label}」正等待審批，再送訊息只會堆疊。請 Founder 先處理。`);
    const auto = link.modes ? roomAutoMode(room, link.modes) : false;
    if (!auto && !options.allowAsk) {
      return stop(`「${label}」是逐項審批模式，交接過去會因無人批准而卡住。請 Founder 在該房按粉盾改為免審批（或確認 Founder 正在查看，再加 --allow-ask）。`);
    }

    const lines: string[] = [...redirected];
    if (!room.live || (options.benchRecipient && !room.ready && !room.steerable)) {
      lines.push(`「${label}」等候原 Session 就緒…`);
      try {
        const ready = link.until(event => event.type === 'ERROR' || (event.type === 'ROOM' && event.room.id === room.id && event.room.live === true &&
          (event.room.ready === true || Boolean(options.benchRecipient && (event.room.pendingApproval || event.room.pendingQuestion || event.room.menu)))),
          wait, `等了 ${wait} 秒，「${label}」都未準備好。`);
        link.send({ type: 'START', roomId: room.id });
        const event = await ready;
        if (event.type === 'ERROR') throw new Error(event.message);
        if (event.type === 'ROOM' && !event.room.ready) return stop(`「${label}」仍有提示等待處理，工單留在原工作台。`);
      } catch (error) { return { code: 1, lines: [...lines, error instanceof Error ? error.message : '續接失敗。', ...routeHint(link, room, options.from)] }; }
    } else if (!room.ready && !room.steerable) {
      lines.push(`「${label}」忙碌中（未能 steer），等它回到輸入位置…`);
      try {
        await link.until(event => event.type === 'ROOM' && event.room.id === room.id && (event.room.ready === true || event.room.pendingApproval !== undefined), wait, `等了 ${wait} 秒，「${label}」尚未回到輸入位置。`);
      } catch (error) { return { code: 1, lines: [...lines, error instanceof Error ? error.message : '等候逾時。', ...routeHint(link, room, options.from)] }; }
      const now = link.rooms.get(room.id);
      if (now?.pendingApproval) return stop(`「${label}」等候期間出現審批提示，請 Founder 處理。`);
    }

    const target = link.rooms.get(room.id);
    if (options.benchRecipient && (!target || (room.sessionId && target.sessionId !== room.sessionId))) return stop('原收件房的 Session 已變更，工單留在原工作台。');
    const steering = Boolean(link.rooms.get(room.id)?.live && !link.rooms.get(room.id)?.ready && link.rooms.get(room.id)?.steerable);
    const prefix = `[交接${options.from ? `｜來自 ${options.from}` : ''}] `;
    const requestId = randomUUID().slice(0, 12);
    link.send({ type: 'INPUT', roomId: room.id, text: prefix + options.text, requestId });
    let result: ServerEvent;
    try {
      result = await link.until(event => (event.type === 'ACTION_RESULT' && event.requestId === requestId) || event.type === 'ERROR', 30, 'Bridge 沒有確認送出。');
    } catch (error) { return { code: 1, lines: [...lines, error instanceof Error ? error.message : '送出失敗。', ...routeHint(link, room, options.from)] }; }
    if (result.type === 'ERROR') return { code: 1, lines: [...lines, result.message, ...routeHint(link, room, options.from)] };
    if (result.type === 'ACTION_RESULT' && !result.ok) return { code: 1, lines: [...lines, result.message ?? '送出失敗。', ...routeHint(link, room, options.from)] };
    return { code: 0, lines: [...lines, `已${steering ? ' steer／排隊入' : '送到'}「${label}」（${auto ? '免審批' : '逐項審批'}）。回覆請對方經 komorebi-room 送返。`] };
  } finally { link.close(); }
}

export async function listRooms(url: string): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    const rooms = [...link.rooms.values()].sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)));
    const quota = quotaLines(link.characters);
    return { code: 0, lines: [...listLines(rooms, link.modes, readNativeTestRooms(link.workspace)), ...(quota.length ? ['', ...quota] : [])] };
  } finally { link.close(); }
}

export interface ReadOptions {
  /** How many of the latest messages to show. */
  messages?: number;
  /** Also show the end of the terminal screen. */
  screen?: boolean;
  /** The most characters shown of any one message. */
  chars?: number;
}

const roleName = { AGY: '瞳', CODEX: '光', CLAUDE: '響' } as const;

/** What another agent needs to see of a room without asking its owner to paste it: the latest messages, what it waits for, and (if asked) the end of its screen. */
export function readLines(room: TerminalRoom, options: ReadOptions = {}): string[] {
  const count = Math.min(Math.max(Math.floor(options.messages ?? 6), 1), 30);
  const limit = Math.min(Math.max(Math.floor(options.chars ?? 1_500), 200), 6_000);
  const lines = [`${roleName[room.modelId]} · ${room.roomName} · ${roomState(room)} · Session ${room.sessionId ?? room.id}`];
  const waiting = [
    room.pendingApproval ? `等待審批：${room.pendingApproval.title}` : '',
    ...(room.pendingQuestion?.questions ?? []).map(question => `等待回答：${question.title.replace(/\s+/g, ' ').slice(0, 200)}${question.options ? `（${question.options.join(' / ')}）` : ''}`),
  ].filter(Boolean);
  lines.push(...waiting);
  const shown = (room.logs ?? []).filter(entry => entry.sender !== 'system').slice(-count);
  lines.push(`── 最近 ${shown.length} 則對話（舊→新）──`);
  for (const entry of shown) {
    const who = entry.sender === 'user' ? '輸入' : roleName[room.modelId];
    const text = entry.text.length > limit ? `${entry.text.slice(0, limit)}…（已截斷，全文 ${entry.text.length} 字）` : entry.text;
    lines.push(`[${entry.timestamp} ${who}] ${text}`);
  }
  if (!shown.length) lines.push('（冇對話記錄）');
  if (options.screen) {
    const tail = (room.screen ?? '').split('\n').filter(line => line.trim()).slice(-24);
    lines.push('── 終端尾部 ──', ...(tail.length ? tail : ['（冇畫面，房間未開）']));
  }
  return lines;
}

/** Read another room's latest messages and state. Read only: nothing is sent to it. */
export async function readRoom(url: string, query: string, options: ReadOptions = {}): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    const found = findRoom([...link.rooms.values()], query);
    if ('error' in found) return { code: 2, lines: [found.error] };
    return { code: 0, lines: readLines(found.room, options) };
  } finally { link.close(); }
}

/** Exact workbench delivery goes through the stored reservation; it never calls resolveTarget or sends a client prompt. */
async function sendFixedBenchWake(url: string, wake: FixedBenchWake): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  const failure = (message: string): HandoffOutcome => ({ code: 1, lines: [message] });
  try {
    if (!link.roleRoutingSupported) return failure('Bridge 不再支援固定收件房。');
    const room = link.rooms.get(wake.roomId);
    if (!room) return failure('原收件房已不在 Bridge。');
    if (room.pendingApproval || room.pendingQuestion) return failure('原收件房等待審批或回答。');
    if (!room.live || (!room.ready && !room.steerable)) {
      const requestId = randomUUID();
      const ready = link.until(event => (event.type === 'ACTION_RESULT' && event.requestId === requestId && !event.ok) ||
        (event.type === 'ROOM' && event.room.id === wake.roomId && Boolean(event.room.ready || (event.room.live && (event.room.pendingApproval || event.room.pendingQuestion || event.room.menu)))) ||
        (event.type === 'ROOM_REMOVED' && event.roomId === wake.roomId), 30, '原收件房未返回輸入位置。');
      // START is idempotent for an open room, and waits for an exiting PTY of this same room.
      link.send({ type: 'BENCH_WAKE', phase: 'start', ...wake, requestId });
      const event = await ready;
      if (event.type === 'ACTION_RESULT') return failure(event.message);
      if (event.type === 'ROOM_REMOVED') return failure('原收件房已不在 Bridge。');
      if (event.type === 'ROOM' && !event.room.ready) return failure('原收件房等待審批或回答。');
    }
    const requestId = randomUUID();
    const answer = link.until(event => event.type === 'ACTION_RESULT' && event.requestId === requestId, 30, 'Bridge 未確認喚醒。');
    link.send({ type: 'BENCH_WAKE', phase: 'input', ...wake, requestId });
    const result = await answer;
    return result.type === 'ACTION_RESULT' && result.ok ? { code: 0, lines: [] } :
      failure(result.type === 'ACTION_RESULT' ? result.message : 'Bridge 未確認喚醒。');
  } catch (error) { return failure(error instanceof Error ? error.message : 'Bridge 未能喚醒原收件房。'); }
  finally { link.close(); }
}

export async function benchCommand(url: string, action: string, fields: Record<string, unknown>): Promise<HandoffOutcome> {
  const query = typeof fields.to === 'string' ? fields.to.trim() : '';
  const needsRouting = fields.groupId !== undefined || (action === 'send' && query.startsWith('@') && query.toLowerCase() !== '@orchestrator');
  const ask = async (payload: Record<string, unknown>) => {
    const link = await Link.open(url);
    try {
      const requestId = randomUUID();
      if (needsRouting && !link.roleRoutingSupported) return {
        type: 'BENCH_RESULT', requestId, ok: false, errorCode: 'ROLE_NOT_SUPPORTED',
        lines: ['Bridge 未支援按崗位派單或 --group。請用房名或 Session ID 指名，不加 --group。'],
      } satisfies Extract<ServerEvent, { type: 'BENCH_RESULT' }>;
      link.send({ type: 'BENCH', requestId, ...payload });
      return await link.until(event => event.type === 'BENCH_RESULT' && event.requestId === requestId, payload.worktree === 'new' ? 75 : 15,
        payload.worktree === 'new' ? '建立 worktree 未收到回覆；工單可能已建立，請先核對記錄才重試。' : 'Bridge 未回應工作台請求（Bridge 可能未更新，請 Founder 重啟 Bridge）。') as Extract<ServerEvent, { type: 'BENCH_RESULT' }>;
    } finally { link.close(); }
  };
  let reply;
  try { reply = await ask({ action, ...fields }); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  if (!reply.ok) {
    if (reply.stop) return stop(reply.lines.join(' '));
    if (reply.errorCode) return { code: 2, lines: reply.lines };
    return { code: /找不到|請指明|未知|為空|不是派給你|與你無關/.test(reply.lines.join(' ')) ? 2 : 1, lines: reply.lines };
  }
  const lines = [...reply.lines];
  if (reply.wake) {
    const woken = await sendFixedBenchWake(url, reply.wake);
    if (woken.code === 0) return { code: 0, lines: [...lines, '已叫醒原收件房。'] };
    try { await ask({ action: 'wake-release', from: fields.from, id: reply.wake.ticket, wakeId: reply.wake.wakeId }); }
    catch { /* The Bridge expires the reservation without removing the ticket. */ }
    return { code: 0, lines: [...lines, `工單已存，但未能即時叫醒原收件房：${woken.lines.join(' ')}`] };
  }
  if (!reply.ping) return { code: 0, lines };
  const woken = await sendHandoff({ url, query: reply.ping.to, text: reply.ping.text, from: reply.ping.from, waitSeconds: 30, benchRecipient: true });
  try { await ask({ action: 'pinged', from: fields.from, id: reply.ping.ticket, ok: woken.code === 0 }); } catch { /* Only the hourly count is affected. */ }
  if (woken.code === 0) return { code: 0, lines: [...lines, '已叫醒對方。'] };
  lines.push(`工單已存，但未能即時叫醒對方：${woken.lines.join(' ')}`);
  return woken.code === 3 ? { code: 3, lines: [...lines, 'STOP：請交 Founder 處理（工單仍在對方工作台）。'] } : { code: 0, lines: [...lines, '對方下次工作時會收到。'] };
}

export async function nativeTestRoom(url: string, action: 'show' | 'set' | 'clear', queries: string[] = []): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    const current = readNativeTestRooms(link.workspace);
    if (action === 'show') {
      return { code: 0, lines: current.length ? current.map((entry, index) => `${index + 1}. ${designatedRoom(link.rooms, entry)?.roomName ?? '（房已不存在）'}（${entry}）`) : ['未指定 native test 房。'] };
    }
    if (action === 'clear') { writeNativeTestRooms(link.workspace, []); return { code: 0, lines: ['已取消指定。'] }; }
    // Rooms are given in order of preference; a session id is the sure way to name one (room names repeat).
    const chosen: TerminalRoom[] = [];
    for (const query of queries) {
      const found = findRoom([...link.rooms.values()], query);
      if ('error' in found) return { code: 2, lines: [found.error] };
      if (!chosen.includes(found.room)) chosen.push(found.room);
    }
    if (!chosen.length) return { code: 2, lines: ['請指明房間。'] };
    writeNativeTestRooms(link.workspace, chosen.map(room => room.sessionId ?? room.id));
    return { code: 0, lines: ['已指定 native test 房（按優先次序）：', ...chosen.map((room, index) => `${index + 1}. ${room.roomName}（${room.sessionId ?? room.id}）`)] };
  } finally { link.close(); }
}

/** The recent `send` outcomes the Bridge has kept (newest last), for finding out what happened to a message that did not arrive. */
export async function handoffLog(url: string, options: { last?: number; failedOnly?: boolean } = {}): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    const requestId = randomUUID();
    link.send({ type: 'HANDOFF_LOG', requestId, last: options.last, failedOnly: options.failedOnly });
    const reply = await link.until(event => event.type === 'HANDOFF_LOG_RESULT' && event.requestId === requestId, 10,
      'Bridge 未回應（可能未更新，請 Founder 重啟 Bridge）。') as Extract<ServerEvent, { type: 'HANDOFF_LOG_RESULT' }>;
    if (!reply.entries.length) return { code: 0, lines: [options.failedOnly ? '冇失敗嘅交接記錄。' : '冇交接記錄。'] };
    return { code: 0, lines: reply.entries.map(entry => {
      const state = entry.code === 0 ? '已送' : entry.code === 3 ? 'STOP' : entry.code === 2 ? '用法' : '失敗';
      return `${entry.at.replace('T', ' ').slice(0, 19)} ${state.padEnd(2)} ${entry.from ?? '—'} → ${entry.to}（${(entry.ms / 1000).toFixed(1)}s）${entry.note ? `：${entry.note}` : ''}`;
    }) };
  } catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '讀取失敗。'] }; }
  finally { link.close(); }
}

/** Only the allowance each character has left (the end of `list`, on its own). */
export async function quotaStatus(url: string): Promise<HandoffOutcome> {
  let link: Link;
  try { link = await Link.open(url); }
  catch (error) { return { code: 1, lines: [error instanceof Error ? error.message : '連不到 Bridge。'] }; }
  try {
    const lines = quotaLines(link.characters);
    return lines.length ? { code: 0, lines } : { code: 1, lines: ['Bridge 未提供額度（可能未更新，請 Founder 重啟 Bridge）。'] };
  } finally { link.close(); }
}
