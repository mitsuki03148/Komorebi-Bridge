import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { Bench, benchLimits } from './bench';
import { benchAction, benchHook, type BenchDeps } from './bench-server';

const from = { id: 'alpha', roomName: '工房甲', modelId: 'CODEX', sessionId: '11111111-1111-1111-1111-111111111111' } as TerminalRoom;
const to = { id: 'beta', roomName: '工房乙', modelId: 'CLAUDE', sessionId: '22222222-2222-2222-2222-222222222222' } as TerminalRoom;
const group = (id: string, boardPath?: string, members = [from, to]): GroupChat => ({
  id, name: id, createdAt: '', boardPath, members: members.map(room => ({ roomId: room.id, modelId: room.modelId })),
});

function workbench(groups: GroupChat[]) {
  const deps: BenchDeps = { groups: () => groups, rooms: () => [from, to], bench: new Bench(), tool: '/bin/komorebi-room', notice() {}, note() {} };
  const call = (action: string, fields: object) => benchAction(deps, { requestId: 'fixture', action, from: from.sessionId, ...fields });
  const send = (body: string, fields: object = {}) => call('send', { to: to.sessionId, body, ...fields });
  return { deps, bench: deps.bench, send, call };
}

test('only verify-gate notices may be sent to the same room', () => {
  const { call, bench } = workbench([group('g')]);
  const self = { to: from.sessionId, body: 'gate finished' };
  assert.equal(call('send', self).ok, false);
  assert.equal(call('send', { ...self, notify: true }).ok, false);
  assert.equal(call('send', { ...self, source: 'verify-gate' }).ok, false);
  assert.equal(call('send', { ...self, notify: true, source: 'other' }).ok, false);
  assert.equal(call('send', { ...self, notify: true, source: 'verify-gate' }).ok, true);
  assert.equal(bench.get(1)?.kind, 'notice');
});

test('background guidance is for Codex; changed-test guidance is for both rooms', () => {
  const deps: BenchDeps = { groups: () => [group('g')], rooms: () => [from, to], bench: new Bench(), tool: '/bin/komorebi-room', notice() {}, note() {} };
  const send = (sender: TerminalRoom, target: TerminalRoom) => benchAction(deps, { requestId: 'hint', action: 'send', from: sender.sessionId, to: target.sessionId, repo: '/fixture', body: 'work' });
  assert.equal(send(to, from).ok, true); assert.match(deps.bench.get(1)!.body, /--test-changed/); assert.match(deps.bench.get(1)!.body, /--background --from/);
  assert.equal(send(from, to).ok, true); assert.match(deps.bench.get(2)!.body, /--test-changed/); assert.doesNotMatch(deps.bench.get(2)!.body, /--background/);
});

test('new tasks persist a single board line for wake-up, show, and hook delivery; other actions are untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-task-board-'));
  try {
    const path = join(dir, 'Team Board.md');
    await writeFile(path, '# Team\nRev: C.3\nTask list');
    const { bench, deps, send, call } = workbench([group('g', path)]);
    const first = send('開工');
    const body = `開工\n告示版：${path}。Rev C.3。開工前讀一次。Rev 有變就重讀。`;
    assert.equal(first.ok, true);
    assert.equal(bench.get(1)?.body, body);
    assert.ok(first.ping?.text.includes(body), 'short wake-up includes the board line');
    assert.ok(JSON.stringify(benchHook(deps, 'claude', { session_id: to.sessionId })).includes('Rev C.3'));
    assert.ok(call('show', { from: to.sessionId, id: 1 }).lines[0].includes(body));
    assert.equal(send('開工\n  告示版：自訂').ok, true);
    assert.equal(bench.get(2)?.body, '開工\n  告示版：自訂');
    assert.equal(send('通知', { notify: true }).ok, true);
    assert.equal(bench.get(3)?.body, '通知');
    assert.equal(send('回覆', { replyTo: 1 }).ok, true);
    assert.equal(bench.get(4)?.body, '回覆');
    assert.equal(call('done', { from: to.sessionId, id: 1, note: '已完成' }).ok, true);
    assert.doesNotMatch(bench.get(5)!.body, /告示版/);
    assert.equal(send('  ').ok, false, 'board metadata does not turn an empty task into a valid task');
    assert.equal(send('x'.repeat(benchLimits.body)).ok, true);
    assert.equal(bench.get(6)?.body.length, benchLimits.body);
    assert.match(bench.get(6)!.body, /Rev C\.3。開工前讀一次。Rev 有變就重讀。$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('use the first shared board and do not pick a board from a group with only one party', () => {
  const privateGroup = group('private', '/private-board.md', [from]);
  const first = group('first', '/first-board.md');
  const second = group('second', '/second-board.md');
  const { bench, send } = workbench([privateGroup, first, second]);
  assert.equal(send('用共同告示版').ok, true);
  assert.match(bench.get(1)!.body, /告示版：\/first-board.md/);
  assert.equal(bench.get(1)?.groupId, first.id);
  delete first.boardPath;
  assert.equal(send('用下一份共同告示版').ok, true);
  assert.match(bench.get(2)!.body, /告示版：\/second-board.md/);
  delete second.boardPath;
  assert.equal(send('沒有共同告示版').ok, true);
  assert.equal(bench.get(3)?.body, '沒有共同告示版');
});

test('Rev searches only the first 40 lines and an unreadable board never blocks sending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-task-rev-'));
  try {
    const g = group('g', join(dir, 'late.md'));
    const { bench, send } = workbench([g]);
    await writeFile(g.boardPath!, 'notes\r\n'.repeat(39) + 'Rev: 40\r\nRev: 41\r\n');
    assert.equal(send('第 40 行').ok, true);
    assert.match(bench.get(1)!.body, /Rev 40。/);
    await writeFile(g.boardPath!, 'notes\n'.repeat(40) + 'Rev: 41\n');
    assert.equal(send('第 41 行').ok, true);
    assert.match(bench.get(2)!.body, /Rev 未知。/);
    g.boardPath = join(dir, 'missing.md');
    assert.equal(send('檔案唔存在').ok, true);
    assert.match(bench.get(3)!.body, /missing\.md。Rev 未知。/);
    g.boardPath = dir;
    assert.equal(send('唔係檔案').ok, true);
    assert.match(bench.get(4)!.body, /Rev 未知。/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
