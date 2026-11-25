import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRoleEditorSave, advanceRoleEditorSave, interruptRoleEditorSave } from '../src/utils/roleEditorSave';
import type { RoleEditorSaveInput } from '../src/utils/roleEditorSave';

const base: RoleEditorSaveInput = { groupId: 'g', roomId: 'r', choice: { preset: 'review' }, direction: 'review the changes', directionSupported: true };
const begin = (overrides: Partial<RoleEditorSaveInput> = {}) => beginRoleEditorSave({ ...base, ...overrides }, 'role-1');
const ack = (state: ReturnType<typeof begin>, requestId = 'role-1') => advanceRoleEditorSave(state, { requestId, ok: true }, 'direction-2');

test('new or changed role is acknowledged before its direction is sent', () => {
  let state = begin();
  assert.equal(state.status, 'pending');
  if (state.status !== 'pending') return;
  assert.deepEqual(state.event, { type: 'GROUP_SET_MEMBER_ROLE', groupId: 'g', roomId: 'r', role: { preset: 'review' }, requestId: 'role-1' });
  assert.strictEqual(ack(state, 'other'), state);
  state = ack(state);
  assert.equal(state.status, 'pending');
  if (state.status !== 'pending') return;
  assert.equal(state.roleSaved, true);
  assert.deepEqual(state.event, { type: 'GROUP_SET_MEMBER_DIRECTION', groupId: 'g', roomId: 'r', direction: 'review the changes', expectedRoleKey: 'review', requestId: 'direction-2' });
  assert.strictEqual(ack(state), state);
  assert.equal(ack(state, 'direction-2').status, 'done');
});

test('same role updates or clears direction; unchanged and role removal need no direction write', () => {
  const same = { key: 'review', direction: 'old' };
  const update = begin({ currentRole: same });
  assert.equal(update.status === 'pending' && update.event.type, 'GROUP_SET_MEMBER_DIRECTION');
  const clear = begin({ currentRole: same, direction: '' });
  assert.equal(clear.status === 'pending' && clear.event.type === 'GROUP_SET_MEMBER_DIRECTION' && clear.event.direction, '');
  assert.equal(begin({ currentRole: same, direction: 'old' }).status, 'done');
  const remove = begin({ currentRole: same, choice: null, direction: '' });
  assert.equal(remove.status, 'pending');
  assert.equal(ack(remove).status, 'done');
  assert.equal(ack(begin({ currentRole: same, choice: { preset: 'clerk' }, direction: '' })).status, 'done');
});

test('validation rejects invalid direction before role write, including unicode and lines', () => {
  for (const direction of ['❤', '😀'.repeat(301), 'a\nb\nc\nd\ne\nf\ng']) {
    const state = begin({ direction });
    assert.equal(state.status === 'error' && state.error, 'invalid');
  }
  assert.equal(begin({ choice: { custom: '' } }).status, 'error');
  assert.equal(begin({ direction: '😀'.repeat(300) }).status, 'pending');
});

test('failure, conflict and disconnect never send the next event and retain draft', () => {
  const first = begin();
  const rejected = advanceRoleEditorSave(first, { requestId: 'role-1', ok: false, code: 'conflict' }, 'direction-2');
  assert.equal(rejected.status === 'error' && rejected.error, 'conflict');
  assert.strictEqual(ack(rejected), rejected);
  const second = ack(first);
  const failed = advanceRoleEditorSave(second, { requestId: 'direction-2', ok: false, code: 'failed' }, 'unused');
  assert.equal(failed.status, 'error');
  assert.equal(failed.roleSaved, true);
  assert.equal(failed.direction, base.direction);
  const retry = begin({ currentRole: { key: 'review' }, direction: failed.direction });
  assert.equal(retry.status === 'pending' && retry.event.type, 'GROUP_SET_MEMBER_DIRECTION');
  const lost = interruptRoleEditorSave(second);
  assert.equal(lost.status === 'error' && lost.error, 'disconnected');
  assert.strictEqual(ack(lost, 'direction-2'), lost);
});

test('legacy bridge can still save role alone without direction support', () => {
  assert.equal(begin({ direction: '', directionSupported: false }).status, 'pending');
  const legacy = begin({ directionSupported: false, direction: undefined });
  assert.equal(legacy.status, 'pending');
  assert.equal(ack(legacy).status, 'done');
});


test('same custom role key with renamed label retains old direction until explicit clear', () => {
  const state = begin({ currentRole: { key: 'qa lead', label: 'QA Lead', direction: 'old' }, choice: { custom: 'Qa Lead' }, direction: '' });
  assert.equal(state.status === 'pending' && state.event.type, 'GROUP_SET_MEMBER_ROLE');
  const next = ack(state);
  assert.equal(next.status === 'pending' && next.event.type === 'GROUP_SET_MEMBER_DIRECTION' && next.event.direction, '');
});
