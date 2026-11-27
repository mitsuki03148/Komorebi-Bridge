import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { Bench, BenchError, benchAuthority, benchLimits, hookOutput, pingText, ticketText, type BenchParty } from './bench';
import { benchAction, benchHook, benchRequest, type BenchDeps } from './bench-server';
import { claudeEffortFlag, claudeModelFlag, cliLaunch } from './rooms';

const TOOL = '/repo/scripts/komorebi-room';
const hikaru: BenchParty = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', roomName: 'Komorebi CLI App', modelId: 'CODEX' };
const hibiki: BenchParty = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000002', roomName: 'CLI app', modelId: 'CLAUDE' };
const hitomi: BenchParty = { sessionId: 'aaaaaaaa-0000-4000-8000-000000000003', roomName: 'Xcode Testing 1', modelId: 'AGY' };

test('a ticket goes into the recipient\'s workbench; replies count hops and the chain stops at the limit', () => {
  const bench = new Bench();
  const task = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '請檢查 R5 的 diff\n細節…', repo: 'ExampleApp', boundary: 'Review/ 以外唔好改' });
  assert.equal(task.id, 1);
  assert.equal(task.kind, 'task');
  assert.equal(task.hops, 1);
  assert.equal(task.title, '請檢查 R5 的 diff');
  assert.equal(task.status, 'new');
  assert.equal(task.boundary, 'Review/ 以外唔好改');
  const reply = bench.send({ groupId: 'g', from: hikaru, to: hibiki, body: '要看哪一個 commit？', replyTo: task.id });
  assert.equal(reply.kind, 'reply');
  assert.equal(reply.hops, 2);
  let last = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'ca364df9', replyTo: reply.id });
  assert.equal(last.hops, 3);
  for (let hop = 4; hop <= benchLimits.hops; hop++) {
    last = bench.send({ groupId: 'g', from: hop % 2 ? hibiki : hikaru, to: hop % 2 ? hikaru : hibiki, body: `回合 ${hop}`, replyTo: last.id });
    assert.equal(last.hops, hop);
  }
  assert.equal(benchLimits.hops, 10);
  const next = benchLimits.hops + 1;
  assert.throws(() => bench.send({ groupId: 'g', from: next % 2 ? hibiki : hikaru, to: next % 2 ? hikaru : hibiki, body: '超出上限', replyTo: last.id }),
    (error: unknown) => error instanceof BenchError && error.stop && /10 回合上限/.test(error.message));
  assert.throws(() => bench.send({ groupId: 'g', from: hibiki, to: hibiki, body: 'x' }), /自己/);
  assert.throws(() => bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '   ' }), /為空/);
  assert.throws(() => bench.send({ groupId: 'g', from: hitomi, to: hikaru, body: 'x', replyTo: task.id }), /與你無關/);
});

test('finishing a ticket tells its sender without adding a hop, and a completion note needs no answer', () => {
  const bench = new Bench();
  const task = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '跑測試' });
  assert.throws(() => bench.done(task.id, hibiki.sessionId), /不是派給你/);
  const { ticket, notice } = bench.done(task.id, hikaru.sessionId, '全部 PASS', 'commit abc123');
  assert.equal(ticket.status, 'done');
  assert.equal(ticket.receipt, 'commit abc123');
  assert.equal(notice?.kind, 'done');
  assert.equal(notice?.to.sessionId, hibiki.sessionId);
  assert.equal(notice?.hops, task.hops);
  assert.match(notice!.body, /全部 PASS/);
  assert.throws(() => bench.done(task.id, hikaru.sessionId), /已完成/);
  // Marking the note read creates nothing more.
  assert.equal(bench.done(notice!.id, hibiki.sessionId).notice, undefined);
  assert.deepEqual(bench.mine(hibiki.sessionId), []);
});

test('the hook hands over each new ticket once, a few at a time', () => {
  const bench = new Bench();
  for (let index = 0; index < 5; index++) bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: `工作 ${index}` });
  assert.deepEqual(bench.takeNew(hikaru.sessionId).map(ticket => ticket.body), ['工作 0', '工作 1', '工作 2']);
  assert.deepEqual(bench.takeNew(hikaru.sessionId).map(ticket => ticket.body), ['工作 3', '工作 4']);
  assert.deepEqual(bench.takeNew(hikaru.sessionId), []);
  assert.equal(bench.mine(hikaru.sessionId).length, 5, 'read is not done');
});

test('wake-ups are limited per member per hour; claims block others and lapse; everything survives a restart', async () => {
  let now = Date.parse('2026-11-13T10:00:00Z');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-bench-'));
  try {
    const path = join(tmp, 'bench.json');
    const bench = new Bench(path, () => now);
    for (let index = 0; index < benchLimits.pingsPerHour; index++) { assert.equal(bench.pingAllowed(hikaru.sessionId), true); bench.notePing(hikaru.sessionId); }
    assert.equal(bench.pingAllowed(hikaru.sessionId), false);
    assert.equal(bench.pingAllowed(hibiki.sessionId), true, 'counted per member');
    bench.claim('g', hikaru, 'src/App.tsx');
    assert.throws(() => bench.claim('g', hibiki, 'SRC/App.tsx'), /已由 Komorebi CLI App 認領/);
    bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '保存測試' });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const reopened = new Bench(path, () => now);
    assert.equal(reopened.mine(hikaru.sessionId)[0].body, '保存測試');
    assert.equal(reopened.claims('g').length, 1);
    assert.equal(reopened.activeClaims()[0].by.sessionId, hikaru.sessionId);
    assert.equal(reopened.send({ groupId: 'g', from: hibiki, to: hikaru, body: '下一張' }).id, 2, 'numbering continues');
    now += 61 * 60_000;
    assert.equal(reopened.pingAllowed(hikaru.sessionId), true, 'an hour later it may wake again');
    now += benchLimits.claimHours * 3_600_000;
    assert.equal(reopened.claims('g').length, 0, 'a forgotten claim lapses');
    assert.equal(reopened.activeClaims().length, 0);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a ticket reads with who, what, where, its limits and the exact commands to answer, by absolute path', () => {
  const bench = new Bench();
  const task = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '請跑 npm test', repo: 'komorebi', ref: 'main', receipt: 'Review/X/HANDOFF.md' });
  const text = ticketText(task, TOOL);
  assert.match(text, /^\[工作台 #1｜響 · CLI app → 你\]/);
  assert.match(text, /repo：komorebi　ref：main　回報位置：Review\/X\/HANDOFF\.md/);
  assert.ok(text.includes(benchAuthority));
  assert.ok(text.includes(`${TOOL} bench done 1 --from ${hikaru.sessionId}`));
  assert.ok(text.includes(`${TOOL} bench send ${hibiki.sessionId} --from ${hikaru.sessionId} --reply-to 1`));
  // Codex wakes with a one-line reference, even for short tickets.
  assert.match(pingText(task, TOOL), /^\[工作台 #1\].*bench show 1 --from/);
  assert.doesNotMatch(pingText(task, TOOL), /\n/);
  assert.equal(pingText({ ...task, to: hitomi }, TOOL), ticketText({ ...task, to: hitomi }, TOOL));
  const long = bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '大任務', body: 'x'.repeat(benchLimits.shortChars + 1) });
  assert.match(pingText(long, TOOL), /^\[工作台 #2\] 大任務 /);
  assert.ok(!pingText(long, TOOL).includes('x'.repeat(50)));
  assert.deepEqual(hookOutput('agy', 'PreInvocation', 'hi'), { injectSteps: [{ systemMessage: { systemMessage: 'hi' } }] });
  assert.deepEqual(hookOutput('codex', 'PostToolUse', 'hi'), { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'hi' } });
  assert.deepEqual(hookOutput('claude', 'UserPromptSubmit', undefined), {});
});

const room = (party: BenchParty, extra: Partial<TerminalRoom> = {}) =>
  ({ id: `room-${party.roomName}`, sessionId: party.sessionId, roomName: party.roomName, modelId: party.modelId, live: true, ready: true, logs: [], ...extra }) as TerminalRoom;

function deps(rooms: TerminalRoom[], groups: GroupChat[]) {
  const notes: [string, string][] = [];
  const notices: string[] = [];
  const flows: [string, string, string, number][] = [];
  const value: BenchDeps = { bench: new Bench(), rooms: () => rooms, groups: () => groups, tool: TOOL, note: (id, text) => notes.push([id, text]), notice: text => notices.push(text), flow: (from, to, kind, ticket) => flows.push([from, to, kind, ticket]) };
  return { value, notes, notices, flows };
}
const group = (id: string, ...rooms: TerminalRoom[]) => ({ id, name: id, members: rooms.map(item => ({ modelId: item.modelId, roomId: item.id })) }) as GroupChat;

test('a worktree task stays held until its checkout is ready and names the new branch', async () => {
  const lead = room(hibiki), worker = room(hikaru);
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  let finish!: (checkout: import('./auto-worktree').BridgeCheckout) => void;
  value.createWorktree = () => new Promise(resolve => { finish = resolve; });
  const pending = benchRequest(value, { requestId: 'r', action: 'send', from: hibiki.sessionId, to: hikaru.sessionId, repo: '/repo', body: '做事', worktree: 'new' });
  assert.equal(value.bench.get(1)?.worktree?.state, 'pending');
  assert.deepEqual(value.bench.mine(hikaru.sessionId), []);
  assert.deepEqual(value.bench.takeNew(hikaru.sessionId), []);
  assert.equal(benchAction(value, { requestId: 'r', action: 'show', from: hikaru.sessionId, id: 1 }).ok, false);
  assert.throws(() => value.bench.done(1, hikaru.sessionId), /尚未準備好/);
  assert.equal(value.bench.get(1)?.status, 'new');
  finish({ ticketId: 1, repo: '/repo', path: '/isolated/1', branch: 'bridge/1', ref: 'a'.repeat(40), state: 'created', createdAt: new Date(0).toISOString() });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(value.bench.mine(hikaru.sessionId)[0].repo, '/isolated/1');
  assert.equal(value.bench.mine(hikaru.sessionId)[0].ref, 'bridge/1');
  assert.match(ticketText(value.bench.mine(hikaru.sessionId)[0], TOOL), /agent 須按路徑進入；非強制隔離/);
  assert.equal(value.bench.lastWorktree(worker.id)?.path, '/isolated/1');
});

test('a failed worktree stays held and is not delivered as an ordinary task', async () => {
  const lead = room(hibiki), worker = room(hikaru);
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  value.createWorktree = async () => { throw new Error('已達上限 6'); };
  const result = await benchRequest(value, { requestId: 'r', action: 'send', from: hibiki.sessionId, to: hikaru.sessionId, repo: '/repo', body: '做事', worktree: 'new' });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /上限 6/);
  assert.equal(value.bench.get(1)?.worktree?.state, 'failed');
  assert.deepEqual(value.bench.mine(hikaru.sessionId), []);
  assert.deepEqual(value.bench.takeNew(hikaru.sessionId), []);
  assert.deepEqual(value.bench.openFrom(hibiki.sessionId), [], 'failed provisioning cannot block the lead closeout');
  assert.match(result.lines[0], /bench cancel 1/);
  assert.equal(benchAction(value, { requestId: 'r', action: 'cancel', from: hibiki.sessionId, id: 1 }).ok, true);
});

