import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, readdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { attachmentDirectory } from './attachments';
import { originalUploadName } from '../src/utils/fileAttachments';

export const ownedImageName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;
/** Only the legacy generated image names and canonical generated file names belong to Komorebi. */
const ours = (name: string) => ownedImageName.test(name) || originalUploadName(name) !== undefined;
export const defaultTrash = join(homedir(), '.Trash');
/** Uploaded attachments older than this are moved to the Trash, whichever room they were for. */
export const attachmentMaxAgeDays = 14;

export interface TrashResult { moved: string[]; failed: string[]; missing: string[] }

/** Move one checked file without overwriting an existing item in the Trash. */
async function moveToTrash(path: string, trash: string, collisionName?: string) {
  const file = basename(path);
  let target = join(trash, file);
  try {
    await lstat(target);
    target = join(trash, randomUUID() + (collisionName ? '_' + collisionName : extname(file)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(path, target);
}

/** Paths must already have been checked against the relevant session root and identity. */
export async function trashSessionFiles(files: string[], trash = defaultTrash) {
  const result = { moved: [] as string[], failed: [] as string[], bytes: 0 };
  for (const file of new Set(files)) {
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error('Not a regular file');
      await moveToTrash(file, trash, basename(file));
      result.moved.push(file);
      result.bytes += info.size;
    } catch { result.failed.push(file); }
  }
  return result;
}

/**
 * Move uploaded attachments to the macOS Trash (never a plain delete): a rename into ~/.Trash, so they can be taken back until
 * the Trash is emptied. A file that cannot be moved stays where it is and is reported.
 */
export async function trashAttachments(files: string[], directory = attachmentDirectory, trash = defaultTrash): Promise<TrashResult> {
  const result: TrashResult = { moved: [], failed: [], missing: [] };
  const owned = [...new Set(files.map(item => basename(item)))].filter(ours);
  if (!owned.length) return result;
  try {
    if (!(await lstat(directory)).isDirectory()) return { ...result, failed: owned };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ...result, missing: owned } : { ...result, failed: owned };
  }
  for (const file of owned) {
    const path = join(directory, file);
    try {
      const info = await lstat(path);
      if (!info.isFile()) { result.failed.push(file); continue; }
    } catch { result.missing.push(file); continue; }
    try {
      await moveToTrash(path, trash, originalUploadName(file));
      result.moved.push(file);
    } catch { result.failed.push(file); }
  }
  return result;
}

/** Move to the Trash the uploaded attachments nobody has touched for `days` days. */
export async function sweepAttachments(days = attachmentMaxAgeDays, directory = attachmentDirectory, trash = defaultTrash, now = Date.now()): Promise<TrashResult> {
  let names: string[];
  try { names = (await lstat(directory)).isDirectory() ? await readdir(directory) : []; } catch { return { moved: [], failed: [], missing: [] }; }
  const cutoff = now - days * 86_400_000;
  const old: string[] = [];
  for (const name of names) {
    if (!ours(name)) continue;
    try { if ((await lstat(join(directory, name))).mtimeMs < cutoff) old.push(name); } catch { /* Gone meanwhile. */ }
  }
  return old.length ? trashAttachments(old, directory, trash) : { moved: [], failed: [], missing: [] };
}

/** Which room each uploaded attachment was sent to, so deleting a room can take its files with it. */
export class AttachmentLedger {
  private map: Record<string, string> = {};

  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved && typeof saved === 'object') for (const [file, room] of Object.entries(saved)) if (ours(file) && typeof room === 'string') this.map[file] = room;
    } catch { /* None yet. */ }
  }

  record(file: string, roomId: string) {
    const name = basename(file);
    if (!ours(name)) return;
    this.map[name] = roomId;
    this.save();
  }

  filesFor(roomIds: Iterable<string>) {
    const wanted = new Set(roomIds);
    return Object.entries(this.map).filter(([, room]) => wanted.has(room)).map(([file]) => file);
  }

  forget(files: string[]) {
    let changed = false;
    for (const file of files) if (delete this.map[file]) changed = true;
    if (changed) this.save();
  }

  private save() {
    if (!this.path) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.map), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch { /* A ledger that cannot be written only means the 14-day sweep does the work. */ }
    finally { try { unlinkSync(temporary); } catch { /* The rename moved it. */ } }
  }
}
