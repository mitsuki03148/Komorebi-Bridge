import { mkdtempSync } from './test-temp';
import { testAnchor } from './file-trigger-test-anchor';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { FileTriggerStore } from './file-trigger-store';
import type { ValidatedTrigger } from './file-trigger-watch';
const key = Buffer.alloc(32, 42);
const identity = (root: string, name: string): ValidatedTrigger => ({ workspace: root, target: join(root, name), kind: 'file', rootDevice: 1, rootInode: 2, parentDevice: 1, parentInode: 2 });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'komorebi-hmac-test-')); return { root, path: join(root, 'state.json') }; }
function populated() { const f = fixture(); const s = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); const id = identity(f.root, 'one'); s.add('group', id.target, id.kind, id); return { ...f, raw: readFileSync(f.path, 'utf8') }; }

test('signed data survives restart, key is absent from storage', () => {
 const f = populated(); const raw = readFileSync(f.path, 'utf8');
 assert.equal(raw.includes(key.toString('hex')), false); assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).settings('group').length, 1);
});
test('changed payload, missing or changed signature, unsigned legacy and bad JSON fail closed', () => {
 const f = populated(); const envelope = JSON.parse(f.raw);
 for (const raw of [JSON.stringify({ ...envelope, payload: envelope.payload.replace('one', 'two') }), JSON.stringify({ version: 1, payload: envelope.payload }), JSON.stringify({ ...envelope, mac: '0'.repeat(64) }), envelope.payload, '{']) {
  writeFileSync(f.path, raw); const store = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); assert.equal(store.readable, false); assert.deepEqual(store.settings(), []); assert.throws(() => store.add('group', identity(f.root, 'two').target, 'file', identity(f.root, 'two'))); assert.equal(readFileSync(f.path, 'utf8'), raw);
 }
});
test('missing or wrong key cannot read, create or overwrite; changed file invalidates live instance', () => {
 const f = populated(); for (const value of [undefined, Buffer.alloc(32, 7)]) { const store = new FileTriggerStore(f.path, value, undefined, testAnchor(f.path)); assert.equal(store.readable, false); assert.throws(() => store.add('group', identity(f.root, 'two').target, 'file', identity(f.root, 'two'))); assert.equal(readFileSync(f.path, 'utf8'), f.raw); }
 const fresh = fixture(); assert.equal(new FileTriggerStore(fresh.path, undefined, undefined, testAnchor(fresh.path)).readable, false);
 const live = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); writeFileSync(f.path, f.raw.slice(0,-1)); assert.equal(live.readable, false); assert.deepEqual(live.settings(), []);
});
test('concurrent stale instance cannot clobber a later successful write', () => {
 const f = populated(); const first = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); const second = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path));
 const two = identity(f.root, 'two'); first.add('group', two.target, two.kind, two); const after = readFileSync(f.path, 'utf8');
 const three = identity(f.root, 'three'); assert.throws(() => second.add('group', three.target, three.kind, three)); assert.equal(readFileSync(f.path, 'utf8'), after); assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).settings().length, 2);
});
test('two in-process store instances cannot overwrite a committed change with a stale baseline', () => {
 const f = populated(); const first = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path));
 const second = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path));
 const two = identity(f.root, 'two'); first.add('group', two.target, two.kind, two);
 const three = identity(f.root, 'three'); assert.throws(() => second.add('group', three.target, three.kind, three));
 assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).settings().length, 2);
});
test('pending events coalesce, persist uncertain after restart and cancel invalidates reservation', () => {
 const f = fixture(); let now = 100_000; let s = new FileTriggerStore(f.path, key, () => now, testAnchor(f.path)); const i = identity(f.root, 'one');
 const watch = s.add('group', i.target, i.kind, i); s.setEnabled('group', watch.id, true);
 const event = { watchId: watch.id, path: i.target, kind: 'change' as const, observedAt: new Date(now).toISOString() };
 s.enqueue('group', event); s.enqueue('group', { ...event, observedAt: new Date(now + 1).toISOString() }); assert.equal(s.pendingEvents('group').length, 1);
 const target = { roomId: 'room', sessionId: 'session', repoPath: f.root }; const first = s.reserve('group', target)!; assert.ok(s.isCurrent(first)); assert.ok(s.hasHold('group'));
 s = new FileTriggerStore(f.path, key, () => now, testAnchor(f.path)); s.recoverInflight(); assert.equal(s.hasPending('group'), false); assert.equal(s.hasHold('group'), false); assert.equal(s.isCurrent(first), false);
 s.enqueue('group', event); assert.equal(s.reserve('group', target), undefined); now += 60_000; const second = s.reserve('group', target)!; assert.ok(s.isCurrent(second)); s.cancel(watch.id); assert.equal(s.isCurrent(second), false); assert.equal(s.hasHold('group'), false);
});
test('overflow remains bounded and visible after restart', () => {
 const f = fixture(); const s = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); const i = identity(f.root, 'one'); const watch = s.add('group', i.target, i.kind, i); s.setEnabled('group', watch.id, true);
 for (let n = 0; n < 40; n++) s.enqueue('group', { watchId: watch.id, path: `${i.target}-${n}`, kind: 'change', observedAt: new Date().toISOString() });
 const reopened = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); assert.equal(reopened.pendingEvents('group').length, 32); assert.equal(reopened.overflow('group'), true);
});

