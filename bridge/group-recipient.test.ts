import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { groupRecipientId } from '../src/utils/groupRecipient';

const group = (orchestratorRoomId?: string) => ({ id: 'g', name: 'g', createdAt: '', ...(orchestratorRoomId ? { orchestratorRoomId } : {}),
  members: ['a', 'b', 'c'].map(roomId => ({ modelId: 'CODEX' as const, roomId })) });

test('a group opens addressed to its orchestrator, and to the first member when nobody has the crown', () => {
  assert.equal(groupRecipientId(group('c'), null), 'c');
  assert.equal(groupRecipientId(group(), null), 'a');
  assert.equal(groupRecipientId(undefined, null), undefined);
});

test('a member the user picked wins until they leave the group, and a pick from another group is ignored', () => {
  assert.equal(groupRecipientId(group('c'), 'b'), 'b');
  assert.equal(groupRecipientId(group('c'), 'elsewhere'), 'c');
});

test('the crown moving changes the default, because nothing was picked', () => {
  assert.equal(groupRecipientId(group('b'), null), 'b');
  assert.equal(groupRecipientId({ ...group('b'), orchestratorRoomId: 'gone' }, null), 'a', 'a crown on a room that is not a member is ignored');
});

test('entering another group forgets the last pick', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /groupRecipientId\(selectedGroup, pickedRecipientId\)/);
  assert.match(app, /pickedRecipient.groupId === selectedGroup\?\.id/);
  assert.match(app, /if \(group.id !== selectedGroupId\) setPickedRecipient\(undefined\)/);
  assert.match(app, /type: 'VIEW_GROUP', groupId: selectedGroup.id, selectedRoomId: groupRecipient/);
});
