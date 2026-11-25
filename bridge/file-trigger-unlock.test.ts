import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { KeychainRead } from './file-trigger-keychain';
import { FileTriggerStore, type TriggerAnchor } from './file-trigger-store';
import { testAnchor } from './file-trigger-test-anchor';
import { reloadGate, unlockWithKey } from './file-trigger-unlock';
import { resetWithKey } from './file-trigger-reset-key';
import type { ValidatedTrigger } from './file-trigger-watch';

const key = Buffer.alloc(32, 7);
const available: KeychainRead = { state: 'available', key };
const identity = (root: string, name: string): ValidatedTrigger => ({ workspace: root, target: join(root, name), kind: 'file', rootDevice: 1, rootInode: 2, parentDevice: 1, parentInode: 2 });
function populated() {
  const root = mkdtempSync(join(tmpdir(), 'komorebi-unlock-'));
  const path = join(root, 'settings');
  const live = new FileTriggerStore(path, key, undefined, testAnchor(path));
  const one = identity(root, 'one');
  live.setEnabled('g', live.add('g', one.target, 'file', one).id, true);
  return { root, path, live, one };
}
const fresh = (path: string, anchor: TriggerAnchor = testAnchor(path)) => new FileTriggerStore(path, key, undefined, anchor);

test('a store locked by another writer unlocks by loading a fresh one, and keeps every setting', () => {
  const f = populated();
  const reasons: string[] = []; f.live.onLock = reason => reasons.push(reason);
  const other = fresh(f.path); const two = identity(f.root, 'two'); other.add('g', two.target, 'file', two); // a second instance commits first
  assert.equal(f.live.readable, false, 'the old instance refuses: it is behind the committed file');
  assert.deepEqual(reasons, ['file-changed'], 'and says why');
  assert.equal(f.live.lockReason, 'file-changed');
  const unlocked = unlockWithKey({ read: () => available, createStore: k => new FileTriggerStore(f.path, k, undefined, testAnchor(f.path)) });
  assert.ok(unlocked, 'the file and the anchor are authentic, so a fresh load verifies');
  assert.equal(unlocked!.settings().length, 2, 'nothing was reset');
  assert.equal(unlocked!.settings().every(setting => setting.id !== undefined), true);
  rmSync(f.root, { recursive: true, force: true });
});

test('a tampered or damaged file stays locked: nothing is repaired by an unlock', () => {
  const f = populated();
  const original = readFileSync(f.path, 'utf8');
  const forged = JSON.parse(original); forged.payload = forged.payload.replace('"enabled":true', '"enabled":false');
  writeFileSync(f.path, JSON.stringify(forged));
  const reasons: string[] = []; f.live.onLock = reason => reasons.push(reason);
  assert.equal(f.live.readable, false);
  assert.deepEqual(reasons, ['anchor-mismatch']);
  assert.equal(unlockWithKey({ read: () => available, createStore: k => new FileTriggerStore(f.path, k, undefined, testAnchor(f.path)) }), undefined, 'a forged file does not unlock');
  writeFileSync(f.path, '{ not json');
  assert.equal(unlockWithKey({ read: () => available, createStore: k => new FileTriggerStore(f.path, k, undefined, testAnchor(f.path)) }), undefined);
  assert.equal(readFileSync(f.path, 'utf8'), '{ not json', 'the damaged file is left as it is');
  rmSync(f.root, { recursive: true, force: true });
});

test('a Keychain that cannot be read for a moment does not lock the store; the next look works', () => {
  const f = populated();
  const base = testAnchor(f.path); let failing = false; let reads = 0;
  const flaky: TriggerAnchor = { read() { reads++; if (failing) throw Error('Keychain unavailable'); return base.read(); }, write: value => base.write(value) };
  const store = fresh(f.path, flaky); // built while the Keychain works
  const reasons: string[] = []; store.onLock = reason => reasons.push(reason);
  assert.equal(store.readable, true);
  failing = true;
  assert.equal(store.readable, false, 'cannot verify right now: refused');
  assert.equal(store.readable, false);
  assert.deepEqual(reasons, [], 'but not locked');
  failing = false;
  assert.equal(store.readable, true, 'the very next look verifies again');
  assert.equal(store.lockReason, undefined);
  assert.ok(reads >= 3);
  rmSync(f.root, { recursive: true, force: true });
});

test('a Keychain that is locked or denied cannot unlock; no store is built', () => {
  let built = 0;
  for (const state of ['unavailable', 'missing'] as const) {
    assert.equal(unlockWithKey({ read: () => ({ state }), createStore: () => { built++; return { readable: true }; } }), undefined);
  }
  assert.equal(built, 0);
});

test('the reload gate lets an automatic try through once per interval, and the Founder always', () => {
  let now = 1_000;
  const gate = reloadGate(10_000, () => now);
  assert.equal(gate(), true);
  now += 9_999; assert.equal(gate(), false);
  assert.equal(gate(true), true, 'the Reset button is never held back');
  now += 9_999; assert.equal(gate(), false, 'the forced try counts as the last one');
  now += 1; assert.equal(gate(), true);
});

test('reset still works when the configuration file is gone but the Keychain remembers it', () => {
  const f = populated();
  rmSync(f.path);
  const locked = fresh(f.path);
  assert.equal(locked.readable, false, 'missing file with a committed hash is locked');
  const reset = resetWithKey({ read: () => available, provisionMissing: () => available, createStore: () => locked });
  assert.equal(reset.readable, true, 'an empty signed configuration is installed');
  assert.deepEqual(reset.settings(), []);
  assert.equal(readdirSync(f.root).filter(name => name.endsWith('.invalid')).length, 0, 'there was nothing to preserve');
  assert.equal(fresh(f.path).readable, true, 'and it survives a restart');
  rmSync(f.root, { recursive: true, force: true });
});

test('reset still preserves a damaged file, and still refuses to erase a valid or merely stale one', () => {
  const f = populated();
  writeFileSync(f.path, '{ damaged');
  const store = fresh(f.path);
  const reset = resetWithKey({ read: () => available, provisionMissing: () => available, createStore: () => store });
  assert.equal(reset.readable, true);
  assert.equal(readdirSync(f.root).filter(name => name.endsWith('.invalid')).length, 1, 'the damaged original is kept');
  assert.throws(() => resetWithKey({ read: () => available, provisionMissing: () => available, createStore: () => fresh(f.path) }), /設定有效/, 'a valid file is not erased');
  rmSync(f.root, { recursive: true, force: true });
});
