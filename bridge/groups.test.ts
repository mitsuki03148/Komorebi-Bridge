import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Groups } from './groups';
import { checkedInput } from './input';
import type { TerminalRoom } from '../src/types/guild';

const makeRoom = (id: string, modelId: TerminalRoom['modelId']) => ({ id, modelId, roomName: `房間 ${id}`, sessionId: randomUUID() } as TerminalRoom);

test('old parent links are ignored on load; a normal save keeps independent groups and their own boards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-flat-groups-'));
  try {
    const path = join(dir, 'groups.json');
    const a = makeRoom('lead', 'CODEX'), b = makeRoom('member', 'CLAUDE');
    const members = [a, b].map(({ id, modelId }) => ({ modelId, roomId: id }));
    const getRoom = (id: string) => [a, b].find(room => room.id === id);
    const base = { members, createdAt: '2026-11-16T09:00:00Z' };
    const first = { ...base, id: 'first', name: '甲', orchestratorRoomId: a.id, boardPath: '/board-one.md' };
    const second = { ...base, id: 'second', name: '乙', orchestratorRoomId: b.id, boardPath: '/board-two.md' };
    const third = { ...base, id: 'third', name: '丙' };
    const legacy = JSON.stringify([first, { ...second, parentGroupId: first.id }, { ...third, parentGroupId: 'missing-id' }]);
    await writeFile(path, legacy);
    const broadcasts: string[] = [];
    const groups = new Groups(path, group => broadcasts.push(group.id), getRoom);
    const clean = () => JSON.parse(JSON.stringify(groups.snapshot()));
    assert.deepEqual(clean(), [first, second, third]);
    assert.ok(groups.snapshot().every(group => !Object.hasOwn(group, 'parentGroupId')));
    assert.equal(await readFile(path, 'utf8'), legacy, 'loading does not rewrite the saved file');
    const roster = groups.reserveRoster(second.id, b.id)!;
    assert.match(roster.suffix, /總指揮：房間 member/);
    assert.match(roster.suffix, /告示版：\/board-two\.md/);
    assert.doesNotMatch(roster.suffix, /board-one\.md|主群告示版/);
    roster.finish(false);
    assert.deepEqual(broadcasts, []);
    assert.deepEqual(groups.reorder([second.id, 'unknown', second.id]), [second.id, first.id, third.id]);
    const saved = await readFile(path, 'utf8');
    assert.doesNotMatch(saved, /parentGroupId/);
    assert.deepEqual(JSON.parse(saved), [second, first, third]);
    assert.deepEqual(JSON.parse(JSON.stringify(new Groups(path, () => {}, getRoom).snapshot())), [second, first, third]);
    assert.deepEqual(broadcasts, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('duplicate group IDs still prevent loading or overwriting the saved file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-duplicate-'));
  try {
    const a = makeRoom('one', 'CODEX'), b = makeRoom('two', 'CLAUDE');
    const members = [a, b].map(({ id, modelId }) => ({ modelId, roomId: id }));
    const path = join(dir, 'groups.json');
    const group = { id: 'same-id', name: '甲', createdAt: '', members };
    const invalid = JSON.stringify([group, { ...group, name: '乙' }]);
    await writeFile(path, invalid);
    const groups = new Groups(path, () => assert.fail('invalid state must not publish'), id => [a, b].find(room => room.id === id));
    assert.deepEqual(groups.snapshot(), []);
    assert.throws(() => groups.create('新群組', members), /無法讀取群組資料/);
    assert.equal(await readFile(path, 'utf8'), invalid);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deleting a group persists while leaving its member rooms intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-delete-'));
  try {
    const a = makeRoom('one', 'CODEX'), b = makeRoom('two', 'CLAUDE');
    const rooms = new Map([a, b].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const members = [a, b].map(room => ({ roomId: room.id, modelId: room.modelId }));
    const removed = groups.create('刪除', members);
    const kept = groups.create('保留', members);
    const reserved = groups.reserveRoster(removed.id, a.id)!;
    groups.delete(removed.id);
    reserved.finish(true);
    assert.throws(() => groups.delete(removed.id), /找不到/);
    assert.deepEqual([...rooms.values()], [a, b]);
    assert.deepEqual(new Groups(path, () => {}, id => rooms.get(id)).snapshot().map(group => group.id), [kept.id]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the first accepted roster is sent once per visit, including for an older group', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-'));
  try {
    const a = makeRoom('room-a', 'CODEX');
    const b = makeRoom('room-b', 'CLAUDE');
    a.roomName = '研究 & 工作';
    const path = join(dir, 'groups.json');
    const rooms = new Map([a, b].map(room => [room.id, room]));
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const group = groups.create('公會', [a, b].map(({ id, modelId }) => ({ roomId: id, modelId })));
    groups.beginVisit(group.id);
    const sessionB = b.sessionId;
    b.sessionId = undefined;
    assert.equal(groups.reserveRoster(group.id, a.id), undefined);
    b.sessionId = sessionB;
    assert.throws(() => groups.reserveRoster(group.id, 'outside'), /已不在群組/);
    const first = groups.reserveRoster(group.id, a.id)!;
    assert.ok(first.suffix.startsWith(' ===== 我哋而家係協作狀態。崗位／原生 Session ID：'));
    assert.ok(first.suffix.includes(`未設定 光 · ${a.roomName}（${a.sessionId}）`));
    assert.ok(first.suffix.includes(`未設定 響 · ${b.roomName}（${b.sessionId}）`));
    assert.ok(first.suffix.includes(`${process.cwd()}/scripts/komorebi-room bench send '<房名或 Session ID>' --group ${group.id} --from`));
    assert.match(first.suffix, /完成用 bench done/);
    assert.doesNotMatch(first.suffix, /分工原則|按上面各房名稱|bench claim/);
    assert.ok(Array.from(first.suffix).length < 500, 'the note stays short without assigned roles');
    assert.equal(checkedInput('CODEX', `你好${first.suffix}`), `你好${first.suffix}`);
    assert.equal(groups.reserveRoster(group.id, b.id), undefined);
    first.finish(false);
    groups.reserveRoster(group.id, b.id)!.finish(true);
    assert.equal(groups.reserveRoster(group.id, a.id), undefined);
    groups.beginVisit(group.id);
    const previousVisit = groups.reserveRoster(group.id, a.id)!;
    groups.beginVisit(group.id);
    previousVisit.finish(true);
    assert.ok(groups.reserveRoster(group.id, a.id), 'a late acknowledgement must not consume the new visit');
    const restored = new Groups(path, () => {}, id => rooms.get(id));
    restored.beginVisit(group.id);
    assert.ok(restored.reserveRoster(group.id, a.id));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid group data is preserved and legacy notices are ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-invalid-'));
  try {
    const path = join(dir, 'groups.json');
    const a = makeRoom('one', 'AGY'), b = makeRoom('two', 'CODEX');
    const members = [a, b].map(room => ({ roomId: room.id, modelId: room.modelId }));
    const rooms = new Map([a, b].map(room => [room.id, room]));
    await writeFile(path, '{invalid');
    const invalid = new Groups(path, () => {}, id => rooms.get(id));
    assert.throws(() => invalid.create('測試', members));
    assert.equal(await readFile(path, 'utf8'), '{invalid');
    const legacyPath = join(dir, 'legacy.json');
    await writeFile(legacyPath, JSON.stringify([{ id: 'group', name: '測試', members, createdAt: '2026-11-12',
      deliveries: { one: { revision: 'a'.repeat(64), status: 'sending' } } }]));
    const restored = new Groups(legacyPath, () => {}, id => rooms.get(id));
    assert.deepEqual(restored.get('group')?.members, members);
    assert.ok(restored.reserveRoster('group', a.id));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('groups support up to eight distinct rooms of the same character with distinct native sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-same-model-'));
  try {
    const rooms = new Map(Array.from({ length: 9 }, (_, index) => {
      const room = makeRoom(`room-${index + 1}`, 'CODEX');
      return [room.id, room] as const;
    }));
    const groups = new Groups(join(dir, 'groups.json'), () => {}, id => rooms.get(id));
    const group = groups.create('合作', [{ modelId: 'CODEX', roomId: 'room-1' }, { modelId: 'CODEX', roomId: 'room-2' }]);
    for (let index = 3; index <= 8; index++) groups.addMember(group.id, { modelId: 'CODEX', roomId: `room-${index}` });
    assert.equal(groups.get(group.id)?.members.length, 8);
    assert.throws(() => groups.addMember(group.id, { modelId: 'CODEX', roomId: 'room-9' }));
    assert.throws(() => groups.create('重複', [{ modelId: 'CODEX', roomId: 'room-1' }, { modelId: 'CODEX', roomId: 'room-1' }]));
    const restored = new Groups(join(dir, 'groups.json'), () => {}, id => rooms.get(id));
    assert.equal(restored.get(group.id)?.members.length, 8);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('room merges migrate group membership, deduplicate and preserve a one-member group for recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-merge-'));
  try {
    const old = makeRoom('old', 'CODEX');
    const replacement = makeRoom('replacement', 'CODEX');
    const other = makeRoom('other', 'CLAUDE');
    const wrong = makeRoom('wrong', 'AGY');
    const rooms = new Map([old, replacement, other, wrong].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const first = groups.create('第一', [{ modelId: 'CODEX', roomId: 'old' }, { modelId: 'CLAUDE', roomId: 'other' }]);
    const duplicate = groups.create('合併', [{ modelId: 'CODEX', roomId: 'old' }, { modelId: 'CODEX', roomId: 'replacement' }]);
    assert.equal(groups.replaceRoom('old', 'missing'), 0);
    assert.equal(groups.replaceRoom('old', 'wrong'), 0);
    assert.equal(groups.get(first.id)!.members[0].roomId, 'old');
    rooms.delete('old');
    assert.equal(groups.replaceRoom('old', 'replacement'), 2);
    assert.deepEqual(groups.get(first.id)!.members.map(member => member.roomId), ['replacement', 'other']);
    assert.deepEqual(groups.get(duplicate.id)!.members.map(member => member.roomId), ['replacement']);
    const restored = new Groups(path, () => {}, id => rooms.get(id));
    assert.deepEqual(restored.get(duplicate.id)!.members.map(member => member.roomId), ['replacement']);
    restored.addMember(duplicate.id, { modelId: 'CLAUDE', roomId: 'other' });
    assert.equal(restored.get(duplicate.id)!.members.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('known aliases for the same native session cannot be added twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-alias-'));
  try {
    const one = makeRoom('one', 'CODEX');
    const alias = makeRoom('alias', 'CODEX');
    const other = makeRoom('other', 'CLAUDE');
    const sameIdOtherModel = makeRoom('different-model', 'AGY');
    one.sessionId = alias.sessionId = sameIdOtherModel.sessionId = '12345678-1234-1234-1234-123456789abc';
    const rooms = new Map([one, alias, other, sameIdOtherModel].map(room => [room.id, room]));
    const groups = new Groups(join(dir, 'groups.json'), () => {}, id => rooms.get(id));
    assert.throws(() => groups.create('重複', [{ modelId: 'CODEX', roomId: 'one' }, { modelId: 'CODEX', roomId: 'alias' }]));
    const group = groups.create('正常', [{ modelId: 'CODEX', roomId: 'one' }, { modelId: 'CLAUDE', roomId: 'other' }]);
    assert.throws(() => groups.addMember(group.id, { modelId: 'CODEX', roomId: 'alias' }));
    groups.addMember(group.id, { modelId: 'AGY', roomId: 'different-model' });
    assert.equal(groups.get(group.id)?.members.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('removing an unavailable member repairs the roster without deleting its room', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-groups-remove-'));
  try {
    const one = makeRoom('one', 'CODEX');
    const two = makeRoom('two', 'CLAUDE');
    const rooms = new Map([one, two].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const group = groups.create('修復', [{ modelId: 'CODEX', roomId: 'one' }, { modelId: 'CLAUDE', roomId: 'two' }]);
    const present = groups.create('解除關聯', [{ modelId: 'CODEX', roomId: 'one' }, { modelId: 'CLAUDE', roomId: 'two' }]);
    groups.removeMember(present.id, 'two');
    assert.equal(rooms.get('two'), two, 'removing a present member leaves its native room intact');
    rooms.delete('two');
    assert.throws(() => groups.removeMember(group.id, 'absent'));
    groups.removeMember(group.id, 'two');
    assert.deepEqual(groups.get(group.id)!.members.map(member => member.roomId), ['one']);
    assert.throws(() => groups.removeMember(group.id, 'one'));
    assert.equal(rooms.get('one'), one);
    rooms.set('two', two);
    assert.equal(rooms.get('two'), two, 'the group operation does not touch native rooms');
    const restored = new Groups(path, () => {}, id => rooms.get(id));
    assert.deepEqual(restored.get(group.id)!.members.map(member => member.roomId), ['one']);
    restored.addMember(group.id, { modelId: 'CLAUDE', roomId: 'two' });
    assert.equal(restored.get(group.id)!.members.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a first roster does not choose a lead; an explicit crown persists, can change, and is removed with the member', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-lead-'));
  try {
    const a = makeRoom('lead-a', 'CODEX'), b = makeRoom('lead-b', 'CLAUDE'), c = makeRoom('lead-c', 'AGY');
    const rooms = new Map([a, b, c].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const group = groups.create('領導', [a, b, c].map(room => ({ roomId: room.id, modelId: room.modelId })));
    assert.equal(group.orchestratorRoomId, undefined);
    const reserved = groups.reserveRoster(group.id, b.id)!;
    assert.doesNotMatch(reserved.suffix, /總指揮：/, 'an unset crown is not invented in the roster');
    assert.match(reserved.suffix, /派單：.* bench send .*--group/);
    reserved.finish(true);
    assert.equal(groups.get(group.id)?.orchestratorRoomId, undefined, 'sending the roster does not set a crown');
    assert.equal(new Groups(path, () => {}, id => rooms.get(id)).get(group.id)?.orchestratorRoomId, undefined);
    assert.equal(groups.setOrchestrator(group.id, b.id).previous, undefined, 'only an explicit setting first gives the crown');
    assert.equal(groups.setOrchestrator(group.id, a.id).previous, b.id);
    assert.equal(new Groups(path, () => {}, id => rooms.get(id)).get(group.id)?.orchestratorRoomId, a.id, 'it is saved');
    assert.equal(groups.setOrchestrator(group.id, a.id).previous, undefined, 'naming the same lead again changes nothing');
    assert.throws(() => groups.setOrchestrator(group.id, 'outside'), /群組成員/);
    groups.removeMember(group.id, a.id);
    assert.equal(groups.get(group.id)?.orchestratorRoomId, undefined, 'the lead left, so nobody leads until one is named');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the lead can be taken away: nobody is made the lead by default afterwards, until one is named again (which replaces the old one)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-unlead-'));
  try {
    const a = makeRoom('un-a', 'CODEX'), b = makeRoom('un-b', 'CLAUDE');
    const rooms = new Map([a, b].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const groups = new Groups(path, () => {}, id => rooms.get(id));
    const group = groups.create('取消', [a, b].map(room => ({ roomId: room.id, modelId: room.modelId })));
    groups.setOrchestrator(group.id, a.id);
    const cleared = groups.clearOrchestrator(group.id);
    assert.equal(cleared.previous, a.id);
    assert.equal(groups.get(group.id)?.orchestratorRoomId, undefined);
    assert.equal(new Groups(path, () => {}, id => rooms.get(id)).get(group.id)?.orchestratorCleared, true, 'saved');
    // The next first prompt does not hand the lead out again, and the roster names none.
    groups.beginVisit(group.id);
    const reserved = groups.reserveRoster(group.id, b.id)!;
    assert.doesNotMatch(reserved.suffix, /　總指揮：[^/]*（[0-9a-f-]{36}）/, 'the roster names no lead');
    assert.doesNotMatch(reserved.suffix, /總指揮：/);
    reserved.finish(true);
    assert.equal(groups.get(group.id)?.orchestratorRoomId, undefined, 'left unassigned on purpose');
    // Naming one again clears the mark; naming another replaces the first.
    groups.setOrchestrator(group.id, b.id);
    assert.equal(groups.get(group.id)?.orchestratorCleared, undefined);
    assert.equal(groups.setOrchestrator(group.id, a.id).previous, b.id);
    assert.equal(groups.get(group.id)?.orchestratorRoomId, a.id, 'only one lead at a time');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a group can be renamed, the new name is saved, and a bad name or an unknown group is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-rename-'));
  try {
    const a = makeRoom('one', 'CODEX'), b = makeRoom('two', 'CLAUDE');
    const rooms = new Map([a, b].map(room => [room.id, room]));
    const path = join(dir, 'groups.json');
    const seen: string[] = [];
    const groups = new Groups(path, group => seen.push(group.name), id => rooms.get(id));
    const group = groups.create('舊名', [a, b].map(room => ({ roomId: room.id, modelId: room.modelId })));
    assert.equal(groups.rename(group.id, '  新名  ').name, '新名');
    assert.equal(seen.at(-1), '新名');
    assert.deepEqual(groups.get(group.id)?.members.map(member => member.roomId), ['one', 'two']);
    const before = seen.length;
    groups.rename(group.id, '新名');
    assert.equal(seen.length, before, 'the same name is not published again');
    assert.throws(() => groups.rename(group.id, ' '), /無效/);
    assert.throws(() => groups.rename(group.id, '!bad'), /無效/);
    assert.throws(() => groups.rename('missing', '名'), /找不到/);
    assert.equal(new Groups(path, () => {}, id => rooms.get(id)).get(group.id)?.name, '新名');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
