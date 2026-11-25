import { mkdtempSync } from './test-temp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertMountedVolume, BridgeWorktrees, cleanupReasons, inspectWorktrees } from './auto-worktree';
import { Bench } from './bench';
import { benchRequest, type BenchDeps } from './bench-server';
import type { GroupChat, TerminalRoom } from '../src/types/guild';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-auto-worktree-'));
  const repo = join(dir, 'Repo With Spaces');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  git('config', 'user.name', 'Worktree Test');
  git('config', 'user.email', 'worktree@example.invalid');
  writeFileSync(join(repo, 'sample.txt'), 'fixture');
  git('add', 'sample.txt');
  git('commit', '-qm', 'fixture');
  return { dir, repo, git, registry: join(dir, 'registry.json'), base: join(dir, 'Worktrees') };
}

test('a plain directory on the system volume is not accepted as the external SSD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-not-a-volume-'));
  assert.throws(() => assertMountedVolume(dir), /未掛載/);
});

test('creates and records a ticket-specific git worktree on request', async () => {
  const f = fixture();
  const store = new BridgeWorktrees(f.registry, f.base);
  const item = await store.create(41, f.repo);
  assert.equal(item.branch, 'bridge/41');
  assert.equal(item.state, 'created');
  assert.equal(item.path, join(realpathSync(f.base), 'Repo With Spaces', '41'));
  assert.equal(f.git('rev-parse', 'bridge/41'), f.git('rev-parse', 'HEAD'));
  assert.equal(new BridgeWorktrees(f.registry, f.base).snapshot()[0].path, item.path);
  await assert.rejects(store.create(41, f.repo), /已有/);
});

test('the six-worktree cap includes reservations and refuses another creation', async () => {
  const f = fixture();
  writeFileSync(f.registry, JSON.stringify(Array.from({ length: 6 }, (_, index) => ({
    ticketId: index + 1, repo: f.repo, path: join(f.base, String(index)), branch: `bridge/${index + 1}`,
    ref: 'HEAD', state: 'reserved', createdAt: new Date(0).toISOString(),
  }))));
  const store = new BridgeWorktrees(f.registry, f.base);
  await assert.rejects(store.create(7, f.repo), /上限 6/);
  assert.equal(store.snapshot().length, 6);
});

test('a removed created worktree frees a slot while preserving its registry entry', async () => {
  const f = fixture();
  const store = new BridgeWorktrees(f.registry, f.base);
  const items = [];
  for (let id = 1; id <= 6; id++) items.push(await store.create(id, f.repo));
  await assert.rejects(store.create(7, f.repo), /Bridge worktree 已達上限 6，請先處理現有記錄。/);
  f.git('worktree', 'remove', items[0].path);
  const replacement = await store.create(7, f.repo);
  assert.equal(replacement.state, 'created');
  assert.deepEqual(store.snapshot().find(item => item.ticketId === 1), items[0]);
  assert.equal(store.snapshot().length, 7);
  await assert.rejects(store.create(8, f.repo), /Bridge worktree 已達上限 6，請先處理現有記錄。/);
});

test('existing created and failed worktrees and absent reservations all occupy slots', async () => {
  const f = fixture();
  mkdirSync(f.base);
  const records = Array.from({ length: 6 }, (_, index) => ({
    ticketId: index + 1, repo: f.repo, path: join(f.base, String(index)), branch: `bridge/${index + 1}`,
    ref: 'HEAD', state: index === 0 ? 'reserved' : index === 1 ? 'failed' : 'created', createdAt: new Date(0).toISOString(),
  }));
  for (const record of records.slice(1)) mkdirSync(record.path);
  writeFileSync(f.registry, JSON.stringify(records));
  const store = new BridgeWorktrees(f.registry, f.base);
  await assert.rejects(store.create(7, f.repo), /Bridge worktree 已達上限 6，請先處理現有記錄。/);
  assert.deepEqual(store.snapshot(), records);
});

test('a failed record with no directory does not occupy a slot', async () => {
  const f = fixture();
  const records = Array.from({ length: 6 }, (_, index) => ({
    ticketId: index + 1, repo: f.repo, path: join(f.base, String(index)), branch: `bridge/${index + 1}`,
    ref: 'HEAD', state: index === 0 ? 'failed' : 'reserved', createdAt: new Date(0).toISOString(),
  }));
  writeFileSync(f.registry, JSON.stringify(records));
  const store = new BridgeWorktrees(f.registry, f.base);
  assert.equal((await store.create(7, f.repo)).state, 'created');
  assert.deepEqual(store.snapshot()[0], records[0]);
});

