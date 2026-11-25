import { mkdtempSync } from './test-temp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FileTriggerStore, type TriggerAnchor, type TriggerAnchorState } from './file-trigger-store';
import { testAnchor } from './file-trigger-test-anchor';

const key = Buffer.alloc(32, 57);
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'komorebi-reset-')); const path = join(root, 'settings'); return { root, path, anchor: testAnchor(path) }; };
const identity = (root: string) => ({ workspace: root, target: join(root, 'one'), kind: 'file' as const, rootDevice: 1, rootInode: 2, parentDevice: 1, parentInode: 2 });
const backups = (root: string) => readdirSync(root).filter(name => name.endsWith('.invalid'));

test('reset preserves invalid original under unique timestamp name, installs signed disabled empty state', () => {
 const f = fixture(); let s = new FileTriggerStore(f.path, key, undefined, f.anchor); const i = identity(f.root);
 const item = s.add('g', i.target, 'file', i); s.setEnabled('g', item.id, true);
 const invalid = '{"bad":"invalid signature"}'; writeFileSync(f.path, invalid);
 assert.equal(s.readable, false); assert.equal(s.resetInvalid(), true);
 assert.equal(backups(f.root).length, 1); assert.equal(readFileSync(join(f.root, backups(f.root)[0]), 'utf8'), invalid);
 s = new FileTriggerStore(f.path, key, undefined, f.anchor); assert.equal(s.readable, true); assert.deepEqual(s.settings(), []); assert.equal(s.hasPending('g'), false);
 assert.equal(s.resetInvalid(), false, 'valid current file cannot be reset as invalid');
});

test('valid stale configuration cannot be erased via invalid reset', () => {
 const f = fixture(); let s = new FileTriggerStore(f.path, key, undefined, f.anchor); const i = identity(f.root);
 s.add('g', i.target, 'file', i); const signed = readFileSync(f.path, 'utf8'); s.setHint('new'); writeFileSync(f.path, signed);
 assert.ok(s.stalePreview()); assert.equal(s.resetInvalid(), false); assert.equal(readFileSync(f.path, 'utf8'), signed); assert.deepEqual(backups(f.root), []);
});

test('confirm authentic stale state shows hint but discards old undelivered notifications', () => {
 const f = fixture(); let s = new FileTriggerStore(f.path, key, undefined, f.anchor); const i = identity(f.root);
 const watch = s.add('g', i.target, 'file', i); s.setEnabled('g', watch.id, true); s.setHint('signed hint');
 const event = { watchId: watch.id, path: i.target, kind: 'change' as const, observedAt: new Date().toISOString() };
 s.enqueue('g', event); const reserved = s.reserve('g', { roomId:'r', sessionId:'s', repoPath:f.root })!;
 s.finish(reserved.id, 'uncertain'); s.enqueue('g', event);
 const old = readFileSync(f.path, 'utf8'); s.setHint('changed'); writeFileSync(f.path, old);
 const preview = s.stalePreview()!; assert.equal(preview.confirmationHint, 'signed hint'); assert.equal(s.confirmStale(preview.sha), true);
 assert.equal(s.hasPending('g'), false); assert.equal(s.hasHold('g'), false); assert.deepEqual(JSON.parse(JSON.parse(readFileSync(f.path, 'utf8')).payload).pending, []); assert.equal(s.getHint(), 'signed hint'); assert.equal(s.settings('g')[0].enabled, true);
 s = new FileTriggerStore(f.path, key, undefined, f.anchor); assert.equal(s.hasPending('g'), false); assert.equal(s.confirmStale(preview.sha), false);
});

test('reset failures at anchor transitions preserve original bytes and never resume invalid data', () => {
 for (const failAt of [1, 2]) {
  const f = fixture(); let writes = 0; const failing: TriggerAnchor = { read: () => f.anchor.read(), write: (value: TriggerAnchorState) => { if (++writes === failAt) throw Error('injected crash'); f.anchor.write(value); } };
  const initial = new FileTriggerStore(f.path, key, undefined, f.anchor); const i = identity(f.root); initial.add('g', i.target, 'file', i);
  const invalid = `invalid-${failAt}`; writeFileSync(f.path, invalid);
  const s = new FileTriggerStore(f.path, key, undefined, failing); assert.equal(s.resetInvalid(), false);
  assert.equal(readFileSync(join(f.root, backups(f.root)[0]), 'utf8'), invalid);
  const reopened = new FileTriggerStore(f.path, key, undefined, f.anchor);
  if (failAt === 1) { assert.equal(readFileSync(f.path, 'utf8'), invalid); assert.equal(reopened.readable, false); }
  else { assert.equal(reopened.readable, true); assert.deepEqual(reopened.settings(), []); }
 }
});

// Real crashes no longer leave a cross-process directory lock; recovery keeps the invalid original.
test('SIGKILL at reset anchor boundaries preserves original and permits recovery without a lock', () => {
 const mod = new URL('./file-trigger-store.ts', import.meta.url).href;
 const anchorModule = new URL('./file-trigger-test-anchor.ts', import.meta.url).href;
 for (const killAt of [1, 2]) {
  const f = fixture(); const original = new FileTriggerStore(f.path, key, undefined, f.anchor); const i = identity(f.root); original.add('g', i.target, 'file', i);
  const invalid = `bad crash ${killAt}`; writeFileSync(f.path, invalid);
  const script = `import {FileTriggerStore} from ${JSON.stringify(mod)}; import {testAnchor} from ${JSON.stringify(anchorModule)}; const path=process.argv[1],killAt=Number(process.argv[2]),base=testAnchor(path);let n=0; const anchor={read:()=>base.read(),write:v=>{if(++n===killAt)process.kill(process.pid,'SIGKILL');base.write(v)}}; new FileTriggerStore(path,Buffer.alloc(32,57),undefined,anchor).resetInvalid();`;
  const result = spawnSync(process.execPath, ['--import','tsx','--input-type=module','-e',script,f.path,String(killAt)]);
  assert.equal(result.signal, 'SIGKILL'); assert.equal(readFileSync(join(f.root, backups(f.root)[0]), 'utf8'), invalid);
  assert.equal(existsSync(`${f.path}.lock`), false);
  const reopened = new FileTriggerStore(f.path, key, undefined, f.anchor);
  if (killAt === 1) { assert.equal(reopened.readable, false); assert.equal(reopened.resetInvalid(), true); }
  else { assert.equal(reopened.readable, true); assert.deepEqual(reopened.settings(), []); }
 }
});
