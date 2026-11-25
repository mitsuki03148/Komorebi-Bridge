import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { attachmentLimit, saveAttachment } from './attachments';
import { Rooms } from './rooms';
import type { TerminalRoom } from '../src/types/guild';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
const attachment = { mime: 'image/png', data: image.toString('base64') };

test('images save under generated names and enforce format, size and directory rules', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-attachments-'));
  try {
    const directory = join(tmp, 'images');
    const path = await saveAttachment(attachment, directory);
    assert.match(basename(path), /^[0-9a-f-]+\.png$/);
    assert.deepEqual(await readFile(path), image);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(saveAttachment({ mime: 'image/jpeg', data: attachment.data }, directory));
    await assert.rejects(saveAttachment({ mime: 'image/png', data: 'garbage!' }, directory));
    await assert.rejects(saveAttachment({ mime: 'image/png', data: Buffer.alloc(attachmentLimit + 1).toString('base64') }, directory));
    assert.equal((await readdir(directory)).length, 1);
    const link = join(tmp, 'link');
    await symlink(directory, link);
    await assert.rejects(saveAttachment(attachment, link));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('attachment is saved before the prompt is sent to its room, with confirmation after Enter', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-image-flow-'));
  try {
    const writes: string[] = [];
    let stored = '';
    const manager = new Rooms(tmp, () => {}, async value => stored = await saveAttachment(value, tmp));
    const room = { id: 'room', modelId: 'CODEX', roomName: '測試', ready: true, logs: [], live: true } as unknown as TerminalRoom;
    const live = { singleNoted: true, process: { write: (s: string) => writes.push(s) }, queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    await assert.rejects(manager.handle({ type: 'INPUT', roomId: room.id, text: '/model', attachment }, () => {}));
    assert.equal(writes.length, 0);
    const result = new Promise<void>((resolve, reject) => {
      void manager.handle({ type: 'INPUT', roomId: room.id, text: '幫我看一下', attachment, requestId: 'img-1' }, event => {
        try {
          assert.equal(event.type, 'ACTION_RESULT');
          if (event.type === 'ACTION_RESULT') assert.equal(event.ok, true);
          assert.equal(writes[1], '\r');
          resolve();
        } catch (error) { reject(error); }
      }).catch(reject);
    });
    await result;
    assert.deepEqual(await readFile(stored), image);
    assert.ok(writes[0].includes(stored));
    assert.match(room.logs.at(-1)?.text ?? '', /📎 圖片/);
    (manager as any).live.delete(room.id);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

function fakeTerminal(lines: string[]) {
  return { modes: { bracketedPasteMode: true }, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
}

for (const [modelId, marker] of [['CLAUDE', '$  [Image #1]'], ['CODEX', '› [Image #1]'], ['AGY', '▸ 📎 1 media attached (file, 70 B, image/png)']] as const) {
  test(`${modelId} gets the image as a native attachment and the text in the same turn`, async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'komorebi-native-image-'));
    try {
      const writes: string[] = [];
      const lines = ['Ready'];
      const manager = new Rooms(tmp, () => {}, async value => saveAttachment(value, tmp));
      const room = { id: 'room', modelId, roomName: '測試', ready: true, logs: [], live: true } as unknown as TerminalRoom;
      // The CLI turns a lone pasted image path into its attachment marker.
      const live = { singleNoted: true, process: { write: (s: string) => { writes.push(s); if (s.startsWith('\x1b[200~') && s.includes(tmp)) lines.push(marker); } },
        terminal: fakeTerminal(lines), queued: 0, dirty: false };
      manager.rooms.set(room.id, room);
      (manager as any).live.set(room.id, live);
      const done = new Promise<void>((resolve, reject) => {
        void manager.handle({ type: 'INPUT', roomId: room.id, text: '幫我看一下', attachment, requestId: 'native' }, event => {
          if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message));
        }).catch(reject);
      });
      await done;
      assert.equal(writes.length, 3);
      assert.match(writes[0], /^\x1b\[200~.*\.png\x1b\[201~$/);
      assert.equal(writes[1], ' 幫我看一下');
      assert.equal(writes[2], '\r');
      assert.equal(writes.some(value => value.includes('請讀取這張本機圖片')), false);
      assert.match(room.logs.at(-1)?.text ?? '', /幫我看一下 📎 圖片/);
      assert.equal((manager as any).live.get(room.id).attaching, false);
      (manager as any).live.delete(room.id);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
}

test('a CLI that does not show an attachment marker still sends the path in the same single turn, without a warning', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-native-image-'));
  try {
    const writes: string[] = [];
    const manager = new Rooms(tmp, () => {}, async value => saveAttachment(value, tmp));
    manager.attachConfirmMs = 200;
    const notices: string[] = [];
    const room = { id: 'room', modelId: 'CODEX', roomName: '測試', ready: true, logs: [], live: true } as unknown as TerminalRoom;
    const live = { singleNoted: true, process: { write: (s: string) => writes.push(s) }, terminal: fakeTerminal(['Ready']), queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    await new Promise<void>((resolve, reject) => {
      void manager.handle({ type: 'INPUT', roomId: room.id, text: '幫我看一下', attachment, requestId: 'fallback' }, event => {
        if (event.type === 'NOTICE') notices.push(event.message);
        if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message));
      }).catch(reject);
    });
    assert.equal(writes.filter(value => value === '\r').length, 1);
    // The path is sent anyway and these CLIs read it with a tool, so the Founder gets no warning.
    assert.deepEqual(notices, []);
    (manager as any).live.delete(room.id);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('screen markers are counted per CLI', async () => {
  const { attachedImages } = await import('./rooms');
  assert.equal(attachedImages('CLAUDE', '$  [Image #2]後面'), 2);
  assert.equal(attachedImages('CODEX', '› [Image #1] text [Image #3]'), 3);
  assert.equal(attachedImages('AGY', '▸ 📎 2 media attached'), 2);
  assert.equal(attachedImages('AGY', 'no image'), 0);
});

test('an image can steer a working CLI in the same turn as its text', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-steer-image-'));
  try {
    const writes: string[] = [];
    const lines = ['Running…', '$'];
    const manager = new Rooms(tmp, () => {}, async value => saveAttachment(value, tmp));
    const room = { id: 'room', modelId: 'CLAUDE', roomName: '測試', ready: false, steerable: true, status: 'running', logs: [], live: true } as unknown as TerminalRoom;
    const live = { singleNoted: true, process: { write: (s: string) => { writes.push(s); if (s.startsWith('\x1b[200~') && s.includes(tmp)) lines.push('$  [Image #1]'); } },
      terminal: fakeTerminal(lines), queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    const results: string[] = [];
    await new Promise<void>((resolve, reject) => {
      void manager.handle({ type: 'INPUT', roomId: room.id, text: '順便看一下這張', attachment, requestId: 'steer-image' }, event => {
        if (event.type === 'ACTION_RESULT') { results.push(event.message); event.ok ? resolve() : reject(new Error(event.message)); }
      }).catch(reject);
    });
    assert.equal(writes.length, 3);
    assert.match(writes[0], /^\x1b\[200~.*\.png\x1b\[201~$/);
    assert.equal(writes[1], ' 順便看一下這張');
    assert.equal(writes[2], '\r');
    assert.match(results[0], /處理完當前步驟會收到/);
    (manager as any).live.delete(room.id);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

function manyImages(tmp: string, modelId: 'CLAUDE' | 'CODEX' | 'AGY', screen: 'native' | 'plain') {
  const writes: string[] = [];
  const lines = ['Ready'];
  let pasted = 0;
  const marker = (n: number) => modelId === 'CLAUDE' ? `$  [Image #${n}]` : modelId === 'CODEX' ? `› [Image #${n}]` : `▸ 📎 ${n} media attached (file, 70 B, image/png)`;
  const live = { singleNoted: true, process: { write: (s: string) => { writes.push(s); if (screen === 'native' && s.startsWith('\x1b[200~') && s.includes(tmp)) lines.push(marker(++pasted)); } },
    terminal: screen === 'native' ? fakeTerminal(lines) : { modes: { bracketedPasteMode: false } }, queued: 0, dirty: false };
  const manager = new Rooms(tmp, () => {}, async value => saveAttachment(value, tmp));
  manager.attachConfirmMs = 300;
  const room = { id: 'room', modelId, roomName: '測試', ready: true, logs: [], live: true } as unknown as TerminalRoom;
  manager.rooms.set(room.id, room);
  (manager as any).live.set(room.id, live);
  const send = (extra: object, text = '比較下') => new Promise<void>((resolve, reject) => {
    void manager.handle({ type: 'INPUT', roomId: room.id, text, requestId: 'many', ...extra } as never, event => {
      if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message));
    }).catch(reject);
  });
  return { writes, room, send, release: () => (manager as any).live.delete(room.id) };
}

for (const modelId of ['CLAUDE', 'CODEX', 'AGY'] as const) {
  test(`${modelId} gets several images as separate native attachments before the text, in one turn`, async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'komorebi-many-images-'));
    try {
      const { writes, room, send, release } = manyImages(tmp, modelId, 'native');
      await send({ attachments: [attachment, attachment, attachment] });
      assert.equal(writes.length, 5, 'three pastes, the text, then Enter');
      for (const index of [0, 1, 2]) assert.match(writes[index], /^\x1b\[200~.*\.png\x1b\[201~$/);
      assert.equal(new Set(writes.slice(0, 3)).size, 3, 'each image is its own file');
      assert.equal(writes[3], ' 比較下');
      assert.equal(writes[4], '\r');
      assert.match(room.logs.at(-1)?.text ?? '', /比較下 📎 圖片 📎 圖片 📎 圖片$/);
      // The sender's own message keeps the files, so the pictures can be shown back to them.
      assert.equal(room.logs.at(-1)?.images?.length, 3);
      assert.ok(room.logs.at(-1)?.images?.every(path => path.startsWith(tmp) && path.endsWith('.png')));
      release();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
}

test('without native attachment every image path goes in the text of the one message', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-many-images-'));
  try {
    const { writes, send, release } = manyImages(tmp, 'CODEX', 'plain');
    await send({ attachments: [attachment, attachment] });
    assert.equal(writes.filter(value => value === '\r').length, 1);
    assert.match(writes.join(''), /請讀取這 2 張本機圖片：.*\.png、.*\.png/);
    release();
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('four photos still go through as native attachments in a single image-only turn', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-four-images-'));
  const { writes, room, send, release } = manyImages(tmp, 'CODEX', 'native');
  try {
    await send({ attachments: Array(4).fill(attachment) });
    assert.equal(writes.length, 6);
    for (const paste of writes.slice(0, 4)) assert.match(paste, /^\x1b\[200~.*\.png\x1b\[201~$/);
    assert.equal(new Set(writes.slice(0, 4)).size, 4);
    assert.deepEqual(writes.slice(4), [' 比較下', '\r']);
    assert.equal(room.logs.at(-1)?.images?.length, 4);
  } finally { release(); await rm(tmp, { recursive: true, force: true }); }
});

test('more than four images, a bad image, or images with a slash command stop the whole message before anything reaches the CLI', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-many-images-'));
  try {
    const { writes, send, release } = manyImages(tmp, 'CLAUDE', 'native');
    await assert.rejects(send({ attachments: [attachment, attachment, attachment, attachment, attachment] }), /最多 4 張/);
    await assert.rejects(send({ attachments: [attachment, { mime: 'image/png', data: 'not an image' }] }));
    await assert.rejects(send({ attachments: 'nope' }), /最多/);
    await assert.rejects(send({ attachments: [attachment, attachment] }, '/model'));
    assert.equal(writes.length, 0);
    release();
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