test('a pending worktree task stays held after Bridge restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-pending-worktree-'));
  const path = join(dir, 'bench.json');
  const bench = new Bench(path);
  bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '工作', repo: '/repo', worktree: { state: 'pending', source: '/repo' } });
  const reopened = new Bench(path);
  assert.equal(reopened.get(1)?.worktree?.state, 'pending');
  assert.deepEqual(reopened.mine(hikaru.sessionId), []);
  assert.deepEqual(reopened.takeNew(hikaru.sessionId), []);
  reopened.finishWorktree(1, 'worker', { path: '/isolated/1', branch: 'bridge/1' });
  assert.equal(new Bench(path).mine(hikaru.sessionId)[0].repo, '/isolated/1');
});

test('a worktree finished after its ticket was cancelled is preserved but not delivered', async () => {
  const lead = room(hibiki), worker = room(hikaru);
  const { value, notes } = deps([lead, worker], [group('g', lead, worker)]);
  let finish!: (checkout: import('./auto-worktree').BridgeCheckout) => void;
  value.createWorktree = () => new Promise(resolve => { finish = resolve; });
  const pending = benchRequest(value, { requestId: 'r', action: 'send', from: hibiki.sessionId, to: hikaru.sessionId, repo: '/repo', body: '做事', worktree: 'new' });
  value.bench.cancel(1, [hibiki.sessionId]);
  finish({ ticketId: 1, repo: '/repo', path: '/isolated/1', branch: 'bridge/1', ref: 'a'.repeat(40), state: 'created', createdAt: new Date(0).toISOString() });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.match(result.lines[0], /已結束/);
  assert.deepEqual(value.bench.takeNew(hikaru.sessionId), []);
  assert.equal(value.bench.lastWorktree(worker.id), undefined);
  assert.deepEqual(notes, []);
});

test('a ticket is only for a member of the same group, and reaches it by hook while it works or by a wake-up while it is idle', () => {
  const lead = room(hibiki);
  const worker = room(hikaru, { ready: false, benchHooked: true });
  const outsider = room(hitomi);
  const { value, notes, notices } = deps([lead, worker, outsider], [group('g', lead, worker)]);
  const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });

  const outside = call('send', { from: 'CLI app', to: 'Xcode Testing 1', body: '幫手' });
  assert.equal(outside.ok, false);
  assert.equal(outside.stop, true);
  // Rule changed by the Founder (2026-11-17): the reason goes back to the sending agent; the open pages are not told.
  assert.match(outside.lines.join('\n'), /不在同一個群組/);
  assert.deepEqual(notices, [], 'a send outside the group is for the sending agent, not a toast');

  const working = call('send', { from: 'CLI app', to: hikaru.sessionId, body: '請跑 npm test' });
  assert.equal(working.ok, true);
  assert.equal(working.ping, undefined, 'it works and has the hook: no message needed');
  assert.match(working.lines[0], /下一步會自動收到/);
  assert.deepEqual(notes.at(-1), [worker.id, '工作台 #1：響 · CLI app → 光 · Komorebi CLI App「請跑 npm test」']);

  worker.ready = true;
  const idle = call('send', { from: 'CLI app', to: hikaru.sessionId, body: 'x'.repeat(400), title: '長任務' });
  assert.equal(idle.ping?.to, hikaru.sessionId);
  assert.equal(idle.ping?.from, 'CLI app');
  assert.match(idle.ping!.text, /^\[工作台 #2\] 長任務/);
  assert.match(idle.lines.join('\n'), /--repo／--ref、--boundary/, 'a long task without its context is pointed out');

  // A Codex wake is only a reference; the hook still receives short tickets in full.
  const short = call('send', { from: 'CLI app', to: hikaru.sessionId, body: '短的' });
  call('pinged', { from: 'CLI app', id: short.ping!.ticket, ok: true });
  assert.equal(value.bench.get(short.ping!.ticket)?.status, 'new');
  assert.equal(value.bench.get(2)?.status, 'new', 'the long one waits for the hook');

  for (let index = 0; index < benchLimits.pingsPerHour; index++) value.bench.notePing(hikaru.sessionId);
  const held = call('send', { from: 'CLI app', to: hikaru.sessionId, body: '再一張' });
  assert.equal(held.ok, true);
  assert.equal(held.ping, undefined);
  assert.match(held.lines.join('\n'), /本小時提示已達上限/, 'the sender is told');
  assert.deepEqual(notices, [], 'the hourly cap is not a toast for the Founder');
  assert.equal(benchLimits.pingsPerHour, 60, 'sixty ordinary wake-up messages an hour');
});

test('the recipient reads, finishes, and the sender is told in its own workbench and room', () => {
  const lead = room(hibiki, { ready: false, benchHooked: true });
  const worker = room(hikaru);
  const { value, notes } = deps([lead, worker], [group('g', lead, worker)]);
  const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });
  call('send', { from: 'CLI app', to: 'Komorebi CLI App', body: '請跑 npm test' });
  assert.match(call('mine', { from: 'Komorebi CLI App' }).lines[0], /^#1 \[新\] 響 · CLI app → 光 · Komorebi CLI App：請跑 npm test$/);
  assert.match(call('show', { from: 'Komorebi CLI App', id: 1 }).lines[0], /請跑 npm test/);
  assert.equal(value.bench.get(1)?.status, 'seen');
  assert.equal(call('show', { from: 'Xcode Testing 1', id: 1 }).ok, false);
  assert.equal(call('claim', { from: 'Komorebi CLI App', scope: 'bridge/rooms.ts' }).ok, true);
  assert.match(call('overview', { from: 'CLI app' }).lines.join('\n'), /認領：bridge\/rooms\.ts（光 · Komorebi CLI App/);
  const finished = call('done', { from: 'Komorebi CLI App', id: 1, note: '244 PASS', receipt: 'commit abc' });
  assert.equal(finished.ok, true);
  assert.equal(finished.ping, undefined, 'the lead is working with its hook, so it just gets it');
  assert.deepEqual(notes.at(-1), [lead.id, '工作台 #1 完成：光 · Komorebi CLI App「244 PASS」']);
  assert.equal(value.bench.claims('g').length, 0, 'finishing releases the claim');
  const notice = value.bench.mine(hibiki.sessionId)[0];
  assert.equal(notice.kind, 'done');
  assert.match(notice.body, /結果：244 PASS\n回報位置：commit abc/);
});

test('only the last main-task receipt in the crown’s group carries the closeout hint', () => {
  const lead = room(hikaru, { ready: false, benchHooked: true });
  const worker = room(hitomi);
  const otherWorker = room(hibiki);
  const active = { ...group('g', lead, worker), orchestratorRoomId: lead.id };
  const { value, notices } = deps([lead, worker, otherWorker], [active, group('elsewhere', lead, otherWorker)]);
  const { bench } = value;
  const first = bench.send({ groupId: 'g', from: hikaru, to: hitomi, body: 'First check' });
  const last = bench.send({ groupId: 'g', from: hikaru, to: hitomi, body: 'Final check' });
  const reply = bench.send({ groupId: 'g', from: hikaru, to: hitomi, body: 'Follow-up', replyTo: last.id });
  const elsewhere = bench.send({ groupId: 'elsewhere', from: hikaru, to: hibiki, body: 'Other group' });
  bench.markSeen(elsewhere.id);
  const incoming = bench.send({ groupId: 'g', from: hitomi, to: hikaru, body: 'Incoming' });
  const done = (id: number, from = hitomi.sessionId) => benchAction(value, { requestId: 'r', action: 'done', from, id, note: 'PASS' });
  const hook = () => JSON.stringify(benchHook(value, 'codex', { session_id: hikaru.sessionId }));

  assert.equal(done(first.id).ok, true);
  assert.doesNotMatch(hook(), /收尾提示/);
  assert.equal(done(last.id).ok, true);
  const receipt = bench.mine(hikaru.sessionId).find(ticket => ticket.replyTo === last.id)!;
  const injected = hook();
  assert.match(injected, /收尾提示.*HANDOFF.*INBOX — DONE.*結果：PASS/);
  assert.ok(injected.includes(`#${reply.id} [新] 光 · Komorebi CLI App → 瞳 · Xcode Testing 1：Follow-up`));
  assert.ok(injected.includes(`#${elsewhere.id} [已讀] 光 · Komorebi CLI App → 響 · CLI app：Other group`));
  assert.doesNotMatch(injected, /仍未完成嘅派單：.*Incoming/);
  assert.doesNotMatch(injected, /仍未完成嘅派單：.*Final check/);
  const workerView = benchAction(value, { requestId: 'r', action: 'show', from: hitomi.sessionId, id: receipt.id });
  assert.equal(workerView.ok, true);
  assert.doesNotMatch(workerView.lines.join('\n'), /仍未完成嘅派單|Other group/);
  assert.doesNotMatch(hook(), /收尾提示/, 'the usual receipt is injected once');
  assert.equal(bench.get(reply.id)?.status, 'new', 'the reply still needs its own answer');
  assert.equal(bench.get(elsewhere.id)?.status, 'seen');
  assert.equal(bench.get(incoming.id)?.status, 'seen');
  assert.equal(done(reply.id).ok, true);
  assert.equal(done(elsewhere.id, hibiki.sessionId).ok, true);
  assert.doesNotMatch(hook(), /收尾提示/, 'replies and groups without this crown use ordinary receipts');
  const solo = bench.send({ groupId: 'g', from: hikaru, to: hitomi, body: 'Only task' });
  assert.equal(done(solo.id).ok, true);
  assert.ok(hook().includes('仍未完成嘅派單：\\n冇。'));
  assert.deepEqual(notices, [], 'no extra notification or ticket');
});

test('a hook gets its own agent\'s new tickets once, in its CLI\'s form, and nothing for anyone else', () => {
  const lead = room(hibiki);
  const worker = room(hikaru);
  const eye = room(hitomi);
  const { value } = deps([lead, worker, eye], [group('g', lead, worker, eye)]);
  value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '給光' });
  value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '給瞳' });
  const codex = benchHook(value, 'codex', { session_id: hikaru.sessionId, hook_event_name: 'PostToolUse' }) as any;
  assert.equal(codex.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(codex.hookSpecificOutput.additionalContext, /給光/);
  assert.deepEqual(benchHook(value, 'codex', { session_id: hikaru.sessionId, hook_event_name: 'PostToolUse' }), {}, 'once only');
  const agy = benchHook(value, 'agy', { conversationId: hitomi.sessionId, hookEventName: 'PreInvocation' }) as any;
  assert.match(agy.injectSteps[0].systemMessage.systemMessage, /給瞳/);
  assert.match(agy.injectSteps[0].systemMessage.systemMessage, /task-context[^\n]*--repo[^\n]*--ref[^\n]*原生讀檔/);
  assert.doesNotMatch(codex.hookSpecificOutput.additionalContext, /task-context/);
  assert.deepEqual(benchHook(value, 'claude', { session_id: 'someone-else', hook_event_name: 'UserPromptSubmit' }), {});
  assert.deepEqual(benchHook(value, 'claude', 'not an object'), {});
  assert.deepEqual(benchHook(value, 'bash', { session_id: hikaru.sessionId }), {});
});

