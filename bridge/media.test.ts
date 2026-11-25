import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, open, rename, rm, stat, symlink, truncate, utimes, writeFile, type FileHandle } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileViewer } from '../src/components/FileViewer';
import { Markdown } from '../src/components/Markdown';
import { FileOpenContext } from '../src/utils/fileOpen';
import { linkFilePaths, videoPath } from '../src/utils/filePaths';
import { accessScope } from './access';
import { MediaLinks } from './media';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'Workspace');
  const docs = join(root, 'Documents');
  const outside = join(root, 'Workspace-other');
  await Promise.all([workspace, docs, outside].map(dir => mkdir(dir)));
  const file = join(workspace, 'test.mp4');
  await writeFile(file, '0123456789');
  return { workspace, docs, outside, file, roots: [workspace, docs] };
}

async function listen(t: TestContext, links: MediaLinks) {
  let port: number;
  let responseTask: Promise<void>;
  const server = createServer((req, res) => {
    const scope = accessScope({
      peer: req.socket.remoteAddress ?? '', local: req.socket.localAddress ?? '',
      host: req.headers.host, headers: req.headers, port, tailscaleIp: null, serveHost: null,
    });
    responseTask = links.serve(req, res, scope);
  });
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
  port = (server.address() as { port: number }).port;
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const client = (path: string, method = 'GET', headers: OutgoingHttpHeaders = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      request({ host: '127.0.0.1', port, method, path, headers }, async res => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of res) chunks.push(chunk);
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() });
        } catch (error) { reject(error); }
      }).on('error', reject).end();
    });
  return { port, origin: `http://127.0.0.1:${port}`, client, done: () => responseTask };
}

