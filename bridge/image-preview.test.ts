import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import type { ServerEvent } from '../src/types/bridge';
import type { TerminalRoom } from '../src/types/guild';
import { ImagePreviewProvider, MessageImages } from '../src/components/ImagePreviews';
import { extractImagePaths } from '../src/utils/imagePaths';
import { loadImagePreview } from './images';
import { Rooms } from './rooms';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');

function crc32(buffer: Buffer) {
  let crc = ~0;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** A noisy RGB PNG that cannot compress, so it is larger than the send-as-is limit. */
function noisePng(size: number) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let row = 0; row < size; row++) for (let i = 1; i <= size * 3; i++) rows[row * (size * 3 + 1) + i] = (row * 31 + i * 17 + ((i * row) % 251)) & 0xff;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

test('image paths are found in markdown, backticks, file URLs and bare paths, but not in URLs or plain words', () => {
  assert.deepEqual(extractImagePaths('圖已儲存：/Users/example/Documents/out/cat.png。'), ['/Users/example/Documents/out/cat.png']);
  assert.deepEqual(extractImagePaths('看 `/Users/x/Komorebi Attachments/a b.jpg` 和 ~/Pictures/x.webp'), ['/Users/x/Komorebi Attachments/a b.jpg', '~/Pictures/x.webp']);
  assert.deepEqual(extractImagePaths('![cat](out/cat.png) 同 ![x](<out/my cat.PNG>) 同 [r](out/r.jpg?raw=1)'), ['out/cat.png', 'out/my cat.PNG', 'out/r.jpg']);
  assert.deepEqual(extractImagePaths('file:///Users/x/a%20b.png'), ['/Users/x/a b.png']);
  assert.deepEqual(extractImagePaths('https://example.com/a/b.png data:image/png;base64,AAAA ![r](https://example.com/c.jpg)'), []);
  assert.deepEqual(extractImagePaths('notes.txt out/cat.png /Users/x/report.pdf'), []);
  assert.deepEqual(extractImagePaths('/a/one.png /a/one.png `/a/one.png`'), ['/a/one.png']);
  assert.equal(extractImagePaths(Array.from({ length: 20 }, (_, i) => `/a/${i}.png`).join(' ')).length, 12);
});

