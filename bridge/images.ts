import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const previewSourceLimit = 25 * 1024 * 1024;
const sendOriginalLimit = 1_500_000;
const hardOriginalLimit = 3_000_000;
const previewEdge = 1600;

/** Places an agent may reasonably write images to. Anything else is not previewed. */
const allowedRoots = () => [homedir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders', '/Volumes'];
const blockedSegments = ['/.ssh/', '/.gnupg/', '/.aws/', '/.kube/', '/.config/gcloud/', '/Library/Keychains/', '/Library/Cookies/', '/.password-store/'];

type Kind = 'png' | 'jpeg' | 'gif' | 'webp' | 'heic';
const mimes: Record<Exclude<Kind, 'heic'>, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function kindOf(head: Buffer): Kind | undefined {
  if (head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (head.toString('ascii', 4, 8) === 'ftyp' && /^(?:heic|heix|hevc|mif1|msf1|heim|heis)/.test(head.toString('ascii', 8, 12))) return 'heic';
  return undefined;
}

export interface ImagePreview { mime: string; data: string; size: number; resized: boolean }

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try { return await work(); }
  finally { active--; waiting.shift()?.(); }
}

/**
 * Reads an image an agent mentioned and returns something a browser can show.
 * The caller must already have checked that the path appears in that room's conversation.
 */
export async function loadImagePreview(path: string, options: { cwd?: string; home?: string; limit?: number; roots?: string[] } = {}): Promise<ImagePreview> {
  const home = options.home ?? homedir();
  let resolved: string;
  if (path === '~' || path.startsWith('~/')) resolved = join(home, path.slice(1));
  else if (isAbsolute(path)) resolved = path;
  else if (options.cwd) resolved = join(options.cwd, path);
  else throw new Error('這個相對路徑未有工作目錄可以參照。');

  let real: string;
  try { real = await realpath(resolved); }
  catch { throw new Error('找不到這個圖片檔案。'); }
  if (!isAbsolute(path) && !path.startsWith('~') && options.cwd) {
    const base = await realpath(options.cwd).catch(() => options.cwd!);
    if (real !== base && !real.startsWith(base + sep)) throw new Error('圖片在工作目錄以外，不預覽。');
  }
  if (!(options.roots ?? allowedRoots()).some(root => real === root || real.startsWith(root.replace(/\/$/, '') + sep))) throw new Error('這個位置的圖片不預覽。');
  if (blockedSegments.some(segment => (real + '/').includes(segment))) throw new Error('這個位置的圖片不預覽。');

  const info = await stat(real);
  if (!info.isFile()) throw new Error('不是圖片檔案。');
  const limit = options.limit ?? previewSourceLimit;
  if (info.size > limit) throw new Error(`圖片太大（上限 ${Math.round(limit / 1048576)} MB）。`);
  const handle = await open(real, 'r');
  let kind: Kind | undefined;
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    kind = kindOf(head);
  } finally { await handle.close(); }
  if (!kind) throw new Error('檔案內容不是支援的圖片。');

  if (kind !== 'heic' && info.size <= sendOriginalLimit) {
    return { mime: mimes[kind], data: (await readFile(real)).toString('base64'), size: info.size, resized: false };
  }
  if (process.platform === 'darwin') {
    try {
      return await slot(async () => {
        const dir = await mkdtemp(join(tmpdir(), 'komorebi-preview-'));
        try {
          const out = join(dir, 'preview.jpg');
          await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', String(previewEdge), real, '--out', out], { timeout: 20_000 });
          return { mime: 'image/jpeg', data: (await readFile(out)).toString('base64'), size: info.size, resized: true };
        } finally { await rm(dir, { recursive: true, force: true }); }
      });
    } catch { /* fall back to the original below */ }
  }
  if (kind !== 'heic' && info.size <= hardOriginalLimit) {
    return { mime: mimes[kind], data: (await readFile(real)).toString('base64'), size: info.size, resized: false };
  }
  throw new Error('圖片太大，而且未能縮細。');
}