test('media serves the full file and supports exact, suffix, open-ended and clipped single ranges', async t => {
  const { roots, file } = await fixture(t);
  const links = new MediaLinks(roots);
  const { origin, client } = await listen(t, links);
  const { url } = await links.issue(file, origin);
  assert.match(url, /^\/media\/[a-f0-9]{32}$/);
  const full = await client(url, 'GET', { 'sec-fetch-site': 'same-origin' });
  assert.equal(full.status, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.equal(full.headers['content-length'], '10');
  assert.equal(full.headers['content-range'], undefined);
  assert.equal(full.headers['cache-control'], 'no-store');
  assert.equal(full.headers['x-content-type-options'], 'nosniff');
  assert.equal(full.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(full.body, '0123456789');

  for (const [header, range, body] of [
    ['bytes=0-1', '0-1', '01'], ['bytes=3-6', '3-6', '3456'], ['bytes=-3', '7-9', '789'],
    ['bytes=7-', '7-9', '789'], ['bytes=8-1000', '8-9', '89'], ['bytes=-1000', '0-9', '0123456789'],
  ]) {
    const res = await client(url, 'GET', { range: header, origin });
    assert.equal(res.status, 206, header);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-range'], `bytes ${range}/10`);
    assert.equal(res.headers['content-length'], String(body.length));
    assert.equal(res.body, body);
  }
});

test('media returns 416 for malformed, multiple or unsatisfiable byte ranges', async t => {
  const { roots, file } = await fixture(t);
  const links = new MediaLinks(roots);
  const { origin, client } = await listen(t, links);
  const { url } = await links.issue(file, origin);
  for (const range of ['bytes=1-2,4-5', 'bytes=10-', 'bytes=3-2', 'bytes=-0', 'bytes=-', 'bad=0-1', 'bytes=a-0']) {
    const res = await client(url, 'GET', { range });
    assert.equal(res.status, 416, range);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-range'], 'bytes */10');
    assert.equal(res.body, '');
  }
  await truncate(file, 0);
  const empty = await links.issue(file, origin);
  assert.equal((await client(empty.url)).status, 200);
  const range = await client(empty.url, 'GET', { range: 'bytes=0-1' });
  assert.equal(range.status, 416);
  assert.equal(range.headers['content-range'], 'bytes */0');
});

test('media sends HEAD headers without bytes, uses canonical extensions and rejects other methods', async t => {
  const { roots, docs } = await fixture(t);
  const links = new MediaLinks(roots);
  const { origin, client } = await listen(t, links);
  for (const [name, mime] of [['screen recording.MOV', 'video/quicktime'], ['preview.M4V', 'video/mp4']]) {
    const path = join(docs, name);
    await writeFile(path, 'video');
    const { url } = await links.issue(path, origin);
    const head = await client(url, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], mime);
    assert.equal(head.headers['content-length'], '5');
    assert.equal(head.headers['accept-ranges'], 'bytes');
    assert.equal(head.body, '');
    const partial = await client(url, 'HEAD', { range: 'bytes=1-2' });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['content-range'], 'bytes 1-2/5');
    assert.equal(partial.body, '');
    const post = await client(url, 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
  }
});

test('media links expire after ten minutes, survive seeks until then, evict oldest, and do not survive restart', async t => {
  const { roots, file } = await fixture(t);
  let now = 1000;
  const links = new MediaLinks(roots, () => now);
  const { origin, client } = await listen(t, links);
  const first = await links.issue(file, origin);
  assert.equal(first.expiresAt, 601_000);
  assert.equal((await client('/media/' + '0'.repeat(32))).status, 404);
  now = first.expiresAt - 1;
  assert.equal((await client(first.url, 'GET', { range: 'bytes=0-1' })).status, 206);
  now++;
  assert.equal((await client(first.url)).status, 404);

  const issued = [];
  for (let i = 0; i < 33; i++) issued.push(await links.issue(file, origin));
  assert.equal(new Set(issued.map(item => item.url)).size, 33);
  assert.equal((await client(issued[0].url)).status, 404);
  assert.equal((await client(issued[1].url)).status, 200);
  assert.equal((await client(issued[32].url)).status, 200);
  const restarted = await listen(t, new MediaLinks(roots));
  assert.equal((await restarted.client(issued[32].url)).status, 404);
});

test('media denies cross-origin browser requests, wrong origin hosts, access failures and URL path fragments', async t => {
  const { roots, file } = await fixture(t);
  const links = new MediaLinks(roots);
  const { port, origin, client } = await listen(t, links);
  const { url } = await links.issue(file, origin);
  assert.equal((await client(url, 'GET', { referer: origin + '/chat' })).status, 200);
  assert.equal((await client(url, 'GET', { origin: 'https://other.test' })).status, 403);
  assert.equal((await client(url, 'GET', { 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await client(url, 'GET', { referer: 'https://other.test/chat' })).status, 403);
  assert.equal((await client(url, 'GET', { host: 'other.test' })).status, 403);
  assert.equal((await client(url, 'GET', { host: `localhost:${port}` })).status, 404);
  for (const path of ['/media', '/media/', url + '/', url + '/other.mov', url + '?path=/movie.mp4', '/media/%2Fother.mov']) {
    assert.equal((await client(path)).status, 404, path);
  }
});

test('media only issues links for regular video files in the reader roots, after symlink resolution', async t => {
  const { roots, workspace, docs, outside } = await fixture(t);
  const links = new MediaLinks(roots);
  const origin = 'http://localhost:3000';
  const hidden = join(workspace, '.hidden');
  await mkdir(hidden);
  const inside = join(docs, 'Movie file.MP4');
  const escaped = join(outside, 'outside.mov');
  const hiddenFile = join(hidden, 'hidden.m4v');
  const text = join(workspace, 'text.txt');
  for (const file of [inside, escaped, hiddenFile, text]) await writeFile(file, 'video fixture');
  await mkdir(join(workspace, 'folder.mov'));
  await symlink(escaped, join(workspace, 'escape.mov'));
  await symlink(inside, join(workspace, 'ok.mov'));
  await symlink(inside, join(workspace, '.hidden.mp4'));
  await symlink(hiddenFile, join(workspace, 'hidden.m4v'));
  await symlink(text, join(workspace, 'alias.mp4'));
  await assert.rejects(links.issue(escaped, origin), /範圍/);
  await assert.rejects(links.issue(join(workspace, 'escape.mov'), origin), /範圍/);
  await assert.rejects(links.issue(join(workspace, '.hidden.mp4'), origin), /隱藏/);
  await assert.rejects(links.issue(join(workspace, 'hidden.m4v'), origin), /隱藏/);
  await assert.rejects(links.issue(join(workspace, 'alias.mp4'), origin), /\.mp4、/);
  await assert.rejects(links.issue(text, origin), /\.mp4、/);
  await assert.rejects(links.issue(join(workspace, 'folder.mov'), origin), /不是檔案/);
  await assert.rejects(links.issue('movie.mp4', origin), /絕對路徑/);
  assert.match((await links.issue(join(workspace, 'ok.mov'), origin)).url, /^\/media\//);
});

test('media rechecks the opened fd: same-size edits and inode swaps with preserved mtime invalidate the link', async t => {
  const { roots, workspace, file } = await fixture(t);
  const links = new MediaLinks(roots);
  const { origin, client } = await listen(t, links);
  await utimes(file, 1111111111, 1111111111);
  const first = await links.issue(file, origin);
  await writeFile(file, 'ABCDEFGHIJ');
  assert.equal((await client(first.url, 'GET', { range: 'bytes=0-1' })).status, 404);

  await utimes(file, 1111111111, 1111111111);
  const second = await links.issue(file, origin);
  const previous = await stat(file);
  const replacement = join(workspace, 'next.mp4');
  await writeFile(replacement, '0123456789');
  await utimes(replacement, 1111111111, 1111111111);
  await rename(replacement, file);
  const swapped = await stat(file);
  assert.equal(swapped.size, previous.size);
  assert.equal(swapped.mtimeMs, previous.mtimeMs);
  assert.notEqual(swapped.ino, previous.ino);
  assert.equal((await client(second.url, 'HEAD')).status, 404);

  const third = await links.issue(file, origin);
  await truncate(file, 4);
  assert.equal((await client(third.url)).status, 404);
});

test('media will not stream after its parent is replaced with an out-of-root symlink', async t => {
  const { roots, workspace, outside } = await fixture(t);
  const folder = join(workspace, 'movies');
  const file = join(folder, 'show.mov');
  await mkdir(folder);
  await writeFile(file, 'movie');
  const links = new MediaLinks(roots);
  const { origin, client } = await listen(t, links);
  const { url } = await links.issue(file, origin);
  await rename(folder, join(outside, 'movies'));
  await symlink(join(outside, 'movies'), folder);
  const result = await client(url);
  assert.equal(result.status, 404);
  assert.equal(result.body, '');
});

test('media closes its descriptor when a client disconnects during a stream', async t => {
  const { roots, file } = await fixture(t);
  await truncate(file, 32 * 1024 * 1024);
  const handles: FileHandle[] = [];
  const links = new MediaLinks(roots, Date.now, async (path, flags) => {
    const handle = await open(path, flags);
    handles.push(handle);
    return handle;
  });
  const { origin, port, done } = await listen(t, links);
  const { url } = await links.issue(file, origin);
  assert.equal(handles[0].fd, -1);
  await new Promise<void>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: url }, res => {
      res.once('error', reject);
      res.once('data', () => { res.destroy(); resolve(); });
    }).on('error', reject).end();
  });
  await done();
  assert.equal(handles.length, 2);
  assert.equal(handles[1].fd, -1);
});

