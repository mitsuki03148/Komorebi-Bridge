import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PendingAges } from '../src/utils/pendingAge';
import type { TerminalRoom } from '../src/types/guild';
const room = (approval?: string) => ({ id: 'r', pendingApproval: approval ? { id: approval } : undefined }) as TerminalRoom;
test('initial approvals are unknown; observed changes get a time and disappear on resolution', () => {
  const ages = new PendingAges();
  assert.deepEqual(ages.reset([room('old')]), {});
  assert.deepEqual(ages.update(room('old'), 100), {});
  assert.deepEqual(ages.update(room(), 200), {});
  assert.deepEqual(ages.update(room('new'), 300), { 'approval:r:new': 300 });
  assert.deepEqual(ages.update(room('new'), 400), { 'approval:r:new': 300 });
  assert.deepEqual(ages.reset([room('new')]), {}, 'reconnect loses untrusted age');
  assert.deepEqual(ages.update(room(), 500), {});
});
