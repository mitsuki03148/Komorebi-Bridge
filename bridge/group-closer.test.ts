import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { GroupCloser, groupCloseDelays } from './group-closer';

const group = (id: string, ...roomIds: string[]) => ({ id, name: id, createdAt: '', orchestratorRoomId: roomIds[0], members: roomIds.map(roomId => ({ modelId: 'CODEX', roomId })) } as GroupChat);

/** A clock and timers the test moves by hand. */
function setup(groups: GroupChat[]) {
  let time = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const state = { busy: new Set<string>(), open: new Set(groups.flatMap(g => g.members.map(m => m.roomId))), finished: new Set<string>(), closed: [] as string[] };
  const closer = new GroupCloser({
    groups: () => groups,
    busy: roomId => state.busy.has(roomId),
    isOpen: roomId => state.open.has(roomId),
    report: g => state.finished.has(g.id) ? 'report-' + g.id : undefined,
    close: roomId => { state.closed.push(roomId); state.open.delete(roomId); },
    now: () => time,
    setTimer: (run, ms) => { const id = next++; timers.set(id, { at: time + ms, run }); return id; },
    clearTimer: id => { timers.delete(id as number); },
  });
  const advance = (ms: number) => {
    const target = time + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].run();
    }
    time = target;
  };
  return { closer, state, advance, timers };
}

test('a group that stays quiet for 3 minutes closes only its crown', () => {
  const g = group('g', 'a', 'b', 'c');
  const { closer, state, advance } = setup([g]);
  closer.checkAll();
  advance(groupCloseDelays.quiet - 1);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed.sort(), ['a']);
});

test("a member's work resets the crown's 3-minute clock", () => {
  const g = group('g', 'a', 'b');
  const { closer, state, advance } = setup([g]);
  closer.checkAll();
  advance(170_000);
  state.busy.add('b');
  closer.checkAll();
  advance(600_000);
  assert.deepEqual(state.closed, [], 'one member working holds the crown');
  state.busy.delete('b');
  closer.checkAll();
  advance(179_999);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed, ['a']);
});

test('once the orchestrator has handed in its final report and everything is quiet, only the crown closes after 2 minutes', () => {
  const g = group('g', 'a', 'b');
  const { closer, state, advance } = setup([g]);
  state.finished.add('g');
  closer.checkAll();
  advance(119_999);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed, ['a']);
});

test('the 2 minutes count from when the group became finished and quiet, not from earlier quiet time', () => {
  const g = group('g', 'a');
  const { closer, state, advance } = setup([g]);
  closer.checkAll();
  advance(30_000);
  state.finished.add('g');
  closer.checkAll();
  advance(119_999);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed, ['a'], 'closed 2 minutes after the report, before the 3-minute limit');
});

test('a new run after the report cancels the short close', () => {
  const g = group('g', 'a');
  const { closer, state, advance } = setup([g]);
  state.finished.add('g');
  closer.checkAll();
  advance(30_000);
  state.busy.add('a');
  state.finished.delete('g');
  closer.checkAll();
  advance(300_000);
  assert.deepEqual(state.closed, []);
});

test('someone looking at any member holds the crown; leaving restarts the count', () => {
  const g = group('g', 'a', 'b');
  const { closer, state, advance } = setup([g]);
  state.busy.add('a');
  closer.checkAll();
  advance(1_000_000);
  assert.deepEqual(state.closed, []);
  state.busy.delete('a');
  closer.checkAll();
  advance(groupCloseDelays.quiet);
  assert.deepEqual(state.closed, ['a']);
});

test('a shared crown must satisfy both group clocks', () => {
  const g1 = group('g1', 'shared', 'a'), g2 = group('g2', 'shared', 'z');
  const { closer, state, advance, timers } = setup([g1, g2]);
  state.busy.add('z');
  closer.checkAll();
  advance(groupCloseDelays.quiet);
  assert.deepEqual(state.closed, []);
  assert.equal(timers.size, 0, 'an expired first clock does not poll while another group is busy');
  state.busy.delete('z');
  closer.checkAll();
  advance(groupCloseDelays.quiet - 1);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed, ['shared']);
  assert.ok(state.open.has('a') && state.open.has('z'));
});

test('nothing is scheduled for a group with no open member or one that no longer exists', () => {
  const g = group('g', 'a');
  const { closer, state, advance, timers } = setup([g]);
  state.open.clear();
  closer.checkAll();
  assert.equal(timers.size, 0);
  advance(1_000_000);
  assert.deepEqual(state.closed, []);
});

test('check for every group at once, and dispose stops pending closes', () => {
  const { closer, state, advance } = setup([group('g1', 'a'), group('g2', 'b')]);
  closer.checkAll();
  closer.dispose();
  advance(1_000_000);
  assert.deepEqual(state.closed, []);
});

test('a crownless room has no group clock, and changing the crown resets the grace', async () => {
  const g = group('g', 'a', 'b');
  g.orchestratorRoomId = undefined;
  const { closer, state, advance, timers } = setup([g]);
  closer.checkAll();
  assert.equal(timers.size, 0);
  g.orchestratorRoomId = 'a';
  closer.checkAll();
  advance(179_999);
  g.orchestratorRoomId = 'b';
  closer.checkAll();
  advance(179_999);
  assert.deepEqual(state.closed, []);
  advance(1);
  assert.deepEqual(state.closed, ['b']);
  assert.deepEqual({ ...groupCloseDelays }, { finished: 120_000, quiet: 180_000 });
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /new GroupCloser\(/);
  assert.match(server, /groupCloser\?\.isCrown\(roomId\)/);
  assert.match(server, /presence.reconcileIdle\(roomId,/);
});

test('rooms say whether they are open and whether anything is still happening in them', async () => {
  const { Rooms } = await import('./rooms');
  const rooms = new Rooms(process.cwd(), () => {});
  const room = { id: 'r', modelId: 'CLAUDE', roomName: 'r', repoPath: '/tmp', logs: [], live: true, ready: true, status: 'idle', remoteControl: {} } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  assert.equal(rooms.isOpen('r'), false, 'no CLI process yet');
  const live: any = { process: { kill() {} }, terminal: {}, queued: 0, dirty: false };
  (rooms as any).live.set('r', live);
  assert.equal(rooms.isOpen('r'), true);
  assert.equal(rooms.isWorking('r'), false);
  room.ready = false; assert.equal(rooms.isWorking('r'), true, 'not at its prompt');
  room.ready = true; room.pendingApproval = {} as never; assert.equal(rooms.isWorking('r'), true, 'waiting for an approval');
  room.pendingApproval = undefined; live.queued = 1; assert.equal(rooms.isWorking('r'), true, 'input queued');
  live.queued = 0;
  room.pendingQuestion = { id: 'waiting', questions: [] }; assert.equal(rooms.isWorking('r'), true, 'an unresolved question prevents recovery');
  room.pendingQuestion = undefined;
  live.closing = Promise.resolve(); assert.equal(rooms.isOpen('r'), false, 'already closing');
  assert.equal(rooms.isWorking('r'), false, 'exiting an idle sibling does not restart the group clock');
  (rooms as any).live.delete('r');
  (rooms as any).starting.add('r');
  assert.equal(rooms.isWorking('r'), true, 'startup before a PTY also keeps the crown open');
});