test('video paths in chat become buttons only with the Bridge capability, including spaces inside backticks', () => {
  const text = 'See /Volumes/K/clip.MP4 and `/Users/me/Documents/screen recording.MoV`, plus /tmp/clip.m4v and /Volumes/K/readme.md';
  const render = (current: boolean) => renderToStaticMarkup(createElement(FileOpenContext.Provider, {
    value: current ? Object.assign(() => {}, { videoSupported: true }) : () => {},
  }, createElement(Markdown, { text })));
  const old = render(false);
  assert.doesNotMatch(old, /data-open-file="[^"]+\.(mp4|mov|m4v)"/i);
  assert.match(old, /\/Volumes\/K\/clip.MP4/);
  assert.match(old, /data-open-file="\/Volumes\/K\/readme.md"/);
  const current = render(true);
  assert.match(current, /data-open-file="\/Volumes\/K\/clip.MP4"/);
  assert.match(current, /data-open-file="\/Users\/me\/Documents\/screen recording.MoV"/);
  assert.match(current, /data-open-file="\/tmp\/clip.m4v"/);
  assert.equal(linkFilePaths('https://example.test/movie.mp4', true), 'https://example.test/movie.mp4');
  assert.equal(videoPath('relative.mp4'), false);
  assert.equal(videoPath('/tmp/clip.mov.txt'), false);
});

test('FileViewer renders an inline controls-enabled player and keeps Finder available on the desktop', () => {
  const props = { path: '/Volumes/K/video.mov', onReveal() {}, onClose() {} };
  const video = { url: '/media/' + 'b'.repeat(32), expiresAt: Date.now() + 60_000 };
  const html = renderToStaticMarkup(createElement(FileViewer, { ...props, video }));
  const player = /<video[^>]+>/.exec(html)?.[0] ?? '';
  for (const attr of ['controls=""', 'playsInline=""', 'preload="metadata"', `src="${video.url}"`]) assert.ok(player.includes(attr), attr);
  assert.match(html, /aria-label="在 Finder 顯示"/);
  const loadError = renderToStaticMarkup(createElement(FileViewer, { ...props, error: '無法開啟這段影片。' }));
  assert.match(loadError, /role="alert"[^>]*>無法開啟這段影片/);
  assert.match(loadError, /aria-label="在 Finder 顯示"/);
  assert.doesNotMatch(loadError, /<video/);
});
