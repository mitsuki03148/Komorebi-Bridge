import { execFile } from 'node:child_process';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileReadLimit, imageContentType } from './file-reader';
import type { RepoWorktree, RepoWorktrees, WorktreeDiffMode } from '../src/types/bridge';

const run = promisify(execFile);

export type WorktreeKind = 'text' | 'image' | 'other';
export interface WorktreeListing {
  /** The folder being looked at, relative to the room's folder ('' at the top). */
  path: string;
  dirs: string[];
  files: { name: string; size: number; kind: WorktreeKind }[];
  truncated: boolean;
}
export type WorktreeFile =
  | { path: string; kind: 'text'; text: string; truncated: boolean; size: number }
  | { path: string; kind: 'image'; dataUrl: string; size: number }
  | { path: string; kind: 'binary'; size: number };

export type DiffStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export interface DiffFile { path: string; status: DiffStatus; add: number; del: number; binary: boolean; truncated: boolean; patch: string }
export interface WorktreeDiff { mode: WorktreeDiffMode; subject?: string; files: DiffFile[]; truncated: boolean }

const entryLimit = 500;
const imageLimit = 8 * 1024 * 1024;
const patchLimit = 60_000;
const totalLimit = 400_000;
const untrackedLimit = 50;
const untrackedFileLimit = 100_000;
const skippedFolders = new Set(['node_modules']);
const imageExtension = /\.(?:png|jpe?g|webp|gif)$/i;
const textExtension = /\.(?:md|markdown|txt|log|json|ts|tsx|js|jsx|mjs|cjs|css|html|yml|yaml|toml|sh|py|swift|rs|go|java|kt|sql|xml|csv|env\.example)$/i;

/**
 * Turn a path the phone sent into a real path inside the room's folder. The path is relative, has no "..", no hidden part,
 * and still points inside the folder once symlinks are followed. Read only: nothing here writes.
 */
export async function resolveInside(root: string, requested: unknown): Promise<{ base: string; real: string; rel: string }> {
  const base = await realpath(root).catch(() => { throw new Error('這間房的資料夾讀不到。'); });
  const rel = requested === undefined || requested === '' ? '' : requested;
  if (typeof rel !== 'string' || rel.includes('\0') || isAbsolute(rel)) throw new Error('請用資料夾內的相對路徑。');
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(part => part === '..' || part === '.')) throw new Error('路徑不可以包含 ..。');
  if (parts.some(part => part.startsWith('.'))) throw new Error('隱藏檔案或資料夾不開放。');
  const real = await realpath(join(base, ...parts)).catch(() => { throw new Error('找不到這個路徑。'); });
  const inside = relative(base, real);
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('這個路徑不在這間房的資料夾內。');
  return { base, real, rel: parts.join('/') };
}

const kindOf = (name: string): WorktreeKind => imageContentType(name) ? 'image' : textExtension.test(name) ? 'text' : 'other';

export async function listWorktree(root: string, requested?: unknown): Promise<WorktreeListing> {
  const { real, rel } = await resolveInside(root, requested);
  if (!(await stat(real)).isDirectory()) throw new Error('要是資料夾，不是檔案。');
  const entries = await readdir(real, { withFileTypes: true }).catch(() => { throw new Error('這個資料夾讀不到。'); });
  const dirs: string[] = [];
  const files: WorktreeListing['files'] = [];
  let truncated = false;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))) {
    if (entry.name.startsWith('.') || skippedFolders.has(entry.name)) continue;
    if (dirs.length + files.length >= entryLimit) { truncated = true; break; }
    const info = await stat(join(real, entry.name)).catch(() => undefined);
    if (!info) continue;
    // A link that leaves the folder is not shown.
    if (entry.isSymbolicLink()) {
      const target = await realpath(join(real, entry.name)).catch(() => undefined);
      const base = await realpath(root);
      const inside = target ? relative(base, target) : '..';
      if (inside.startsWith('..') || isAbsolute(inside)) continue;
    }
    if (info.isDirectory()) dirs.push(entry.name);
    else if (info.isFile()) files.push({ name: entry.name, size: info.size, kind: kindOf(entry.name) });
  }
  return { path: rel, dirs, files, truncated };
}

export async function readWorktreeFile(root: string, requested: unknown): Promise<WorktreeFile> {
  const { real, rel } = await resolveInside(root, requested);
  const info = await stat(real);
  if (!info.isFile()) throw new Error('這不是檔案。');
  const handle = await open(real, 'r');
  try {
    if (imageExtension.test(real)) {
      if (info.size > imageLimit) return { path: rel, kind: 'binary', size: info.size };
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
      return { path: rel, kind: 'image', dataUrl: `data:${imageContentType(real)};base64,${buffer.subarray(0, bytesRead).toString('base64')}`, size: info.size };
    }
    const length = Math.min(info.size, fileReadLimit);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0)) return { path: rel, kind: 'binary', size: info.size };
    return { path: rel, kind: 'text', text: data.toString('utf8'), truncated: info.size > fileReadLimit, size: info.size };
  } finally { await handle.close(); }
}