test('concurrent requests cannot exceed the six-worktree cap', async () => {
  const f = fixture();
  writeFileSync(f.registry, JSON.stringify(Array.from({ length: 5 }, (_, index) => ({
    ticketId: index + 1, repo: f.repo, path: join(f.base, String(index)), branch: `bridge/${index + 1}`,
    ref: 'HEAD', state: 'reserved', createdAt: new Date(0).toISOString(),
  }))));
  const store = new BridgeWorktrees(f.registry, f.base);
  const other = new BridgeWorktrees(f.registry, f.base);
  const result = await Promise.allSettled([store.create(6, f.repo), other.create(7, f.repo)]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter(item => item.status === 'rejected').length, 1);
  assert.equal(store.snapshot().length, 6);
});

test('corrupt registry refuses new worktrees', async () => {
  const f = fixture();
  writeFileSync(f.registry, '{broken');
  const store = new BridgeWorktrees(f.registry, f.base);
  assert.equal(store.isReadable(), false);
  await assert.rejects(store.create(1, f.repo), /無法讀取/);
});

test('failed creation is recorded and never removes an existing worktree', async () => {
  const f = fixture();
  const store = new BridgeWorktrees(f.registry, f.base);
  await assert.rejects(store.create(3, f.repo, 'missing-ref'));
  assert.equal(store.snapshot()[0].state, 'failed');
  assert.equal(f.git('rev-parse', 'HEAD').length, 40);
});

test('every cleanup condition withholds the candidate independently', () => {
  const ok = { finished: true, oldEnough: true, clean: true, pushedOrMerged: true, running: false, protected: false, verified: true };
  assert.deepEqual(cleanupReasons(ok), []);
  for (const [key, value, reason] of [
    ['finished', false, 'unfinished'], ['oldEnough', false, 'tooRecent'], ['clean', false, 'dirty'],
    ['pushedOrMerged', false, 'unpushed'], ['running', true, 'running'], ['protected', true, 'protected'], ['verified', false, 'unverified'],
  ] as const) assert.deepEqual(cleanupReasons({ ...ok, [key]: value }), [reason]);
});

test('read-only inspection withholds a clean checkout without an upstream', async () => {
  const f = fixture();
  const store = new BridgeWorktrees(f.registry, f.base);
  const item = await store.create(4, f.repo);
  const [usage] = await inspectWorktrees([item], () => ({ finished: true, oldEnough: true, running: false, protected: false, verified: true }));
  assert.equal(usage.candidate, false);
  assert.deepEqual(usage.reasons, ['unpushed']);
  assert.ok(usage.bytes !== undefined && usage.bytes > 0);
  const main = f.git('symbolic-ref', '--short', 'HEAD');
  execFileSync('git', ['-C', item.path, 'branch', '--set-upstream-to', main, item.branch]);
  const [localUpstream] = await inspectWorktrees([item], () => ({ finished: true, oldEnough: true, running: false, protected: false, verified: true }));
  assert.ok(localUpstream.reasons.includes('unpushed'), 'a local upstream is not proof of a push');
  const remote = join(f.dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  f.git('remote', 'add', 'origin', remote);
  execFileSync('git', ['-C', item.path, 'push', '-qu', 'origin', item.branch]);
  const [pushed] = await inspectWorktrees([item], () => ({ finished: true, oldEnough: true, running: false, protected: false, verified: true }));
  assert.equal(pushed.candidate, true);
  writeFileSync(join(item.path, 'untracked.txt'), 'not removed');
  const [dirty] = await inspectWorktrees([item], () => ({ finished: true, oldEnough: true, running: false, protected: false, verified: true }));
  assert.ok(dirty.reasons.includes('dirty'));
});

test('a real opt-in workbench dispatch gives the member the created checkout and branch', async () => {
  const f = fixture();
  const store = new BridgeWorktrees(f.registry, f.base);
  const lead = { id: 'lead', roomName: 'Lead', modelId: 'CODEX', sessionId: 'lead-session', live: true, ready: true } as TerminalRoom;
  const member = { id: 'member', roomName: 'Member', modelId: 'AGY', sessionId: 'member-session', live: true, ready: false, benchHooked: true } as TerminalRoom;
  const group = { id: 'g', name: 'g', members: [{ roomId: lead.id, modelId: lead.modelId }, { roomId: member.id, modelId: member.modelId }] } as GroupChat;
  const deps: BenchDeps = { bench: new Bench(), rooms: () => [lead, member], groups: () => [group], tool: '/fixture', note: () => {}, notice: () => {}, createWorktree: (id, repo, ref) => store.create(id, repo, ref) };
  const result = await benchRequest(deps, { requestId: 'r', action: 'send', from: lead.id, to: member.id, repo: f.repo, body: 'implement', worktree: 'new' });
  assert.equal(result.ok, true);
  const [ticket] = deps.bench.takeNew(member.sessionId!);
  assert.equal(ticket.repo, store.snapshot()[0].path);
  assert.equal(ticket.ref, 'bridge/1');
  assert.equal(f.git('rev-parse', 'bridge/1'), f.git('rev-parse', 'HEAD'));
});
