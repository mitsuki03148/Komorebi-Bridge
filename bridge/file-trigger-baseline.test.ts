import { mkdtempSync } from './test-temp';
import { testAnchor } from './file-trigger-test-anchor';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTriggerStore } from './file-trigger-store';
import { FileTriggerWatch, validateTriggerPath } from './file-trigger-watch';

test('signed metadata baseline survives restart and detects an edit while the same root was unavailable', () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'trigger-baseline-'));
 const workspace = join(dir, 'workspace'); mkdirSync(workspace);
 const target = join(workspace, 'file.md'), config = join(dir, 'settings.json');
 const secret = 'CONTENT_MUST_NEVER_BE_SAVED_837'; writeFileSync(target, secret);
 const key = Buffer.alloc(32, 47), identity = validateTriggerPath(workspace, target, 'file');
 let store = new FileTriggerStore(config, key, undefined, testAnchor(config)); const item = store.add('g', target, 'file', identity); store.setEnabled('g', item.id, true);
 let observed = 0;
 let watcher = new FileTriggerWatch({ workspace, target, kind: 'file', expectedIdentity: identity,
  onEvent: () => { observed++; }, onStatus: () => {}, onBaseline: value => store.setWatchBaseline('g', item.id, value) });
 watcher.start(); assert.equal(store.getWatchBaseline('g', item.id)?.length, 1); watcher.close();
 const serialized = readFileSync(config, 'utf8'); assert.equal(serialized.includes(secret), false);
 renameSync(workspace, workspace + '-offline'); writeFileSync(join(workspace + '-offline', 'file.md'), secret + ' changed'); renameSync(workspace + '-offline', workspace);
 store = new FileTriggerStore(config, key, undefined, testAnchor(config)); const saved = store.getWatchBaseline('g', item.id); assert.equal(saved?.length, 1);
 watcher = new FileTriggerWatch({ workspace, target, kind: 'file', expectedIdentity: identity, baseline: saved,
  onEvent: () => { observed++; }, onStatus: () => {}, onBaseline: value => store.setWatchBaseline('g', item.id, value) });
 watcher.start(); watcher.close(); assert.equal(observed, 1);
 const persisted = new FileTriggerStore(config, key, undefined, testAnchor(config)); assert.deepEqual(persisted.getWatchBaseline('g', item.id), store.getWatchBaseline('g', item.id));
 renameSync(workspace, workspace + '-previous'); mkdirSync(workspace); writeFileSync(target, 'other');
 assert.throws(() => new FileTriggerWatch({ workspace, target, kind: 'file', expectedIdentity: identity, baseline: saved, onEvent() {}, onStatus() {} }), /replaced/);
});

test('signed metadata baseline rejects unrelated paths, content fields, excessive entries and wrong group', () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'trigger-baseline-invalid-')); const workspace = join(dir, 'workspace'); mkdirSync(workspace);
 const target = join(workspace, 'file.md'); writeFileSync(target, 'ignored');
 const store = new FileTriggerStore(join(dir, 'settings.json'), Buffer.alloc(32, 52), undefined, testAnchor(join(dir, 'settings.json'))); const id = validateTriggerPath(workspace, target, 'file');
 const item = store.add('g', target, 'file', id); const stamp = { dev: 1, ino: 1, size: 1, mtime: 1, ctime: 1 };
 assert.throws(() => store.setWatchBaseline('other', item.id, [{ path: target, stamp }]));
 assert.throws(() => store.setWatchBaseline('g', item.id, [{ path: join(workspace, 'else'), stamp }]));
 assert.throws(() => store.setWatchBaseline('g', item.id, [{ path: target, stamp, content: 'bad' } as never]));
 assert.throws(() => store.setWatchBaseline('g', item.id, Array.from({ length: 2049 }, () => ({ path: target, stamp }))));
 assert.equal(store.getWatchBaseline('g', item.id), undefined);
});

test('tampering immediately after watch start stops deferred scan without overwriting the signed config', async () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'trigger-scan-tamper-')); const workspace = join(dir, 'workspace'); mkdirSync(workspace);
 const target = join(workspace, 'file.md'), config = join(dir, 'settings.json'); writeFileSync(target, 'contents never read');
 const store = new FileTriggerStore(config, Buffer.alloc(32, 53), undefined, testAnchor(config)); const identity = validateTriggerPath(workspace, target, 'file');
 const item = store.add('g', target, 'file', identity); store.setEnabled('g', item.id, true);
 let watcher: FileTriggerWatch | undefined;
 const tampered = '{"version":1,"payload":"modified","mac":"00"}';
 try {
  await new Promise<void>((resolve, reject) => {
   const timer = setTimeout(() => reject(Error('tamper gap timeout')), 4000);
   watcher = new FileTriggerWatch({ workspace, target, kind: 'file', expectedIdentity: identity,
    onEvent: () => reject(Error('unexpected event')), onStatus: status => { if (status === 'gap') { clearTimeout(timer); resolve(); } },
    onBaseline: baseline => store.setWatchBaseline('g', item.id, baseline) });
   watcher.start(); writeFileSync(config, tampered);
  });
  assert.equal(store.readable, false); assert.equal(readFileSync(config, 'utf8'), tampered);
 } finally { watcher?.close(); }
});
