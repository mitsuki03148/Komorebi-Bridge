import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';
import { pickRoleRoom, type RolePickInput, type RoleRoomState } from './bench-server';

const uuid = (n: number) => `702916d6-6b56-4c72-a3ad-${n.toString().padStart(12, '0')}`;
const room = (id: string, modelId: CLIModelId, n: number, more: Partial<TerminalRoom> = {}) =>
  ({ id, roomName: id, modelId, sessionId: uuid(n), live: true, ready: true, resumable: true, status: 'idle', ...more }) as TerminalRoom;
const lead = room('lead', 'CODEX', 1);
const a = room('a', 'CLAUDE', 2);
const b = room('b', 'AGY', 3);
const c = room('c', 'CODEX', 4);
const state = (room: TerminalRoom, overrides: Partial<Omit<RoleRoomState, 'room'>> = {}): RoleRoomState =>
  ({ room, inactive: false, verifiedSession: true, auto: true, working: false, openWork: false, ...overrides });
const card = (modelId: CLIModelId, hp: number | null, mp: number | null): CharacterProfile => ({
  ...INITIAL_CHARACTERS[modelId], mpWeekly: { ...INITIAL_CHARACTERS[modelId].mpWeekly, current: hp },
  hp5h: { ...INITIAL_CHARACTERS[modelId].hp5h, current: mp },
});
const input = (candidates: RoleRoomState[], options: Partial<RolePickInput> = {}): RolePickInput =>
  ({
    group: { id: 'g', name: 'Fixture', createdAt: '', members: [
      { roomId: lead.id, modelId: lead.modelId },
      ...candidates.map(({ room }) => ({ roomId: room.id, modelId: room.modelId, role: { key: options.roleKey ?? 'review' } })),
    ] },
    sender: lead,
    rooms: new Map(candidates.map(candidate => [candidate.room.id, candidate])),
    characters: {}, nativeAllowlist: new Set<string>(), roleKey: 'review', ...options,
  });
const picked = (options: RolePickInput) => {
  const result = pickRoleRoom(options);
  assert.equal(result.kind, 'picked');
  return result;
};

test('routing uses raw HP weekly and MP 5-hour; known values below floor exclude even with an unknown second value', () => {
  const low = { CLAUDE: card('CLAUDE', 80, 9.6), AGY: card('AGY', 4.9, null), CODEX: card('CODEX', 5, 10) };
  assert.equal(picked(input([state(a), state(b), state(c)], { characters: low })).room.id, 'c');
  const none = pickRoleRoom(input([state(a), state(b)], { characters: low }));
  assert.equal(none.kind, 'unavailable');
  assert.equal(none.cause, 'no-eligible');
  assert.deepEqual(none.rejected.map(item => [item.roomId, item.reason]), [['a', 'low-quota'], ['b', 'low-quota']]);
  assert.equal(picked(input([state(a)], { characters: { CLAUDE: card('CLAUDE', 5, 10) } })).room.id, 'a');
  assert.equal(picked(input([state(b)], { characters: { AGY: card('AGY', 5, 10) } })).room.id, 'b');
});

test('routing ignores HP/MP magnitude above forty and prefers a verified forty room before considering busy/idle', () => {
  const good = { CLAUDE: card('CLAUDE', 42, 45), AGY: card('AGY', 90, 90) };
  const options = [state(b), state(a)];
  assert.deepEqual(picked(input(options, { characters: good })).rule, { quota: 'both-at-least-40', workload: 'idle-and-empty', rotated: true });
  assert.equal(picked(input(options, { characters: good })).room.id, 'a');
  assert.equal(picked(input(options, { characters: good, previousRoomId: 'a' })).room.id, 'b');
  const busyA = state({ ...a, ready: false, status: 'running' }, { working: true, openWork: true });
  assert.equal(picked(input([busyA, state(b)], { characters: { ...good, AGY: card('AGY', 39, 90) } })).room.id, 'a');
  assert.equal(picked(input([busyA, state(b)], { characters: { ...good, AGY: card('AGY', null, 90) } })).room.id, 'a');
});