test('all configuration authority fields are authenticated, including hint and versions', () => {
 const f = fixture(); const s = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); const item = identity(f.root, 'one');
 const watch = s.add('group', item.target, item.kind, item); s.setEnabled('group', watch.id, true); s.setHint('test hint');
 assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).getHint(), 'test hint');
 const envelope = JSON.parse(readFileSync(f.path, 'utf8')); const initial = JSON.parse(envelope.payload);
 const changes: Array<(data: any) => void> = [data => { data.version = 2; }, data => { data.settings[0].groupId = 'other'; }, data => { data.settings[0].path += 'x'; }, data => { data.settings[0].kind = 'directory'; }, data => { data.settings[0].enabled = false; }, data => { data.confirmationHint = 'another hint'; }];
 for (const change of changes) { const value = structuredClone(initial); change(value); const raw = JSON.stringify({ ...envelope, payload: JSON.stringify(value) }); writeFileSync(f.path, raw); const altered = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)); assert.equal(altered.readable, false); assert.throws(() => altered.setHint('other')); assert.equal(readFileSync(f.path, 'utf8'), raw); }
 const wrongEnvelope = JSON.stringify({ ...envelope, version: 2 }); writeFileSync(f.path, wrongEnvelope); assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).readable, false);
});

test('old valid file becomes stale and confirmation is one-shot; invalid file cannot be confirmed', () => {
 const f=fixture(), anchor=testAnchor(f.path), s=new FileTriggerStore(f.path,key,undefined,anchor), i=identity(f.root,'one');
 const watch=s.add('group',i.target,i.kind,i); s.setEnabled('group',watch.id,true); const old=readFileSync(f.path,'utf8');
 s.remove('group',watch.id); writeFileSync(f.path,old);
 const first=new FileTriggerStore(f.path,key,undefined,anchor), second=new FileTriggerStore(f.path,key,undefined,anchor);
 assert.equal(first.readable,false); const preview=first.stalePreview()!; assert.equal(preview.settings[0].path,i.target); assert.equal(preview.settings[0].enabled,true);
 assert.equal(first.confirmStale('0'.repeat(64)),false); assert.equal(first.confirmStale(preview.sha),true); assert.equal(second.confirmStale(preview.sha),false); assert.equal(first.settings('group').length,1);
 const invalid=JSON.parse(old); invalid.mac='0'.repeat(64); writeFileSync(f.path,JSON.stringify(invalid)); const bad=new FileTriggerStore(f.path,key,undefined,anchor);
 assert.equal(bad.stalePreview(),undefined); assert.equal(bad.confirmStale(preview.sha),false);
});

