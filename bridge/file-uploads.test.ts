import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WebSocket, { WebSocketServer } from 'ws';
import { AttachmentPicker } from '../src/components/AttachmentPicker';
import { cleanUploadName, maxFileBytes, maxUploadFrameBytes, originalUploadName, requireFileUploadSupport, selectionCountIssue, sendFileUpload } from '../src/utils/fileAttachments';
import { displayRoom, fileReadSuffix, transcriptText, userTextKey } from '../src/utils/transcriptText';
import type { ClientEvent } from '../src/types/bridge';
import type { TerminalRoom } from '../src/types/guild';
import { attachmentLimit, saveAttachment, saveFileAttachments } from './attachments';
import { AttachmentLedger } from './attachment-trash';
import { Rooms } from './rooms';

const raw = (name: string, bytes = Buffer.from('資料\n🔍')) => ({ name, data: bytes.toString('base64') });
const image = { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=' };

test('file uploads keep original bytes; validate a batch before saving and constrain the original filename', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-files-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const folder = join(dir, 'uploads');
  const valid = raw('..report\\目錄/零\x1b：計劃 & 1.PDF');
  const bytes = Buffer.from(valid.data, 'base64');
  const [result, plain, long] = await saveFileAttachments([valid, raw('LICENSE'), raw('報'.repeat(150) + '.pdf')], folder);
  assert.equal(basename(result), basename(result).slice(0, 37) + 'report_目錄_零__計劃 & 1.PDF');
  assert.deepEqual(await readFile(result), bytes);
  assert.equal((await stat(result)).mode & 0o777, 0o600);
  assert.equal(originalUploadName(basename(plain)), 'LICENSE');
  assert.ok(Buffer.byteLength(basename(long)) <= 255);
  assert.ok(originalUploadName(basename(long))?.endsWith('.pdf'));
  assert.equal(cleanUploadName('a.exe.zip'), 'a.exe.zip', 'only the final extension is checked');
  for (const ext of ['APP', 'sH', 'COMMAND', 'pkg', 'DMG', 'exe', 'BaT']) {
    await assert.rejects(saveFileAttachments([raw('would be saved'), raw('../report.' + ext + ' ')], folder), /副檔名/);
  }
  await assert.rejects(saveFileAttachments([{ name: 'empty', data: '' }], folder), /不可為空/);
  await assert.rejects(saveFileAttachments([{ name: 'broken', data: 'AA?=' }], folder), /編碼無效/);
  await assert.rejects(saveFileAttachments([{ name: 'broken', data: 'AB==' }], folder), /編碼無效/);
  await assert.rejects(saveFileAttachments([raw('oversize', Buffer.alloc(maxFileBytes + 1))], folder), /10 MB/);
  assert.equal((await readdir(folder)).length, 3);
  const link = join(dir, 'outside-link');
  await symlink(folder, link);
  await assert.rejects(saveFileAttachments([valid], link), /附件資料夾無效/);
});

test('two maximum files and two maximum images fit a WebSocket frame exactly at the new ceiling', { timeout: 15_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-files-limit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = Buffer.alloc(maxFileBytes, 7).toString('base64');
  const payload = { name: 'limit.bin', mime: 'application/octet-stream', data };
  const [path] = await saveFileAttachments([payload], dir);
  assert.equal((await stat(path)).size, maxFileBytes);
  assert.equal(attachmentLimit, 3 * 1024 * 1024);
  const png = Buffer.alloc(attachmentLimit);
  Buffer.from(image.data, 'base64').copy(png);
  const frame = JSON.stringify({ type: 'INPUT', roomId: 'r', requestId: 'boundary', text: '測試', files: [payload, payload],
    attachments: Array(2).fill({ mime: 'image/png', data: png.toString('base64') }) });
  const bytes = Buffer.byteLength(frame);
  const base64Bytes = 2 * (payload.data.length + Math.ceil(attachmentLimit / 3) * 4);
  assert.equal(maxUploadFrameBytes, base64Bytes + 2 * 1024 * 6 + 1_048_576);
  assert.ok(bytes < maxUploadFrameBytes);
  assert.ok(maxUploadFrameBytes < 3 * payload.data.length);
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /maxPayload: maxUploadFrameBytes/);
  assert.match(server, /fileUploadSupported: true/);
  assert.match(server, /!authenticated && \(data as Buffer\)\.length > 4096/);
  const loopback = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: maxUploadFrameBytes, perMessageDeflate: false });
  let client: WebSocket | undefined;
  try {
    await once(loopback, 'listening');
    const address = loopback.address();
    assert.ok(address && typeof address === 'object');
    const received = new Promise<number>((resolve, reject) => {
      loopback.once('connection', peer => {
        peer.once('error', reject);
        peer.once('message', (body: Buffer) => resolve(body.length));
      });
    });
    client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await once(client, 'open');
    // Trailing JSON whitespace fills the envelope budget without changing the attachment contents.
    client.send(frame + ' '.repeat(maxUploadFrameBytes - bytes));
    assert.equal(await received, maxUploadFrameBytes);
  } finally {
    client?.terminate();
    for (const peer of loopback.clients) peer.terminate();
    await new Promise<void>(resolve => loopback.close(() => resolve()));
  }
});

