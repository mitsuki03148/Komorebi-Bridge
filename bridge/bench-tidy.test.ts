import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { Bench, type BenchParty, ticketText } from './bench';
import { benchAction, benchHook, benchRequest, dispatchRsiTidy, escalateStalled, escalateUnread, idleWake, stalledWake, startClosedRecipient, type BenchDeps } from './bench-server';
import { readTidyGroup, tidyGroupFile } from './bench-experience';

const groupId = 'aaaaaaaa-0000-4000-8000-000000000001';
const other = 'bbbbbbbb-0000-4000-8000-000000000002';
const from: BenchParty = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000003', roomName: 'worker', modelId: 'CLAUDE' };
const to: BenchParty = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000004', roomName: 'lead', modelId: 'CODEX' };
const day = 86_400_000;
function fixture(enabled = true) {
  const dir = mkdtempSync(join(process.env.RSI_TIDY_EVIDENCE ?? tmpdir(), 'rsi-tidy-'));
  const path = join(dir, 'bench.json');
  let time = Date.parse('2026-11-01T00:00:00.000Z');
  const now = () => time;
  const open = (active = enabled) => new Bench(path, now, undefined, active ? groupId : undefined);
  let bench = open();
  const complete = (group = groupId) => {
    const task = bench.send({ groupId: group, from, to, body: 'work' });
    bench.done(task.id, to.sessionId, 'RESULT — DONE');
    return task.id;
  };
  return { dir, path, now, advance: (ms: number) => { time += ms; }, open, complete,
    get bench() { return bench; }, restart: () => { bench = open(); } };
}
function rooms(bench: Bench) {
  const lead = { id: 'lead-room', ...to, live: true, ready: true, resumable: true, autoMode: true, status: 'idle' } as TerminalRoom;
  const worker = { id: 'worker-room', ...from, live: true, ready: true, resumable: true, autoMode: true, status: 'idle' } as TerminalRoom;
  const group: GroupChat = { id: groupId, name: 'group', createdAt: '', orchestratorRoomId: lead.id,
    members: [lead, worker].map(r => ({ roomId: r.id, modelId: r.modelId })) };
  const all = [lead, worker];
  const deps: BenchDeps = { bench, groups: () => [group], rooms: () => all, tool: '/fixture', note() {}, notice() {},
    roleRouting: { characters: () => ({}), nativeAllowlist: () => new Set(), state: r => ({ inactive: false, auto: r.autoMode === true, verifiedSession: true, working: false }) } };
  return { lead, worker, group, all, deps };
}

test('nine versus ten closures, one open tidy, new work kept after completion and restart', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.complete();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.complete();
  const task = f.bench.dispatchTidy(groupId, to, 'lead-room')!;
  assert.deepEqual(task.from, { system: 'rsi-tidy' });
  assert.match(ticketText(task, '/fixture'), /Bridge/);
  assert.doesNotMatch(ticketText(task, '/fixture'), /由同組成員派出|問對方/);
  for (let i = 0; i < 10; i++) f.complete();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.restart();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  assert.equal(f.bench.done(task.id, to.sessionId, 'reviewed').notice, undefined);
  assert.ok(f.bench.dispatchTidy(groupId, to, 'lead-room'));
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
});

test('seven days needs fresh material; prune, expiry and late completion do not lose or duplicate eligibility', () => {
  const f = fixture();
  f.advance(8 * day);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.complete();
  f.advance(7 * day - 1);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.advance(1);
  f.bench.sweep();
  f.restart();
  const first = f.bench.dispatchTidy(groupId, to, 'lead-room')!;
  assert.ok(first);
  f.advance(4 * 3_600_000);
  f.bench.sweep();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.bench.done(first.id, to.sessionId, 'late tidy');
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  const late = f.bench.send({ groupId, from, to, body: 'late work' });
  f.advance(4 * 3_600_000);
  f.bench.sweep();
  f.bench.done(late.id, to.sessionId, 'late completion');
  assert.throws(() => f.bench.done(late.id, to.sessionId));
  f.advance(7 * day);
  assert.ok(f.bench.dispatchTidy(groupId, to, 'lead-room'));
});