const git = (cwd: string, args: string[]) => run('git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 15_000, encoding: 'utf8' });

const worktreeLimit = 60;
const removeFinalNewline = (value: string) => value.replace(/\n$/, '');

async function registeredWorktrees(root: string) {
  const top = await git(root, ['rev-parse', '--show-toplevel']).then(
    ({ stdout }) => realpath(removeFinalNewline(stdout)),
  ).catch(() => undefined);
  if (!top) return [];
  const { stdout } = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  const entries = await Promise.all(stdout.split('\0\0').filter(Boolean).map(async record => {
    const [location, ...fields] = record.split('\0');
    if (!location.startsWith('worktree ') || fields.includes('bare')) return;
    const path = location.slice('worktree '.length);
    const head = fields.find(field => /^HEAD [0-9a-f]{40,64}$/.test(field))?.slice(5) ?? '';
    const branch = fields.find(field => field.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null;
    const real = await realpath(path).catch(() => undefined);
    const exists = real !== undefined && await stat(real).then(info => info.isDirectory(), () => false);
    return { path, head, branch, exists, isRoom: real === top, real };
  }));
  return entries.filter(entry => entry !== undefined);
}

type RegisteredWorktree = Awaited<ReturnType<typeof registeredWorktrees>>[number];

async function orderWorktrees(root: string, entries: RegisteredWorktree[]) {
  const heads = [...new Set(entries.map(entry => entry.head).filter(head => head && /[1-9a-f]/.test(head)))];
  const dates = new Map<string, number>();
  if (heads.length > 0) {
    const { stdout } = await git(root, ['log', '--no-walk=unsorted', '--format=%H:%ct', ...heads, '--']).catch(() => ({ stdout: '' }));
    for (const line of stdout.trim().split('\n')) {
      const [head, date] = line.split(':');
      if (date) dates.set(head, Number(date));
    }
  }
  // The room stays first. Among its siblings, reachable folders come before missing ones.
  return entries.sort((a, b) => Number(b.isRoom) - Number(a.isRoom) || Number(b.exists) - Number(a.exists) ||
    (dates.get(b.head) ?? 0) - (dates.get(a.head) ?? 0));
}

type WorktreeParams = { path?: unknown; mode?: unknown; worktree?: unknown; query?: unknown };
type RememberedWorktree = { path: string; title?: string };

async function listRepoWorktrees(root: string, params: WorktreeParams | undefined, branchHint?: string, remembered?: RememberedWorktree,
  tickets: readonly RememberedWorktree[] = []): Promise<RepoWorktrees> {
  const all = await registeredWorktrees(root);
  const search = typeof params?.query === 'string' ? params.query.slice(0, 200).normalize('NFKC').toLowerCase().trim() : '';
  const words = search.split(/\s+/).filter(Boolean);
  const matches = branchHint ? all.filter(entry => entry.exists && entry.branch === branchHint) : [];
  const previous = remembered && all.find(entry => entry.exists && entry.real === remembered.path);
  const followed = previous?.real && await sharesRepository(root, previous.real) ? previous : undefined;
  let ticketWorktree: RegisteredWorktree | undefined;
  let ticketTitle: string | undefined;
  // An observed linked checkout takes priority over the task's assigned directory.
  if (!words.length && (!followed || followed.isRoom)) {
    const checked = new Set<string>();
    for (const ticket of tickets) {
      if (!isAbsolute(ticket.path) || checked.has(ticket.path)) continue;
      checked.add(ticket.path);
      const target = await realpath(ticket.path).catch(() => undefined);
      if (!target) continue;
      const entry = all.find(item => item.exists && !item.isRoom && item.real === target);
      if (!entry?.real || !await sharesRepository(root, entry.real)) continue;
      ticketWorktree = entry;
      ticketTitle = ticket.title;
      break;
    }
  }
  const suggestion = ticketWorktree ?? followed ?? (matches.length === 1 && !matches[0].isRoom ? matches[0] : undefined);
  const title = ticketWorktree ? ticketTitle : followed && remembered?.title;
  const filtered = words.length ? all.filter(entry => {
    const label = `${entry.branch ?? ''} ${entry.path} ${entry.head}`.normalize('NFKC').toLowerCase();
    return words.every(word => label.includes(word));
  }) : all;
  const entries = (await orderWorktrees(root, filtered)).slice(0, worktreeLimit);
  if (!words.length) {
    const preferred = all.find(entry => entry.exists && entry.path === params?.worktree);
    const keep = [suggestion, preferred].filter(entry => entry !== undefined);
    for (const entry of keep) {
      if (!entries.includes(entry)) {
        if (entries.length === worktreeLimit) entries.splice(entries.findLastIndex(item => !keep.includes(item)), 1);
        entries.push(entry);
      }
    }
  }
  return {
    entries: entries.map(({ path, branch, head, exists, isRoom }): RepoWorktree => ({ path, branch, head: head.slice(0, 7), exists, isRoom })),
    ...(suggestion ? { suggestedWorktree: suggestion.path } : {}),
    ...(title ? { suggestedTitle: title } : {}),
  };
}

async function sharesRepository(root: string, target: string): Promise<boolean> {
  // A stale registration can point to a folder now occupied by another repository.
  const commonArgs = ['--path-format=absolute', '--git-common-dir'];
  try {
    const [room, candidate] = await Promise.all([
      git(root, ['rev-parse', ...commonArgs]),
      git(target, ['rev-parse', '--show-prefix', ...commonArgs]),
    ]);
    if (!candidate.stdout.startsWith('\n')) return false;
    const [roomCommon, candidateCommon] = await Promise.all([
      realpath(removeFinalNewline(room.stdout)),
      realpath(removeFinalNewline(candidate.stdout.slice(1))),
    ]);
    return roomCommon === candidateCommon;
  } catch { return false; }
}

/** A caller can claim from a subdirectory. Resolve Git's top in the registered checkout only. */
export async function claimedWorktree(root: string, cwd: string): Promise<string | undefined> {
  if (!root || !isAbsolute(cwd)) return;
  const caller = await realpath(cwd).catch(() => undefined);
  if (!caller) return;
  const candidates = (await registeredWorktrees(root)).flatMap(({ exists, real }) => {
    if (!exists || !real) return [];
    const rel = relative(real, caller);
    return rel === '..' || rel.startsWith('../') || isAbsolute(rel) ? [] : [real];
  });
  if (!candidates.length) return;
  const checkout = await git(caller, ['rev-parse', '--show-toplevel'])
    .then(({ stdout }) => realpath(removeFinalNewline(stdout))).catch(() => undefined);
  if (checkout && candidates.includes(checkout) && await sharesRepository(root, checkout)) return checkout;
}

async function selectedRoot(root: string, requested: unknown): Promise<string> {
  if (requested === undefined) return root;
  const invalid = () => new Error('選擇的工作樹不屬於這間房的 Git 專案，或已無法使用。');
  if (typeof requested !== 'string' || !isAbsolute(requested)) throw invalid();
  const target = await realpath(requested).catch(() => undefined);
  if (!target) throw invalid();
  const entry = (await registeredWorktrees(root)).find(item => item.exists && item.real === target);
  if (!entry) throw invalid();
  if (entry.isRoom) return root;
  if (!await sharesRepository(root, target)) throw invalid();
  return target;
}

/** Split a unified diff into one entry per file. */
export function splitDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue;
    const lines = chunk.split('\n');
    const head = lines[0].match(/^diff --git a\/(.+) b\/(.+)$/);
    const renamed = lines.find(line => line.startsWith('rename to '))?.slice('rename to '.length);
    const path = renamed ?? head?.[2] ?? head?.[1] ?? '?';
    const status: DiffStatus = renamed ? 'renamed' : lines.some(line => line.startsWith('new file mode')) ? 'added' : lines.some(line => line.startsWith('deleted file mode')) ? 'deleted' : 'modified';
    const binary = lines.some(line => /^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch'));
    const firstHunk = lines.findIndex(line => line.startsWith('@@'));
    const body = firstHunk < 0 ? [] : lines.slice(firstHunk);
    let add = 0;
    let del = 0;
    for (const line of body) { if (line.startsWith('+')) add++; else if (line.startsWith('-')) del++; }
    const patch = body.join('\n').replace(/\n+$/, '');
    files.push({ path, status, add, del, binary, truncated: patch.length > patchLimit, patch: patch.length > patchLimit ? patch.slice(0, patchLimit) : patch });
  }
  return files;
}

async function untrackedAsAdded(top: string): Promise<DiffFile[]> {
  const { stdout } = await git(top, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = stdout.split('\0').filter(name => name && !name.split('/').some(part => part.startsWith('.'))).slice(0, untrackedLimit);
  const result: DiffFile[] = [];
  for (const name of names) {
    try {
      const { real, rel } = await resolveInside(top, name);
      const info = await stat(real);
      if (!info.isFile()) continue;
      const handle = await open(real, 'r');
      let data: Buffer;
      try {
        const length = Math.min(info.size, untrackedFileLimit);
        data = Buffer.alloc(length);
        await handle.read(data, 0, length, 0);
      } finally { await handle.close(); }
      if (data.includes(0)) { result.push({ path: rel, status: 'added', add: 0, del: 0, binary: true, truncated: false, patch: '' }); continue; }
      const lines = data.toString('utf8').replace(/\n$/, '').split('\n');
      const cut = info.size > untrackedFileLimit;
      result.push({ path: rel, status: 'added', add: lines.length, del: 0, binary: false, truncated: cut,
        patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}` });
    } catch { /* a file that vanished or cannot be read is left out */ }
  }
  return result;
}

/** The first common commit with the primary branch, using refs already on this Mac. */
async function branchDiffBase(top: string) {
  const origin = await git(top, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
    .then(({ stdout }) => stdout.trim(), () => '');
  const configuredLocal = origin.startsWith('refs/remotes/origin/') ? 'refs/heads/' + origin.slice('refs/remotes/origin/'.length) : '';
  for (const ref of new Set([configuredLocal, origin, 'refs/heads/main', 'refs/heads/master'].filter(Boolean))) {
    const head = await git(top, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']).then(({ stdout }) => stdout.trim(), () => '');
    if (!head) continue;
    const base = await git(top, ['merge-base', head, 'HEAD']).then(({ stdout }) => stdout.trim(), () => '');
    if (!base) break;
    return { base, branch: ref.replace(/^refs\/(?:heads|remotes)\//, '') };
  }
  return undefined;
}

/** Read the working changes, last commit or combined branch diff without changing the repository. */
export async function diffWorktree(root: string, mode: unknown): Promise<WorktreeDiff> {
  const kind: WorktreeDiffMode = mode === 'commit' || mode === 'branch' ? mode : 'work';
  const { base } = await resolveInside(root, '');
  const top = await git(base, ['rev-parse', '--show-toplevel']).then(out => out.stdout.trim(), () => { throw new Error('這間房的資料夾不是 Git 專案。'); });
  const hasHead = await git(top, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  let files: DiffFile[];
  let subject: string | undefined;
  if (kind === 'commit') {
    if (!hasHead) return { mode: kind, files: [], truncated: false };
    subject = (await git(top, ['log', '-1', '--format=%h %s'])).stdout.trim();
    files = splitDiff((await git(top, ['show', '--format=', '--no-color', '--no-ext-diff', '-M', 'HEAD'])).stdout);
  } else {
    const comparison = kind === 'branch' && hasHead ? await branchDiffBase(top) : undefined;
    if (kind === 'branch' && !comparison) return { mode: kind, files: [], truncated: false };
    if (comparison) subject = `${comparison.branch} · ${comparison.base.slice(0, 7)}`;
    const revision = comparison ? [comparison.base] : hasHead ? ['HEAD'] : [];
    const tracked = await git(top, ['diff', ...revision, '--no-color', '--no-ext-diff', '-M', '--']);
    files = [...splitDiff(tracked.stdout), ...await untrackedAsAdded(top)];
  }
  if (kind === 'branch') {
    // Keep the file list intact when the combined patch is large.
    const budget = Math.min(patchLimit, Math.floor(totalLimit / Math.max(1, files.length)));
    const previews = files.map(file => file.patch.length > budget
      ? { ...file, patch: file.patch.slice(0, budget), truncated: true } : file);
    return { mode: kind, subject, files: previews, truncated: previews.some(file => file.truncated) };
  }
  let size = 0;
  let truncated = false;
  const kept: DiffFile[] = [];
  for (const file of files) {
    size += file.patch.length;
    if (size > totalLimit) { truncated = true; break; }
    kept.push(file);
  }
  return { mode: kind, ...(subject ? { subject } : {}), files: kept, truncated };
}

/** The operations the phone may ask for; anything else is refused. */
export async function worktreeCall(root: string, op: string, params: WorktreeParams | undefined, branchHint?: string,
  remembered?: RememberedWorktree, tickets?: readonly RememberedWorktree[]) {
  if (op === 'worktrees') return listRepoWorktrees(root, params, branchHint, remembered, tickets);
  if (op !== 'list' && op !== 'read' && op !== 'diff') throw new Error('這個操作不開放，只可以瀏覽。');
  const folder = await selectedRoot(root, params?.worktree);
  if (op === 'list') return listWorktree(folder, params?.path);
  if (op === 'read') return readWorktreeFile(folder, params?.path);
  return diffWorktree(folder, params?.mode);
}

