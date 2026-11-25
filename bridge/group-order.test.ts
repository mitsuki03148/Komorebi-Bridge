import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Groups } from './groups';
import { applyOrder, moveId } from '../src/utils/reorder';
import type { TerminalRoom } from '../src/types/guild';

const makeRoom = (id: string, modelId: TerminalRoom['modelId']) => ({ id, modelId, roomName: `房間 ${id}`, sessionId: randomUUID() } as TerminalRoom);

async function withGroups(run: (groups: Groups, ids: string[], path: string, rooms: Map<string, TerminalRoom>) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-order-'));
  try {
    const a = makeRoom('one', 'CODEX'), b = makeRoom('two', 'CLAUDE');
    const rooms = new Map([a, b].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const members = [a, b].map(room => ({ roomId: room.id, modelId: room.modelId }));
    const ids = ['甲', '乙', '丙'].map(name => groups.create(name, members).id);
    await run(groups, ids, path, rooms);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('reordering groups changes the saved order and survives a restart', () => withGroups((groups, ids, path, rooms) => {
  const order = groups.reorder([ids[2], ids[0], ids[1]]);
  assert.deepEqual(order, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(groups.snapshot().map(group => group.id), order);
  assert.deepEqual(new Groups(path, () => {}, id => rooms.get(id)).snapshot().map(group => group.id), order);
}));

test('reordering ignores unknown ids and keeps groups the caller did not list', () => withGroups((groups, ids) => {
  const order = groups.reorder([ids[1], 'gone', ids[1]]);
  assert.deepEqual(order, [ids[1], ids[0], ids[2]]);
}));

test('reordering keeps every group and its members', () => withGroups((groups, ids) => {
  const before = groups.snapshot().map(group => [group.id, group.name, group.members.length]).sort();
  groups.reorder([...ids].reverse());
  assert.deepEqual(groups.snapshot().map(group => [group.id, group.name, group.members.length]).sort(), before);
}));

test('moveId lifts one id to a new place', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 1), ['a', 'b', 'c']);
  assert.deepEqual(moveId(['a', 'b'], 'x', 0), ['a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 99), ['b', 'c', 'a']);
});

test('applyOrder sorts by the given ids and appends groups that are not listed', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(applyOrder(items, ['c', 'a']).map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(applyOrder(items, ['x', 'b']).map(item => item.id), ['b', 'a', 'c']);
});

test('indexAt counts the rows above the pointer', async () => {
  const { indexAt } = await import('../src/utils/reorder');
  assert.equal(indexAt([10, 40, 70], 5), 0);
  assert.equal(indexAt([10, 40, 70], 41), 2);
  assert.equal(indexAt([10, 40, 70], 500), 3);
  assert.equal(indexAt([], 20), 0);
});

test('the flat group picker can be dragged, the manage button does not start a drag, and the order is sent and received', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(app.split('{...groupDrag}').length - 1, 1);
  assert.equal(app.split("data-drag-ignore aria-label={t('topbar.group.manage'").length - 1, 1);
  assert.match(app, /\{\.\.\.groupDrag\}[^]*?\{groups\.map\(group/);
  const { zh } = await import('../src/i18n/zh.ts');
  assert.equal(zh['topbar.group.manage'], '管理群組 {name}');
  assert.match(app, /type: 'GROUP_REORDER', groupIds: ids/);
  assert.match(app, /event\.type === 'GROUPS_ORDER'/);
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /GROUP_REORDER[\s\S]{0,400}groups\.reorder/);
});
