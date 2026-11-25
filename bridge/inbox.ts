import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { imageContentType, videoContentType } from './file-reader';

export type InboxKind = 'text' | 'image' | 'video' | 'other';
export interface InboxListing {
  /** The Inbox folder itself, and the folder being looked at (the same at the top). */
  root: string;
  path: string;
  parent: string | null;
  dirs: { name: string; modified: number }[];
  files: { name: string; kind: InboxKind; size: number; modified: number }[];
}

const entryLimit = 300;
const textFile = /\.(?:md|markdown|txt|log|json)$/i;
export const inboxKind = (name: string): InboxKind => textFile.test(name) ? 'text' : imageContentType(name) ? 'image' : videoContentType(name) ? 'video' : 'other';

/**
 * What is in the Founder's Inbox folder (where the personas' tasks leave their handoff and evidence), newest first.
 * Read only. Nothing outside the Inbox can be listed, also not through a symlink, and hidden files are left out.
 */
export async function listInbox(root: string, requested?: unknown): Promise<InboxListing> {
  const base = await realpath(root).catch(() => undefined);
  if (!base) return { root, path: root, parent: null, dirs: [], files: [] };
  let path = base;
  if (typeof requested === 'string' && requested) {
    if (!isAbsolute(requested)) throw new Error('請用絕對路徑。');
    path = await realpath(requested).catch(() => { throw new Error('找不到這個資料夾。'); });
    const rel = relative(base, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('這個資料夾不在 Inbox 內。');
  }
  if (!(await stat(path)).isDirectory()) throw new Error('要是資料夾，不是檔案。');
  const entries = await readdir(path, { withFileTypes: true }).catch(() => { throw new Error('這個資料夾讀不到。'); });
  const dirs: InboxListing['dirs'] = [];
  const files: InboxListing['files'] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(path, entry.name);
    const info = await stat(full).catch(() => undefined);
    if (!info) continue;
    // A symlink counts only when what it points at is still inside the Inbox.
    if (entry.isSymbolicLink()) {
      const target = await realpath(full).catch(() => undefined);
      const rel = target ? relative(base, target) : '..';
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
    }
    if (info.isDirectory()) dirs.push({ name: entry.name, modified: info.mtimeMs });
    else if (info.isFile()) files.push({ name: entry.name, kind: inboxKind(entry.name), size: info.size, modified: info.mtimeMs });
    if (dirs.length + files.length >= entryLimit) break;
  }
  dirs.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  // The handoff first, then the rest by name.
  files.sort((a, b) => Number(/^handoff\.md$/i.test(b.name)) - Number(/^handoff\.md$/i.test(a.name)) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { root: base, path, parent: path === base ? null : join(path, '..'), dirs, files };
}