test('separate opt-in, other group, cancelled work and notices cannot cause dispatch', () => {
  const f = fixture(false);
  for (let i = 0; i < 10; i++) f.complete();
  f.advance(8 * day);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  const enabled = f.open(true);
  assert.equal(enabled.dispatchTidy(groupId, to, 'lead-room'), undefined);
  const g = fixture();
  for (let i = 0; i < 10; i++) g.complete(other);
  const cancelled = g.bench.send({ groupId, from, to, body: 'cancelled' });
  g.bench.cancel(cancelled.id, [from.sessionId]);
  const notice = g.bench.send({ groupId, from, to, body: 'notice', kind: 'notice' });
  g.bench.done(notice.id, to.sessionId);
  g.advance(8 * day);
  assert.equal(g.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  assert.equal(readTidyGroup(g.dir, [groupId]), undefined);
  writeFileSync(join(g.dir, tidyGroupFile), other, { mode: 0o600 });
  assert.equal(readTidyGroup(g.dir, [groupId], () => {}), undefined);
  writeFileSync(join(g.dir, tidyGroupFile), groupId);
  assert.equal(readTidyGroup(g.dir, [groupId]), groupId);
  chmodSync(join(g.dir, tidyGroupFile), 0o644);
  assert.equal(readTidyGroup(g.dir, [groupId], () => {}), undefined);
  assert.equal(readTidyGroup(g.dir, undefined), undefined);
  chmodSync(join(g.dir, tidyGroupFile), 0o600);
  assert.equal(readTidyGroup(g.dir, 'all'), groupId);
  assert.equal(readTidyGroup(g.dir, [other], () => {}), undefined);
});

test('failed completion and failed dispatch keep the last durable snapshot across restart', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.complete();
  const tenth = f.bench.send({ groupId, from, to, body: 'tenth' });
  const backup = join(f.dir, 'saved');
  renameSync(f.path, backup);
  mkdirSync(f.path);
  assert.throws(() => f.bench.done(tenth.id, to.sessionId));
  renameSync(f.path, join(f.dir, 'blocked-completion'));
  renameSync(backup, f.path);
  f.restart();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.bench.done(tenth.id, to.sessionId);
  renameSync(f.path, backup);
  mkdirSync(f.path);
  assert.throws(() => f.bench.dispatchTidy(groupId, to, 'lead-room'));
  renameSync(f.path, join(f.dir, 'blocked-dispatch'));
  renameSync(backup, f.path);
  f.restart();
  assert.ok(f.bench.dispatchTidy(groupId, to, 'lead-room'));
  f.restart();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
});

test('internal dispatch and manual access require the exact current lead; completing retains unrelated claim', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.complete();
  const r = rooms(f.bench);
  r.group.orchestratorRoomId = undefined;
  assert.equal(dispatchRsiTidy(r.deps, groupId), undefined);
  r.group.orchestratorRoomId = r.worker.id;
  r.worker.autoMode = false;
  assert.equal(dispatchRsiTidy(r.deps, groupId), undefined);
  r.lead.id = to.sessionId;
  r.group.members[0].roomId = r.lead.id;
  r.group.orchestratorRoomId = r.lead.id;
  const task = dispatchRsiTidy(r.deps, groupId)!;
  assert.ok(task);
  assert.equal(dispatchRsiTidy(r.deps, other), undefined);
  f.bench.claim(groupId, to, 'other work');
  const act = (action: string, who: TerminalRoom, fields: Record<string, unknown> = {}) => benchAction(r.deps, { requestId: 'test', action, from: who.sessionId, ...fields });
  assert.equal(act('show', r.worker, { id: task.id }).ok, false);
  r.group.orchestratorRoomId = r.worker.id;
  assert.equal(idleWake(r.deps, r.lead), undefined);
  assert.deepEqual(benchHook(r.deps, 'codex', { session_id: to.sessionId }), {});
  assert.doesNotMatch(act('mine', r.lead).lines.join(' '), /RSI 整理/);
  assert.equal(act('show', r.lead, { id: task.id }).ok, false);
  assert.equal(act('done', r.lead, { id: task.id }).ok, false);
  const checked = await benchRequest(r.deps, { requestId: 'test', action: 'done-checked', from: r.lead.sessionId, id: task.id });
  assert.deepEqual(checked.lines, ['只可提交自己工單嘅驗收記錄。']);
  f.advance(16 * 60_000);
  assert.deepEqual(escalateUnread(r.deps), []);
  assert.equal(f.bench.mine(r.worker.sessionId!).some(ticket => ticket.kind === 'notice'), false);
  r.group.orchestratorRoomId = r.lead.id;
  r.lead.sessionId = 'aaaaaaaa-0000-4000-8000-000000000005';
  assert.equal(act('show', r.lead, { id: task.id }).ok, false);
  assert.equal(act('done', r.lead, { id: task.id }).ok, false);
  r.lead.sessionId = to.sessionId;
  const membership = r.group.members.shift()!;
  assert.equal(act('show', r.lead, { id: task.id }).ok, false);
  assert.equal(act('done', r.lead, { id: task.id }).ok, false);
  r.group.members.unshift(membership);
  assert.ok(idleWake(r.deps, r.lead));
  assert.equal(act('done', r.worker, { id: task.id }).ok, false);
  assert.equal(act('done', r.lead, { id: task.id, note: 'checked' }).ok, true);
  assert.equal(f.bench.claims(groupId).length, 1);
  assert.equal(f.bench.dispatchTidy(groupId, to, r.lead.id), undefined);
});

