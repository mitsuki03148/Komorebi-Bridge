import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmFileTrigger } from './file-trigger-confirm';

test('two connected clients both see fresh state and only the first digest confirmation activates', () => {
 let integrity = 'stale', activated = 0, rejected = 0;
 const clients: { integrity: string; groupId: string }[][] = [[], []];
 const run = () => confirmFileTrigger({
  digest: 'preview-sha', groupIds: () => ['group-a', 'group-b'],
  confirm: value => { if (value !== 'preview-sha' || integrity !== 'stale') return false; integrity = 'ok'; return true; },
  onAccepted: () => { activated++; },
  publish: groupId => { for (const client of clients) client.push({ groupId, integrity }); },
  onRejected: () => { rejected++; },
 });
 assert.equal(run(), true); assert.equal(run(), false); assert.equal(activated, 1); assert.equal(rejected, 1);
 assert.deepEqual(clients[0], clients[1]); assert.deepEqual(clients[1], [
  { groupId: 'group-a', integrity: 'ok' }, { groupId: 'group-b', integrity: 'ok' },
  { groupId: 'group-a', integrity: 'ok' }, { groupId: 'group-b', integrity: 'ok' },
 ]);
});

test('invalid signature cannot activate a stale confirmation and all views receive invalid state', () => {
 let activated = false, rejected = false; const states: string[] = [];
 assert.equal(confirmFileTrigger({ digest: 'old-sha', groupIds: () => ['group'], confirm: () => false,
  onAccepted: () => { activated = true; }, publish: () => states.push('invalid'), onRejected: () => { rejected = true; } }), false);
 assert.equal(activated, false); assert.equal(rejected, true); assert.deepEqual(states, ['invalid']);
});