test('only a group room is started with the workbench hook, in each CLI\'s own way', () => {
  const codex = { id: 'c', modelId: 'CODEX', sessionId: hikaru.sessionId, repoPath: '/tmp' } as TerminalRoom;
  const [, plain] = cliLaunch(codex, false, false, true);
  assert.ok(!plain.some(arg => /bench-hook|hook-trust/.test(arg)));
  const [, hooked] = cliLaunch(codex, false, false, true, { hook: '/repo/scripts/bench-hook' });
  // Codex: the hooks and the trust flag go before the subcommand.
  assert.equal(hooked[0], '--dangerously-bypass-hook-trust');
  assert.ok(hooked.indexOf('resume') > hooked.findIndex(arg => arg.startsWith('hooks.PostToolUse=')));
  assert.ok(hooked.includes('hooks.PostToolUse=[{matcher="*",hooks=[{type="command",command="/repo/scripts/bench-hook codex",timeout=5}]}]'));
  assert.ok(hooked.includes('hooks.UserPromptSubmit=[{hooks=[{type="command",command="/repo/scripts/bench-hook codex",timeout=5}]}]'));
  assert.equal(hooked.at(-1), hikaru.sessionId);
  const claude = { id: 'k', modelId: 'CLAUDE', sessionId: hibiki.sessionId, repoPath: '/tmp' } as TerminalRoom;
  const [, claudeArgs] = cliLaunch(claude, false, false, true, { hook: '/repo/scripts/bench-hook' });
  const settings = JSON.parse(claudeArgs[claudeArgs.indexOf('--settings') + 1]);
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, '/repo/scripts/bench-hook claude');
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, '/repo/scripts/bench-hook claude');
  assert.equal(settings.hooks.SessionStart[0].matcher, 'compact');
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, '/repo/scripts/bench-hook claude');
  assert.ok(!cliLaunch(claude, false, false, true)[1].includes('--settings'));
  const agy = { id: 'a', modelId: 'AGY', sessionId: hitomi.sessionId, repoPath: '/tmp' } as TerminalRoom;
  assert.deepEqual(cliLaunch(agy, false, true, false, { hook: '/repo/scripts/bench-hook' }), cliLaunch(agy, false, true, false), 'AGY gets it from its plugin');
});