test('an open manual RSI tidy suppresses dispatch and its own completion is not material', () => {
  const f = fixture();
  const manual = f.bench.send({ groupId, from, to, title: 'RSI 整理', body: 'manual review' });
  for (let i = 0; i < 10; i++) f.complete();
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.bench.done(manual.id, to.sessionId);
  const tidy = f.bench.dispatchTidy(groupId, to, 'lead-room')!;
  assert.ok(tidy);
  f.bench.done(tidy.id, to.sessionId);
  f.advance(8 * day);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
});

test('a post-save observer failure cannot undo or duplicate a durable dispatch', () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.complete();
  f.bench.onRecoveryChange = () => { throw new Error('observer failed after commit'); };
  const ticket = f.bench.dispatchTidy(groupId, to, 'lead-room');
  assert.ok(ticket);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.restart();
  assert.equal(f.bench.get(ticket.id)?.status, 'new');
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
});


test('disabling or mismatching opt-in leaves saved Tidy manually accessible and prevents automatic delivery', () => {
  for (const group of [undefined, other]) {
    const f = fixture();
    for (let i = 0; i < 10; i++) f.complete();
    const task = f.bench.dispatchTidy(groupId, to, 'lead-room')!;
    f.advance(16 * 60_000);
    const reopened = new Bench(f.path, f.now, undefined, group);
    const r = rooms(reopened);
    r.lead.live = false;
    assert.equal(startClosedRecipient(r.deps, r.lead), false);
    r.lead.live = true;
    assert.equal(idleWake(r.deps, r.lead), undefined);
    assert.deepEqual(benchHook(r.deps, 'codex', { session_id: r.lead.sessionId }), {});
    assert.deepEqual(escalateUnread(r.deps), []);
    assert.equal(benchAction(r.deps, { requestId: 'test', action: 'show', from: r.lead.sessionId, id: task.id }).ok, true);
    reopened.recordNudge([task.id]);
    reopened.recordNudge([task.id]);
    f.advance(16 * 60_000);
    assert.equal(stalledWake(r.deps, r.lead, 16 * 60_000), undefined);
    assert.deepEqual(escalateStalled(r.deps, r.lead, 16 * 60_000), []);
  }
});

test('a scoped pending lesson alone triggers at seven days, survives restart, and cannot count twice', () => {
  const f = fixture();
  const original = f.bench.send({ groupId, from: to, to: from, body: 'open work', fixed: { fromRoomId: 'lead-room', toRoomId: 'worker-room' } });
  const offGroup = f.bench.send({ groupId: other, from: to, to: from, body: 'outside the pilot' });
  const r = rooms(f.bench);
  r.group.orchestratorRoomId = r.lead.id;
  const register = (deps: BenchDeps, who: TerminalRoom, id: number) => benchAction(deps, { requestId: 'test', action: 'lesson-pending', from: who.sessionId, id });
  assert.equal(register(r.deps, r.lead, original.id).ok, false);
  assert.equal(register(r.deps, r.worker, offGroup.id).ok, false);
  assert.equal(register(rooms(f.open(false)).deps, r.worker, original.id).ok, false);
  assert.match(register(r.deps, r.worker, original.id).lines[0], /已登記/);
  assert.match(register(r.deps, r.worker, original.id).lines[0], /已有/);
  f.advance(7 * day - 1);
  f.restart();
  assert.equal(f.bench.dispatchTidy(groupId, to, r.lead.id), undefined);
  f.advance(1);
  const tidy = f.bench.dispatchTidy(groupId, to, r.lead.id)!;
  assert.ok(tidy);
  assert.equal(register(rooms(f.bench).deps, r.lead, tidy.id).ok, false);
  assert.match(register(rooms(f.bench).deps, r.worker, original.id).lines[0], /已有/);
  f.bench.done(tidy.id, to.sessionId);
  f.advance(7 * day);
  assert.equal(f.bench.dispatchTidy(groupId, to, r.lead.id), undefined);
});