test('each save crash window recovers the durable committed or pending file and discards the other hash', () => {
 const f=fixture(),anchor=testAnchor(f.path),s=new FileTriggerStore(f.path,key,undefined,anchor),i=identity(f.root,'one'); s.add('group',i.target,i.kind,i);
 const oldRaw=readFileSync(f.path,'utf8'), oldHash=anchor.read().committed!; s.setHint('after');
 const newRaw=readFileSync(f.path,'utf8'), newHash=anchor.read().committed!;
 // Crash before atomic file rename: committed file exists; pending SHA must not remain replayable.
 anchor.write({committed:oldHash,pending:newHash}); writeFileSync(f.path,oldRaw);
 let recovered=new FileTriggerStore(f.path,key,undefined,anchor); assert.equal(recovered.readable,true); assert.equal(recovered.getHint(),''); assert.deepEqual(anchor.read(),{committed:oldHash,pending:null});
 writeFileSync(f.path,newRaw); recovered=new FileTriggerStore(f.path,key,undefined,anchor); assert.equal(recovered.readable,false); assert.equal(recovered.stalePreview()?.sha,newHash);
 // Crash after rename before commit: pending SHA is accepted and becomes the sole committed SHA.
 anchor.write({committed:oldHash,pending:newHash}); writeFileSync(f.path,newRaw);
 recovered=new FileTriggerStore(f.path,key,undefined,anchor); assert.equal(recovered.readable,true); assert.equal(recovered.getHint(),'after'); assert.deepEqual(anchor.read(),{committed:newHash,pending:null});
 // Crash after commit: normal read.
 recovered=new FileTriggerStore(f.path,key,undefined,anchor); assert.equal(recovered.readable,true);
 // Crash creating the first file before rename: no committed file, pending cleared.
 const fresh=fixture(), firstAnchor=testAnchor(fresh.path); firstAnchor.write({committed:null,pending:newHash});
 recovered=new FileTriggerStore(fresh.path,key,undefined,firstAnchor); assert.equal(recovered.readable,true); assert.deepEqual(firstAnchor.read(),{committed:null,pending:null});
});

test('two in-process clients cannot confirm the same stale file twice', () => {
 const f=fixture(),anchor=testAnchor(f.path),s=new FileTriggerStore(f.path,key,undefined,anchor),i=identity(f.root,'one');
 const w=s.add('g',i.target,'file',i); const old=readFileSync(f.path,'utf8'); s.remove('g',w.id); writeFileSync(f.path,old);
 const first=new FileTriggerStore(f.path,key,undefined,anchor),second=new FileTriggerStore(f.path,key,undefined,anchor),sha=first.stalePreview()!.sha;
 assert.equal(first.confirmStale(sha),true); assert.equal(second.confirmStale(sha),false);
});

test('real SIGKILL at every anchor-write boundary recovers without a process lock', async () => {
 const { spawnSync } = await import('node:child_process');
 const { existsSync } = await import('node:fs');
 const modulePath=new URL('./file-trigger-store.ts',import.meta.url).href, anchorPath=new URL('./file-trigger-test-anchor.ts',import.meta.url).href;
 for (const boundary of ['before-pending','after-pending','before-commit','after-commit']) {
  const f=fixture(),anchor=testAnchor(f.path),store=new FileTriggerStore(f.path,key,undefined,anchor),i=identity(f.root,'one');
  store.add('g',i.target,'file',i);
  const script=`import {FileTriggerStore} from ${JSON.stringify(modulePath)};import {testAnchor} from ${JSON.stringify(anchorPath)};const [path,boundary]=process.argv.slice(1),base=testAnchor(path);let writes=0;const wrap={read:()=>base.read(),write:value=>{writes++;if((writes===1&&boundary==='before-pending')||(writes===2&&boundary==='before-commit'))process.kill(process.pid,'SIGKILL');base.write(value);if((writes===1&&boundary==='after-pending')||(writes===2&&boundary==='after-commit'))process.kill(process.pid,'SIGKILL');}};new FileTriggerStore(path,Buffer.alloc(32,42),undefined,wrap).setHint('new');`;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script,f.path,boundary]);
  assert.equal(result.signal,'SIGKILL',boundary); assert.equal(existsSync(`${f.path}.lock`),false,boundary);
  const recovered=new FileTriggerStore(f.path,key,undefined,anchor);
  assert.equal(recovered.readable,true,boundary); assert.equal(recovered.getHint(),boundary==='before-pending'||boundary==='after-pending'?'':'new',boundary);
 }
});