test('a preview is only built for a real image in an allowed place, and the file is not trusted by its name', async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-preview-')));
  try {
    const roots = [tmp];
    await mkdir(join(tmp, 'work', 'out'), { recursive: true });
    await mkdir(join(tmp, '.ssh'), { recursive: true });
    await writeFile(join(tmp, 'shot.png'), png);
    await writeFile(join(tmp, 'work', 'out', 'a.png'), png);
    await writeFile(join(tmp, 'secret.png'), png);
    await writeFile(join(tmp, 'work', 'fake.png'), 'not an image at all, just text');
    await writeFile(join(tmp, '.ssh', 'key.png'), png);
    await symlink(join(tmp, 'secret.png'), join(tmp, 'work', 'link.png'));
    const cwd = join(tmp, 'work');

    const small = await loadImagePreview(join(tmp, 'shot.png'), { roots });
    assert.deepEqual({ mime: small.mime, resized: small.resized, size: small.size }, { mime: 'image/png', resized: false, size: png.length });
    assert.deepEqual(Buffer.from(small.data, 'base64'), png);
    assert.equal((await loadImagePreview('~/shot.png', { roots, home: tmp })).mime, 'image/png');
    assert.equal((await loadImagePreview('out/a.png', { roots, cwd })).mime, 'image/png');

    await assert.rejects(loadImagePreview('../secret.png', { roots, cwd }), /工作目錄以外/);
    await assert.rejects(loadImagePreview('link.png', { roots, cwd }), /工作目錄以外/);
    await assert.rejects(loadImagePreview('out/a.png', { roots }), /工作目錄/);
    await assert.rejects(loadImagePreview(join(tmp, 'work', 'fake.png'), { roots }), /不是支援的圖片/);
    await assert.rejects(loadImagePreview(join(tmp, 'missing.png'), { roots }), /找不到/);
    await assert.rejects(loadImagePreview(join(tmp, 'work'), { roots }), /不是圖片檔案|不是支援/);
    await assert.rejects(loadImagePreview(join(tmp, '.ssh', 'key.png'), { roots }), /不預覽/);
    await assert.rejects(loadImagePreview(join(tmp, 'shot.png'), { roots: ['/nonexistent'] }), /不預覽/);
    await assert.rejects(loadImagePreview(join(tmp, 'shot.png'), { roots, limit: 10 }), /圖片太大/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a large image is shrunk into a JPEG that is small enough to send', { skip: process.platform !== 'darwin' }, async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-preview-')));
  try {
    const big = noisePng(900);
    assert.ok(big.length > 1_500_000);
    await writeFile(join(tmp, 'big.png'), big);
    const preview = await loadImagePreview(join(tmp, 'big.png'), { roots: [tmp] });
    assert.equal(preview.resized, true);
    assert.equal(preview.mime, 'image/jpeg');
    const bytes = Buffer.from(preview.data, 'base64');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(bytes.length < big.length);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('the room only previews images its own conversation mentions', async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-preview-')));
  try {
    await writeFile(join(tmp, 'made.png'), png);
    await writeFile(join(tmp, 'other.png'), png);
    const rooms = new Rooms(tmp, () => {});
    rooms.imagePreviewOptions = { roots: [tmp] };
    const room = { id: 'r', modelId: 'CODEX', roomName: '測試', repoPath: tmp, logs: [
      { id: 'a', timestamp: '', sender: 'agent', text: `做好，已儲存：${join(tmp, 'made.png')}` }] } as unknown as TerminalRoom;
    rooms.rooms.set(room.id, room);
    const replies: ServerEvent[] = [];
    await rooms.handle({ type: 'IMAGE_PREVIEW', roomId: room.id, path: join(tmp, 'made.png') }, event => replies.push(event));
    await rooms.handle({ type: 'IMAGE_PREVIEW', roomId: room.id, path: join(tmp, 'other.png') }, event => replies.push(event));
    await rooms.handle({ type: 'IMAGE_PREVIEW', roomId: room.id, path: '/etc/passwd.png' }, event => replies.push(event));
    const [first, second, third] = replies as Extract<ServerEvent, { type: 'IMAGE_PREVIEW' }>[];
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.mime, 'image/png');
    assert.equal(second.ok, false);
    assert.match(second.ok ? '' : second.message, /不在房間對話內/);
    assert.equal(third.ok, false);
    await assert.rejects(rooms.handle({ type: 'IMAGE_PREVIEW', roomId: 'nope', path: 'x.png' }, () => {}));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('thumbnails render for ready, failed and waiting images, and nothing when the Bridge cannot preview', () => {
  const path = '/Users/x/out/cat.png';
  const show = (supported: boolean, state: unknown) => renderToStaticMarkup(createElement(ImagePreviewProvider, {
    value: { supported, get: () => state as never, request() {} },
  }, createElement(MessageImages, { roomId: 'r', text: `已儲存 ${path}` })));
  const ready = show(true, { status: 'ready', dataUrl: 'data:image/png;base64,AAAA', size: 10 });
  assert.match(ready, /<img[^>]+src="data:image\/png;base64,AAAA"/);
  assert.match(ready, /aria-label="放大 cat\.png"/);
  assert.match(show(true, { status: 'error', message: '找不到這個圖片檔案。' }), /找不到這個圖片檔案/);
  assert.match(show(true, undefined), /aria-busy="true"[^>]*>cat\.png</);
  assert.equal(show(false, undefined), '');
  assert.equal(renderToStaticMarkup(createElement(ImagePreviewProvider, { value: { supported: true, get: () => undefined, request() {} } }, createElement(MessageImages, { roomId: 'r', text: '沒有圖' }))), '');
});

test('previews are requested a few at a time, time out when the Bridge stays silent, and old ones are forgotten', async t => {
  const { PreviewLoader } = await import('../src/utils/previewLoader');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: string[] = [];
  const loader = new PreviewLoader(request => { sent.push(request.path); return request.path !== '/offline.png'; }, { spacingMs: 25, timeoutMs: 60, keep: 2 });
  const changes: number[] = [];
  loader.subscribe(() => changes.push(loader.version));
  try {
    for (const path of ['/a.png', '/b.png', '/c.png']) loader.request('r', path);
    loader.request('r', '/a.png');
    assert.deepEqual(sent, ['/a.png']);
    assert.equal(loader.get('r', '/c.png')?.status, 'loading');
    t.mock.timers.tick(25);
    t.mock.timers.tick(25);
    assert.deepEqual(sent, ['/a.png', '/b.png', '/c.png']);
    loader.receive({ roomId: 'r', path: '/b.png', ok: true, mime: 'image/png', data: 'AAAA', size: 4 });
    assert.deepEqual(loader.get('r', '/b.png'), { status: 'ready', dataUrl: 'data:image/png;base64,AAAA', size: 4 });
    loader.receive({ roomId: 'r', path: '/c.png', ok: false, message: '找不到' });
    assert.deepEqual(loader.get('r', '/c.png'), { status: 'error', message: '找不到' });
    t.mock.timers.tick(10);
    assert.match((loader.get('r', '/a.png') as { message: string }).message, /逾時/);
    loader.request('r', '/offline.png');
    t.mock.timers.tick(15);
    assert.match((loader.get('r', '/offline.png') as { message: string }).message, /未連到/);
    // Only the newest finished previews are kept.
    for (const name of ['d', 'e', 'f']) {
      loader.request('r', `/${name}.png`);
      t.mock.timers.tick(25);
      loader.receive({ roomId: 'r', path: `/${name}.png`, ok: true, mime: 'image/png', data: 'AAAA', size: 4 });
    }
    assert.equal(loader.get('r', '/d.png'), undefined);
    assert.equal(loader.get('r', '/f.png')?.status, 'ready');
    assert.ok(changes.length > 5);
    // An unknown reply changes nothing.
    const before = loader.version;
    loader.receive({ roomId: 'r', path: '/never-asked.png', ok: false, message: 'x' });
    assert.equal(loader.version, before);
  } finally { loader.dispose(); }
});
