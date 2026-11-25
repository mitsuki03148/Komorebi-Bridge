import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms, cliLaunch } from './rooms';

const codex = (extra = {}) => ({ id: 'c1', modelId: 'CODEX', roomName: 'R', repoPath: '/tmp', logs: [], sessionId: '11111111-1111-4111-8111-111111111111', remoteControl: {}, ...extra }) as unknown as TerminalRoom;

test('a Codex room is started with its own speed, Fast or standard, whatever the global setting says', () => {
  const fast = cliLaunch(codex(), false, false, false, undefined, undefined, true)[1];
  const standard = cliLaunch(codex(), false, false, false, undefined, undefined, false)[1];
  assert.ok(fast.includes('service_tier="priority"'));
  assert.ok(standard.includes('service_tier="default"'));
  assert.ok(fast.indexOf('resume') < fast.indexOf('service_tier="priority"'), 'it belongs to the resumed session\'s own arguments');
  assert.ok(!cliLaunch(codex(), false)[1].some(arg => arg.startsWith('service_tier')), 'a caller that gives no speed changes nothing');
  assert.ok(!cliLaunch({ ...codex(), modelId: 'CLAUDE' } as TerminalRoom, false, false, false, undefined, undefined, true)[1].some(arg => String(arg).startsWith('service_tier')), 'only Codex');
});

test('each room remembers its own speed, as seen on its footer, and keeps it across a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-fast-'));
  try {
    const path = join(dir, 'fast.json');
    const rooms = new Rooms(dir, () => {}) as any;
    rooms.useFastFile(path);
    const a = codex({ id: 'a' }), b = codex({ id: 'b' });
    rooms.noteFast(a, 'GPT-6.1-Sol high Fast · /x');
    rooms.noteFast(b, 'GPT-6.1-Sol high · /x');
    assert.equal(a.fastMode, true);
    assert.equal(b.fastMode, false);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: true, b: false });
    rooms.noteFast(b, 'nothing like a footer');
    assert.equal(b.fastMode, false, 'no footer on screen: nothing changes');
    rooms.noteFast(a, 'GPT-6.1-Sol high · /x');
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: false, b: false }, 'turning it off is remembered too');
    assert.equal(rooms.fastFor('a'), false);
    assert.equal(rooms.fastFor('never-seen'), false, 'a room nobody chose for starts standard');
    rooms.noteFast(a, 'GPT-6.1-Sol high Fast · /x');
    const again = new Rooms(dir, () => {}) as any;
    again.useFastFile(path);
    assert.equal(again.fastFor('a'), true);
    assert.equal(again.fastFor('b'), false);
    await writeFile(path, '{broken');
    const broken = new Rooms(dir, () => {}) as any;
    broken.useFastFile(path);
    assert.equal(broken.fastFor('a'), false, 'a damaged file means standard, not a crash');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('opening a Codex room passes its remembered speed to the launch', async () => {
  const rooms = await readFile(new URL('./rooms.ts', import.meta.url), 'utf8');
  assert.match(rooms, /room\.modelId === 'CODEX' \? this\.fastFor\(room\.id\) : undefined/);
  assert.match(rooms, /this\.noteFast\(room, screen\)/);
});

test('without a file the speeds are kept only in memory, so tests and other uses never write into the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-fast-'));
  try {
    const rooms = new Rooms(dir, () => {}) as any;
    const room = codex();
    rooms.noteFast(room, 'GPT-6.1-Sol high Fast · /x');
    assert.equal(rooms.fastFor('c1'), true);
    const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(server, /rooms\.useFastFile\(join\(project, '\.env\.komorebi-codex-fast\.json'\)\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
