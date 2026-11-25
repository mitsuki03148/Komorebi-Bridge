import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GroupViews } from './group-views';
import { Groups } from './groups';
import { groupWakeNotice, Rooms } from './rooms';
import { readSession } from './sessions';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { translateServerNoticeFor } from '../src/i18n/serverNotice';

const group = (id: string): GroupChat => ({
  id, name: id, createdAt: '', orchestratorRoomId: 'lead',
  members: ['lead', 'worker', 'another'].map(roomId => ({ roomId, modelId: 'CODEX' })),
});

function viewsFixture(open: (id: string, wanted: () => boolean) => Promise<void>) {
  const selection = new Map<string, string | null>();
  const views = new GroupViews<string>({
    connected: () => true, beginVisit: () => {},
    select: (client, roomId) => { selection.set(client, roomId); },
    hasRoom: () => true, canOpenEntry: () => true, open,
    failed: (_id, error) => assert.fail(String(error)),
  });
  const click = (client: string, team: GroupChat, roomId: string) => {
    const guard = views.selectMember(client, team, roomId);
    if (guard) return views.retry(roomId, guard);
  };
  return { views, click, selection };
}

test('only explicit member activation in the open group adds a wake; passive selections and updates do not', async () => {
  const wakes: string[] = [];
  const { views, click, selection } = viewsFixture(async (id, wanted) => { if (wanted()) wakes.push(id); });
  const g = group('DemoProject');
  await click('phone', g, 'worker');
  assert.deepEqual(wakes, [], 'a stale click is not an entry or a wake');
  await views.view('phone', g);
  assert.deepEqual(wakes, ['lead'], 'the old payload still enters on the crown only');
  await views.view('phone', g, 'worker');
  views.update({ ...g, name: 'Renamed' });
  await click('phone', g, 'outside');
  assert.equal(selection.get('phone'), 'worker');
  assert.deepEqual(wakes, ['lead'], 'passive selection and roster updates do not start the worker');
  await click('phone', g, 'worker');
  assert.deepEqual(wakes, ['lead', 'worker']);
  await views.view('phone', group('Other'));
  await click('phone', g, 'another');
  assert.deepEqual(wakes, ['lead', 'worker', 'lead'], 'a delayed event for the previous group cannot wake another room');
});

test('fast clicks share one launch and a switched-away explicit selection cancels before spawn', async () => {
  let unlock!: () => void;
  const paused = new Promise<void>(resolve => { unlock = resolve; });
  const attempts: string[] = [], spawns: string[] = [];
  const { views, click } = viewsFixture(async (id, wanted) => {
    attempts.push(id);
    if (id !== 'lead') await paused;
    if (wanted()) spawns.push(id);
  });
  const g = group('DemoProject');
  await views.view('phone', g);
  const first = click('phone', g, 'worker');
  const again = click('phone', g, 'worker');
  assert.equal(views.isOpening('worker'), true);
  const other = click('phone', g, 'another');
  views.leave('phone');
  await views.view('mac', g); // A second visit does not retain a stale explicit wake from the phone.
  const joined = click('mac', g, 'worker');
  unlock();
  await Promise.all([first, again, other, joined]);
  assert.equal(attempts.filter(id => id === 'worker').length, 1);
  assert.equal(spawns.filter(id => id === 'worker').length, 1);
  assert.ok(!spawns.includes('another'));
});

function verified(id = randomUUID(), sessionId = id) {
  return {
    id: 'session-codex-' + id, roomName: 'Stored room', modelId: 'CODEX', sessionId,
    ready: false, live: false, resumable: true, repoPath: process.cwd(), logs: [],
  } as unknown as TerminalRoom;
}

test('selection preflight refuses archive, deletion, no or unverified Session, and rechecks the exact original Session', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const ok = verified();
  const noSession = { ...verified(), sessionId: undefined };
  const unverified = verified(randomUUID(), randomUUID());
  const notResumable = { ...verified(), resumable: false };
  const archived = verified(), deleted = verified();
  for (const room of [ok, noSession, unverified, notResumable, archived, deleted]) rooms.rooms.set(room.id, room);
  (rooms as any).archivedKeys.add(archived.id);
  (rooms as any).deletedKeys.add(deleted.id);
  assert.equal(rooms.groupMemberWakeBlock(ok.id), undefined);
  assert.ok(rooms.canWakeGroupMember(ok.id, ok.sessionId));
  assert.equal(rooms.canWakeGroupMember(ok.id, randomUUID()), false);
  for (const room of [archived, deleted]) {
    assert.equal(rooms.groupMemberWakeBlock(room.id), 'archived');
    assert.equal(rooms.canWakeGroupMember(room.id, room.sessionId), false);
  }
  for (const room of [noSession, unverified, notResumable]) assert.equal(rooms.groupMemberWakeBlock(room.id), 'unverified');
  assert.equal(rooms.groupMemberWakeBlock('room-not-yet-synced'), 'unverified');
  (rooms as any).starting.add(ok.id);
  assert.equal(rooms.groupMemberWakeBlock(ok.id), 'starting');
  (rooms as any).starting.delete(ok.id);
  (rooms as any).live.set(ok.id, {});
  assert.equal(rooms.groupMemberWakeBlock(ok.id), 'open');
});

