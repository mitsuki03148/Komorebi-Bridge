import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Bench, benchLimits, type BenchParty, type SavedBenchChange } from './bench';
import { BenchExperience, experienceFile, experienceGroupFile, experienceMaxBytes, readExperience, readExperienceInput, readExperienceScope, summarizeExperience } from './bench-experience';

const groupId = 'aaaaaaaa-0000-4000-8000-000000000001';
const otherGroup = 'bbbbbbbb-0000-4000-8000-000000000002';
const from: BenchParty = { sessionId: 'secret sender session', roomName: 'secret sender', modelId: 'CLAUDE' };
const to: BenchParty = { sessionId: 'secret recipient session', roomName: 'secret recipient', modelId: 'AGY' };
const hash = 'a'.repeat(64);
const initial = '2026-11-23T09:00:00.000Z';
const work = { from, to, groupId, repo: '/secret repo', body: 'secret task content', receipt: '/secret receipt' };

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-experience-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const benchPath = join(dir, 'bench.json');
  const path = join(dir, experienceFile);
  let time = Date.parse(initial);
  const now = () => time;
  const iso = () => new Date(now()).toISOString();
  const advance = (ms: number) => { time += ms; };
  const warnings: string[] = [];
  const journal = () => new BenchExperience(path, groupId, message => warnings.push(message), iso, () => 'implement');
  const open = () => {
    const store = journal();
    return new Bench(benchPath, now, changes => store.record(changes));
  };
  return { dir, benchPath, path, now, iso, advance, warnings, journal, open, rows: () => readExperience(readExperienceInput(path)) };
}

test('capture is off until a private local group ID is configured', t => {
  const { dir, warnings } = fixture(t);
  const setting = join(dir, experienceGroupFile);
  const warn = (message: string) => warnings.push(message);
  assert.equal(readExperienceScope(dir, warn), undefined);
  assert.deepEqual(warnings, []);
  writeFileSync(setting, groupId + '\n', { mode: 0o600 });
  assert.deepEqual(readExperienceScope(dir, warn), [groupId]);
  chmodSync(setting, 0o644);
  assert.equal(readExperienceScope(dir, warn), undefined);
  chmodSync(setting, 0o600);
  // The Founder opened capture to more groups: a list of IDs, or `all`.
  writeFileSync(setting, groupId + '\n' + otherGroup + '\n' + groupId);
  assert.deepEqual(readExperienceScope(dir, warn), [groupId, otherGroup]);
  writeFileSync(setting, 'all\n');
  assert.equal(readExperienceScope(dir, warn), 'all');
  writeFileSync(setting, groupId + '\nnot-a-group');
  assert.equal(readExperienceScope(dir, warn), undefined);
  assert.equal(warnings.length, 2);
});

test('record one group, skip notices and replies, and keep only projected metadata through restart and retarget', t => {
  const fx = fixture(t);
  let bench = fx.open();
  bench.send({ ...work, groupId: otherGroup });
  assert.equal(existsSync(fx.path), false);
  const task = bench.send(work);
  const reply = bench.send({ ...work, from: to, to: from, replyTo: task.id });
  bench.done(reply.id, from.sessionId, 'reply complete');
  bench.retarget([to.sessionId], { ...to, sessionId: 'successor secret' });
  bench = fx.open();
  bench.done(task.id, 'successor secret', 'private note\nRESULT — INCOMPLETE', '/secret file');
  const checked = bench.send(work);
  bench.done(checked.id, to.sessionId, 'private report', '/secret file', { path: '/secret file', state: 'file', at: fx.iso(), sha256: hash }, 'FAIL');
  const input = readExperienceInput(fx.path);
  assert.doesNotMatch(input, /secret|private|fromRoomId|selectedRoomId|receiptProof/);
  assert.equal(statSync(fx.path).mode & 0o777, 0o600);
  const { events, invalid } = fx.rows();
  assert.equal(invalid, 0);
  const [opened, closed, , , acceptance] = events;
  assert.deepEqual(events.map(row => row.event), ['task_opened', 'task_closed', 'task_opened', 'task_closed', 'acceptance_reported']);
  assert.ok(opened.event === 'task_opened' && closed.event === 'task_closed' && acceptance.event === 'acceptance_reported');
  assert.equal(opened.taskKey, closed.taskKey);
  assert.equal(opened.role, 'implement');
  assert.equal(opened.cli, 'AGY');
  assert.equal(closed.agentResult, 'INCOMPLETE');
  assert.equal(acceptance.result, 'FAIL');
  assert.equal(acceptance.evidenceSha256, hash);
  assert.equal(acceptance.reviewType, 'unknown');
});