test('external replacement after Bridge save is stale and cannot silently change settings', async () => {
 const { spawnSync } = await import('node:child_process');
 const f=fixture(),anchor=testAnchor(f.path),s=new FileTriggerStore(f.path,key,undefined,anchor),i=identity(f.root,'one');
 s.add('g',i.target,'file',i); const old=readFileSync(f.path,'utf8'); const source=join(f.root,'external-copy'); writeFileSync(source,old);
 s.setHint('new');
 const result=spawnSync(process.execPath,['-e','require("fs").copyFileSync(process.argv[1],process.argv[2])',source,f.path]);
 assert.equal(result.status,0); const reopened=new FileTriggerStore(f.path,key,undefined,anchor);
 assert.equal(reopened.readable,false); assert.ok(reopened.stalePreview());
});

test('an external process writing between pending and rename loses to the Bridge committed settings', async () => {
 const { spawnSync } = await import('node:child_process');
 const f = fixture(), anchor = testAnchor(f.path), initial = new FileTriggerStore(f.path, key, undefined, anchor);
 const keep = identity(f.root, 'keep'), externalOnly = identity(f.root, 'external-only');
 initial.add('group', keep.target, keep.kind, keep);
 const extra = initial.add('group', externalOnly.target, externalOnly.kind, externalOnly);
 const externalRaw = readFileSync(f.path, 'utf8');
 const externalSource = join(f.root, 'external-valid'); writeFileSync(externalSource, externalRaw);
 initial.remove('group', extra.id);
 initial.setHint('before');
 let externalRan = false;
 const injectingAnchor = {
  read: () => anchor.read(),
  write(value: Parameters<typeof anchor.write>[0]) {
   anchor.write(value);
   if (value.pending !== null && !externalRan) {
    externalRan = true;
    const result = spawnSync(process.execPath, ['-e', 'require("fs").copyFileSync(process.argv[1], process.argv[2])', externalSource, f.path]);
    assert.equal(result.status, 0, 'external process must actually replace the selected file');
    assert.equal(readFileSync(f.path, 'utf8'), externalRaw, 'external bytes were present before Bridge rename');
   }
  },
 };
 const bridge = new FileTriggerStore(f.path, key, undefined, injectingAnchor);
 bridge.setHint('bridge-wins');
 assert.equal(externalRan, true);
 assert.notEqual(readFileSync(f.path, 'utf8'), externalRaw, 'Bridge rename replaced the external write');
 const reopened = new FileTriggerStore(f.path, key, undefined, anchor);
 assert.equal(reopened.readable, true);
 assert.equal(reopened.stalePreview(), undefined);
 assert.equal(reopened.getHint(), 'bridge-wins');
 assert.deepEqual(reopened.settings('group').map(setting => setting.path), [keep.target], 'external-only watcher never became effective');
});

test('a rejected change leaves the store readable and later valid changes still work', () => {
 const f = fixture(); const store = new FileTriggerStore(f.path, key, undefined, testAnchor(f.path));
 const one = identity(f.root, 'one'); store.add('group', one.target, one.kind, one);
 assert.throws(() => store.add('group', one.target, one.kind, one), /Already watched/);
 assert.equal(store.readable, true); assert.equal(store.settings('group').length, 1);
 const two = identity(f.root, 'two'); store.add('group', two.target, two.kind, two);
 assert.equal(store.readable, true); assert.equal(store.settings('group').length, 2);
 assert.equal(new FileTriggerStore(f.path, key, undefined, testAnchor(f.path)).settings('group').length, 2);
});
test('a failure while writing still makes the store unreadable', () => {
 const f = fixture(); const base = testAnchor(f.path); let fail = false;
 const anchor = { read: () => base.read(), write: (value: Parameters<typeof base.write>[0]) => { if (fail) throw Error('Keychain unavailable'); base.write(value); } };
 const store = new FileTriggerStore(f.path, key, undefined, anchor);
 const one = identity(f.root, 'one'); store.add('group', one.target, one.kind, one);
 fail = true; const two = identity(f.root, 'two');
 assert.throws(() => store.add('group', two.target, two.kind, two), /Keychain unavailable/);
 assert.equal(store.readable, false);
});