test('a selection cannot exceed the twelve CLI slots, including starts in flight', async () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const target = verified();
  rooms.rooms.set(target.id, target);
  for (let i = 0; i < 11; i++) (rooms as any).live.set('existing-' + i, {});
  assert.equal(rooms.groupMemberWakeBlock(target.id), undefined);
  (rooms as any).starting.add('twelfth');
  assert.equal(rooms.groupMemberWakeBlock(target.id), 'limit');
  await assert.rejects(rooms.openViewedRoom(target.id, () => true), /已開啟 12 個 CLI/);
  assert.equal(rooms.isOpen(target.id), false);
  assert.match(translateServerNoticeFor('en', groupWakeNotice.limit), /12 CLIs are open/);
});

test('fresh member activation still requires group membership, an empty history and a free CLI slot', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-fresh-wake-guards-'));
  try {
    const rooms = new Rooms(tmp, () => {});
    const [fresh, withHistory, archived, deleted, outsider] = await Promise.all(
      ['Fresh', 'History', 'Archived', 'Deleted', 'Outside'].map(name => rooms.ensureGroupMember('CODEX', name)),
    );
    rooms.retainGroupRooms([fresh, withHistory, archived, deleted].map(room => room.id));
    withHistory.logs.push({ id: 'old', sender: 'agent', timestamp: '—', text: 'Existing conversation' });
    (rooms as any).archivedKeys.add(archived.id);
    (rooms as any).deletedKeys.add(deleted.id);

    assert.equal(rooms.groupMemberWakeBlock(fresh.id), undefined);
    assert.equal(rooms.groupMemberWakeBlock(withHistory.id), 'unverified');
    assert.equal(rooms.groupMemberWakeBlock(outsider.id), 'unverified');
    assert.equal(rooms.groupMemberWakeBlock(archived.id), 'archived');
    assert.equal(rooms.groupMemberWakeBlock(deleted.id), 'archived');
    for (let i = 0; i < 11; i++) (rooms as any).live.set('existing-' + i, {});
    (rooms as any).starting.add('twelfth');
    assert.equal(rooms.groupMemberWakeBlock(fresh.id), 'limit');
    await assert.rejects(rooms.openViewedRoom(fresh.id, () => rooms.canWakeGroupMember(fresh.id, undefined, true)), /已開啟 12 個 CLI/);
    assert.equal(rooms.isOpen(fresh.id), false);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('an explicit tap starts a newly added CLI and binds its first transcript', { timeout: 8000 }, async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-fresh-group-')));
  const originalPath = process.env.PATH;
  const originalDirectory = process.cwd();
  process.chdir(tmp);
  const bin = join(tmp, 'bin');
  const sessionId = randomUUID();
  let markReady!: () => void, markDiscovered!: () => void, markExited!: () => void;
  const ready = new Promise<void>(resolve => { markReady = resolve; });
  const discovered = new Promise<void>(resolve => { markDiscovered = resolve; });
  const exited = new Promise<void>(resolve => { markExited = resolve; });
  const starts: string[] = [];
  let member: TerminalRoom | undefined;
  const rooms = new Rooms(tmp, event => {
    if (event.type !== 'ROOM') return;
    const { room } = event;
    if (room.currentActionSummary === 'CLI 啟動中') starts.push(room.id);
    if (room.id !== member?.id) return;
    if (room.ready) markReady();
    if (room.screen?.includes(sessionId)) markDiscovered();
    if (room.status === 'completed') markExited();
  });
  const groups = new Groups(join(tmp, 'groups.json'), () => {
    rooms.retainGroupRooms(groups.snapshot().flatMap(team => team.members.map(item => item.roomId)));
  }, id => rooms.rooms.get(id));
  const views = new GroupViews<string>({
    connected: () => true, beginVisit: () => {}, select: () => {},
    hasRoom: id => rooms.rooms.has(id),
    canOpenEntry: id => rooms.canWakeGroupMember(id, rooms.rooms.get(id)?.sessionId),
    open: (id, wanted) => rooms.openViewedRoom(id, wanted),
    failed: (_, error) => assert.fail(String(error)),
  });
  try {
    await mkdir(bin);
    await writeFile(join(bin, 'codex'), `#!/bin/sh
printf '› Ask Codex anything\\nGPT-test high · fixture\\n'
while IFS= read -r line; do
  case "$line" in
    *"first turn"*) printf '│ OpenAI Codex (v1.0) │\\n│ Directory: fixture │\\n│ Session: ${sessionId} │\\n› Ask Codex anything\\nGPT-test high · fixture\\n' ;;
  esac
done
`, { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    rooms.benchHook = join(tmp, 'bench-hook');
    const initial = await Promise.all([rooms.ensureGroupMember('CODEX', 'One'), rooms.ensureGroupMember('CODEX', 'Two')]);
    const roster = (room: TerminalRoom) => ({ roomId: room.id, modelId: room.modelId });
    const team = groups.create('Fresh group', initial.map(roster));
    member = await rooms.ensureGroupMember('CODEX', 'New member');
    groups.addMember(team.id, roster(member));
    const current = groups.get(team.id)!;
    const preflight = rooms.groupMemberWakeBlock(member.id);
    assert.equal(preflight, undefined, 'an empty member is eligible for an explicit wake');
    assert.equal(rooms.canWakeGroupMember(member.id, undefined), false, 'automatic entry still needs a confirmed session');
    await views.view('phone', current, member.id);
    assert.deepEqual(starts, [], 'passive entry on an empty member does not spawn a CLI');
    const selected = views.selectMember('phone', current, member.id);
    assert.ok(selected);
    const id = member.id;
    // The event handler pins the absence of a session for this fresh launch.
    const stillWanted = () => selected() && rooms.canWakeGroupMember(id, undefined, true);
    await Promise.all([views.retry(id, stillWanted), views.retry(id, stillWanted)]);
    assert.deepEqual(starts, [id]);
    assert.equal(member.sessionId, undefined);
    assert.equal(member.benchHooked, true);
    assert.match(member.remoteControl.autoLaunchedFlag, /codex .*--no-alt-screen/);
    assert.doesNotMatch(member.remoteControl.autoLaunchedFlag, /\bresume\b/);
    await ready;
    await rooms.handle({ type: 'INPUT', roomId: id, groupId: current.id, text: 'first turn' }, () => {});
    await discovered;
    const rollout = join(tmp, 'rollout-fixture.jsonl');
    await writeFile(rollout, [
      { type: 'session_meta', payload: { id: sessionId, cwd: tmp } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first reply' }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const session = await readSession('CODEX', rollout, tmp, tmp);
    assert.ok(session);
    await (rooms as any).syncWatchedSession(session);
    assert.equal(member.sessionId, sessionId);
    assert.equal(rooms.canJoinExistingGroup(member), true);
    assert.ok(member.logs.some(log => log.text === 'first reply'));
    assert.equal(rooms.snapshot().filter(room => room.sessionId === sessionId).length, 1);
  } finally {
    const running = member && rooms.isOpen(member.id);
    await rooms.close();
    if (running) await exited;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    process.chdir(originalDirectory);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('selecting a member whose CLI is already open stays silent; other blocks still tell the user', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /if \(block !== 'open'\) send\(ws, \{ type: 'NOTICE', message: groupWakeNotice\[block\] \}\);/);
  assert.equal([...server.matchAll(/groupWakeNotice\[block\]/g)].length, 1);
});

test('desktop and phone share the explicit member handler; the view synchronization never supplies its flag', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onSelectRoom=\{wakeGroupMember\}/);
  assert.match(app, /selectedRoomId: roomId, wakeSelected: true/);
  assert.match(app, /selectedRoomId: groupRecipient \}/);
  assert.equal([...app.matchAll(/wakeSelected: true/g)].length, 1);
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /canOpenEntry: roomId => rooms\.canWakeGroupMember\(roomId, rooms\.rooms\.get\(roomId\)\?\.sessionId\)/);
  assert.match(server, /stillSelected\(\) && rooms\.canWakeGroupMember\(roomId, sessionId, true\)/);
  const sidebar = await readFile(new URL('../src/components/GroupRoomSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /type="button" data-room-id=\{member.roomId\}/);
  assert.match(sidebar, /onClick=.*onSelectRoom\(member.roomId\)/, 'native button supports pointer activation and Enter/Space');
});
