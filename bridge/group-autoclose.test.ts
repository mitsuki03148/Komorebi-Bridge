import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { RoomPresence } from './presence';
import { Rooms } from './rooms';
import { Bench } from './bench';

test('ordinary members and single rooms have the same 30-second boundary, with a fresh interval after a delivery hold', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = { setTimeout, clearTimeout };
  const ended: string[] = [];
  const presence = new RoomPresence<string>(roomId => { ended.push(roomId); return true; }, 30_000, clock);
  const bench = new Bench();
  bench.onRecoveryChange = () => presence.reconcileIdle('member', !bench.hasDeliveryHold(['member']));
  presence.view('phone', 'single');
  presence.disconnect('phone');
  presence.reconcileIdle('member', true); // This CLI woke for work; no client ever viewed it.
  t.mock.timers.tick(29_999);
  assert.deepEqual(ended, []);
  const hold = bench.reservePing(['member'], [1])!;
  t.mock.timers.tick(1);
  assert.deepEqual(ended, ['single']);
  bench.finishPing(hold, false);
  t.mock.timers.tick(29_999);
  assert.deepEqual(ended, ['single']);
  t.mock.timers.tick(1);
  assert.deepEqual(ended, ['single', 'member']);
  presence.dispose();
});

test('a group member that is idle and unwatched is closed, but one with work still owed to it stays open and is looked at again when it next goes idle', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const room = { id: `session-claude-${sessionId}`, modelId: 'CLAUDE', roomName: '成員', repoPath: '/tmp', logs: [], live: true, ready: true, status: 'idle', sessionId, resumable: true, remoteControl: {} } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  rooms.retainGroupRooms([room.id]);
  let killed = 0;
  const live: any = { process: { kill: () => { killed++; live.resolveClose?.(); } }, terminal: {}, queued: 0, dirty: false };
  (rooms as any).live.set(room.id, live);
  assert.equal(rooms.isGroupMember(room.id), true);
  rooms.hasOpenTickets = () => true;
  assert.equal(rooms.closeUnviewed(room.id), false, 'something is owed to it: not closed, try again when idle');
  assert.equal(killed, 0);
  rooms.hasOpenTickets = () => false;
  assert.equal(rooms.closeUnviewed(room.id), true);
  assert.equal(killed, 1, 'nothing owed: closed');
  // A member that is working is never closed, whatever is owed.
  const busy = { ...room, id: 'busy', ready: false, status: 'running' } as TerminalRoom;
  rooms.rooms.set(busy.id, busy); rooms.retainGroupRooms([room.id, busy.id]);
  (rooms as any).live.set(busy.id, { process: { kill: () => { killed++; } }, terminal: {}, queued: 0, dirty: false });
  assert.equal(rooms.closeUnviewed(busy.id), false);
  assert.equal(killed, 1);
});

test('a committed ticket and its in-flight hold each prevent an automatic kill at the last instant', () => {
  const events: unknown[] = [];
  const rooms = new Rooms(process.cwd(), event => events.push(event));
  const bench = new Bench();
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const room = { id: 'session-claude-' + sessionId, sessionId, modelId: 'CLAUDE', roomName: 'Worker', repoPath: '/tmp',
    logs: [], live: true, ready: true, status: 'idle', resumable: true, remoteControl: {} } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  rooms.retainGroupRooms([room.id]);
  rooms.hasDeliveryHold = r => bench.hasDeliveryHold([r.id, r.sessionId!]);
  rooms.hasOpenTickets = r => bench.mine(r.sessionId!).length > 0;
  let kills = 0;
  (rooms as any).live.set(room.id, { process: { kill: () => kills++ }, queued: 0, dirty: false });
  const f = { sessionId: 'author', modelId: 'CLAUDE' as const, roomName: 'Author' };
  const to = { sessionId, modelId: 'CLAUDE' as const, roomName: 'Worker' };
  const ticket = bench.send({ groupId: 'g', from: f, to, body: 'Test the closing boundary' });
  const hold = bench.reservePing([sessionId, room.id], [ticket.id])!;
  assert.equal(rooms.closeUnviewed(room.id), false);
  bench.done(ticket.id, sessionId);
  assert.equal(rooms.closeUnviewed(room.id), false, 'the completed work does not remove a write already in flight');
  bench.finishPing(hold, false);
  assert.equal(rooms.closeUnviewed(room.id), true);
  assert.equal(kills, 1);
  assert.ok(!events.some(event => (event as { type: string }).type === 'ARCHIVED'));
});

test('a reopened PTY does not use an old final report as a fresh completion', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const room = { id: 'room', modelId: 'CLAUDE', logs: [
    { id: 'old-report', sender: 'agent', timestamp: '', text: 'RESULT: DONE' },
  ] } as TerminalRoom;
  rooms.rooms.set(room.id, room);
  const live = { queued: 0, dirty: false, reportBaseline: undefined as string | undefined };
  (rooms as any).live.set(room.id, live);
  assert.equal(rooms.currentReport(room.id), undefined, 'history read on startup is not a current report');
  live.reportBaseline = 'old-report';
  assert.equal(rooms.currentReport(room.id), undefined, 'the same assistant entry seen before work does not count');
  room.logs.push({ id: 'new-report', sender: 'agent', timestamp: '', text: 'RESULT: DONE' });
  assert.equal(rooms.currentReport(room.id), 'new-report');
});

test('an abandoned delivery reservation releases its hold by one expiry event', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bench = new Bench();
  let changes = 0;
  bench.onRecoveryChange = () => { changes++; };
  bench.reservePing(['room', 'session'], [1]);
  assert.equal(bench.hasDeliveryHold(['session']), true);
  t.mock.timers.tick(89_999);
  assert.equal(changes, 1);
  t.mock.timers.tick(1);
  assert.equal(changes, 2);
  assert.equal(bench.hasDeliveryHold(['room', 'session']), false);
  t.mock.timers.tick(90_000);
  assert.equal(changes, 2, 'no retry or periodic poll');
});