test('the hook script passes the CLI\'s input to the Bridge and prints its answer, or {} when the Bridge is down or answers anything else', async () => {
  const { createServer } = await import('node:http');
  const { execFile } = await import('node:child_process');
  const run = (port: number, input: string) => new Promise<string>((resolve, reject) => {
    const child = execFile(join(process.cwd(), 'scripts', 'bench-hook'), ['codex'], { env: { ...process.env, KOMOREBI_PORT: String(port) }, timeout: 10_000 },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    child.stdin!.end(input);
  });
  let mode: 'json' | 'html' = 'json';
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${body}`);
      res.end(mode === 'json' ? '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"工單"}}' : '<!doctype html><p>not found</p>');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  try {
    assert.equal(await run(port, '{"session_id":"s1"}'), '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"工單"}}');
    assert.deepEqual(seen, ['POST /bench/hook/codex {"session_id":"s1"}']);
    mode = 'html';
    assert.equal(await run(port, '{}'), '{}');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await run(port, '{}'), '{}', 'Bridge not running');
});

test('a member that finishes with tickets still unread is woken, naming them when its hook will add them and carrying them when not', async () => {
  const { idleWake } = await import('./bench-server');
  const lead = room(hibiki);
  const hooked = room(hikaru, { benchHooked: true });
  const plain = room(hitomi, { benchHooked: false });
  const { value, notices } = deps([lead, hooked, plain], [group('g', lead, hooked, plain)]);
  assert.equal(idleWake(value, hooked), undefined, 'nothing waiting');
  value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '測試 #B', body: '工作中收' });
  assert.equal(idleWake(value, { ...hooked, ready: false }), undefined, 'only at its prompt');
  const hinted = idleWake(value, hooked)!;
  assert.match(hinted.text, /^\[交接｜來自 工作台\] 你的工作台有 1 張新工單：#1 測試 #B。內容會自動附上/);
  hinted.finish(true);
  assert.equal(value.bench.get(1)?.status, 'new', 'its hook hands it over');
  value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '給瞳的全文' });
  const carried = idleWake(value, plain)!;
  assert.match(carried.text, /給瞳的全文/);
  assert.equal(value.bench.get(2)?.status, 'new', 'reservation alone is not delivery');
  carried.finish(false);
  assert.equal(value.bench.get(2)?.status, 'new', 'a failed write leaves the ticket unread');
  idleWake(value, plain)!.finish(true);
  assert.equal(value.bench.get(2)?.status, 'seen');
  for (let index = 0; index < benchLimits.pingsPerHour; index++) value.bench.notePing(hikaru.sessionId);
  assert.equal(idleWake(value, hooked), undefined);
  assert.deepEqual(notices, [], 'at the hourly cap the tickets wait quietly');
});

test('the Bridge hears when a live CLI comes back to its prompt', async () => {
  const { Rooms } = await import('./rooms');
  const rooms = new Rooms(process.cwd(), () => {});
  const idle: string[] = [];
  rooms.onIdle = item => idle.push(item.id);
  const codex = { id: 'w', modelId: 'CODEX', roomName: 'x', repoPath: '/tmp', logs: [], live: true, ready: false, screen: '', remoteControl: { enabled: false, sessionUrl: '' } } as unknown as TerminalRoom;
  const lines = ['• Working (3s • esc to interrupt)', '› Ask Codex to do anything', '  GPT-6.1 Terra high · /tmp'];
  const live = { process: { write() {} }, queued: 0, dirty: false, terminal: { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } } };
  (rooms as any).refresh(codex, live);
  await Promise.resolve();
  assert.deepEqual(idle, []);
  lines.splice(0, 1);
  (rooms as any).refresh(codex, live);
  await Promise.resolve();
  assert.deepEqual(idle, ['w']);
  (rooms as any).refresh(codex, live);
  await Promise.resolve();
  assert.deepEqual(idle, ['w'], 'once per return, not on every redraw');
});

test('a new room without a CLI session yet gets tickets under its room id, and its hook finds them once the session is known', () => {
  const lead = room(hibiki);
  const fresh = { ...room(hitomi), id: 'room-new-agy', sessionId: undefined } as TerminalRoom;
  const { value } = deps([lead, fresh], [group('g', lead, fresh)]);
  const sent = benchAction(value, { requestId: 'r', action: 'send', from: 'CLI app', to: 'room-new-agy', body: '給新房' });
  assert.equal(sent.ok, true);
  assert.equal(sent.ping?.to, 'room-new-agy');
  fresh.sessionId = 'conversation-made-later';
  const agy = benchHook(value, 'agy', { conversationId: 'conversation-made-later', hookEventName: 'PreInvocation' }) as any;
  assert.match(agy.injectSteps[0].systemMessage.systemMessage, /給新房/);
  assert.equal(benchAction(value, { requestId: 'r', action: 'done', from: 'conversation-made-later', id: 1, note: '收到' }).ok, true);
});

test('a room whose room id is also its session id is counted once', async () => {
  const { idleWake } = await import('./bench-server');
  const same = room({ ...hibiki, sessionId: 'same-id' }, { id: 'same-id', benchHooked: true });
  const other = room(hikaru);
  const { value } = deps([same, other], [group('g', same, other)]);
  value.bench.send({ groupId: 'g', from: hikaru, to: { ...hibiki, sessionId: 'same-id' }, title: '一張', body: '內容' });
  const wake = idleWake(value, same)!;
  assert.equal(wake.text.match(/#1 一張/g)?.length, 1);
  assert.match(wake.text, /有 1 張新工單/);
  wake.finish(true);
  assert.equal(benchAction(value, { requestId: 'r', action: 'mine', from: 'same-id' }).lines.length, 1);
});

test('a ticket sent or finished lets a heart fly between the two rooms, and the group list shows it', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { GroupRoomSidebar } = await import('../src/components/GroupRoomSidebar');
  const { INITIAL_CHARACTERS } = await import('../src/data/initialGuildData');
  const lead = room(hibiki);
  const worker = room(hikaru);
  const { value, flows } = deps([lead, worker], [group('g', lead, worker)]);
  benchAction(value, { requestId: 'r', action: 'send', from: 'CLI app', to: 'Komorebi CLI App', body: '請跑 npm test' });
  assert.deepEqual(flows, [[lead.id, worker.id, 'task', 1]]);
  benchAction(value, { requestId: 'r', action: 'done', from: 'Komorebi CLI App', id: 1, note: 'ok' });
  assert.deepEqual(flows.at(-1), [worker.id, lead.id, 'done', 1]);
  const g = group('g', lead, worker);
  const show = (items: { id: number; from: string; to: string; kind: 'task' | 'done' }[]) => renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [g], rooms: [lead, worker], characters: INITIAL_CHARACTERS, selectedGroupId: 'g', onSelectGroup() {}, onSelectRoom() {}, flows: items }));
  assert.doesNotMatch(show([]), /data-heart/);
  const html = show([{ id: 1, from: lead.id, to: worker.id, kind: 'task' }]);
  assert.equal(html.match(/data-heart="out"/g)?.length, 1, 'one leaves the sender');
  assert.equal(html.match(/data-heart="in"/g)?.length, 1, 'one lands on the receiver');
  assert.match(html, /data-flower="task"/);
  assert.match(show([{ id: 1, from: worker.id, to: lead.id, kind: 'done' }]), /data-flower="done"/);
  // The flower takes the colour of whoever sent it, on both rooms, whether work is handed over or comes back.
  const { roleAccent } = await import('../src/utils/roleAccent');
  const fills = (markup: string) => [...markup.matchAll(/<ellipse[^>]*fill="(#[0-9A-Fa-f]{6})"/g)].map(match => match[1]);
  const fromLead = fills(show([{ id: 1, from: lead.id, to: worker.id, kind: 'task' }]));
  const fromWorker = fills(show([{ id: 2, from: worker.id, to: lead.id, kind: 'done' }]));
  assert.equal(fromLead.length, 10, 'five petals on each of the two flowers');
  assert.ok(fromLead.every(fill => fill === roleAccent[lead.modelId].stripe), 'sent by the lead: its colour');
  assert.ok(fromWorker.every(fill => fill === roleAccent[worker.modelId].stripe), 'sent back by the worker: its colour, not a fixed green');
  assert.notEqual(roleAccent[lead.modelId].stripe, roleAccent[worker.modelId].stripe);
  assert.ok(![...fromLead, ...fromWorker].some(fill => fill === '#F2B8C4' || fill === '#9CC6A4'), 'the old fixed pink and green are gone');
});

test('a notice (--notify) ends when it is read, needs no done, and is never left open for either side', () => {
  const lead = room(hibiki);
  const worker = room(hikaru, { ready: false, benchHooked: true });
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });
  const sent = call('send', { from: 'CLI app', to: hikaru.sessionId, body: '方案取捨：選 A，原因 xxx', notify: true });
  assert.equal(sent.ok, true);
  assert.equal(value.bench.get(1)?.kind, 'notice');
  assert.equal(call('overview', { from: 'CLI app' }).lines.some(line => line.includes('#1')), true, 'open until read');
  // The hook hands it to the receiver; that is enough to close it.
  const handed = benchHook(value, 'codex', { session_id: hikaru.sessionId, hook_event_name: 'PostToolUse' });
  assert.match(JSON.stringify(handed), /只係通知/);
  assert.equal(value.bench.get(1)?.status, 'done');
  assert.deepEqual(value.bench.mine(hikaru.sessionId), []);
  assert.equal(value.bench.open('g').length, 0);
  // Closing it by hand is harmless, and sends no completion note back.
  const closed = call('done', { from: 'Komorebi CLI App', id: 1 });
  assert.equal(closed.ok, true);
  assert.match(closed.lines[0], /自動結案/);
  assert.equal(value.bench.mine(hibiki.sessionId).length, 0, 'the sender gets no completion note to close');
  assert.match(ticketText(value.bench.get(1)!, TOOL), /｜通知\]/);
});

test('a ticket that names files is held back when one is missing, and goes out once they are there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-req-'));
  try {
    const lead = room(hibiki);
    const worker = room(hikaru, { ready: false, benchHooked: true });
    const { value } = deps([lead, worker], [group('g', lead, worker)]);
    const call = (fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action: 'send', from: 'CLI app', to: hikaru.sessionId, body: '請 review', ...fields });
    const missing = call({ repo: dir, requirePaths: ['Review/HANDOFF.md'] });
    assert.equal(missing.ok, false);
    assert.match(missing.lines.join(' '), /派單前核對：找不到 .*HANDOFF\.md/);
    assert.equal(value.bench.get(1), undefined, 'nothing was written into the workbench');
    assert.equal(call({ requirePaths: ['Review/HANDOFF.md'] }).ok, false, 'a relative path needs --repo');
    await (await import('node:fs/promises')).mkdir(join(dir, 'Review'));
    await (await import('node:fs/promises')).writeFile(join(dir, 'Review', 'HANDOFF.md'), 'x');
    assert.equal(call({ repo: dir, requirePaths: ['Review/HANDOFF.md', join(dir, 'Review')] }).ok, true);
    assert.equal(value.bench.get(1)?.kind, 'task');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a ticket can go to @orchestrator, and one for a room that was taken over goes to its successor', () => {
  const lead = room(hibiki, { id: 'room-lead' });
  const heir = room({ ...hibiki, sessionId: 'aaaaaaaa-0000-4000-8000-0000000000ff', roomName: '新統籌' }, { id: 'room-heir' });
  const worker = room(hikaru);
  const { value } = deps([lead, heir, worker], [{ ...group('g', lead, heir, worker), orchestratorRoomId: heir.id } as GroupChat]);
  value.successors = () => ({ [hibiki.sessionId]: 'aaaaaaaa-0000-4000-8000-0000000000ff' });
  const call = (fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action: 'send', from: 'Komorebi CLI App', body: '做完了', ...fields });
  const viaAlias = call({ to: '@orchestrator' });
  assert.equal(viaAlias.ok, true, viaAlias.lines.join(' '));
  assert.equal(value.bench.get(1)?.to.roomName, '新統籌');
  const viaOld = call({ to: hibiki.sessionId });
  assert.equal(viaOld.ok, true);
  assert.equal(value.bench.get(2)?.to.roomName, '新統籌');
  assert.match(viaOld.lines[0], /已由「新統籌」接手/);
});

test('@orchestrator requires an explicit room when a member belongs to groups with different leads', () => {
  const firstLead = room(hibiki), secondLead = room(hitomi), worker = room(hikaru);
  const groups = [
    { ...group('first', firstLead, worker), orchestratorRoomId: firstLead.id },
    { ...group('second', secondLead, worker), orchestratorRoomId: secondLead.id },
  ] as GroupChat[];
  const { value } = deps([firstLead, secondLead, worker], groups);
  const result = benchAction(value, { requestId: 'r', action: 'send', from: worker.roomName, to: '@orchestrator', body: '報告' });
  assert.equal(result.ok, false);
  assert.match(result.lines.join(' '), /幾個群組都有總指揮/);
  assert.equal(value.bench.get(1), undefined);
});

test('finishing a ticket with a file receipt records that it existed, and later says if it is gone or changed', async () => {
  const { writeFile, rm: remove } = await import('node:fs/promises');
  const { proveReceipt, receiptNow } = await import('./bench-server');
  const dir = await mkdtemp(join(tmpdir(), 'bench-receipt-'));
  try {
    const lead = room(hibiki), worker = room(hikaru, { ready: false, benchHooked: true });
    const { value } = deps([lead, worker], [group('g', lead, worker)]);
    const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });
    const file = join(dir, 'receipt.md');
    await writeFile(file, '證據');
    call('send', { from: 'CLI app', to: hikaru.sessionId, body: '請做' });
    const done = call('done', { from: 'Komorebi CLI App', id: 1, note: 'PASS', receipt: file });
    assert.equal(done.ok, true);
    assert.match(done.lines.join('\n'), /完成時存在（1 KB，sha256 [0-9a-f]{12}…）/);
    const proof = value.bench.get(1)!.receiptProof!;
    assert.equal(proof.state, 'file');
    assert.match(value.bench.mine(hibiki.sessionId).map(ticket => ticket.body).join('\n'), /完成時存在/, 'the sender\'s completion note carries it too');
    assert.match(receiptNow(proof), /仍在，內容同完成時一樣/);
    await writeFile(file, '改咗');
    assert.match(receiptNow(proof), /內容自完成後有變/);
    await remove(file);
    assert.match(receiptNow(proof), /已經唔存在（完成時存在）/);
    assert.match(call('show', { from: 'CLI app', id: 1 }).lines.join('\n'), /已經唔存在（完成時存在）/);
    // A missing receipt is flagged when the ticket is finished; a commit or free text is left alone.
    assert.equal(proveReceipt(join(dir, 'never.md'))?.state, 'missing');
    assert.match(done.lines.join('\n'), /sha256/);
    assert.equal(proveReceipt('commit abc123'), undefined);
    assert.equal(proveReceipt('34301adf'), undefined);
    assert.equal(proveReceipt(dir)?.state, 'dir');
  } finally { await remove(dir, { recursive: true, force: true }); }
});

test('a completion persists Git, gate and receipt facts and the notice checks their current state', async t => {
  const base = await mkdtemp(join(tmpdir(), 'bench-completion-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = await realpath(base);
  const repo = join(root, 'checkout');
  const origin = join(root, 'origin.git');
  const gateResultDir = join(root, 'gate');
  const customDir = join(root, 'custom');
  await Promise.all([repo, origin, gateResultDir, customDir].map(dir => mkdir(dir)));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'trial');
  git('config', 'user.email', 'bench@example.invalid');
  git('config', 'user.name', 'Bench');
  await writeFile(join(repo, 'old.txt'), 'tracked');
  git('add', 'old.txt');
  git('commit', '-qm', 'initial');
  git('init', '-q', '--bare', origin);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'trial');
  const head = git('rev-parse', 'HEAD');
  git('mv', 'old.txt', 'renamed.txt');
  await mkdir(join(repo, 'new'));
  await writeFile(join(repo, 'new', 'one\nline.txt'), 'untracked');
  await writeFile(join(repo, 'new', 'two.txt'), 'untracked');
  const receipt = join(root, 'HANDOFF.md');
  await writeFile(receipt, 'evidence');
  const hash = createHash('sha256').update('evidence').digest('hex');

  const lead = room(hibiki), worker = room(hikaru), other = room(hitomi);
  const { value } = deps([lead, worker, other], [group('g', lead, worker, other)]);
  value.gateResultDir = gateResultDir;
  const state = join(root, 'bench.json');
  value.bench = new Bench(state);
  const call = (action: string, fields: Record<string, unknown>) => benchRequest(value, { requestId: 'r', action, ...fields });
  const gatePath = (dir: string, second: number) => join(dir, `2026-11-27T01-50-0${second}.381Z-bfe6925e-2fea-474a-ae39-44a9e7759f2f.json`);
  const gate = { root: repo, head, ok: true, status: 'clean', test: { tail: 'ℹ tests 7\nℹ pass 7\nℹ fail 0' } };
  await writeFile(gatePath(gateResultDir, 1), JSON.stringify({ ...gate, ok: false }));
  await writeFile(gatePath(gateResultDir, 3), JSON.stringify({ ...gate, root: origin }));
  await writeFile(gatePath(gateResultDir, 4), '{');
  const customGate = gatePath(customDir, 2);
  await writeFile(customGate, JSON.stringify(gate));
  assert.equal((await call('send', { from: hikaru.sessionId, to: hikaru.sessionId, notify: true, source: 'verify-gate',
    body: `verify-gate PASS；ℹ tests 7, ℹ pass 7；結果：${customGate}` })).ok, true);

  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'verify', repo });
  const done = (fields: Record<string, unknown> = {}) => call('done', { from: hikaru.sessionId, id: task.id, receipt, ...fields });
  assert.equal((await done({ from: hibiki.sessionId })).ok, false);
  assert.equal((await done()).ok, true);
  const notice = value.bench.mine(hibiki.sessionId).find(ticket => ticket.replyTo === task.id)!;
  value.bench = new Bench(state);
  const show = (from = hibiki.sessionId) => call('show', { from, id: notice.id });
  const checked = await show();
  assert.equal(checked.ok, true);
  assert.ok(checked.lines[0].split('\n').includes(`自動核對：HEAD ${head}｜已推｜未 commit 3 個檔｜gate PASS 7/7｜receipt sha256 ${hash}`));
  assert.equal(checked.lines.at(-1), '核對：SHA 存在｜分支一致｜receipt 一致');
  assert.equal(await readFile(receipt, 'utf8'), 'evidence');
  assert.equal(git('rev-parse', 'refs/heads/trial'), head);
  assert.equal((await show(hitomi.sessionId)).ok, false);
  assert.doesNotMatch((await show(hikaru.sessionId)).lines.join('\n'), /\n核對：/);

  git('commit', '-qm', 'rename');
  await writeFile(receipt, 'changed evidence');
  const changed = await show();
  assert.equal(changed.lines.at(-1), '核對：SHA 存在｜分支 SHA 已變｜receipt hash 已變');
  assert.match(changed.lines[0], /｜已推｜/, 'the saved origin comparison is a completion-time fact');

  const unpushed = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'new version', repo });
  assert.equal((await done({ id: unpushed.id, receipt: undefined })).ok, true);
  const next = value.bench.mine(hibiki.sessionId).find(ticket => ticket.replyTo === unpushed.id)!;
  assert.match(ticketText(next, TOOL), /｜未推｜未 commit 2 個檔｜gate PASS 7\/7（HEAD 不同）｜receipt UNKNOWN/);

  await writeFile(gatePath(gateResultDir, 5), JSON.stringify({ ...gate, head: git('rev-parse', 'HEAD'), ok: false,
    status: '?? new/', test: { tail: 'ℹ tests 7\nℹ pass 6\nℹ fail 1' } }));
  const failedGate = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'failed gate', repo });
  assert.equal((await done({ id: failedGate.id, receipt: undefined })).ok, true);
  const failed = value.bench.mine(hibiki.sessionId).find(ticket => ticket.replyTo === failedGate.id)!;
  assert.match(ticketText(failed, TOOL), /gate FAIL 6\/7（驗證時工作樹有變更）/);

  git('switch', '--detach', '-q');
  git('branch', '-D', 'trial');
  await rm(receipt);
  assert.equal((await show()).lines.at(-1), '核對：SHA 存在｜分支唔存在｜receipt 唔存在');
  await rename(repo, join(root, 'other-checkout'));
  assert.equal((await show()).lines.at(-1), '核對：SHA UNKNOWN｜分支 UNKNOWN｜receipt 唔存在');
  await mkdir(repo);
  git('init', '-q', '-b', 'replacement');
  assert.equal((await show()).lines.at(-1), '核對：SHA 唔存在｜分支唔存在｜receipt 唔存在');
});

test('missing checkout, gate and receipt evidence leave ordinary completion usable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-missing-completion-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = await realpath(dir);
  const lead = room(hibiki), worker = room(hikaru);
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  value.gateResultDir = join(repo, 'no-gate');
  const call = (action: string, fields: Record<string, unknown>) => benchRequest(value, { requestId: 'r', action, ...fields });
  const complete = async (path: string) => {
    const task = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'check', repo: path });
    assert.equal((await call('done', { from: hikaru.sessionId, id: task.id, receipt: join(repo, 'missing.md') })).ok, true);
    assert.equal(task.status, 'done');
    const notice = value.bench.mine(hibiki.sessionId).find(ticket => ticket.replyTo === task.id)!;
    return call('show', { from: hibiki.sessionId, id: notice.id });
  };
  const missingGit = await complete(repo);
  assert.match(missingGit.lines[0], /HEAD UNKNOWN｜推送 UNKNOWN｜未 commit UNKNOWN｜gate UNKNOWN｜receipt UNKNOWN/);
  assert.equal(missingGit.lines.at(-1), '核對：SHA UNKNOWN｜分支 UNKNOWN｜receipt 唔存在');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'trial');
  git('-c', 'user.email=bench@example.invalid', '-c', 'user.name=Bench', 'commit', '-qm', 'initial', '--allow-empty');
  const head = git('rev-parse', 'HEAD');
  const missingGate = await complete(repo);
  assert.ok(missingGate.lines[0].includes(`HEAD ${head}｜推送 UNKNOWN｜未 commit 0 個檔｜gate UNKNOWN｜receipt UNKNOWN`));
  assert.equal(missingGate.lines.at(-1), '核對：SHA 存在｜分支一致｜receipt 唔存在');
  const subdir = join(repo, 'not-a-worktree');
  await mkdir(subdir);
  assert.match((await complete(subdir)).lines[0], /HEAD UNKNOWN/);
});

test('finished tickets retire after a week or past the newest 500; a ticket open under three hours stays', () => {
  const day = 86_400_000;
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const bench = new Bench(undefined, () => clock);
  const old = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '舊單（會完成）' });
  const stuck = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '一直未完成' });
  bench.done(old.id, hikaru.sessionId, 'ok');
  clock += 6 * day;
  const fresh = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '新單' });
  assert.ok(bench.get(old.id), '6 days after finishing it is still there');
  clock += 2 * day;
  bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '再派一張' });
  assert.equal(bench.get(old.id), undefined, 'finished 8 days ago: gone');
  // Rule changed by the Founder (2026-11-17): an unfinished task is closed by itself after 3 hours instead of staying forever.
  assert.equal(bench.get(stuck.id)?.status, 'done', 'an open ticket 8 days old was closed by itself long before');
  assert.ok(bench.get(stuck.id)?.expiredAt);
  // A completion note nobody read for a week goes too.
  assert.equal(bench.mine(hibiki.sessionId).length, 0, 'the unread completion note for the old ticket retired with it');
  assert.ok(bench.get(fresh.id));
  // Past 500 finished ones, the oldest finished go; a ticket that is still open and under three hours old is kept.
  const stuckNow = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '仍然未完成（未夠 3 小時）' });
  for (let index = 0; index < 520; index++) { const ticket = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: `批量 ${index}` }); bench.done(ticket.id, hikaru.sessionId); }
  bench.retire();
  const all = bench.open('g').length;
  assert.ok(bench.get(stuckNow.id), 'still there');
  assert.ok(all >= 2, 'the open tickets are all still listed');
  const finished = (bench as any).data.tickets.filter((ticket: { status: string; kind: string }) => ticket.status === 'done' || (ticket.kind === 'done' && ticket.status === 'seen')).length;
  assert.ok(finished <= 500, `finished tickets are capped (${finished})`);
});

test('a lapsed claim and an empty ping record are let go', () => {
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const bench = new Bench(undefined, () => clock);
  bench.claim('g', hikaru, 'Sources/');
  bench.notePing(hibiki.sessionId);
  clock += 13 * 3_600_000;
  assert.equal(bench.retire(), true);
  assert.deepEqual((bench as any).data.claims, []);
  assert.deepEqual((bench as any).data.pings, {});
});

test('a task or reply open for more than three hours closes by itself; fresher ones and sender-side notes are left alone', async () => {
  const { escalateUnread } = await import('./bench-server');
  const hour = 3_600_000;
  let clock = Date.parse('2026-11-17T00:00:00Z');
  const bench = new Bench(undefined, () => clock);
  const { value } = deps([], []);
  value.bench = bench;
  const task = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '一張未完成嘅任務' });
  bench.takeNew(hikaru.sessionId);
  const reply = bench.send({ groupId: 'g', from: hikaru, to: hibiki, body: '一張從來冇人讀嘅回覆', replyTo: task.id });
  clock += 3 * hour - 60_000;
  bench.sweep();
  assert.equal(bench.get(task.id)?.status, 'seen', 'under three hours: still open');
  assert.equal(bench.mine(hikaru.sessionId).length, 1);
  clock += 2 * 60_000;
  assert.deepEqual(escalateUnread(value), [], 'maintenance closes old work before escalating');
  const closedTask = bench.get(task.id)!, closedReply = bench.get(reply.id)!;
  assert.equal(closedTask.status, 'done');
  assert.ok(closedTask.expiredAt && closedTask.doneAt === closedTask.expiredAt);
  assert.match(closedTask.note ?? '', /自動結案：超過 3 小時未完成/);
  assert.match(closedReply.note ?? '', /自動結案：超過 3 小時未讀取/, 'a ticket nobody ever read says so');
  assert.equal(bench.mine(hikaru.sessionId).length, 0);
  assert.equal(bench.openFrom(hikaru.sessionId).length, 0);
  assert.equal(bench.mine(hibiki.sessionId).length, 0, 'closing for age sends no notice to anyone');
});

test('finishing a ticket the Bridge closed for age still completes it and tells the sender', () => {
  let clock = Date.parse('2026-11-17T00:00:00Z');
  const bench = new Bench(undefined, () => clock);
  const task = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '做咗好耐嘅工作' });
  clock += 4 * 3_600_000;
  bench.sweep();
  assert.ok(bench.get(task.id)?.expiredAt);
  const { ticket, notice } = bench.done(task.id, hikaru.sessionId, '終於完成');
  assert.equal(ticket.status, 'done');
  assert.equal(ticket.expiredAt, undefined, 'a real completion replaces the auto close');
  assert.equal(ticket.note, '終於完成');
  assert.equal(notice?.to.sessionId, hibiki.sessionId, 'the sender gets the completion note');
  assert.throws(() => bench.done(task.id, hikaru.sessionId, '再做一次'), /已完成/, 'a real completion cannot be repeated');
});

test('only a decision for the Founder becomes a toast: the five-hop limit does, a refused route does not', () => {
  const bench = new Bench();
  let ticket = bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '開始' });
  for (let hop = 2; hop <= benchLimits.hops; hop++) {
    ticket = bench.send({ groupId: 'g', from: hop % 2 ? hibiki : hikaru, to: hop % 2 ? hikaru : hibiki, body: `回合 ${hop}`, replyTo: ticket.id });
  }
  const limit = (() => { try { bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '再來', replyTo: ticket.id }); } catch (error) { return error as BenchError; } })();
  assert.equal(limit?.stop, true);
  assert.equal(limit?.toast, true, 'the Founder has to decide past the hop limit');
  assert.equal(new BenchError('x', true, 'ROLE_NO_ELIGIBLE').toast, false, 'a refused route stays with the agents');
});

test('a task its idle recipient read but never finished is reminded twice, then reported once to the lead and the Founder', async () => {
  const { stalledWake, escalateStalled } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const worker = room(hikaru, { status: 'idle' });
  const { value, notes, notices } = deps([lead, worker], [{ ...group('g', lead, worker), orchestratorRoomId: lead.id } as GroupChat]);
  value.bench = new Bench(undefined, () => clock);
  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '長任務', body: '做 X' });
  value.bench.takeNew(hikaru.sessionId);
  clock += 14 * minute;
  assert.equal(stalledWake(value, worker, 14 * minute), undefined, 'under 15 minutes: nothing yet');
  clock += 2 * minute;
  assert.equal(stalledWake(value, worker, 5 * minute), undefined, 'the member only just went idle');
  const first = stalledWake(value, worker, 16 * minute)!;
  assert.match(first.text, /^\[交接｜來自 工作台\] 工單提示：#1「長任務」仍未完成/);
  assert.ok(first.text.includes(`bench done <編號> --from ${hikaru.sessionId}`));
  assert.equal(first.authorizeBenchInput(), true);
  first.finish(true);
  assert.equal(value.bench.get(task.id)?.nudges, 1);
  assert.equal(stalledWake(value, worker, 16 * minute), undefined, 'the next reminder waits another 15 minutes');
  clock += 15 * minute;
  stalledWake(value, worker, 31 * minute)!.finish(true);
  assert.equal(value.bench.get(task.id)?.nudges, 2);
  clock += 15 * minute;
  assert.equal(stalledWake(value, worker, 46 * minute), undefined, 'two reminders is the limit');
  assert.deepEqual(escalateStalled(value, worker, 46 * minute), [task.id]);
  assert.deepEqual(notes.map(([id]) => id), [lead.id], 'the lead room is told');
  assert.equal(notices.length, 1, 'the Founder is told once');
  assert.match(notices[0], /已提示 2 次仍未回應/);
  assert.deepEqual(escalateStalled(value, worker, 60 * minute), [], 'reported only once');
  clock += 3 * 3_600_000;
  value.bench.sweep();
  assert.equal(value.bench.get(task.id)?.status, 'done', 'the three-hour close is still the backstop');
});

test('only a reply from the recipient on this task postpones its reminder, including a reserved reminder', async () => {
  const { stalledWake, escalateStalled } = await import('./bench-server');
  const delay = benchLimits.stall.idleMs;
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const worker = room(hikaru, { status: 'idle' });
  const { value } = deps([room(hibiki), worker], [group('g', room(hibiki), worker)]);
  value.bench = new Bench(undefined, () => clock);
  const parties = { groupId: 'g', from: hibiki, to: hikaru };
  const task = value.bench.send({ ...parties, body: 'work' });
  value.bench.takeNew(hikaru.sessionId);
  clock += delay;
  value.bench.send({ ...parties, replyTo: task.id, body: 'sender follow-up' });
  const reserved = stalledWake(value, worker, delay)!;
  const progress = () => value.bench.send({ ...parties, from: hikaru, to: hibiki, replyTo: task.id, body: 'progress' });
  progress();
  assert.equal(reserved.authorizeBenchInput(), false);
  reserved.finish(false);
  assert.equal(stalledWake(value, worker, delay), undefined);
  for (let i = 0; i < benchLimits.stall.nudges; i++) {
    clock += delay;
    stalledWake(value, worker, delay)!.finish(true);
  }
  clock += delay;
  progress();
  assert.deepEqual(escalateStalled(value, worker, delay), []);
  clock += delay;
  assert.deepEqual(escalateStalled(value, worker, delay), [task.id]);
});

test('a stall reminder is sent after its own paste marks the room busy, and a refused Enter still counts, so the box is not filled again', async () => {
  const { stalledWake } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-20T04:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const worker = room(hikaru, { status: 'idle' });
  const { value } = deps([lead, worker], [{ ...group('g', lead, worker), orchestratorRoomId: lead.id } as GroupChat]);
  value.bench = new Bench(undefined, () => clock);
  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '長任務', body: '做 X' });
  value.bench.takeNew(hikaru.sessionId);
  clock += 16 * minute;
  const first = stalledWake(value, worker, 16 * minute)!;
  assert.equal(first.authorizeBenchInput('paste'), true);
  // The Bridge sets these itself when it types the reminder (before Enter).
  Object.assign(worker, { ready: false, status: 'running' });
  assert.equal(first.authorizeBenchInput('submit'), true, 'the reminder\'s own paste does not block its Enter');
  first.finish(true);
  assert.equal(value.bench.get(task.id)?.nudges, 1);

  Object.assign(worker, { ready: true, status: 'idle' });
  clock += 15 * minute;
  const second = stalledWake(value, worker, 31 * minute)!;
  assert.equal(second.authorizeBenchInput('paste'), true);
  worker.menu = { id: 'm' } as TerminalRoom['menu'];
  assert.equal(second.authorizeBenchInput('submit'), false, 'a menu that opened after the paste still stops Enter');
  second.finish(false);
  assert.equal(value.bench.get(task.id)?.nudges, 2, 'the pasted reminder counts, so it is not typed again a minute later');
  worker.menu = undefined;
  clock += minute;
  assert.equal(stalledWake(value, worker, 32 * minute), undefined);

  const third = room(hikaru, { status: 'idle' });
  const other = deps([lead, third], [{ ...group('g2', lead, third), orchestratorRoomId: lead.id } as GroupChat]).value;
  other.bench = new Bench(undefined, () => clock);
  const unpasted = other.bench.send({ groupId: 'g2', from: hibiki, to: hikaru, title: '另一單', body: '做 Y' });
  other.bench.takeNew(hikaru.sessionId);
  clock += 16 * minute;
  const refused = stalledWake(other, third, 16 * minute)!;
  third.menu = { id: 'm' } as TerminalRoom['menu'];
  assert.equal(refused.authorizeBenchInput('paste'), false);
  refused.finish(false);
  assert.equal(other.bench.get(unpasted.id)?.nudges, undefined, 'nothing was typed, so it is tried again later');
});

test('a member is not reminded while working, waiting for the Founder, closed or at the hourly cap; replies and unread tickets are not reminded', async () => {
  const { stalledWake, escalateStalled } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const worker = room(hikaru, { status: 'idle' });
  const { value, notices } = deps([lead, worker], [group('g', lead, worker)]);
  value.bench = new Bench(undefined, () => clock);
  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '做 X' });
  value.bench.takeNew(hikaru.sessionId);
  clock += 20 * minute;
  assert.equal(stalledWake(value, { ...worker, ready: false }, 20 * minute), undefined, 'working');
  assert.equal(stalledWake(value, { ...worker, status: 'running' }, 20 * minute), undefined, 'not idle');
  assert.equal(stalledWake(value, { ...worker, live: false }, 20 * minute), undefined, 'closed: no room is opened for a reminder');
  assert.equal(stalledWake(value, { ...worker, pendingApproval: { id: 'a' } as TerminalRoom['pendingApproval'] }, 20 * minute), undefined, 'waiting for the Founder');
  assert.equal(stalledWake(value, { ...worker, menu: { id: 'm' } as TerminalRoom['menu'] }, 20 * minute), undefined, 'a menu is open');
  assert.deepEqual(escalateStalled(value, { ...worker, ready: false }, 20 * minute), []);
  for (let index = 0; index < benchLimits.pingsPerHour; index++) value.bench.notePing(hikaru.sessionId);
  assert.equal(stalledWake(value, worker, 20 * minute), undefined, 'at the hourly cap');
  assert.deepEqual(notices, [], 'and it says nothing');
  // A reply is an answer, not work somebody owes; it is left to the three-hour close.
  value.bench.done(task.id, hikaru.sessionId, 'ok');
  const reply = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '回覆', replyTo: task.id });
  value.bench.takeNew(hikaru.sessionId);
  clock += 20 * minute;
  assert.equal(stalledWake(value, room(hikaru, { status: 'idle' }), 20 * minute), undefined);
  assert.ok(value.bench.get(reply.id));
});

test('a ticket nobody read for three minutes is delivered again to an idle recipient, and a fresher one is not', async () => {
  const { retryUnreadWake } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const plain = room(hitomi, { status: 'idle', benchHooked: false });
  const { value } = deps([lead, plain], [group('g', lead, plain)]);
  value.bench = new Bench(undefined, () => clock);
  value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '給瞳的全文' });
  clock += benchLimits.stall.unreadMs - minute;
  assert.equal(retryUnreadWake(value, plain), undefined, 'one minute under the limit');
  clock += 2 * minute;
  const again = retryUnreadWake(value, plain)!;
  assert.match(again.text, /給瞳的全文/);
  again.finish(true);
  assert.equal(value.bench.get(1)?.status, 'seen');
  assert.equal(retryUnreadWake(value, plain), undefined, 'delivered: nothing left to retry');
});

test('completion and reply wakes bypass the cap while tasks remain limited, including mixed idle batches', async () => {
  const { idleWake } = await import('./bench-server');
  const lead = room(hibiki, { status: 'idle', benchHooked: false });
  const worker = room(hitomi, { status: 'idle' });
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: 'work' });
  const done = value.bench.done(task.id, hitomi.sessionId, 'done').notice!;
  const reply = value.bench.send({ groupId: 'g', from: hitomi, to: hibiki, replyTo: task.id, body: 'reply' });
  const ordinary = value.bench.send({ groupId: 'g', from: hitomi, to: hibiki, body: 'ordinary' });
  for (let i = 0; i < benchLimits.pingsPerHour; i++) value.bench.notePing(hibiki.sessionId);
  assert.equal(value.bench.reservePing([hibiki.sessionId], [ordinary.id]), undefined);
  for (const ticket of [done, reply]) {
    const id = value.bench.reservePing([hibiki.sessionId], [ticket.id])!;
    assert.ok(id);
    value.bench.finishPing(id, true);
  }
  const wake = idleWake(value, lead)!;
  assert.match(wake.text, /done/);
  assert.match(wake.text, /reply/);
  assert.doesNotMatch(wake.text, /ordinary/);
  wake.finish(true);
  assert.equal(value.bench.get(ordinary.id)?.status, 'new');
  assert.equal(value.bench.pingAllowed(hibiki.sessionId), false);
});

test('finishing and replying through the workbench still wake an idle capped sender', () => {
  const lead = room(hibiki, { status: 'idle' });
  const worker = room(hitomi, { status: 'idle' });
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });
  const task = call('send', { from: hibiki.sessionId, to: hitomi.sessionId, body: 'work' });
  assert.ok(task.ping);
  for (let i = 0; i < benchLimits.pingsPerHour; i++) value.bench.notePing(hibiki.sessionId);
  const reply = call('send', { from: hitomi.sessionId, to: hibiki.sessionId, replyTo: task.ping!.ticket, body: 'reply' });
  assert.ok(reply.ping, 'reply is not held by the cap');
  const done = call('done', { from: hitomi.sessionId, id: task.ping!.ticket, note: 'complete' });
  assert.ok(done.ping, 'completion is not held by the cap');
  assert.equal(value.bench.pingAllowed(hibiki.sessionId), false);
});

test('an unread completion gets at most one automatic retry, including after failure', async () => {
  const { retryUnreadWake, startClosedRecipient } = await import('./bench-server');
  let clock = Date.parse('2026-11-17T12:00:00Z');
  const lead = room(hibiki, { status: 'idle', benchHooked: false });
  const worker = room(hitomi, { status: 'idle' });
  const { value } = deps([lead, worker], [group('g', lead, worker)]);
  value.bench = new Bench(undefined, () => clock);
  const task = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: 'work' });
  const completion = value.bench.done(task.id, hitomi.sessionId, 'done').notice!;
  clock += benchLimits.stall.unreadMs;
  assert.equal(retryUnreadWake(value, { ...lead, menu: { id: 'm' } as TerminalRoom['menu'] }), undefined);
  assert.equal(value.bench.get(completion.id)?.completionRetriedAt, undefined, 'an open menu must not spend the retry');
  const closed = { ...lead, live: false, resumable: true } as TerminalRoom;
  assert.equal(startClosedRecipient(value, closed), true);
  assert.equal(startClosedRecipient(value, closed), false);
  const retry = retryUnreadWake(value, lead)!;
  retry.finish(false);
  assert.ok(value.bench.get(completion.id)?.completionRetriedAt);
  assert.equal(retryUnreadWake(value, lead), undefined);
  clock += benchLimits.stall.unreadMs * 2;
  assert.equal(startClosedRecipient(value, closed), false);
});

test('a member that changes rooms keeps its unfinished tickets, and finished ones stay as history', () => {
  const bench = new Bench();
  const next: BenchParty = { sessionId: 'bbbbbbbb-0000-4000-8000-000000000009', roomName: 'CLI app', modelId: 'CLAUDE' };
  const toHibiki = bench.send({ groupId: 'g', from: hikaru, to: hibiki, body: '請看 diff' });
  const fromHibiki = bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '請畫圖' });
  const finished = bench.send({ groupId: 'g', from: hikaru, to: hibiki, body: '舊單' });
  const completion = bench.done(finished.id, hibiki.sessionId, 'ok').notice!;
  const unrelated = bench.send({ groupId: 'g', from: hikaru, to: hitomi, body: '無關' });
  const moved = bench.retarget([hibiki.sessionId, 'room-id-not-used'], next);
  assert.deepEqual(moved.sort(), [toHibiki.id, fromHibiki.id, completion.id].sort(), 'the completion note this member wrote and nobody has read yet moves too');
  assert.equal(bench.get(toHibiki.id)!.to.sessionId, next.sessionId);
  assert.equal(bench.get(fromHibiki.id)!.from.sessionId, next.sessionId);
  assert.equal(bench.mine(next.sessionId).length, 1, 'the new room finds the ticket in its workbench');
  assert.equal(bench.mine(hibiki.sessionId).length, 0, 'the old room has nothing left');
  assert.equal(bench.get(finished.id)!.to.sessionId, hibiki.sessionId, 'a finished ticket is history and keeps its old room');
  assert.equal(bench.get(unrelated.id)!.to.sessionId, hitomi.sessionId);
  assert.deepEqual(bench.retarget([hibiki.sessionId], next), [], 'nothing left to move');
  assert.deepEqual(bench.retarget([next.sessionId], next), [], 'a room cannot be moved onto itself');
});

test('a replacement Claude room starts with the model and effort of the room it replaces', () => {
  assert.equal(claudeModelFlag('Sonnet 5.5'), 'claude-sonnet-5-5');
  assert.equal(claudeModelFlag('Claude Opus 5.5'), 'claude-opus-5-5');
  assert.equal(claudeModelFlag('claude-haiku-5-5'), 'claude-haiku-5-5');
  assert.equal(claudeModelFlag('—'), undefined, 'an unknown name is left to the CLI default');
  assert.equal(claudeEffortFlag('ultra'), undefined, 'a level the flag does not take is left out');
  const room = { id: '66666666-0000-4000-8000-000000000006', modelId: 'CLAUDE', roomName: 'r', repoPath: '/tmp' } as unknown as TerminalRoom;
  const [, args] = cliLaunch(room, false, false, false, undefined, undefined, undefined, { model: 'claude-sonnet-5-5', effort: 'medium' });
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'claude-sonnet-5-5', '--effort', 'medium']);
  assert.deepEqual(args.slice(-2), ['--session-id', room.id], 'the room id stays its session id');
  assert.equal(cliLaunch(room, false)[1].includes('--model'), false, 'an ordinary room is launched as before');
});

test('a closed recipient with a ticket nobody read is started, a few times and spaced out, and nothing else is', async () => {
  const { startClosedRecipient } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const closed = room(hitomi, { live: false, resumable: true, ready: false, status: 'completed' });
  const { value } = deps([lead, closed], [group('g', lead, closed)]);
  value.bench = new Bench(undefined, () => clock);
  const ticket = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '請畫圖' });
  clock += benchLimits.stall.unreadMs - minute;
  assert.equal(startClosedRecipient(value, closed), false, 'under the unread limit (three minutes) the sender\'s own wake-up still has its chance');
  clock += 2 * minute;
  assert.equal(startClosedRecipient(value, closed), true, 'the wake-up did not get through: start the room');
  assert.equal(value.bench.get(ticket.id)!.nudges, 1);
  assert.equal(startClosedRecipient(value, closed), false, 'not again straight away');
  clock += 6 * minute;
  assert.equal(startClosedRecipient(value, closed), true, 'a second start later');
  clock += 6 * minute;
  assert.equal(startClosedRecipient(value, closed), false, 'then it waits for the recipient or the three-hour close');
  // Rooms that must not be started.
  const other = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '另一張' });
  clock += 6 * minute;
  assert.equal(startClosedRecipient(value, { ...closed, live: true } as TerminalRoom), false, 'an open room has the usual wake-up');
  assert.equal(startClosedRecipient(value, { ...closed, resumable: false } as TerminalRoom), false, 'a room that cannot be resumed');
  value.bench.markSeen(other.id);
  assert.equal(startClosedRecipient(value, closed), false, 'a ticket that was read is not unread any more');
});

test('a ticket nobody read for fifteen minutes is reported once to the lead, whether the recipient is closed or open', async () => {
  const { escalateUnread } = await import('./bench-server');
  const minute = 60_000;
  let clock = Date.parse('2026-11-18T12:00:00Z');
  const lead = room(hibiki, { status: 'idle' });
  const closed = room(hitomi, { live: false, resumable: true, ready: false, status: 'completed' });
  const crowned = { ...group('g', lead, closed), orchestratorRoomId: lead.id } as GroupChat;
  const { value } = deps([lead, closed], [crowned]);
  value.bench = new Bench(undefined, () => clock);
  const ticket = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '請畫圖', title: 'Demo iPhone' });
  clock += 14 * minute;
  assert.deepEqual(escalateUnread(value), [], 'under fifteen minutes');
  clock += 2 * minute;
  assert.deepEqual(escalateUnread(value), [ticket.id]);
  assert.ok(value.bench.get(ticket.id)!.escalatedAt);
  const told = value.bench.mine(hibiki.sessionId).find(item => item.kind === 'notice');
  assert.ok(told, 'the lead gets a notice ticket');
  assert.match(told!.body, /Demo iPhone.*15 分鐘仍未讀（CLI 未開）/);
  assert.deepEqual(escalateUnread(value), [], 'said once');
  // A read ticket, a reply nobody owes and a ticket for the lead itself are not reported.
  const read = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, body: '已讀' });
  value.bench.markSeen(read.id);
  const mine = value.bench.send({ groupId: 'g', from: hitomi, to: hibiki, body: '給隊長' });
  clock += 20 * minute;
  assert.deepEqual(escalateUnread(value), []);
  assert.ok(mine.id);
});

test('a workbench file that cannot be read is never replaced by an empty start; it comes back when it can be read again', async () => {
  const { readFileSync, writeFileSync, chmodSync } = await import('node:fs');
  const dir = await mkdtemp(join(tmpdir(), 'bench-unreadable-'));
  try {
    const path = join(dir, 'bench.json');
    const first = new Bench(path);
    first.send({ groupId: 'g', from: hibiki, to: hikaru, body: '第一張' });
    first.send({ groupId: 'g', from: hibiki, to: hikaru, body: '第二張', kind: 'notice' });
    const original = readFileSync(path, 'utf8');

    chmodSync(path, 0o000);
    const blind = new Bench(path);
    assert.match(blind.problem() ?? '', /EACCES|permission/i);
    assert.throws(() => blind.send({ groupId: 'g', from: hibiki, to: hikaru, body: '新票' }), /暫時讀不到/);
    assert.deepEqual(blind.takeNew(hikaru.sessionId), [], 'nothing is handed over from an empty view');
    chmodSync(path, 0o600);
    assert.equal(readFileSync(path, 'utf8'), original, 'the file is exactly as it was');

    const next = blind.send({ groupId: 'g', from: hibiki, to: hikaru, body: '新票' });
    assert.equal(next.id, 3, 'the old tickets are back, so the new id follows them');
    assert.equal(blind.problem(), undefined);
    assert.equal(blind.mine(hikaru.sessionId).length, 3);

    writeFileSync(path, '{ broken');
    const broken = new Bench(path);
    assert.ok(broken.problem());
    assert.throws(() => broken.send({ groupId: 'g', from: hibiki, to: hikaru, body: 'x' }), /暫時讀不到/);
    assert.equal(readFileSync(path, 'utf8'), '{ broken', 'a damaged file is kept for repair, not overwritten');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a ticket whose save failed is not counted as handed over', async () => {
  const { chmodSync } = await import('node:fs');
  const dir = await mkdtemp(join(tmpdir(), 'bench-save-'));
  try {
    const path = join(dir, 'bench.json');
    const bench = new Bench(path);
    bench.send({ groupId: 'g', from: hibiki, to: hikaru, body: '要交付的票' });
    chmodSync(dir, 0o500);
    try {
      assert.deepEqual(bench.takeNew(hikaru.sessionId), [], 'the hand-over was not saved, so it did not happen');
      assert.equal(bench.mine(hikaru.sessionId)[0].status, 'new');
    } finally { chmodSync(dir, 0o700); }
    assert.equal(bench.takeNew(hikaru.sessionId).length, 1, 'it goes out at the next chance');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('only the sender cancels a ticket it sent; a read one leaves a stop notice, an unread one just goes, and a late done is refused', () => {
  const lead = room(hibiki);
  const worker = room(hikaru);
  const tester = room(hitomi);
  const { value, notes } = deps([lead, worker, tester], [group('g', lead, worker, tester)]);
  const call = (action: string, fields: Record<string, unknown>) => benchAction(value, { requestId: 'r', action, ...fields });
  const read = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '跑測試', body: '跑 R5' });
  value.bench.takeNew(hikaru.sessionId);
  const unread = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, title: '截圖', body: '截 iPad' });

  const stranger = call('cancel', { from: 'Xcode Testing 1', id: read.id });
  assert.equal(stranger.ok, false);
  assert.match(stranger.lines[0], /與你無關/);
  const recipient = call('cancel', { from: 'Komorebi CLI App', id: read.id });
  assert.equal(recipient.ok, false, 'the recipient cannot cancel either');
  assert.match(recipient.lines[0], /只有派單方/);

  const first = call('cancel', { from: 'CLI app', id: read.id, note: '已由隊長自己重跑' });
  assert.equal(first.ok, true);
  assert.match(first.lines[0], /停手通知/);
  assert.equal(value.bench.get(read.id)?.status, 'done');
  assert.match(value.bench.get(read.id)?.note ?? '', /^已取消：已由隊長自己重跑/);
  const stop = value.bench.mine(hikaru.sessionId);
  assert.equal(stop.length, 1);
  assert.equal(stop[0].kind, 'notice');
  assert.match(stop[0].body, /請停手/);
  assert.ok(notes.some(([id, line]) => id === worker.id && /已被 .* 取消/.test(line)));

  const second = call('cancel', { from: 'CLI app', id: unread.id });
  assert.match(second.lines[0], /對方未讀/);
  assert.deepEqual(value.bench.mine(hitomi.sessionId), [], 'an unread ticket leaves nothing behind');

  assert.match(call('cancel', { from: 'CLI app', id: read.id }).lines[0], /已經結束/);
  const late = call('done', { from: 'Komorebi CLI App', id: read.id, note: 'PASS' });
  assert.equal(late.ok, false);
  assert.match(late.lines[0], /已被派單方取消/);
  assert.deepEqual(value.bench.mine(hibiki.sessionId), [], 'the lead gets no completion note for a cancelled ticket');
});

test('a DONE final report from the lead cancels only the open tickets the lead sent in that group', async () => {
  const { cancelLeadTickets } = await import('./bench-server');
  const lead = room(hibiki);
  const worker = room(hikaru);
  const tester = room(hitomi);
  const { value, notes } = deps([lead, worker, tester], [{ ...group('g', lead, worker, tester), orchestratorRoomId: lead.id } as GroupChat, group('h', lead, worker)]);
  const open = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '仍開', body: 'x' });
  const finished = value.bench.send({ groupId: 'g', from: hibiki, to: hitomi, title: '已完成', body: 'y' });
  value.bench.done(finished.id, hitomi.sessionId, 'PASS');
  const members = value.bench.send({ groupId: 'g', from: hikaru, to: hitomi, title: '組員之間', body: 'z' });
  const otherGroup = value.bench.send({ groupId: 'h', from: hibiki, to: hikaru, title: '另一組', body: 'w' });
  const postal = value.bench.send({ groupId: 'g', from: hibiki, to: hikaru, title: '通知', body: 'postal', purpose: 'persona-notice' });

  assert.deepEqual(cancelLeadTickets(value, 'g', lead), [open.id]);
  assert.equal(value.bench.get(open.id)?.status, 'done');
  assert.match(value.bench.get(open.id)?.note ?? '', /最後報告/);
  assert.equal(value.bench.get(finished.id)?.note, 'PASS', 'a finished ticket is untouched');
  assert.equal(value.bench.get(members.id)?.status, 'new', 'a member\'s own ticket is not the lead\'s to cancel');
  assert.equal(value.bench.get(otherGroup.id)?.status, 'new', 'another group is untouched');
  assert.equal(value.bench.get(postal.id)?.status, 'new', 'a Bridge persona notice survives the same final report');
  assert.ok(notes.some(([id, line]) => id === lead.id && line.includes(`#${open.id}`)));
  assert.deepEqual(cancelLeadTickets(value, 'g', lead), [], 'nothing twice');
});

test('only a report whose own verdict is DONE counts as final', async () => {
  const { reportIsDone } = await import('../src/utils/attentionDiff');
  assert.equal(reportIsDone('**Result** ...\nRESULT — DONE'), true);
  assert.equal(reportIsDone('RESULT: done'), true);
  assert.equal(reportIsDone('RESULT — STOP'), false);
  assert.equal(reportIsDone('RESULT — INCOMPLETE'), false);
  assert.equal(reportIsDone('瞳 said RESULT — DONE for #12.\nRESULT — INCOMPLETE'), false, 'a quoted member verdict does not count');
  assert.equal(reportIsDone('all done'), false);
});

test('three CLI recipients return the same structured acceptance via existing completion fields', async () => {
  const { acceptanceOptions } = await import('../scripts/bench-acceptance');
  const bench = new Bench();
  for (const [i, to] of [hikaru, hibiki, hitomi].entries()) {
    const from = to === hibiki ? hikaru : hibiki;
    const task = bench.send({ from, to, groupId: 'trial', body: 'check' });
    const report = { branch: null, exitCode: i === 2 ? null : i, commit: i ? 'a'.repeat(40) : null, check: 'npm test', result: ['PASS', 'FAIL', 'SKIP'][i], evidence: '/tmp/test report.md' };
    const { note, receipt } = acceptanceOptions(JSON.stringify(report));
    const done = bench.done(task.id, to.sessionId, note, receipt);
    assert.deepEqual(JSON.parse(done.ticket.note!), report);
    assert.equal(done.ticket.receipt, report.evidence);
    assert.ok(done.notice?.body.includes(report.result));
    assert.throws(() => acceptanceOptions(JSON.stringify({ ...report, commit: 'main' })));
  }
});

test('Bridge checks reported Git objects and readable evidence before closing a checked ticket', async () => {
  const { benchRequest } = await import('./bench-server');
  const { BenchExperience, readExperience, readExperienceInput } = await import('./bench-experience');
  const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'bench-checked-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'trial');
    git('-c', 'user.email=bench@example.invalid', '-c', 'user.name=Bench', 'commit', '-qm', 'trial', '--allow-empty');
    const sha = git('rev-parse', 'HEAD');
    const worker = room(hikaru);
    const lead = room(hibiki);
    const { value } = deps([worker, lead], [group('g', worker, lead)]);
    const log = join(dir, 'experience.jsonl');
    const journal = new BenchExperience(log, 'g');
    value.bench = new Bench(join(dir, 'bench.json'), undefined, changes => journal.record(changes));
    const task = value.bench.send({ to: hikaru, from: hibiki, groupId: 'g', body: 'verify', repo: dir });
    const report = { commit: sha, branch: 'trial', result: 'PASS', exitCode: 0, check: 'test', evidence: join(dir, '.git/HEAD') };
    const submit = (override: object) => benchRequest(value, { requestId: 't', action: 'done-checked', from: hikaru.sessionId, id: task.id, note: JSON.stringify({ ...report, ...override }) });
    for (const invalid of [{ commit: '0'.repeat(40) }, { branch: 'missing' }, { exitCode: 1 }, { evidence: dir }, { evidence: join(dir, 'missing') }]) {
      assert.equal((await submit(invalid)).ok, false);
      assert.equal(task.status, 'new');
    }
    assert.equal(readExperience(readExperienceInput(log)).events.length, 1);
    assert.equal((await submit({})).ok, true);
    assert.deepEqual(JSON.parse(task.note!).report, report);
    assert.equal(JSON.parse(task.note!).review, 'pending');
    assert.ok(task.receiptProof?.sha256);
    // A note with the same shape and a readable receipt is still an ordinary, unverified completion.
    const ordinary = value.bench.send({ to: hikaru, from: hibiki, groupId: 'g', body: 'ordinary', repo: dir });
    assert.equal((await benchRequest(value, { requestId: 't', action: 'done', from: hikaru.sessionId, id: ordinary.id,
      note: task.note, receipt: report.evidence })).ok, true);
    const evidence = readExperience(readExperienceInput(log)).events.filter(row => row.event === 'acceptance_reported');
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].ticketId, task.id);
    assert.equal(evidence[0].evidenceSha256, task.receiptProof?.sha256);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Claude compact hook restores open work without consuming new tickets', () => {
  const lead = room(hibiki), worker = room(hikaru);
  const g = group('compact', lead, worker);
  g.orchestratorRoomId = lead.id;
  g.members[0].role = { key: 'review' };
  const { value } = deps([lead, worker], [g]);
  assert.deepEqual(benchHook(value, 'claude', { session_id: hibiki.sessionId, hook_event_name: 'SessionStart', source: 'compact' }), {});
  value.bench.send({ groupId: 'compact', from: hikaru, to: hibiki, title: 'Review work', body: 'details', repo: '/missing', boundary: 'Only review', receipt: 'Review/T/HANDOFF.md' });
  value.bench.send({ groupId: 'compact', from: hibiki, to: hikaru, title: 'Delegated work', body: 'details' });
  const input = { session_id: hibiki.sessionId, hook_event_name: 'SessionStart', source: 'compact' };
  const result = benchHook(value, 'claude', input) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(result.hookSpecificOutput.additionalContext, /Review work/);
  assert.match(result.hookSpecificOutput.additionalContext, /Delegated work \(sent\)/);
  assert.match(result.hookSpecificOutput.additionalContext, /Only review/);
  assert.match(result.hookSpecificOutput.additionalContext, /checkout: unavailable/);
  assert.equal(value.bench.mine(hibiki.sessionId)[0].status, 'new');
  assert.deepEqual(benchHook(value, 'claude', { ...input, source: 'startup' }), {});
  assert.deepEqual(benchHook(value, 'codex', input), {});
});