test('the picker and composer count ordinary files separately and also enforce the combined ceiling', () => {
  const file = { type: 'application/pdf' }, picture = { type: 'image/png' };
  assert.equal(selectionCountIssue([picture, picture, picture, picture]), undefined);
  assert.equal(selectionCountIssue([picture, picture, file, file]), undefined);
  assert.equal(selectionCountIssue([picture, picture, picture, file]), undefined);
  assert.equal(selectionCountIssue([file, file, file]), 'files');
  assert.equal(selectionCountIssue([picture, picture, file, file, file]), 'files');
  assert.equal(selectionCountIssue([picture, picture, picture, file, file]), 'total');
  assert.equal(selectionCountIssue([picture, picture, picture, picture, picture]), 'total');
});

test('old Bridge and a stale supporting socket never receive the upload; current Bridge receives both attachment types', () => {
  const encoded = JSON.stringify({ files: [raw('Notes.txt')], attachments: [image] });
  const doc = new File(['a'], 'Notes.txt', { type: 'text/plain' });
  const photo = new File(['b'], 'Photo.png', { type: 'image/png' });
  assert.equal(requireFileUploadSupport([photo], false), true);
  assert.equal(requireFileUploadSupport([photo, doc], false), false);
  assert.equal(requireFileUploadSupport([photo, doc], true), true);
  const out: string[] = [];
  const old = { readyState: 1 as const, send: (text: string) => { out.push(text); } };
  const next = { ...old };
  const envelope = { type: 'INPUT', roomId: 'room', requestId: 'a', text: '測試' };
  assert.equal(sendFileUpload(old, null, envelope, encoded), 'unsupported');
  assert.equal(sendFileUpload(next, old, envelope, encoded), 'unsupported', 'a reconnect does not carry the old socket capability');
  assert.deepEqual(out, []);
  assert.equal(sendFileUpload(next, next, envelope, encoded), 'sent');
  assert.deepEqual(JSON.parse(out[0]), { ...envelope, files: [raw('Notes.txt')], attachments: [image] });
});

test('picker accepts any file; the filename, removal control and reading state render without image resolution', () => {
  const text = new File(['x'], 'Brief & notes.txt');
  const picture = new File(['x'], 'Still.png', { type: 'image/png' });
  const props = { size: 'medium' as const, onSize() {}, onChange() {}, onError() {}, supported: true, fileUploadSupported: true };
  const button = renderToStaticMarkup(createElement(AttachmentPicker, { ...props, files: [] }));
  assert.match(button, /<input[^>]+type="file"[^>]+multiple=""/);
  assert.doesNotMatch(button, /accept=/);
  const onlyFile = renderToStaticMarkup(createElement(AttachmentPicker, { ...props, mode: 'preview', files: [text], preparing: true }));
  assert.match(onlyFile, /Brief &amp; notes\.txt/);
  assert.match(onlyFile, /aria-label="移除 Brief &amp; notes\.txt"/);
  assert.match(onlyFile, /role="status"[^>]*>正在讀取附件/);
  assert.doesNotMatch(onlyFile, /<select/);
  const mixed = renderToStaticMarkup(createElement(AttachmentPicker, { ...props, mode: 'preview', files: [picture, text] }));
  assert.match(mixed, /<select[^>]*aria-label="圖片解像度"/);
  assert.match(mixed, /Brief &amp; notes\.txt/);
});

