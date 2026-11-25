import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { brandHtml, brandManifest, DEFAULT_DISPLAY_NAME, displayName } from '../src/brand';
import { pushPayload } from './push';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the public default is Komorebi Bridge in the page, manifest, header and notifications', () => {
  assert.equal(DEFAULT_DISPLAY_NAME, 'Komorebi Bridge');
  assert.match(read('src/App.tsx'), /\{displayName\(\)\}/);
  assert.doesNotMatch(read('src/App.tsx'), /<Leaf\b/);
  assert.ok(read('index.html').includes(`<title>${DEFAULT_DISPLAY_NAME}</title>`));
  assert.equal(JSON.parse(read('public/manifest.webmanifest')).name, DEFAULT_DISPLAY_NAME);
  assert.equal(pushPayload('test', '', '', false).title, DEFAULT_DISPLAY_NAME);
});

test('a configured name is used by header, HTML, manifest and push; HTML escapes it safely', () => {
  const name = '木漏れ日ギルド';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { value: { __KOMOREBI_DISPLAY_NAME__: name }, configurable: true });
    assert.equal(displayName(), name);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.match(brandHtml(read('index.html'), name), /<title>木漏れ日ギルド<\/title>/);
  assert.equal(brandManifest(JSON.parse(read('public/manifest.webmanifest')), name).name, name);
  assert.equal(pushPayload('test', '', '', false, undefined, name).title, name);
  const unsafe = brandHtml(read('index.html'), '</script><b>');
  assert.doesNotMatch(unsafe, /<script>window\.__KOMOREBI_DISPLAY_NAME__="<\/script>/);
  assert.match(brandHtml(read('index.html'), 'A $& B'), /<title>A \$&amp; B<\/title>/);
});

test('the group menu offers rename and sends GROUP_RENAME; the Bridge handles it', () => {
  assert.match(read('src/App.tsx'), /data-group-rename/);
  assert.match(read('src/App.tsx'), /type: 'GROUP_RENAME'/);
  assert.match(read('server.ts'), /event\?\.type === 'GROUP_RENAME'/);
  assert.match(read('src/types/bridge.ts'), /type: 'GROUP_RENAME'/);
});

test('the rename dialogs sit near the top on a phone, so the keyboard that opens with them does not cover the box', () => {
  const app = read('src/App.tsx');
  for (const close of ['setRenameRoomId(null)', 'setRenameGroupId(null)']) {
    const opener = app.split('\n').find(line => line.includes('guild-backdrop-in') && line.includes(`onClick={() => ${close}}`));
    assert.ok(opener, close);
    assert.match(opener!, /items-start/);
    assert.doesNotMatch(opener!, /items-end/);
  }
});
