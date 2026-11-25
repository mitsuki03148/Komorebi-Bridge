import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveGroups } from './archive-groups';
import { Groups } from './groups';
import type { TerminalRoom } from '../src/types/guild';

const rooms = [
  { id: 'a', modelId: 'CODEX', roomName: 'A', sessionId: '12345678-1234-1234-1234-123456789abc' },
  { id: 'b', modelId: 'CLAUDE', roomName: 'B', sessionId: '22345678-1234-1234-1234-123456789abc' },
  { id: 'c', modelId: 'AGY', roomName: 'C', sessionId: '32345678-1234-1234-1234-123456789abc' },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: 'extra-' + i, modelId: 'CODEX' as const, roomName: 'Extra ' + i,
    sessionId: '42345678-1234-1234-1234-' + String(i).padStart(12, '0'),
  })),
] as const;
const getRoom = (id: string) => rooms.find(room => room.id === id) as TerminalRoom | undefined;
const member = (id: string) => ({ modelId: rooms.find(room => room.id === id)!.modelId, roomId: id });

async function fixture(run: (ctx: { dir: string; groups: Groups; notes: ArchiveGroups; file: string }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-archive-groups-'));
  try {
    const file = join(dir, 'archive-groups.json');
    await run({ dir, groups: new Groups(join(dir, 'groups.json'), () => {}, getRoom), notes: new ArchiveGroups(file), file });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('a restored room goes back into the groups it left, with its lead role', () => fixture(async ({ groups, notes, file }) => {
  const g1 = groups.create('一群', [member('a'), member('b')]);
  const g2 = groups.create('二群', [member('a'), member('c')]);
  groups.setOrchestrator(g1.id, 'a');
  // Archive of room a: it leaves both groups; the note keeps them.
  const left = [g1, g2].map(group => ({ groupId: group.id, orchestrator: groups.get(group.id)!.orchestratorRoomId === 'a' }));
  groups.removeMember(g1.id, 'a');
  groups.removeMember(g2.id, 'a');
  notes.remember('a', left);
  assert.ok((await readFile(file, 'utf8')).includes(g1.id), 'the note is saved');
  assert.equal(new ArchiveGroups(file).take('a').length, 2, 'the note survives a restart');

  const skipped = notes.restore('a', getRoom('a'), groups, () => true);
  assert.deepEqual(skipped, []);
  assert.ok(groups.get(g1.id)!.members.some(item => item.roomId === 'a'));
  assert.ok(groups.get(g2.id)!.members.some(item => item.roomId === 'a'));
  assert.equal(groups.get(g1.id)!.orchestratorRoomId, 'a', 'the lead role comes back');
  assert.equal(groups.get(g2.id)!.orchestratorRoomId, undefined, 'a group it did not lead stays without a lead');
  assert.deepEqual(notes.take('a'), [], 'the note is used once');
}));

test('restoring skips a deleted group, reports a group it cannot rejoin, and leaves other groups alone', () => fixture(async ({ groups, notes }) => {
  const kept = groups.create('保留群', [member('b'), member('c')]);
  const gone = groups.create('已刪群', [member('b'), member('c')]);
  notes.remember('a', [{ groupId: kept.id, orchestrator: false }, { groupId: gone.id, orchestrator: false }]);
  groups.delete(gone.id);
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), [], 'a deleted group is skipped quietly');
  assert.ok(groups.get(kept.id)!.members.some(item => item.roomId === 'a'));

  notes.remember('a', [{ groupId: kept.id, orchestrator: false }]);
  groups.removeMember(kept.id, 'a');
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => false), ['保留群'], 'a room that cannot join is reported');
  assert.ok(!groups.get(kept.id)!.members.some(item => item.roomId === 'a'));
}));

test('an unreadable note file is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-archive-groups-'));
  try {
    const file = join(dir, 'archive-groups.json');
    await writeFile(file, '{broken');
    const notes = new ArchiveGroups(file);
    notes.remember('a', [{ groupId: 'x', orchestrator: false }]);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const has = (groups: Groups, groupId: string) => groups.get(groupId)?.members.find(item => item.roomId === 'a');
const withRole = (groupId: string, orchestrator = true) => ({ groupId, orchestrator, role: { key: 'review' } });
const readNotes = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

test('a full group retains the room, role and lead through restart until a slot opens', () => fixture(async ({ groups, notes, file }) => {
  const g = groups.create('Full group', [member('a'), member('b')]);
  groups.setMemberRole(g.id, 'a', { preset: 'review' });
  groups.setOrchestrator(g.id, 'a');
  groups.removeMember(g.id, 'a');
  notes.remember('a', [withRole(g.id)]);
  for (const room of rooms.slice(2)) groups.addMember(g.id, member(room.id));
  assert.equal(groups.get(g.id)!.members.length, 8);

  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), [g.name]);
  assert.equal(has(groups, g.id), undefined);
  assert.deepEqual(await readNotes(file), { a: [withRole(g.id)] });
  groups.removeMember(g.id, rooms.at(-1)!.id);
  const reopened = new ArchiveGroups(file);
  assert.deepEqual(reopened.restore('a', getRoom('a'), groups, () => true), []);
  assert.deepEqual(has(groups, g.id)?.role, { key: 'review' });
  assert.equal(groups.get(g.id)?.orchestratorRoomId, 'a');
  assert.deepEqual(await readNotes(file), {});
  assert.deepEqual(reopened.restore('a', getRoom('a'), groups, () => true), []);
  assert.equal(groups.get(g.id)!.members.filter(item => item.roomId === 'a').length, 1);
}));