test('two native photos and two files send one turn, record filenames and deduplicate the native transcript', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-mixed-uploads-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const directory = join(tmp, 'Komorebi Attachments');
  await mkdir(directory);
  const room = { id: 'room', modelId: 'CODEX', roomName: '測試', ready: true, logs: [], live: true, status: 'idle' } as unknown as TerminalRoom;
  const writes: string[] = [], lines = ['› Ask Codex to do anything', 'GPT-6.1 high · /tmp'];
  const rooms = new Rooms(tmp, () => {}, value => saveAttachment(value, directory));
  rooms.fileAttachmentDirectory = directory;
  rooms.attachmentLedger = new AttachmentLedger();
  let photos = 0;
  const live = { singleNoted: true, queued: 0, dirty: false,
    process: { write: (value: string) => { writes.push(value); if (value.startsWith('\x1b[200~') && /\.png\x1b\[201~$/.test(value)) lines.unshift(`› [Image #${++photos}]`); } },
    terminal: { modes: { bracketedPasteMode: true }, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } },
  };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    const files = [raw('Part A.txt'), raw('.資料.pdf')];
    const base = { type: 'INPUT', roomId: room.id, text: '對照', requestId: 'files-1', attachments: [image, image], files } satisfies ClientEvent;
    await assert.rejects(rooms.handle({ ...base, attachments: [], files: [...files, raw('third.bin')] }, () => {}), /一次最多 2 個檔案/);
    await assert.rejects(rooms.handle({ ...base, attachments: [image, image, image] }, () => {}), /最多 4 個附件/);
    await assert.rejects(rooms.handle({ ...base, text: '/model' }, () => {}), /不可以和 \/ 指令/);
    await assert.rejects(rooms.handle({ ...base, files: [files[0], raw('unsafe.sh')] }, () => {}), /副檔名/);
    assert.deepEqual(writes, []);
    assert.deepEqual(await readdir(directory), []);
    await new Promise<void>((resolve, reject) => {
      void rooms.handle(base, event => { if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message)); }).catch(reject);
    });
    const paths = (await readdir(directory)).filter(name => originalUploadName(name)).map(name => join(directory, name));
    const ordered = ['Part A.txt', '資料.pdf'].map(name => paths.find(path => originalUploadName(basename(path)) === name)!);
    assert.equal(ordered.length, 2);
    assert.match(writes[0], /^\x1b\[200~.*\.png\x1b\[201~$/);
    assert.match(writes[1], /^\x1b\[200~.*\.png\x1b\[201~$/);
    assert.notEqual(writes[0], writes[1]);
    assert.equal(writes[2], ` 對照 請讀取這 2 個本機檔案：${ordered[0]}、${ordered[1]}`);
    assert.equal(writes[3], '\r');
    const local = displayRoom(room).logs.at(-1)!;
    assert.equal(local.text, '對照 📎 圖片 📎 圖片\n📎 Part A.txt\n📎 資料.pdf');
    assert.equal(local.images?.length, 2);
    const native = `[Image #1] [Image #2]${writes[2]} ===== 呢間係單人房，冇其他成員。`;
    assert.equal(userTextKey(transcriptText('CODEX', 'user', native)), userTextKey(local.text) + ' ===== 呢間係單人房，冇其他成員。');
    const imageFallback = `對照 請讀取這張本機圖片：${local.images![0]}` + fileReadSuffix(ordered);
    assert.equal(userTextKey(imageFallback), userTextKey(local.text));
    const single = fileReadSuffix([ordered[0]]);
    assert.equal(single, ` 請讀取這個本機檔案：${ordered[0]}`);
    assert.equal(transcriptText('CLAUDE', 'user', `<pasted_content>對照${single}</pasted_content>`), '對照\n📎 Part A.txt');
    assert.equal(transcriptText('AGY', 'user', '對照 請讀取這個本機檔案：/some/other/place/notes.txt'), '對照 請讀取這個本機檔案：/some/other/place/notes.txt');
    assert.deepEqual(rooms.attachmentLedger.filesFor([room.id]).sort(), ordered.map(path => basename(path)).sort());
  } finally { (rooms as any).live.delete(room.id); }
});
