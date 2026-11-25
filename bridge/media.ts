import { randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { open, stat, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { originAllowed, type Scope } from './access';
import { mediaContentType, resolveReadable } from './file-reader';

const lifetime = 10 * 60_000;
const limit = 32;
const tokenUrl = /^\/media\/([a-f0-9]{32})$/;

type Link = { path: string; origin: string; expiresAt: number; info: BigIntStats };

function sameFile(a: BigIntStats, b: BigIntStats) {
  return b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** An absent Range means the whole file; null means the requested byte range is invalid. */
function byteRange(header: string | undefined, size: number) {
  if (header === undefined) return undefined;
  const [, first, last] = /^bytes=(\d*)-(\d*)$/i.exec(header.trim()) ?? [];
  if (!size || (!first && !last)) return null;
  if (!first) {
    const suffix = Number(last);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  return start < size && start <= end ? { start, end } : null;
}

export class MediaLinks {
  private readonly links = new Map<string, Link>();
  constructor(
    private readonly roots: string[],
    private readonly now = Date.now,
    private readonly openFile: (path: string, flags: number) => Promise<FileHandle> = open,
  ) {}

  async issue(requested: unknown, origin: string) {
    const path = await resolveReadable(requested, this.roots, 'media');
    // Check identity before/after open. O_NOFOLLOW also rejects a symlink swapped into the final component.
    const before = await stat(path, { bigint: true });
    const handle = await this.openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let info: BigIntStats;
    try {
      info = await handle.stat({ bigint: true });
      if (!sameFile(before, info) || info.size > BigInt(Number.MAX_SAFE_INTEGER) ||
          await resolveReadable(path, this.roots, 'media') !== path ||
          !sameFile(info, await stat(path, { bigint: true }))) throw new Error('影片已變更，請重新開啟。');
    } finally { await handle.close(); }

    const now = this.now();
    for (const [key, link] of this.links) if (link.expiresAt <= now) this.links.delete(key);
    if (this.links.size >= limit) this.links.delete(this.links.keys().next().value!);
    const token = randomBytes(16).toString('hex');
    const expiresAt = now + lifetime;
    this.links.set(token, { path, origin, expiresAt, info });
    return { url: `/media/${token}`, expiresAt };
  }

  async serve(req: IncomingMessage, res: ServerResponse, scope: Scope | undefined, url = req.url) {
    const finish = (status: number) => { res.statusCode = status; res.end(); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const { origin, host, referer, 'sec-fetch-site': site } = req.headers;
    // A media GET might omit Origin. Check browser origin signals if present, and always bind the
    // bearer token to the exact origin that issued it, including on plain HTTP on the tailnet.
    if (!scope || (origin !== undefined && !originAllowed(scope, origin, host)) ||
        (referer !== undefined && !originAllowed(scope, referrerOrigin(referer), host)) ||
        (site !== undefined && site !== 'same-origin')) return finish(403);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return finish(405);
    }
    const token = tokenUrl.exec(url ?? '')?.[1];
    const link = token && this.links.get(token);
    if (!link) return finish(404);
    if (link.expiresAt <= this.now()) {
      this.links.delete(token);
      return finish(404);
    }
    if (!originAllowed(scope, link.origin, host)) return finish(404);

    try {
      const handle = await this.openFile(link.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat({ bigint: true });
        if (!sameFile(link.info, info) || await resolveReadable(link.path, this.roots, 'media') !== link.path) return finish(404);
        if (res.destroyed) return;
        const size = Number(info.size);
        const range = byteRange(req.headers.range, size);
        res.setHeader('Accept-Ranges', 'bytes');
        if (range === null) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return finish(416);
        }
        res.setHeader('Content-Type', mediaContentType(link.path)!);
        res.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
        if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        const status = range ? 206 : 200;
        if (req.method === 'HEAD' || size === 0) return finish(status);
        res.statusCode = status;
        // Pipeline destroys the stream on a client disconnect; the finally owns closure of the fd.
        await pipeline(handle.createReadStream({ ...range, autoClose: false }), res);
      } finally { await handle.close(); }
    } catch {
      if (!res.headersSent && !res.destroyed) finish(404);
      else if (!res.destroyed) res.destroy();
    }
  }
}

function referrerOrigin(value: string) {
  try { return new URL(value).origin; } catch { return undefined; }
}