test('compact context has a strict byte limit, hides unrelated groups and records no invented boundary', () => {
  const lead = room(hibiki), worker = room(hikaru);
  const g = group('compact', lead, worker);
  const { value } = deps([lead, worker], [g]);
  for (let n = 0; n < 12; n++) value.bench.send({ groupId: 'compact', from: hikaru, to: hibiki, title: '任'.repeat(80), body: 'x', boundary: '界'.repeat(120) });
  value.bench.send({ groupId: 'unrelated', from: hikaru, to: hibiki, title: 'private unrelated', body: 'x' });
  const result = JSON.stringify(benchHook(value, 'claude', { session_id: hibiki.sessionId, hook_event_name: 'SessionStart', source: 'compact' }));
  assert.ok(Buffer.byteLength(result) <= 2048);
  assert.match(result, /omitted/);
  assert.doesNotMatch(result, /private unrelated/);
});

test('compact context reads actual checkout and stop point without changing the worktree', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'compact-context-test-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base');
  await mkdir(join(dir, 'Review', 'Test'), { recursive: true });
  await writeFile(join(dir, 'Review', 'Test', 'PLAN.md'), '# Plan\n\n## Stop point\nContinue the bounded check.\n\n## Next\nDone.\n');
  const lead = room(hibiki), worker = room(hikaru);
  const { value } = deps([lead, worker], [group('compact', lead, worker)]);
  value.bench.send({ groupId: 'compact', from: hikaru, to: hibiki, title: 'Actual checkout', body: 'x', repo: dir, receipt: 'Review/Test/HANDOFF.md' });
  const result = benchHook(value, 'claude', { session_id: hibiki.sessionId, hook_event_name: 'SessionStart', source: 'compact' }) as { hookSpecificOutput: { additionalContext: string } };
  assert.match(result.hookSpecificOutput.additionalContext, new RegExp(`HEAD ${git('rev-parse', 'HEAD')}`));
  assert.match(result.hookSpecificOutput.additionalContext, /changed paths 1/);
  assert.match(result.hookSpecificOutput.additionalContext, /PLAN stop: Continue the bounded check\./);
});


