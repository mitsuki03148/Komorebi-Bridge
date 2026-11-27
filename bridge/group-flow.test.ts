import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Groups } from './groups';
import { GroupViews } from './group-views';
import { approvalPrompt } from './terminal';
import { groupRosterPrefix, splitBridgeNote } from '../src/utils/bridgeNote';
import { fileReadSuffix, transcriptText } from '../src/utils/transcriptText';
import { Rooms } from './rooms';
import { RoomPresence } from './presence';
import type { GroupChat, TerminalRoom } from '../src/types/guild';

test('group roster is appended to the first accepted prompt for only its selected PTY', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-group-flow-'));
  try {
    const rooms = new Rooms(tmp, () => {});
    const a = await rooms.ensureGroupMember('CODEX', '協作 #1');
    const b = await rooms.ensureGroupMember('CODEX', '協作 #2');
    const writes = new Map<string, string[]>();
    let failA = false;
    for (const room of [a, b]) {
      const recorded: string[] = [];
      writes.set(room.id, recorded);
      room.live = true;
      room.ready = true;
      room.status = 'idle';
      room.sessionId = randomUUID();
      (rooms as any).live.set(room.id, { process: { write: (value: string) => {
        if (room === a && failA) throw new Error('test write failure');
        recorded.push(value);
      } }, queued: 0, dirty: false });
    }
    const groups = new Groups(join(tmp, 'groups.json'), () => {}, id => rooms.rooms.get(id));
    const group = groups.create('協作', [a, b].map(room => ({ roomId: room.id, modelId: room.modelId })));
    groups.beginVisit(group.id);
    const send = (room: TerminalRoom, text: string) => new Promise<boolean>((resolve, reject) => {
      void rooms.handle({ type: 'INPUT', roomId: room.id, text, requestId: room.id }, event => {
        if (event.type === 'ACTION_RESULT') resolve(event.ok);
      }, { reserveRoster: () => groups.reserveRoster(group.id, room.id) }).catch(reject);
    });
    assert.deepEqual([...writes.values()], [[], []], 'creating a group writes nothing to either PTY');
    assert.equal(await send(a, '/status'), true);
    assert.deepEqual(writes.get(a.id), ['/status', '\r']);
    a.ready = true;
    failA = true;
    assert.equal(await send(a, '未送出'), false);
    assert.equal(await send(b, '開始吧'), true);
    const sent = writes.get(b.id)?.[0] ?? '';
    assert.ok(sent.startsWith('開始吧 ===== ' + groupRosterPrefix));
    assert.ok(sent.includes(`未設定 光 · ${a.roomName}（${a.sessionId}）；未設定 光 · ${b.roomName}（${b.sessionId}）`));
    assert.equal(writes.get(b.id)?.[1], '\r');
    assert.equal(b.logs.at(-1)?.text, '開始吧');
    (rooms as any).sync({
      id: b.sessionId, modelId: 'CODEX', cwd: tmp, branch: 'main', file: join(tmp, 'codex.jsonl'),
      updated: '2026-11-16T12:00:00Z', resumable: true,
      logs: [{ id: b.sessionId + '-echo', timestamp: '12:00', sender: 'user', text: sent }],
    });
    assert.deepEqual(b.logs.filter(log => log.sender === 'user').map(log => log.text), ['開始吧']);
    assert.deepEqual(writes.get(a.id), ['/status', '\r']);
    failA = false;
    assert.equal(await send(a, '跟進一下'), true);
    assert.deepEqual(writes.get(a.id)?.slice(2), ['跟進一下', '\r']);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('an existing imported session is never fabricated with the wrong directory while waiting for sync', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-group-restore-'));
  try {
    const rooms = new Rooms(tmp, () => {});
    const id = 'session-codex-00000006-0006-4006-8006-000000000006';
    await assert.rejects(rooms.ensureGroupMember('CODEX', 'existing', id), /等待原有 CLI/);
    assert.equal(rooms.rooms.has(id), false);
    const unbound = await rooms.ensureGroupMember('CODEX', 'new');
    assert.equal(rooms.canJoinExistingGroup(unbound), false);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('DemoProject opens only the crown once across clients; a crownless entry opens only the picked room', { timeout: 5000 }, async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-view-flow-'));
  const originalPath = process.env.PATH;
  const originalDirectory = process.cwd();
  process.chdir(tmp);
  const starts: string[] = [];
  const signals = new Map<string, () => void>();
  const rooms = new Rooms(tmp, event => {
    if (event.type !== 'ROOM') return;
    const { room } = event;
    if (room.currentActionSummary === 'CLI 啟動中') starts.push(room.id);
    if (room.ready) signals.get(`ready:${room.id}`)?.();
    if (room.status === 'completed') signals.get(`exit:${room.id}`)?.();
    presence.activity(room.id, Boolean(room.ready));
  });
  const presence = new RoomPresence<string>(id => rooms.closeUnviewed(id), 20);
  const waitFor = (state: string, ids: string[]) =>
    Promise.all(ids.map(id => new Promise<void>(resolve => signals.set(`${state}:${id}`, resolve))));
  const groups = new GroupViews<string>({
    connected: () => true, beginVisit: () => {}, select: (client, id) => presence.view(client, id),
    hasRoom: id => rooms.rooms.has(id), canOpenEntry: id => rooms.canWakeGroupMember(id, rooms.rooms.get(id)?.sessionId),
    open: (id, wanted) => rooms.openViewedRoom(id, wanted), failed: (_id, error) => assert.fail(String(error)),
  });
  const leave = (client: string) => { groups.leave(client); presence.disconnect(client); };
  try {
    const bin = join(tmp, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'codex'), '#!/bin/sh\nprintf "› Ask Codex to do anything\\nGPT-test high · fixture\\n"\nwhile IFS= read -r line; do :; done\n', { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    const members = await Promise.all(Array.from({ length: 3 }, (_, index) => rooms.ensureGroupMember('CODEX', `成員 ${index + 1}`)));
    for (const member of members) {
      member.sessionId = randomUUID();
      member.resumable = true;
      rooms.rooms.delete(member.id);
      member.id = `session-codex-${member.sessionId}`;
      rooms.rooms.set(member.id, member);
    }
    const ids = members.map(member => member.id);
    const group: GroupChat = {
      id: 'demoproject', name: 'DemoProject', createdAt: '',
      members: members.map(room => ({ roomId: room.id, modelId: room.modelId })),
      orchestratorRoomId: ids[0],
    };
    const ready = waitFor('ready', [ids[0]]);
    await Promise.all([groups.view('phone', group, ids[1]), groups.view('mac', group, ids[0])]);
    await ready;
    assert.deepEqual(starts, [ids[0]], 'group entry spawns only the crown, not every member or the alternate recipient');
    assert.deepEqual([...new Set(groups.watchedRooms())], ids, 'all transcripts are still watched');
    assert.equal(presence.hasViewers(ids[1]), true, 'the phone views its selected room');
    assert.equal(presence.hasViewers(ids[2]), false, 'watching a transcript is not a room viewer');
    const alias: TerminalRoom = { ...members[0], id: randomUUID(), live: false };
    rooms.rooms.set(alias.id, alias);
    await assert.rejects(rooms.openViewedRoom(alias.id, () => true), /同一個 Session/);
    leave('phone');
    assert.ok(members[0].live && presence.hasViewers(ids[0]));
    const exited = waitFor('exit', [ids[0]]);
    leave('mac');
    await exited;
    const resumed = waitFor('ready', [ids[0]]);
    await groups.view('phone', group, ids[0]);
    await resumed;
    assert.deepEqual(starts, [ids[0], ids[0]], 're-entry resumes the same crowned room');
    const crownless = { ...group, id: 'crownless', name: 'Crownless', orchestratorRoomId: undefined };
    const cancelled = groups.view('mac', crownless, ids[1]);
    leave('mac');
    await cancelled;
    assert.equal(starts.length, 2, 'leaving before the selected PTY opens cancels that entry');
    const selected = waitFor('ready', [ids[1]]);
    await groups.view('mac', crownless, ids[1]);
    await selected;
    groups.view('mac', crownless, ids[2]);
    assert.deepEqual(starts, [ids[0], ids[0], ids[1]], 'the crownless group opens only its entry selection, not later picks');
    // The single-room flow remains independent of group views.
    const singleReady = waitFor('ready', [ids[2]]);
    presence.view('solo', ids[2]);
    await rooms.openViewedRoom(ids[2], () => presence.hasViewers(ids[2]));
    await singleReady;
    assert.deepEqual(starts, [ids[0], ids[0], ids[1], ids[2]]);
    const lastExit = waitFor('exit', [ids[0], ids[2]]);
    leave('phone');
    leave('mac');
    presence.disconnect('solo');
    await lastExit;
  } finally {
    presence.dispose();
    await rooms.close();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    process.chdir(originalDirectory);
    await rm(tmp, { recursive: true, force: true });
  }
});


test('three-member roster uses actual role keys, one scoped command and readable attachment labels', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-group-roster-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const sessionId = (n: number) => 'b78acf90-33f5-4bcd-b211-' + String(n).padStart(12, '0');
  const path = join(tmp, 'groups.json');
  const members = [
    { id: 'codex-fixture', modelId: 'CODEX', roomName: 'Implementation', sessionId: sessionId(1) },
    { id: 'claude-fixture', modelId: 'CLAUDE', roomName: 'Verification', sessionId: sessionId(2) },
    { id: 'agy-fixture', modelId: 'AGY', roomName: 'Native Test', sessionId: sessionId(3) },
  ] as TerminalRoom[];
  const groups = new Groups(path, () => {}, key => members.find(r => r.id === key));
  const { id: groupId } = groups.create('Fixture', members.map(r => ({ modelId: r.modelId, roomId: r.id })));
  groups.setMemberRole(groupId, members[0].id, { preset: 'implement' });
  groups.setMemberRole(groupId, members[1].id, { custom: 'QA Lead' });
  groups.setMemberRole(groupId, members[2].id, { preset: 'native-test' });
  groups.setOrchestrator(groupId, members[0].id);
  groups.setBoard(groupId, '/Volumes/Komorebi/Bench/Rules.md');
  const { suffix } = groups.reserveRoster(groupId, members[1].id)!;
  assert.ok(suffix.includes('@implement 光 · Implementation（' + sessionId(1) + '）'));
  assert.ok(suffix.includes('@qa lead 響 · Verification（' + sessionId(2) + '）'));
  assert.ok(suffix.includes('@native-test 瞳 · Native Test（' + sessionId(3) + '）'));
  assert.ok(suffix.includes('總指揮 ♛：Implementation（' + sessionId(1) + '）'));
  assert.ok(!suffix.includes('你就係總指揮 ♛'), 'members must not be told they are the lead');
  assert.ok(suffix.includes("bench send '@<崗位>' --group " + groupId + ' --from'));
  assert.ok(suffix.includes('告示版：/Volumes/Komorebi/Bench/Rules.md。開工前讀一次。'));
  assert.equal(suffix.split('\n').length, 1);
  assert.ok(Array.from(suffix).length < 600, 'three-member note stays within 600 Unicode characters');
  const filename = 'b78acf90-33f5-4bcd-b211-000000000006_Agenda.txt';
  const attachment = '/tmp/Komorebi Attachments/' + filename;
  const sent = '睇一下' + fileReadSuffix([attachment]) + suffix;
  const restored = splitBridgeNote(transcriptText('CODEX', 'user', sent));
  assert.equal(restored.main, '睇一下\n📎 Agenda.txt');
  assert.ok(restored.note.startsWith(groupRosterPrefix));
});

test('entry waiting for a transcript is cancelled on departure, and a later selection or roster refresh does not wake a second room', async () => {
  const available = new Set(['b']);
  const opened: string[] = [];
  const watched: string[][] = [];
  const visits: string[] = [];
  const views = new GroupViews<string>({
    connected: () => true, beginVisit: id => { visits.push(id); },
    select: () => { watched.push([...views.watchedRooms()]); },
    hasRoom: id => available.has(id), canOpenEntry: id => available.has(id),
    open: async (id, wanted) => { if (wanted()) opened.push(id); }, failed: (_id, error) => assert.fail(String(error)),
  });
  const group = { id: 'group', name: '協作', createdAt: '', orchestratorRoomId: 'a',
    members: ['a', 'b'].map(roomId => ({ roomId, modelId: 'CODEX' as const })) };
  views.view('phone', group, 'b');
  views.leave('phone');
  available.add('a');
  await views.synced('a');
  assert.deepEqual(opened, []);
  const entering = views.view('phone', group, 'b');
  const other = views.view('mac', group);
  views.leave('phone');
  await Promise.all([entering, other]);
  assert.deepEqual(opened, ['a'], 'the remaining client still owns the shared wake');
  const newMember = { roomId: 'c', modelId: 'CODEX' as const };
  available.add('c');
  views.update({ ...group, orchestratorRoomId: 'c', members: [...group.members, newMember] });
  views.view('mac', { ...group, orchestratorRoomId: 'c', members: [...group.members, newMember] }, 'c');
  await views.synced('c');
  assert.deepEqual(opened, ['a']);
  assert.deepEqual(watched.at(-1), ['a', 'b', 'c']);
  assert.deepEqual(visits, ['group', 'group'], 'a new visit starts only after everyone left');
});

test('a saved group prompt cannot approve a numbered choice which appears on resume', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-group-resume-gate-'));
  const rooms = new Rooms(tmp, () => {});
  try {
    const room = await rooms.ensureGroupMember('CLAUDE', 'Stored room');
    room.sessionId = randomUUID();
    room.resumable = true;
    const screen = 'Permission Required: tool operation\n1. Yes\n2. No\nSelect with numbers [1-2]';
    const approval = approvalPrompt('CLAUDE', screen)!;
    assert.equal(approval.numbered['1'], '1\r', 'the test screen really has an approval key');
    const writes: string[] = [];
    let resumed = 0;
    (rooms as any).resumeForInput = async () => {
      resumed++;
      room.live = true;
      room.ready = false;
      room.pendingApproval = approval.card;
      room.screen = screen;
      (rooms as any).live.set(room.id, {
        process: { write: (value: string) => writes.push(value), kill: () => {} },
        queued: 0, dirty: false, approvalFingerprint: approval.fingerprint,
      });
    };
    const input = (text: string) => rooms.handle({ type: 'INPUT', roomId: room.id, groupId: 'fixture', text }, () => {});
    await assert.rejects(input('/compact'), /請先續接/);
    assert.equal(resumed, 0);
    await assert.rejects(input('1'), /續接後 CLI 仍未就緒/);
    assert.equal(resumed, 1);
    assert.deepEqual(writes, []);
    assert.equal(room.pendingApproval, approval.card);
  } finally {
    await rooms.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
