import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { FileTriggerStore } from './file-trigger-store';
import { testAnchor } from './file-trigger-test-anchor';
import { deliverFileNotice, type FileNoticeDeps } from './file-trigger-delivery';
import { stopFileTriggerObservers } from './file-trigger-shutdown';
import { validateTriggerPath } from './file-trigger-watch';

/** The monitor is deliberately absent: only the delivery gate may detect tampering. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-tamper-gate-'));
  const path = join(dir, 'settings.json');
  const target = join(dir, 'message.txt');
  writeFileSync(target, 'fixture text never read by delivery');
  const store = new FileTriggerStore(path, Buffer.alloc(32, 29), undefined, testAnchor(path));
  const setting = store.add('group', target, 'file', validateTriggerPath(dir, target, 'file'));
  store.setEnabled('group', setting.id, true);
  store.enqueue('group', { watchId: setting.id, path: target, kind: 'change', observedAt: '2026-01-01T00:00:00.000Z' });
  const room = { id: 'crown', modelId: 'CODEX', sessionId: '00000022-0022-4022-8022-000000000022', repoPath: dir,
    live: true, ready: true, status: 'idle', autoMode: true, resumable: true } as TerminalRoom;
  const group: GroupChat = { id: 'group', name: 'group', createdAt: '',
    members: [{ roomId: room.id, modelId: room.modelId }], orchestratorRoomId: room.id };
  const closed: string[] = [];
  const watches = new Map([['one', { close: () => closed.push('one') }], ['two', { close: () => closed.push('two') }]]);
  const returns = new Map([['return', () => closed.push('return')]]);
  const timers = new Map([['group', setTimeout(() => { throw Error('cancelled retry ran'); }, 60_000)]]);
  let inputs = 0;
  const deps: FileNoticeDeps = {
    store, groups: () => [group], rooms: () => [room],
    verifyIntegrity: () => {
      if (store.readable) return true;
      stopFileTriggerObservers({ watches, returns, timers, onStopped: () => {} });
      return false;
    },
    state: () => ({ inactive: false, verifiedSession: true, auto: true, working: false }),
    validatePaths: () => true, ptyGuard: () => () => true, notice: () => {},
    handle: async () => { inputs++; },
  };
  const tamper = () => {
    const replacement = join(dir, 'replacement');
    // Use a valid JSON envelope with a bogus MAC, then replace atomically.
    const raw = '{"version":1,"payload":"tampered","mac":"' + '0'.repeat(64) + '"}';
    writeFileSync(replacement, raw);
    renameSync(replacement, path);
    return raw;
  };
  return { deps, closed, watches, returns, timers, path, tamper, inputCount: () => inputs };
}

test('without monitor callback, tampered signed state is rejected before delivery and closes all observers', async () => {
  const f = fixture();
  const raw = f.tamper();
  assert.equal(await deliverFileNotice(f.deps, 'group'), 'held');
  assert.equal(f.inputCount(), 0, 'no input reaches the room');
  assert.deepEqual(f.closed.sort(), ['one', 'return', 'two']);
  assert.equal(f.watches.size, 0);
  assert.equal(f.returns.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(readFileSync(f.path, 'utf8'), raw, 'invalid settings are not overwritten');
});

test('without monitor callback, tampering between paste and submit blocks submit and closes all observers', async () => {
  const f = fixture();
  let bytes = '';
  let submitted = false;
  f.deps.handle = async (_event, reply, guards) => {
    assert.equal(guards.authorizeBenchInput?.('paste'), true);
    bytes = f.tamper();
    submitted = guards.authorizeBenchInput?.('submit') === true;
    reply({ type: 'ACTION_RESULT', requestId: 'fixture', ok: submitted, message: 'fixture' });
  };
  await deliverFileNotice(f.deps, 'group');
  assert.equal(submitted, false);
  assert.deepEqual(f.closed.sort(), ['one', 'return', 'two']);
  assert.equal(f.watches.size, 0);
  assert.equal(f.returns.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(readFileSync(f.path, 'utf8'), bytes, 'invalid settings are not overwritten');
});