test('expiry, late completion and both cancellation sources retain separate facts', t => {
  const fx = fixture(t);
  let bench = fx.open();
  const late = bench.send(work);
  bench.markSeen(late.id);
  const unread = bench.send(work);
  const cancelled = bench.send(work);
  bench.cancel(cancelled.id, [from.sessionId], 'private cancel note');
  const leadCancelled = bench.send(work);
  bench.markSeen(leadCancelled.id);
  bench.cancel(leadCancelled.id, [from.sessionId], 'private cancellation', 'lead_final_report');
  fx.advance(benchLimits.staleHours * 3_600_000 + 10);
  bench = fx.open();
  assert.equal(bench.get(late.id)?.status, 'done');
  assert.equal(bench.get(unread.id)?.status, 'done');
  bench.sweep();
  bench.done(late.id, to.sessionId, 'RESULT — STOP\ntext after the quoted marker');
  assert.throws(() => bench.done(late.id, to.sessionId), /已完成/);
  const closed = fx.rows().events.filter(row => row.event === 'task_closed');
  assert.deepEqual(closed.map(row => row.reason), ['sender', 'lead_final_report', 'expired_seen', 'expired_unread', 'late_completion']);
  assert.equal(closed[2].taskKey, closed[4].taskKey);
  assert.equal(closed[4].agentResult, undefined);
  assert.equal(new Set(closed.map(row => row.id)).size, 5);
});

test('save failure emits nothing, restores expiries and allows retry after storage returns', t => {
  const fx = fixture(t);
  const bench = fx.open();
  const original = bench.send(work);
  fx.advance(benchLimits.staleHours * 3_600_000 + 10);
  const backup = fx.benchPath + '.bak';
  renameSync(fx.benchPath, backup);
  mkdirSync(fx.benchPath);
  assert.throws(() => bench.send(work));
  assert.throws(() => bench.done(original.id, to.sessionId, 'never persisted'));
  assert.equal(bench.get(original.id)?.status, 'new');
  assert.equal(fx.rows().events.length, 1);
  renameSync(fx.benchPath, fx.benchPath + '.blocked');
  renameSync(backup, fx.benchPath);
  const newTask = bench.send(work);
  assert.equal(newTask.id, original.id + 1);
  assert.deepEqual(fx.rows().events.map(row => row.event), ['task_opened', 'task_opened', 'task_closed']);
  assert.equal(bench.get(original.id)?.status, 'done');
});

test('journal write failure leaves durable tickets, rejects links and reports a gap when writing resumes', t => {
  const fx = fixture(t);
  const bench = fx.open();
  const sentinel = join(fx.dir, 'sentinel');
  const blocked = fx.path + '.blocked';
  writeFileSync(sentinel, 'original content', { mode: 0o600 });
  symlinkSync(sentinel, fx.path);
  const first = bench.send(work);
  fx.advance(1000);
  bench.done(first.id, to.sessionId, 'done');
  assert.equal(JSON.parse(readFileSync(fx.benchPath, 'utf8')).tickets[0].status, 'done');
  assert.equal(readFileSync(sentinel, 'utf8'), 'original content');
  assert.equal(fx.warnings.length, 1);
  renameSync(fx.path, blocked);
  fx.advance(1000);
  bench.send(work);
  const [gap, opening] = fx.rows().events;
  assert.ok(gap.event === 'capture_gap' && opening.event === 'task_opened');
  assert.deepEqual([gap.from, gap.at, gap.changes], [initial, fx.iso(), 2]);
});

test('replayed transitions after reopen are deduplicated and damaged tails do not hide later events', t => {
  const fx = fixture(t);
  const first = fx.open().send(work);
  const repeated: SavedBenchChange = { kind: 'opened', ticket: first };
  const raw = readExperienceInput(fx.path);
  fx.journal().record([repeated]);
  assert.equal(readExperienceInput(fx.path), raw);
  writeFileSync(fx.path, '{broken tail', { flag: 'a' });
  fx.advance(10_000);
  fx.open().send(work);
  const result = fx.rows();
  assert.equal(result.invalid, 1);
  assert.equal(result.events.length, 2);
  assert.equal(readExperience(raw + raw).duplicates, 1);
});

test('journal caps retained data and keeps new work operational', t => {
  const fx = fixture(t);
  writeFileSync(fx.path, '', { mode: 0o600 });
  truncateSync(fx.path, experienceMaxBytes - 400);
  const task = fx.open().send(work);
  assert.equal(JSON.parse(readFileSync(fx.benchPath, 'utf8')).tickets[0].id, task.id);
  const size = statSync(fx.path).size;
  assert.ok(size <= experienceMaxBytes);
  assert.match(fx.warnings.join('\n'), /75% full/);
  assert.match(fx.warnings.join('\n'), /paused at capacity/);
  const [gap] = fx.rows().events;
  assert.ok(gap.event === 'capture_gap');
  assert.equal(gap.reason, 'capacity');
  assert.equal(gap.from, initial);
  fx.open().send(work);
  assert.equal(statSync(fx.path).size, size, 'restart does not silently resume capture');
  const later = summarizeExperience(readExperienceInput(fx.path), groupId, '2026-11-24T00:00:00.000Z', '2026-11-25T00:00:00.000Z');
  assert.equal(later.coverage.gaps.length, 1, 'a capacity stop affects later windows too');
});