test('Codex compact hook restores open work only for its own compact session', () => {
  const lead = room(hibiki), worker = room(hikaru);
  const { value } = deps([lead, worker], [group('codex-compact', lead, worker)]);
  value.bench.send({ groupId: 'codex-compact', from: hibiki, to: hikaru, title: 'Codex work', body: 'details' });
  const input = { session_id: hikaru.sessionId, hook_event_name: 'SessionStart', source: 'compact' };
  const result = benchHook(value, 'codex', input) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(result.hookSpecificOutput.additionalContext, /Codex work/);
  assert.equal(value.bench.mine(hikaru.sessionId)[0].status, 'new');
  assert.deepEqual(benchHook(value, 'codex', { ...input, source: 'startup' }), {});
  assert.deepEqual(benchHook(value, 'claude', input), {});
  const args = cliLaunch(worker, false, false, true, { hook: '/repo/scripts/bench-hook' })[1];
  assert.ok(args.some(arg => arg.startsWith('hooks.SessionStart=[{matcher="compact"')));
});


test('AGY restores live context once for each newly completed checkpoint, including after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-checkpoint-'));
  const transcript = join(dir, 'transcript.jsonl');
  const db = join(dir, 'bench.json');
  const lead = room(hibiki), worker = room(hitomi);
  const { value } = deps([lead, worker], [group('agy-compact', lead, worker)]);
  value.bench = new Bench(db);
  value.bench.send({ groupId: 'agy-compact', from: hibiki, to: hitomi, title: 'AGY work', body: 'details' });
  value.bench.takeNew(hitomi.sessionId);
  await writeFile(transcript, JSON.stringify({ step_index: 1, type: 'CHECKPOINT', status: 'DONE' }) + '\n');
  const input = { conversationId: hitomi.sessionId, hookEventName: 'PreInvocation', transcriptPath: transcript };
  assert.deepEqual(benchHook(value, 'agy', input), {}, 'old history is a baseline');
  await appendFile(transcript, '{"step_index":2,"type":"CHECKPOINT","status":"DONE"');
  assert.deepEqual(benchHook(value, 'agy', input), {}, 'incomplete line is not a checkpoint');
  await appendFile(transcript, '}\n');
  value.bench.send({ groupId: 'agy-compact', from: hibiki, to: hitomi, title: 'New ticket', body: 'new details' });
  const text = JSON.stringify(benchHook(value, 'agy', input));
  assert.match(text, /Live workbench/);
  assert.match(text, /New ticket/);
  assert.deepEqual(benchHook(value, 'agy', input), {}, 'checkpoint is delivered once');
  value.bench = new Bench(db);
  assert.deepEqual(benchHook(value, 'agy', input), {}, 'restart does not redeliver');
  await appendFile(transcript, JSON.stringify({ step_index: 3, type: 'CHECKPOINT', status: 'DONE' }) + '\n');
  assert.match(JSON.stringify(benchHook(value, 'agy', input)), /Live workbench/);
});
