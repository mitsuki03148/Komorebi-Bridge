import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Where a new room starts its CLI. It is saved in the settings file; until one is saved it is the workspace itself. */
export class FolderSetting {
  private folder: string;

  constructor(private readonly path: string, private readonly fallback: string) {
    this.folder = fallback;
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const saved = data && typeof data === 'object' ? (data as { defaultFolder?: unknown }).defaultFolder : undefined;
      // A saved folder that has gone (a disk that is not mounted, a folder that was removed) is not used.
      if (typeof saved === 'string' && isAbsolute(saved) && statSync(saved).isDirectory()) this.folder = saved;
    } catch { /* No settings yet, or not readable: the workspace is used. */ }
  }

  get() { return this.folder; }

  /** Check the folder, then save it. Returns the real path that is kept. */
  async set(requested: unknown) {
    if (typeof requested !== 'string' || !isAbsolute(requested.trim())) throw new Error('請輸入 Mac 絕對路徑。');
    const real = await realpath(requested.trim()).catch(() => { throw new Error('找不到這個資料夾。請先確認路徑存在和磁碟已掛載。'); });
    if (!(await stat(real)).isDirectory()) throw new Error('要是資料夾，不是檔案。');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ defaultFolder: real }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally { try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ } }
    this.folder = real;
    return real;
  }
}

export interface DirectoryListing { path: string; parent: string | null; dirs: string[]; files?: string[] }

const hidden = (path: string) => path.split('/').some(part => part.startsWith('.') && part !== '.' && part !== '..');
const entryLimit = 500;

/** The visible sub-folders, and optionally text files for the board picker. */
export async function listDirectories(requested: unknown, includeFiles = false, limitTo?: string): Promise<DirectoryListing> {
  if (typeof requested !== 'string' || !isAbsolute(requested)) throw new Error('請輸入 Mac 絕對路徑。');
  if (includeFiles && hidden(requested)) throw new Error('隱藏資料夾不開放。');
  let path = await realpath(requested).catch(() => { throw new Error('找不到這個資料夾。'); });
  // With a limit, browsing never leaves it: a folder outside lists the limit itself, and the limit has no "up".
  // A folder is inside by the path it was reached through, so a link under the limit that points elsewhere (an alias to another disk)
  // can still be opened; it keeps the path it was reached through, and its "up" is the folder it sits in.
  const base = limitTo ? await realpath(limitTo).catch(() => undefined) : undefined;
  let shown = path;
  if (base && limitTo) {
    const outside = (from: string, to: string) => { const inside = relative(from, to); return inside.startsWith('..') || isAbsolute(inside); };
    const lexical = resolve(requested);
    if (!outside(resolve(limitTo), lexical)) shown = lexical;
    else if (outside(base, path)) { path = base; shown = base; }
    else shown = path;
  }
  if (includeFiles && hidden(path)) throw new Error('隱藏資料夾不開放。');
  if (!(await stat(path)).isDirectory()) throw new Error('要是資料夾，不是檔案。');
  const entries = await readdir(path, { withFileTypes: true }).catch(() => { throw new Error('這個資料夾讀不到（沒有權限）。'); });
  const dirs: string[] = [];
  const files: string[] = [];
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) dirs.push(entry.name);
    else if (includeFiles && entry.isFile() && /\.(?:md|markdown|txt)$/i.test(entry.name)) files.push(entry.name);
    else if (entry.isSymbolicLink()) {
      const entryPath = join(path, entry.name);
      const target = includeFiles ? await realpath(entryPath).catch(() => undefined) : entryPath;
      if (target && (!includeFiles || !hidden(target)) && await stat(target).then(info => info.isDirectory(), () => false)) dirs.push(entry.name);
    }
    if (dirs.length + files.length >= entryLimit) break;
  }
  const up = dirname(shown);
  return { path: shown, parent: up === shown || (base && (shown === base || shown === resolve(limitTo!))) ? null : up, dirs, ...(includeFiles ? { files } : {}) };
}