test('temporary join refusal can be retried without losing the saved role', () => fixture(async ({ groups, notes, file }) => {
  const g = groups.create('Wait for session', [member('b'), member('c')]);
  notes.remember('a', [withRole(g.id)]);
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => false), [g.name]);
  assert.equal(has(groups, g.id), undefined);
  assert.deepEqual(await readNotes(file), { a: [withRole(g.id)] });
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), []);
  assert.deepEqual(has(groups, g.id)?.role, { key: 'review' });
  assert.equal(groups.get(g.id)?.orchestratorRoomId, 'a');
}));

test('a failed group save leaves the original record available for retry', () => fixture(async ({ groups, notes, dir, file }) => {
  const g = groups.create('Group save unavailable', [member('b'), member('c')]);
  const groupPath = join(dir, 'groups.json');
  const backup = join(dir, 'saved-groups.json');
  notes.remember('a', [withRole(g.id)]);
  await rename(groupPath, backup);
  await mkdir(groupPath);
  try {
    assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), [g.name]);
    assert.equal(has(groups, g.id), undefined);
    assert.deepEqual(await readNotes(file), { a: [withRole(g.id)] });
  } finally {
    await rmdir(groupPath);
    await rename(backup, groupPath);
  }
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), []);
  assert.deepEqual(has(groups, g.id)?.role, { key: 'review' });
  assert.equal(groups.get(g.id)?.orchestratorRoomId, 'a');
}));

test('a failed archive-record save retains the entry in memory and the retry does not re-add the member', () => fixture(async ({ groups, notes, dir, file }) => {
  const g = groups.create('Journal unavailable', [member('b'), member('c')]);
  notes.remember('a', [withRole(g.id)]);
  const backup = join(dir, 'saved-archive.json');
  await rename(file, backup);
  await mkdir(file);
  try {
    assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), []);
    assert.deepEqual(has(groups, g.id)?.role, { key: 'review' });
  } finally {
    await rmdir(file);
    await rename(backup, file);
  }
  assert.deepEqual(await readNotes(file), { a: [withRole(g.id)] });
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => false), [], 'membership is already restored');
  assert.deepEqual(await readNotes(file), {}, 'the retained entry can be committed once storage recovers');
  assert.equal(groups.get(g.id)!.members.filter(item => item.roomId === 'a').length, 1);
}));

test('a partial restore forgets successful and deleted groups; archiving again preserves unresolved groups', () => fixture(async ({ groups, notes, file }) => {
  const good = groups.create('Can join', [member('b'), member('c')]);
  const blocked = groups.create('Still full', rooms.slice(1).map(room => member(room.id)));
  const gone = groups.create('Deleted', [member('b'), member('c')]);
  notes.remember('a', [withRole(good.id, false), withRole(blocked.id), withRole(gone.id, false)]);
  groups.delete(gone.id);
  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), [blocked.name]);
  assert.ok(has(groups, good.id));
  assert.deepEqual(await readNotes(file), { a: [withRole(blocked.id)] });
  const archivedAgain = has(groups, good.id)!;
  groups.removeMember(good.id, 'a');
  notes.remember('a', [{ groupId: good.id, orchestrator: false, role: archivedAgain.role }]);
  groups.removeMember(blocked.id, rooms.at(-1)!.id);

  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), []);
  assert.deepEqual(has(groups, blocked.id)?.role, { key: 'review' });
  assert.ok(has(groups, good.id));
  assert.equal(groups.get(gone.id), undefined);
  assert.deepEqual(await readNotes(file), {});
}));

test('a failed lead write retains the entry without reporting the restored membership as skipped', async t => {
  await fixture(async ({ groups, notes, file }) => {
    const g = groups.create('Lead pending', [member('b'), member('c')]);
    notes.remember('a', [withRole(g.id)]);
    const lead = groups.setOrchestrator.bind(groups);
    const warned = t.mock.method(console, 'warn', () => {});
    const setter = t.mock.method(groups, 'setOrchestrator', () => { throw new Error('lead save unavailable'); });

    assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => true), []);
    assert.equal(warned.mock.callCount(), 1, 'lead failure is visible in the Bridge log');
    assert.deepEqual(has(groups, g.id)?.role, { key: 'review' });
    assert.equal(groups.get(g.id)?.orchestratorRoomId, undefined);
    assert.deepEqual(await readNotes(file), { a: [withRole(g.id)] });

    setter.mock.mockImplementation(lead);
    assert.deepEqual(new ArchiveGroups(file).restore('a', getRoom('a'), groups, () => false), []);
    assert.equal(groups.get(g.id)?.orchestratorRoomId, 'a');
    assert.equal(groups.get(g.id)!.members.filter(item => item.roomId === 'a').length, 1);
    assert.deepEqual(await readNotes(file), {});
  });
});

test('an already joined member retains its current role and cannot displace the current lead', () => fixture(async ({ groups, notes, file }) => {
  const g = groups.create('Already joined', [member('a'), member('b')]);
  groups.setMemberRole(g.id, 'a', { preset: 'clerk' });
  notes.remember('a', [withRole(g.id)]);
  groups.setOrchestrator(g.id, 'b');

  assert.deepEqual(notes.restore('a', getRoom('a'), groups, () => false), []);
  assert.deepEqual(has(groups, g.id)?.role, { key: 'clerk' });
  assert.equal(groups.get(g.id)?.orchestratorRoomId, 'b');
  assert.deepEqual(await readNotes(file), {});
}));