test('a failed pending-lesson registration is retryable without starting the clock early', () => {
  const f = fixture();
  const original = f.bench.send({ groupId, from, to, body: 'work' });
  const backup = join(f.dir, 'before-registration');
  renameSync(f.path, backup);
  mkdirSync(f.path);
  assert.throws(() => f.bench.markPendingLesson(original.id));
  assert.equal(f.bench.get(original.id)?.pendingLessonAt, undefined);
  f.advance(60_000);
  renameSync(f.path, join(f.dir, 'blocked-registration'));
  renameSync(backup, f.path);
  assert.equal(f.bench.markPendingLesson(original.id), true);
  f.advance(7 * day - 60_000);
  assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
  f.advance(60_000);
  assert.ok(f.bench.dispatchTidy(groupId, to, 'lead-room'));
});


test('malformed Tidy timestamps disable automation without blocking ordinary workbench saves', () => {
  for (const damaged of [{ firstAt: { toString: 0, valueOf: 0 } }, { lastDispatchAt: 0 }]) {
    const f = fixture();
    f.complete();
    const snapshot = JSON.parse(readFileSync(f.path, 'utf8'));
    snapshot.tidy = { ...snapshot.tidy, ...damaged };
    writeFileSync(f.path, JSON.stringify(snapshot), { mode: 0o600 });
    f.restart();
    const task = f.bench.send({ groupId, from, to, body: 'ordinary work' });
    f.bench.done(task.id, to.sessionId);
    assert.throws(() => f.bench.markPendingLesson(task.id), /試點群/);
    assert.equal(f.bench.tidyEnabled(groupId), false);
    assert.equal(f.bench.dispatchTidy(groupId, to, 'lead-room'), undefined);
    assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')).tidy, snapshot.tidy);
  }
});

test('with capture open to more groups, their finished tasks count toward the one tidy sent to the review group lead', () => {
  const f = fixture();
  const wide = new Bench(f.path, f.now, undefined, groupId, id => id === groupId || id === other);
  const finish = (group: string) => { const task = wide.send({ groupId: group, from, to, body: 'work' }); wide.done(task.id, to.sessionId, 'RESULT — DONE'); return task.id; };
  for (let i = 0; i < 5; i++) finish(other);
  const third = 'cccccccc-0000-4000-8000-000000000005';
  for (let i = 0; i < 4; i++) finish(third);
  assert.equal(wide.dispatchTidy(groupId, to, 'lead-room'), undefined, 'a group outside the scope does not count');
  for (let i = 0; i < 4; i++) finish(groupId);
  const lessonTicket = finish(other);
  assert.equal(wide.dispatchTidy(other, to, 'lead-room'), undefined, 'only the review group gets the tidy');
  assert.ok(wide.dispatchTidy(groupId, to, 'lead-room'));
  assert.equal(wide.markPendingLesson(lessonTicket), true, 'a lesson may come from any captured group');
  assert.throws(() => wide.markPendingLesson(finish(third)), /試點群/);
});

test('the RSI tidy goes to the group Debug member when there is one, and only that room can read or finish it', () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.complete();
  const r = rooms(f.bench);
  const debug = { id: 'debug-room', sessionId: 'aaaaaaaa-0000-4000-8000-000000000009', roomName: 'debug', modelId: 'CODEX', live: true, ready: true, resumable: true, autoMode: true, status: 'idle' } as TerminalRoom;
  r.all.push(debug);
  r.group.members.push({ roomId: debug.id, modelId: debug.modelId, role: { key: 'debug' } });
  const ticket = dispatchRsiTidy(r.deps, groupId)!;
  assert.equal(ticket.to.sessionId, debug.sessionId);
  assert.equal(ticket.fixed?.toRoomId, debug.id);
  const mine = (room: TerminalRoom) => benchAction(r.deps, { requestId: 'x', action: 'mine', from: room.sessionId ?? room.id });
  assert.match(mine(debug).lines.join('\n'), /RSI 整理/);
  assert.doesNotMatch(mine(r.lead).lines.join('\n'), /RSI 整理/);
  assert.equal(benchAction(r.deps, { requestId: 'x', action: 'done', id: ticket.id, from: r.lead.sessionId!, note: 'x' }).ok, false);
});