test('when all known quotas are below forty, routing maximizes the smaller value; an unknown does not get fabricated', () => {
  const allLower = { CLAUDE: card('CLAUDE', 27, 38), AGY: card('AGY', 98, 25), CODEX: card('CODEX', 32, 35) };
  const result = picked(input([state(a), state(b), state(c)], { characters: allLower }));
  assert.equal(result.room.id, 'c');
  assert.equal(result.rule.quota, 'best-lower-quota');
  const unknown = picked(input([state(a), state(c)], { characters: { ...allLower, CLAUDE: card('CLAUDE', NaN, 60) } }));
  assert.equal(unknown.room.id, 'a');
  assert.deepEqual(unknown.quota, { hp: null, mp: 60 });
  assert.equal(unknown.rule.quota, 'not-compared');
});

test('routing prefers idle/empty and rotates only ties in ID order, independent of input order', () => {
  const quiet = state(a);
  const idleWithWork = state(b, { openWork: true });
  const busyNoWork = state({ ...c, status: 'running' }, { working: true });
  assert.equal(picked(input([idleWithWork, busyNoWork, quiet])).room.id, 'a');
  assert.equal(picked(input([busyNoWork, idleWithWork])).room.id, 'b');
  const tie = (previousRoomId?: string, reversed = false) => picked(input(
    reversed ? [state(b), quiet] : [quiet, state(b)], { previousRoomId })).room.id;
  assert.deepEqual([tie(), tie('a', true), tie('b'), tie('a-removed')], ['a', 'b', 'a', 'b']);
});

test('routing will not disclose a foreign group; lookup cannot select an unlisted room', () => {
  const withMissing = input([state(a)]);
  const nonmember = room('outside', 'AGY', 9);
  const wrongSender = pickRoleRoom({ ...withMissing, sender: nonmember });
  assert.deepEqual(wrongSender, { kind: 'unavailable', cause: 'sender-outside', available: [], rejected: [] });
  const listed = new Map([[nonmember.id, state(nonmember)]]);
  const missing = pickRoleRoom({ ...withMissing, rooms: listed });
  assert.equal(missing.kind, 'unavailable');
  assert.equal(missing.rejected[0].reason, 'unavailable');
});

test('routing excludes alias-self, archived/deleted, unknown or non-resumable sessions, and all approval blocks', () => {
  const self = state({ ...lead, id: `session-codex-${lead.sessionId!.toUpperCase()}`, sessionId: undefined, roomName: 'Another label' });
  const archived = state(a, { inactive: true });
  const notVerified = state(b, { verifiedSession: false });
  const stillAsking = state(c, { auto: false });
  const permission = state(room('approval', 'CLAUDE', 5, { status: 'waiting_approval' }));
  const question = state(room('question', 'CODEX', 6, { pendingQuestion: { id: 'q' } as TerminalRoom['pendingQuestion'] }));
  const closed = state(room('not-resumable', 'CODEX', 7, { live: false, resumable: false }));
  const invalid = state(room('not-native', 'AGY', 8, { sessionId: 'wrong' }));
  const result = pickRoleRoom(input([self, archived, notVerified, stillAsking, permission, question, closed, invalid]));
  assert.equal(result.kind, 'unavailable');
  assert.deepEqual(result.rejected.map(item => item.reason), ['self', 'inactive', 'unverified', 'approval-mode', 'waiting', 'waiting', 'unverified', 'unverified']);
});

test('routing for Native Test goes to a room that holds the role, whatever its CLI; a busy one is still chosen so the ticket can queue', () => {
  const options = { roleKey: 'native-test' };
  assert.equal(picked(input([state(b)], options)).room.id, 'b', 'a new group works without any list');
  assert.equal(picked(input([state(a)], options)).room.id, 'a', 'a Claude room can take it too');
  const busyB = state(b, { openWork: true });
  assert.equal(picked(input([busyB, state(a)], options)).room.id, 'a', 'a free room is preferred');
  assert.equal(picked(input([busyB], options)).room.id, 'b', 'with only a busy one, the ticket queues there');
  assert.equal(picked(input([state({ ...b, live: false })], options)).room.id, 'b');
});

test('a missing assignment returns only eligible alternatives in the same group', () => {
  const p = input([state(a), state(b, { auto: false })], { roleKey: 'review' });
  p.group.members[2] = { ...p.group.members[2], role: { key: 'clerk' } };
  const result = pickRoleRoom({ ...p, roleKey: 'other' });
  assert.deepEqual(result, { kind: 'unavailable', cause: 'unknown-role', available: ['review'], rejected: [] });
});