test('summary keeps the task and review opportunity denominators distinct', t => {
  const fx = fixture(t);
  const bench = fx.open();
  const first = bench.send(work);
  const second = bench.send(work);
  const third = bench.send(work);
  const fourth = bench.send(work);
  fx.advance(benchLimits.staleHours * 3_600_000 + 10);
  bench.sweep();
  bench.done(first.id, to.sessionId, 'RESULT — DONE');
  const raw = readExperienceInput(fx.path);
  const opening = fx.rows().events.filter(event => event.event === 'task_opened');
  const review = (ticketId: number, outcome: string, workId?: string) => JSON.stringify({
    at: fx.iso(), taskKey: opening.find(row => row.ticketId === ticketId)?.taskKey, reviewType: 'test-evidence',
    by: 'reviewer', outcome, workId, findingSha256: outcome === 'rework' ? hash : undefined,
  });
  const result = summarizeExperience(raw, groupId, initial, '2026-11-24T00:00:00.000Z', [
    review(first.id, 'rework', 'same-work'), review(second.id, 'rework', 'same-work'),
    review(third.id, 'clear', 'separate-work'), review(fourth.id, 'pending'),
    review(999, 'pending'), '{bad row',
  ].join('\n'));
  assert.equal(result.coverage.invalidReviews, 2);
  assert.equal(result.cohorts[0].opened, 4);
  assert.equal(result.cohorts[0].uniqueTasksClosed, 4);
  assert.deepEqual(result.cohorts[0].closures, { expired_unread: 4, late_completion: 1 });
  assert.deepEqual(result.reviews[0].confirmedWork, { opportunities: 2, resolved: 2, rework: 1, clear: 1, pending: 0, conflicts: 0 });
  assert.equal(result.reviews[0].ticketOnly.pending, 1);
});

test('each event reflects its current role, and unique closures deduplicate across roles', t => {
  const fx = fixture(t);
  let role = 'implement';
  const journal = new BenchExperience(fx.path, groupId, () => {}, fx.iso, () => role);
  const bench = new Bench(fx.benchPath, fx.now, events => journal.record(events));
  const task = bench.send({ ...work, route: {
    groupId, roleKey: 'implement', selectedRoomId: 'test', rule: { quota: 'not-compared', workload: 'idle', rotated: false },
    hp: 50, mp: 50,
  } });
  fx.advance(benchLimits.staleHours * 3_600_000 + 1);
  role = 'review';
  bench.sweep();
  role = 'debug';
  bench.done(task.id, to.sessionId, 'late completion');
  const result = summarizeExperience(readExperienceInput(fx.path), groupId, initial, '2026-11-24T00:00:00.000Z');
  assert.equal(result.uniqueTasksClosed, 1);
  assert.deepEqual(result.cohorts.map(row => [row.role, row.opened, row.closures]), [
    ['implement', 1, {}], ['review', 0, { expired_unread: 1 }], ['debug', 0, { late_completion: 1 }],
  ]);
});

test('disagreements on one ticket stay unresolved, including a tied reply and a missing work ID', t => {
  const fx = fixture(t);
  const bench = fx.open();
  bench.send(work);
  const [task] = fx.rows().events;
  assert.ok(task.event === 'task_opened');
  const common = { at: fx.iso(), taskKey: task.taskKey, reviewType: 'evidence', workId: 'original-work' };
  const review = (rows: object[]) => summarizeExperience(readExperienceInput(fx.path), groupId, initial, '2026-11-24T00:00:00.000Z',
    rows.map(row => JSON.stringify({ ...common, ...row })).join('\n')).reviews[0];
  const rework = { by: 'reviewer', outcome: 'rework', findingSha256: hash };
  for (const other of [{ by: 'owner', outcome: 'clear', workId: undefined }, { by: 'reviewer', outcome: 'clear' }]) {
    assert.deepEqual(review([rework, other]).confirmedWork, { opportunities: 1, resolved: 0, rework: 0, clear: 0, pending: 0, conflicts: 1 });
  }
  const conflictingWork = review([rework, { by: 'owner', outcome: 'clear', workId: 'other-work' }]);
  assert.equal(conflictingWork.confirmedWork.opportunities, 0);
  assert.equal(conflictingWork.ticketOnly.conflicts, 1);
});

test('capture open to all groups records the events of each group', t => {
  const { path, iso, warnings } = fixture(t);
  const store = new BenchExperience(path, 'all', message => warnings.push(message), iso, () => 'implement');
  const ticket = (group: string, id: number) => ({ ...work, groupId: group, id, kind: 'task', hops: 1, status: 'new', createdAt: initial } as unknown as Parameters<BenchExperience['record']>[0][number]['ticket']);
  store.record([{ kind: 'opened', ticket: ticket(groupId, 1) }, { kind: 'opened', ticket: ticket(otherGroup, 2) }]);
  const rows = readExperience(readExperienceInput(path)).events;
  assert.deepEqual(rows.map(row => row.groupId).sort(), [groupId, otherGroup].sort());
});
