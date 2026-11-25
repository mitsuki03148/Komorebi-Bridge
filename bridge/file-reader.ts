import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';

/** A file this big is shown only from its start. */
export const fileReadLimit = 400_000;
const readable = /\.(?:md|markdown|txt|log|json)$/i;
export function videoContentType(path: string) {
  switch (extname(path).toLowerCase()) {
    case '.mp4': case '.m4v': return 'video/mp4';
    case '.mov': return 'video/quicktime';
  }
}

export function imageContentType(path: string) {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
  }
}
/** What the media route may send: a video, or an image the browser shows itself. */
export const mediaContentType = (path: string) => videoContentType(path) ?? imageContentType(path);

export interface ReadFile { path: string; text: string; truncated: boolean; size: number }

const hidden = (path: string) => path.split(sep).some(part => part.startsWith('.') && part !== '.' && part !== '..');

/**
 * Check an absolute reader path against its allowed extensions and roots, before and after following symlinks.
 * Hidden files and folders are never opened.
 */
export async function resolveReadable(requested: unknown, roots: string[], kind: 'text' | 'video' | 'media' = 'text'): Promise<string> {
  if (typeof requested !== 'string' || !isAbsolute(requested)) throw new Error('請用絕對路徑。');
  const allowed = (path: string) => kind === 'video' ? Boolean(videoContentType(path)) : kind === 'media' ? Boolean(mediaContentType(path)) : readable.test(path);
  const wrongType = kind === 'video' ? '只可以預覽 .mp4、.m4v、.mov 影片。' : kind === 'media' ? '只可以預覽 .mp4、.m4v、.mov 影片或 .png、.jpg、.webp、.gif 圖片。' : '只可以開 .md、.txt、.log、.json 檔案。';
  if (!allowed(requested)) throw new Error(wrongType);
  const real = await realpath(requested).catch(() => { throw new Error('找不到這個檔案。'); });
  let inside: string | undefined;
  for (const root of roots) {
    const base = await realpath(root).catch(() => undefined);
    if (!base) continue;
    const rel = relative(base, real);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) { inside = rel; break; }
  }
  if (inside === undefined) throw new Error('這個檔案不在可以開啟的範圍。');
  if (hidden(inside) || hidden(requested)) throw new Error('隱藏檔案或資料夾不開放。');
  if (!allowed(real)) throw new Error(wrongType);
  if (!(await stat(real)).isFile()) throw new Error('這不是檔案。');
  return real;
}

/** Read a text file for the reader (see resolveReadable for what is allowed). */
export async function readTextFile(requested: unknown, roots: string[]): Promise<ReadFile> {
  const real = await resolveReadable(requested, roots);
  const info = await stat(real);
  const handle = await open(real, 'r');
  try {
    const length = Math.min(info.size, fileReadLimit);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return { path: real, text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > fileReadLimit, size: info.size };
  } finally { await handle.close(); }
}
