import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, open, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoveRoomModal, RoomMoveAction } from '../src/components/GuildModals';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { zh } from '../src/i18n/zh';
import type { TerminalRoom } from '../src/types/guild';
import { Bench } from './bench';
import { Groups } from './groups';
import {
  claudeProjectSlug,
  copyClaudeMemory,
  forkAgyConversation,
  moveClaudeRoom,
  moveRoom,
  replaceStaleRoom,
  replaceVerdict,
  rewriteAgyMetadataBlob,
  validateMoveFolder,
  type MoveRoomDeps,
  type ReplaceDeps,
} from './room-replace';
import { Rooms, cliLaunch } from './rooms';
import { readSession, roomDirectory } from './sessions';
import { Successors } from './successors';

const room = (id: string, modelId: string, name: string, sessionId = id) => ({ id, modelId, roomName: name, sessionId, repoPath: '/tmp/x', selectedSubModel: 'Sonnet 5.5', effortLevel: 'medium', live: true } as unknown as TerminalRoom);
const ids = { crown: '11111111-0000-4000-8000-000000000001', member: '22222222-0000-4000-8000-000000000002', codex: '33333333-0000-4000-8000-000000000003', fresh: '44444444-0000-4000-8000-000000000004' };

test('empty fork rollout is watched before metadata and binds its unique parent in a shared cwd', { timeout: 15_000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-fork-bind-')));
  const oldCwd = process.cwd();
  process.chdir(dir);
  const manager = new Rooms(dir, () => {});
  const parents = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const child = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    const forks = await Promise.all(parents.map(async (parent, i) => {
      const result = await manager.ensureGroupMember('CODEX', 'fork ' + i);
      result.live = true;
      (manager as any).live.set(result.id, { forkedFromSession: parent, resolvedCwd: dir, process: { kill() {} } });
      return result;
    }));
    const file = join(dir, `rollout-2026-11-21T12-00-00-${child}.jsonl`);
    const handle = await open(file, 'w');
    let resolveChanged!: () => void;
    const changed = new Promise<void>(resolve => { resolveChanged = resolve; });
    try {
      (manager as any).watchCodexForkRollout(file, resolveChanged);
      await handle.writeFile(JSON.stringify({ type: 'session_meta', payload: { id: child, cwd: dir, forked_from_id: parents[1] } }) + '\n');
      await Promise.race([changed, new Promise((_, reject) => {
        const signal = AbortSignal.timeout(10_000);
        signal.addEventListener('abort', () => reject(new Error('metadata write was not observed')), { once: true });
      })]);
      const session = await readSession('CODEX', file, dir, dir);
      assert.ok(session);
      await (manager as any).syncWatchedSession(session);
      assert.equal(forks[1].sessionId, child);
      assert.equal(forks[0].sessionId, undefined);
      assert.equal(forks[2].sessionId, undefined);
      assert.equal(manager.snapshot().filter(item => item.sessionId === child).length, 1);
    } finally { await handle.close(); }
  } finally {
    await manager.close();
    process.chdir(oldCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

async function verifyForkFileWithoutEvents(bound: boolean, expire = false) {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'codex-fork-no-events-')));
  const roomsUrl = pathToFileURL(resolve('bridge/rooms.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { open } from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const dir = process.env.HOME;
    process.chdir(dir);
    const parent = '11111111-1111-4111-8111-111111111111';
    const child = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const file = join(dir, 'rollout-2026-11-21T12-00-00-' + child + '.jsonl');
    const handle = await open(file, 'w');
    const nativeWatch = fs.watch;
    let masked = 0;
    let acceleratedExpiry = 0;
    if (${expire}) {
      const nativeTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback, delay, ...args) => {
        if (delay === 30_000) { acceleratedExpiry++; delay = 100; }
        return nativeTimeout(callback, delay, ...args);
      };
    }
    fs.watch = (path, ...args) => {
      const watcher = nativeWatch(path, ...args);
      if (String(path) === file) {
        masked++;
        const emit = watcher.emit;
        watcher.emit = function(type, ...values) {
          if (type === 'change') return true;
          return emit.call(this, type, ...values);
        };
      }
      return watcher;
    };
    syncBuiltinESMExports();
    const { Rooms } = await import(${JSON.stringify(roomsUrl)});
    const rooms = new Rooms(dir, () => {});
    let calls = 0;
    const changed = Promise.withResolvers();
    const changedAgain = Promise.withResolvers();
    try {
      const room = await rooms.ensureGroupMember('CODEX', 'fork');
      room.live = true;
      rooms.live.set(room.id, { forkedFromSession: parent, resolvedCwd: dir, process: { kill() {} } });
      if (${bound}) rooms.bindSession(room, child);
      rooms.watchCodexForkRollout(file, () => { calls++; if (calls === 1) changed.resolve(); else changedAgain.resolve(); });
      assert.equal(masked, 1, 'native file events are suppressed');
      if (${expire}) {
        assert.equal(acceleratedExpiry, 1, 'the recovery has a 30-second expiry');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await handle.writeFile(JSON.stringify({ type: 'session_meta', payload: { id: child, cwd: dir, forked_from_id: parent } }) + '\\n');
      if (${expire}) {
        await new Promise(resolve => setTimeout(resolve, 1_500));
        assert.equal(calls, 0, 'fallback no longer polls after its expiry');
      } else {
        let deadline;
        try {
          await Promise.race([changed.promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('file change was not recovered')), 8_000); })]);
        } finally { clearTimeout(deadline); }
        const size = (await handle.stat()).size;
        await handle.write('X', 0, 'utf8');
        assert.equal((await handle.stat()).size, size, 'the next update changes mtime without changing size');
        try {
          await Promise.race([changedAgain.promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('same-size change was not recovered')), 8_000); })]);
        } finally { clearTimeout(deadline); }
        await rooms.close();
        const atClose = calls;
        await handle.appendFile('extra\\n');
        await new Promise(resolve => setTimeout(resolve, 1_500));
        assert.equal(calls, atClose, 'closing stops fallback callbacks');
      }
    } finally { await rooms.close(); await handle.close(); }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp, CODEX_HOME: join(tmp, '.codex'), PATH: '' }, timeout: 22_000,
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

test('a pending fork notices metadata when its exact file watcher misses events', { timeout: 25_000 }, () => verifyForkFileWithoutEvents(false));
test('a bound fork notices metadata when its exact file watcher misses events', { timeout: 25_000 }, () => verifyForkFileWithoutEvents(true));
test('fork file polling stops after its 30-second budget', { timeout: 25_000 }, () => verifyForkFileWithoutEvents(false, true));

test('fork matching rejects ambiguous or missing parents and recovers an already imported rollout', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codex-fork-match-')));
  const oldCwd = process.cwd();
  process.chdir(dir);
  const manager = new Rooms(dir, () => {});
  const parent = '11111111-1111-4111-8111-111111111111';
  const child = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const common = { id: child, modelId: 'CODEX' as const, cwd: dir, branch: 'main',
    file: '~/fixture.jsonl', updated: '2026-11-21T12:00:00Z', logs: [], resumable: true };
  try {
    const first = await manager.ensureGroupMember('CODEX', 'First');
    const second = await manager.ensureGroupMember('CODEX', 'Second');
    for (const item of [first, second]) {
      item.live = true;
      (manager as any).live.set(item.id, { forkedFromSession: parent, resolvedCwd: dir, process: { kill() {} } });
    }
    (manager as any).sync(common);
    assert.equal(first.sessionId, undefined, 'same cwd alone is not proof');
    assert.equal(second.sessionId, undefined);
    (manager as any).sync({ ...common, forkedFromId: parent });
    assert.equal(first.sessionId, undefined, 'two matching forks must not be guessed');
    assert.equal(second.sessionId, undefined);
    (manager as any).live.delete(second.id);
    (manager as any).sync({ ...common, forkedFromId: parent, updated: '2026-11-21T12:00:01Z' });
    assert.equal(first.sessionId, child, 'the unique matching live fork adopts an already imported rollout');
    assert.equal(manager.snapshot().filter(item => item.sessionId === child).length, 1);
  } finally {
    await manager.close();
    process.chdir(oldCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('a live fork recovers an existing rollout opened by its own process', { timeout: 8000 }, async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'codex-fork-recover-')));
  const roomsUrl = pathToFileURL(resolve('bridge/rooms.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { Rooms } from ${JSON.stringify(roomsUrl)};
    const home = process.env.HOME;
    process.chdir(home);
    const root = join(home, '.codex/sessions/2026/11/21');
    await mkdir(root, { recursive: true });
    const parent = '11111111-1111-4111-8111-111111111111';
    const childId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const file = join(root, 'rollout-2026-11-21T12-00-00-' + childId + '.jsonl');
    await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id: childId, cwd: home, forked_from_id: parent } }) + '\\n');
    const child = spawn(process.execPath, ['-e', 'require("node:fs").openSync(process.argv[1],"r"); console.log("ready"); process.stdin.resume()', file], { stdio: ['pipe', 'pipe', 'pipe'] });
    const manager = new Rooms(home, () => {});
    try {
      await once(child.stdout, 'data');
      const room = await manager.ensureGroupMember('CODEX', 'fork');
      const other = await manager.ensureGroupMember('CODEX', 'parallel fork');
      room.live = true;
      other.live = true;
      const live = { forkedFromSession: parent, resolvedCwd: home, process: { pid: child.pid, kill() {} } };
      manager.live.set(room.id, live);
      manager.live.set(other.id, { forkedFromSession: parent, resolvedCwd: home, process: { kill() {} } });
      await manager.recoverCodexFork(room, live);
      assert.equal(room.sessionId, childId);
      assert.equal(other.sessionId, undefined, 'same-parent concurrent fork must not take this process-owned file');
      assert.equal(room.syncedStateFile, '~/.codex/sessions/2026/11/21/' + file.split('/').at(-1));
      assert.ok(live.disposeForkRollout, 'recovered fork keeps an exact file watch');
    } finally {
      await manager.close();
      child.kill();
      await once(child, 'exit');
    }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: process.cwd(), env: { ...process.env, HOME: tmp }, timeout: 7000 });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

async function setup(fn: (ctx: { deps: ReplaceDeps; rooms: Map<string, TerminalRoom>; groups: Groups; bench: Bench; notes: string[]; log: string[]; groupId: string }) => Promise<void>, options: { cloneFails?: boolean; greetFails?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-replace-'));
  try {
    const rooms = new Map([[ids.crown, room(ids.crown, 'CLAUDE', 'DemoProject 總指揮')], [ids.member, room(ids.member, 'CLAUDE', 'DemoProject 實作')], [ids.codex, room(ids.codex, 'CODEX', 'DemoProject Codex')]]);
    const groups = new Groups(join(dir, 'groups.json'), () => {}, id => rooms.get(id) ?? (id === ids.fresh ? room(ids.fresh, 'CLAUDE', 'DemoProject 實作') : undefined));
    const group = groups.create('DemoProject', [ids.crown, ids.member, ids.codex].map(id => ({ roomId: id, modelId: rooms.get(id)!.modelId as 'CLAUDE' })));
    groups.setOrchestrator(group.id, ids.crown);
    groups.setMemberRole(group.id, ids.member, { custom: 'Implement' });
    const notes: string[] = [], log: string[] = [];
    const bench = new Bench();
    const deps: ReplaceDeps = {
      rooms: {
        clone: async old => { log.push('clone'); if (options.cloneFails) throw new Error('同時開啟的 CLI 已達上限'); const made = room(ids.fresh, 'CLAUDE', old.roomName); rooms.set(made.id, made); return made; },
        close: async old => { log.push(`close:${old.id}`); },
        archive: async old => { log.push(`archive:${old.id}`); },
        find: id => rooms.get(id),
        greet: async fresh => { log.push(`greet:${fresh.id}`); if (options.greetFails) throw new Error('not ready'); },
      },
      groups, bench, successors: new Successors(),
      note: (id, text) => { notes.push(`${id}:${text}`); },
    };
    await fn({ deps, rooms, groups, bench, notes, log, groupId: group.id });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('only a Claude member of a group that is not its lead is replaced', async () => {
  await setup(async ({ groups, rooms }) => {
    assert.deepEqual(replaceVerdict(groups.snapshot(), rooms.get(ids.member)!), { replace: true });
    assert.deepEqual(replaceVerdict(groups.snapshot(), rooms.get(ids.crown)!), { replace: false, why: 'lead' }, 'the lead is always kept');
    assert.deepEqual(replaceVerdict(groups.snapshot(), rooms.get(ids.codex)!), { replace: false, why: 'not-claude' });
    assert.deepEqual(replaceVerdict(groups.snapshot(), room('55555555-0000-4000-8000-000000000005', 'CLAUDE', 'Solo')), { replace: false, why: 'no-group' }, 'a room on its own is left for the Founder');
  });
});

test('a stale member gets a new room in its seat with its role, its unfinished tickets, and the lead is told', async () => {
  await setup(async ({ deps, groups, bench, rooms, notes, log, groupId }) => {
    const old = rooms.get(ids.member)!, lead = rooms.get(ids.crown)!;
    const open = bench.send({ groupId, from: { sessionId: ids.crown, roomName: lead.roomName, modelId: 'CLAUDE' }, to: { sessionId: ids.member, roomName: old.roomName, modelId: 'CLAUDE' }, body: '請實作 X' });
    const roleBefore = groups.get(groupId)!.members.find(member => member.roomId === ids.member)!.role;
    assert.ok(roleBefore, 'the member has a role to carry over');
    const result = await replaceStaleRoom(deps, old);
    assert.equal(result.replaced, true);
    assert.deepEqual((result as { moved: number[] }).moved, [open.id]);
    const after = groups.get(groupId)!;
    assert.equal(after.members.some(member => member.roomId === ids.member), false, 'the old room has left the group');
    assert.deepEqual(after.members.find(member => member.roomId === ids.fresh)?.role, roleBefore, 'role and direction come along');
    assert.equal(bench.mine(ids.fresh).some(ticket => ticket.id === open.id), true, 'the new room finds the old ticket');
    assert.equal(bench.mine(ids.member).filter(ticket => ticket.id === open.id).length, 0);
    const notice = bench.mine(ids.crown).find(ticket => ticket.kind === 'notice');
    assert.ok(notice, 'the lead gets a notice ticket');
    assert.match(notice!.body, /身份、崗位、方向不變/);
    assert.match(notice!.body, new RegExp(`#${open.id}`));
    assert.ok(notes.some(note => note.startsWith(`${ids.crown}:`) && note.includes('已自動換房')), 'the lead sees a small line');
    assert.deepEqual(log, ['clone', `greet:${ids.fresh}`, `close:${ids.member}`, `archive:${ids.member}`], 'the new room is greeted once it holds the seat; the old room is closed and put away only after that');
  });
});

test('the lead and a room outside any group are not replaced, and a failed new room leaves everything as it was', async () => {
  await setup(async ({ deps, rooms, log, groups, groupId }) => {
    assert.deepEqual(await replaceStaleRoom(deps, rooms.get(ids.crown)!), { replaced: false, why: 'lead' });
    assert.deepEqual(log, []);
    assert.deepEqual(groups.get(groupId)!.members.map(member => member.roomId).sort(), [ids.crown, ids.member, ids.codex].sort());
  });
  await setup(async ({ deps, rooms, log, groups, bench, groupId }) => {
    const result = await replaceStaleRoom(deps, rooms.get(ids.member)!);
    assert.deepEqual(result, { replaced: false, why: '同時開啟的 CLI 已達上限' });
    assert.deepEqual(log, ['clone'], 'the old room is not closed when no new room came up');
    assert.equal(groups.get(groupId)!.members.some(member => member.roomId === ids.member), true);
    assert.equal(bench.mine(ids.crown).length, 0, 'no notice for a move that did not happen');
  }, { cloneFails: true });
});

test('a first word that cannot be sent does not undo the move, and is said in the new room', async () => {
  await setup(async ({ deps, rooms, groups, notes, log, groupId }) => {
    const result = await replaceStaleRoom(deps, rooms.get(ids.member)!);
    assert.equal(result.replaced, true);
    assert.equal(groups.get(groupId)!.members.some(member => member.roomId === ids.fresh), true, 'the new room keeps the seat');
    assert.deepEqual(log, ['clone', `greet:${ids.fresh}`, `close:${ids.member}`, `archive:${ids.member}`], 'the old room is still put away');
    assert.ok(notes.some(note => note.startsWith(`${ids.fresh}:`) && note.includes('未能送出第一句')));
  }, { greetFails: true });
});

test('a fixed ticket follows the replaced room, and a routed one follows it to its own session once that exists', async () => {
  await setup(async ({ deps, groups, bench, rooms, groupId }) => {
    const old = rooms.get(ids.member)!, lead = rooms.get(ids.crown)!;
    const native = '99999999-0000-4000-8000-000000000009';
    const leadParty = { sessionId: ids.crown, roomName: lead.roomName, modelId: 'CLAUDE' as const };
    const memberParty = { sessionId: ids.member, roomName: old.roomName, modelId: 'CLAUDE' as const };
    const fixed = bench.send({ groupId, from: leadParty, to: memberParty, body: '固定工單', fixed: { fromRoomId: ids.crown, toRoomId: ids.member } });
    const back = bench.send({ groupId, from: memberParty, to: leadParty, body: '固定回覆', fixed: { fromRoomId: ids.member, toRoomId: ids.crown } });
    // The new room learns its own session after the first word.
    const greet = deps.rooms.greet;
    deps.rooms.greet = async fresh => { await greet(fresh); rooms.get(ids.fresh)!.sessionId = native; };
    const result = await replaceStaleRoom({ ...deps, pause: async () => {} }, old);
    assert.equal(result.replaced, true);
    assert.deepEqual(bench.get(fixed.id)!.fixed, { fromRoomId: ids.crown, toRoomId: ids.fresh }, 'the room that changed is replaced in the fixed pair');
    assert.deepEqual(bench.get(back.id)!.fixed, { fromRoomId: ids.fresh, toRoomId: ids.crown });
    assert.equal(bench.get(fixed.id)!.to.sessionId, native, 'the ticket names the new room\'s own session once it exists');
    assert.equal(groups.get(groupId)!.members.some(member => member.roomId === ids.fresh), true);
  });
});

test('fork launch arguments pass the per-CLI fork flags for Claude, Codex and AGY, and keep the old session ID out of the new room', () => {
  const freshId = '66666666-0000-4000-8000-000000000006';
  const oldSession = '77777777-0000-4000-8000-000000000007';
  const newSession = '88888888-0000-4000-8000-000000000008';

  // 1. Claude fork: --resume <oldSession> --fork-session, without --session-id.
  const forkedClaude = { ...room(freshId, 'CLAUDE', 'Forked Claude', undefined as unknown as string), sessionId: undefined, repoPath: '/Volumes/Komorebi/NewRepo' };
  const [claudeCmd, claudeArgs] = cliLaunch(forkedClaude, true, false, true, { hook: '/tmp/hook.sh' }, undefined, undefined, { model: 'claude-opus-4-6', effort: 'high' }, oldSession);
  assert.equal(claudeCmd, 'claude');
  assert.deepEqual(claudeArgs.slice(-3), ['--resume', oldSession, '--fork-session']);
  assert.equal(claudeArgs.includes('--session-id'), false, 'forked Claude launch does not pass --session-id');
  assert.equal(claudeArgs.includes('bypassPermissions'), true);
  assert.equal(claudeArgs.includes('--remote-control'), true);
  assert.deepEqual(claudeArgs.slice(claudeArgs.indexOf('--model'), claudeArgs.indexOf('--model') + 4), ['--model', 'claude-opus-4-6', '--effort', 'high']);

  const [, normalClaudeArgs] = cliLaunch(forkedClaude, false, false, false);
  assert.equal(normalClaudeArgs.includes('--fork-session'), false);
  assert.deepEqual(normalClaudeArgs.slice(-2), ['--session-id', freshId]);

  const [, reopenClaudeArgs] = cliLaunch({ ...forkedClaude, sessionId: newSession }, false, false, false);
  assert.equal(reopenClaudeArgs.includes('--fork-session'), false);
  assert.deepEqual(reopenClaudeArgs.slice(-2), ['--resume', newSession]);

  // 2. Codex fork: codex [...hooks] fork [...args] <oldSession>; reopen uses resume <newSession>.
  const forkedCodex = { ...room(freshId, 'CODEX', 'Forked Codex', undefined as unknown as string), sessionId: undefined, repoPath: '/Volumes/Komorebi/NewRepo' };
  const [codexCmd, codexArgs] = cliLaunch(forkedCodex, false, false, true, { hook: '/tmp/hook.sh' }, undefined, true, undefined, oldSession);
  assert.equal(codexCmd, 'codex');
  assert.equal(codexArgs.includes('fork'), true);
  assert.equal(codexArgs.includes('resume'), false);
  assert.equal(codexArgs.at(-1), oldSession);
  assert.equal(codexArgs.includes('service_tier="priority"'), true);
  assert.equal(codexArgs.includes('danger-full-access'), true);

  const [, reopenCodexArgs] = cliLaunch({ ...forkedCodex, sessionId: newSession }, false, false, true);
  assert.equal(reopenCodexArgs[0], 'resume');
  assert.equal(reopenCodexArgs.includes('fork'), false);
  assert.equal(reopenCodexArgs.at(-1), newSession);

  // 3. AGY fork: agy [...flags] --conversation <newRoomId> (where forkAgyConversation copied the conversation under <newRoomId>).
  const forkedAgy = { ...room(freshId, 'AGY', 'Forked AGY', undefined as unknown as string), sessionId: undefined, repoPath: '/Volumes/Komorebi/NewRepo' };
  const [agyCmd, agyArgs] = cliLaunch(forkedAgy, true, true, false, undefined, 'gemini-4-argon-high', undefined, undefined, oldSession);
  assert.equal(agyCmd, 'agy');
  assert.deepEqual(agyArgs.slice(-2), ['--conversation', freshId]);
  assert.equal(agyArgs.includes(oldSession), false, 'forked AGY launch uses the new conversation ID, not the old session ID');
  assert.equal(agyArgs.includes('--dangerously-skip-permissions'), true);
  assert.equal(agyArgs.includes('--remote-control'), true);
  assert.deepEqual(agyArgs.slice(agyArgs.indexOf('--model'), agyArgs.indexOf('--model') + 2), ['--model', 'gemini-4-argon-high']);
});

test('validateMoveFolder enforces workspace boundary, rejects .., missing or file paths, and preserves lexical path for symlink aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-move-dir-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'komorebi-outside-'));
  try {
    const validSub = join(root, 'repo-a');
    const fileTarget = join(root, 'note.md');
    const aliasPath = join(root, 'alias-repo');
    await mkdir(validSub, { recursive: true });
    await writeFile(fileTarget, 'hi');
    await symlink(outsideDir, aliasPath);

    assert.equal(await validateMoveFolder(root, validSub), validSub);
    assert.equal(await validateMoveFolder(root, aliasPath), aliasPath, 'symlink alias under workspace keeps its lexical path');

    await assert.rejects(validateMoveFolder(root, 'relative/path'), /絕對路徑/);
    await assert.rejects(validateMoveFolder(root, `${validSub}/../repo-a`), /\.\./);
    await assert.rejects(validateMoveFolder(root, join(root, 'does-not-exist')), /找不到這個資料夾/);
    await assert.rejects(validateMoveFolder(root, fileTarget), /實際資料夾/);
    await assert.rejects(validateMoveFolder(root, outsideDir), /允許的工作區/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('copyClaudeMemory copies *.md only, never overwrites existing files, never deletes, and handles missing source folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-claude-mem-'));
  try {
    const oldFolder = '/Volumes/Komorebi/Old_Repo';
    const newFolder = '/Volumes/Komorebi/New_Repo';
    assert.equal(claudeProjectSlug(oldFolder), '-Volumes-Komorebi-Old-Repo');

    // Missing source memory folder: reports missing and proceeds cleanly.
    const missing = await copyClaudeMemory(oldFolder, newFolder, dir);
    assert.deepEqual(missing, { copied: 0, skipped: 0, missing: true });

    const srcMem = join(dir, claudeProjectSlug(oldFolder), 'memory');
    const dstMem = join(dir, claudeProjectSlug(newFolder), 'memory');
    await mkdir(srcMem, { recursive: true });
    await mkdir(dstMem, { recursive: true });
    await writeFile(join(srcMem, 'MEMORY.md'), 'old index');
    await writeFile(join(srcMem, 'note.md'), 'new fact');
    await writeFile(join(srcMem, 'ignore.txt'), 'not markdown');
    await writeFile(join(dstMem, 'MEMORY.md'), 'existing target index');
    await writeFile(join(dstMem, 'keep.md'), 'stay untouched');

    const result = await copyClaudeMemory(oldFolder, newFolder, dir);
    assert.deepEqual(result, { copied: 1, skipped: 1, missing: false });
    assert.equal(await readFile(join(dstMem, 'MEMORY.md'), 'utf8'), 'existing target index', 'never overwrites existing file');
    assert.equal(await readFile(join(dstMem, 'note.md'), 'utf8'), 'new fact', 'copies new .md file');
    assert.equal(await readFile(join(dstMem, 'keep.md'), 'utf8'), 'stay untouched', 'never deletes existing target files');
    assert.equal(await readFile(join(srcMem, 'MEMORY.md'), 'utf8'), 'old index', 'source file stays untouched');
    const dstFiles = (await readdir(dstMem)).sort();
    assert.deepEqual(dstFiles, ['MEMORY.md', 'keep.md', 'note.md'], 'non-.md file is not copied');

    // Symlink alias folders: project slug is computed from realpath of each folder so memory is found and copied.
    const realOld = join(dir, 'physical-old');
    const realNew = join(dir, 'physical-new');
    const aliasOld = join(dir, 'alias-old');
    const aliasNew = join(dir, 'alias-new');
    await mkdir(realOld, { recursive: true });
    await mkdir(realNew, { recursive: true });
    await symlink(realOld, aliasOld);
    await symlink(realNew, aliasNew);
    const realOldCanonical = await realpath(aliasOld);
    const realNewCanonical = await realpath(aliasNew);
    assert.notEqual(claudeProjectSlug(aliasOld), claudeProjectSlug(realOldCanonical));
    const aliasSrcMem = join(dir, claudeProjectSlug(realOldCanonical), 'memory');
    await mkdir(aliasSrcMem, { recursive: true });
    await writeFile(join(aliasSrcMem, 'alias-note.md'), 'from physical old');

    const aliasResult = await copyClaudeMemory(aliasOld, aliasNew, dir);
    assert.deepEqual(aliasResult, { copied: 1, skipped: 0, missing: false });
    const aliasDstFile = join(dir, claudeProjectSlug(realNewCanonical), 'memory', 'alias-note.md');
    assert.equal(await readFile(aliasDstFile, 'utf8'), 'from physical old');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('moveClaudeRoom refuses invalid requests with nothing changed, reopens the old room if fork fails, copies memory before fork, tolerates memory copy errors, and moves group seat, role, direction, tickets, claims and memory on success', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-move-room-')));
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-move-out-')));
  try {
    const oldFolder = join(dir, 'repo-old');
    const newFolder = join(dir, 'repo-new');
    const projectsRoot = join(dir, 'claude-projects');
    await mkdir(oldFolder, { recursive: true });
    await mkdir(newFolder, { recursive: true });
    const srcMem = join(projectsRoot, claudeProjectSlug(oldFolder), 'memory');
    await mkdir(srcMem, { recursive: true });
    await writeFile(join(srcMem, 'project.md'), 'remember this');

    const rooms = new Map<string, TerminalRoom>([
      [ids.crown, { ...room(ids.crown, 'CLAUDE', '總管', ids.crown), repoPath: oldFolder, resumable: true }],
      [ids.member, { ...room(ids.member, 'CLAUDE', '實作房', ids.member), repoPath: oldFolder, resumable: true }],
      [ids.codex, { ...room(ids.codex, 'CODEX', '光房', ids.codex), repoPath: oldFolder, resumable: true }],
    ]);
    const groups = new Groups(join(dir, 'groups.json'), () => {}, id => rooms.get(id));
    const group = groups.create('Team', [ids.crown, ids.member, ids.codex].map(id => ({ roomId: id, modelId: rooms.get(id)!.modelId as 'CLAUDE' })));
    groups.setOrchestrator(group.id, ids.crown);
    groups.setMemberRole(group.id, ids.member, { preset: 'implement' });
    groups.setMemberDirection(group.id, ids.member, '专注簡潔實作', 'implement');

    const bench = new Bench();
    const successors = new Successors();
    const log: string[] = [];
    const notes: string[] = [];
    let busy = false;
    let forkFails = false;
    let expectMemoryOnFork = false;
    let memoryReadyAtFork = false;
    const forkedSession = 'aaaaaaaa-0000-4000-8000-00000000000a';
    let greetedPrompt: string | undefined;

    const deps: MoveRoomDeps = {
      workspace: dir,
      claudeProjectsRoot: projectsRoot,
      rooms: {
        isBusy: () => busy,
        fork: async (old, folder) => {
          log.push(`fork:${old.id}:${folder}`);
          if (expectMemoryOnFork) {
            const targetMem = join(projectsRoot, claudeProjectSlug(folder), 'memory', 'project.md');
            memoryReadyAtFork = (await readFile(targetMem, 'utf8').catch(() => '')) === 'remember this';
          }
          if (forkFails) throw new Error('CLI 啟動失敗');
          const forked = { ...room(ids.fresh, 'CLAUDE', old.roomName, undefined as unknown as string), sessionId: undefined, repoPath: folder, resumable: true };
          rooms.set(forked.id, forked);
          return forked;
        },
        close: async old => { log.push(`close:${old.id}`); old.live = false; },
        reopen: async old => { log.push(`reopen:${old.id}`); old.live = true; },
        archive: async old => { log.push(`archive:${old.id}`); },
        find: id => rooms.get(id),
        greet: async (fresh, prompt) => {
          log.push(`greet:${fresh.id}`);
          greetedPrompt = prompt;
          fresh.sessionId = forkedSession;
        },
      },
      groups,
      bench,
      successors,
      note: (id, text) => { notes.push(`${id}:${text}`); },
      pause: async () => {},
    };

    // 1. Validation refusals: busy room, outside workspace, missing folder, not a directory, no session ID, same folder.
    for (const candidateId of [ids.member, ids.codex] as const) {
      const target = rooms.get(candidateId)!;
      busy = true;
      await assert.rejects(moveRoom(deps, target, { folder: newFolder }), /CLI 工作中/);
      busy = false;
      await assert.rejects(moveRoom(deps, target, { folder: outside }), /允許的工作區/);
      await assert.rejects(moveRoom(deps, target, { folder: join(dir, 'missing') }), /找不到這個資料夾/);
      const plainFile = join(dir, 'a.txt');
      await writeFile(plainFile, 'x');
      await assert.rejects(moveRoom(deps, target, { folder: plainFile }), /實際資料夾/);
      const noSessionRoom = { ...target, sessionId: undefined };
      await assert.rejects(moveRoom(deps, noSessionRoom, { folder: newFolder }), /未有可續接的對話/);
      await assert.rejects(moveRoom(deps, target, { folder: oldFolder }), /已經在這個工作資料夾/);
    }
    assert.deepEqual(log, [], 'refused validations change nothing');

    // 2. Failure after old room was closed: reopens old room on its own session.
    forkFails = true;
    await assert.rejects(moveClaudeRoom(deps, rooms.get(ids.member)!, { folder: newFolder }), /CLI 啟動失敗/);
    assert.deepEqual(log, [`close:${ids.member}`, `fork:${ids.member}:${newFolder}`, `reopen:${ids.member}`]);
    assert.equal(rooms.get(ids.member)!.live, true, 'old room is reopened when fork fails');
    assert.equal(groups.get(group.id)!.members.some(m => m.roomId === ids.member), true, 'group seat untouched on failure');
    log.length = 0;
    forkFails = false;

    // 3. Successful move with open ticket, claim, and memory copied BEFORE fork is called.
    const leadParty = { sessionId: ids.crown, roomName: '總管', modelId: 'CLAUDE' as const };
    const memberParty = { sessionId: ids.member, roomName: '實作房', modelId: 'CLAUDE' as const };
    const ticket = bench.send({ groupId: group.id, from: leadParty, to: memberParty, body: '搬資料夾測試' });
    bench.claim(group.id, memberParty, 'src/move.ts');
    expectMemoryOnFork = true;

    const moved = await moveClaudeRoom(deps, rooms.get(ids.member)!, { folder: newFolder, copyMemory: true });
    assert.equal(memoryReadyAtFork, true, 'memory files already exist on disk when fork is called');
    assert.equal(moved.room.id, ids.fresh);
    assert.equal(moved.room.repoPath, newFolder);
    assert.equal(moved.room.sessionId, forkedSession);
    assert.deepEqual(moved.memory, { copied: 1, skipped: 0, missing: false });
    const dstMemFile = join(projectsRoot, claudeProjectSlug(newFolder), 'memory', 'project.md');
    assert.equal(await readFile(dstMemFile, 'utf8'), 'remember this');

    // Group seat, role, direction, open tickets, claims, and successor all follow the new room.
    const updatedGroup = groups.get(group.id)!;
    const newMember = updatedGroup.members.find(m => m.roomId === ids.fresh);
    assert.ok(newMember, 'new room holds the group seat');
    assert.deepEqual(newMember?.role, { key: 'implement', direction: '专注簡潔實作' });
    assert.equal(updatedGroup.members.some(m => m.roomId === ids.member), false);
    assert.equal(bench.mine(forkedSession).some(t => t.id === ticket.id), true, 'open ticket follows new session ID');
    assert.equal(bench.claims(group.id).some(c => c.scope === 'src/move.ts' && c.by.sessionId === forkedSession), true, 'claim follows new session ID');
    assert.equal(successors.snapshot()[ids.member], forkedSession);
    assert.deepEqual(log, [`close:${ids.member}`, `fork:${ids.member}:${newFolder}`, `archive:${ids.member}`, `greet:${ids.fresh}`]);
    assert.match(greetedPrompt ?? '', /實作房/);
    assert.ok(greetedPrompt?.includes(newFolder), 'agent prompt names new working folder');
    assert.match(greetedPrompt ?? '', /唔再適用/);
    assert.ok(notes.some(n => n.startsWith(`${ids.fresh}:`) && n.includes(newFolder) && n.includes('唔再適用')));

    // 4. A throwing memory copy (e.g. target memory path is a file instead of a directory) does not stop the move and is noted.
    expectMemoryOnFork = false;
    notes.length = 0;
    const thirdFolder = join(dir, 'repo-third');
    await mkdir(thirdFolder, { recursive: true });
    const srcMem2 = join(projectsRoot, claudeProjectSlug(newFolder), 'memory');
    await mkdir(srcMem2, { recursive: true });
    await writeFile(join(srcMem2, 'extra.md'), 'extra memory');
    const brokenTarget = join(projectsRoot, claudeProjectSlug(thirdFolder));
    await mkdir(brokenTarget, { recursive: true });
    await writeFile(join(brokenTarget, 'memory'), 'blocking file');

    const movedDespiteMemError = await moveClaudeRoom(deps, rooms.get(ids.fresh)!, { folder: thirdFolder, copyMemory: true });
    assert.equal(movedDespiteMemError.folder, thirdFolder);
    assert.equal(movedDespiteMemError.memory, undefined);
    assert.ok(
      notes.some(n => n.startsWith(`${ids.fresh}:`) && /記憶複製失敗：.*，已略過/.test(n)),
      'room note records memory copy failure and says it was skipped',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('Codex and AGY room moves: forkAgyConversation rewrites SQLite and cache, Codex and AGY bind new session IDs, preserve model/effort/fastMode, hand over group seat/tickets/claims, and reopen old room on failure', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-move-codex-agy-')));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    const oldFolder = join(dir, 'repo-old');
    const codexFolder = join(dir, 'repo-codex-new');
    const agyFolder = join(dir, 'repo-agy-new');
    await mkdir(oldFolder, { recursive: true });
    await mkdir(codexFolder, { recursive: true });
    await mkdir(agyFolder, { recursive: true });

    // 1. Prove forkAgyConversation copies SQLite DB + brain logs + last_conversations.json and readSession reads the forked AGY session in agyFolder.
    const oldAgyId = '55555555-0000-4000-8000-000000000005';
    const newAgyId = '66666666-0000-4000-8000-000000000006';
    const agyRoot = join(dir, '.gemini/antigravity-cli');
    await mkdir(join(agyRoot, 'conversations'), { recursive: true });
    await mkdir(join(agyRoot, 'brain', oldAgyId, '.system_generated/logs'), { recursive: true });
    await mkdir(join(agyRoot, 'annotations'), { recursive: true });
    await mkdir(join(agyRoot, 'cache'), { recursive: true });
    await writeFile(join(agyRoot, 'annotations', `${oldAgyId}.pbtxt`), 'title:"Test AGY"\n');
    await writeFile(join(agyRoot, 'cache/last_conversations.json'), JSON.stringify({ [oldFolder]: oldAgyId }, null, 2));

    const srcDbPath = join(agyRoot, 'conversations', `${oldAgyId}.db`);
    const srcDb = new DatabaseSync(srcDbPath);
    srcDb.exec(`
      CREATE TABLE trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer, PRIMARY KEY (trajectory_id));
      CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, error_details blob, permissions blob, task_details blob, render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
      CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
      CREATE TABLE executor_metadata (idx integer, data blob, PRIMARY KEY (idx));
      CREATE TABLE parent_references (idx integer, data blob, PRIMARY KEY (idx));
      CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob, PRIMARY KEY (id));
      CREATE TABLE battle_mode_infos (idx integer, data blob, PRIMARY KEY (idx));
    `);
    srcDb.prepare('INSERT INTO trajectory_meta VALUES (?, ?, 4, 17)').run('11111111-1111-4111-8111-111111111111', oldAgyId);
    srcDb.prepare('INSERT INTO trajectory_metadata_blob VALUES (?, ?)').run('main', rewriteAgyMetadataBlob(undefined, oldAgyId, oldFolder));
    srcDb.prepare('INSERT INTO steps (idx, metadata, step_payload) VALUES (0, ?, ?)').run(
      Buffer.from(`meta:${oldAgyId}`, 'utf8'),
      Buffer.from(`payload:${oldAgyId}`, 'utf8'),
    );
    srcDb.close();

    const agyTranscriptRows = [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-21T10:00:00Z', content: '<USER_REQUEST>\nHello Hitomi\n</USER_REQUEST>' }),
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-21T10:00:02Z', model: 'gemini-4-argon-high', input_tokens: 1000, output_tokens: 50, content: 'Hello Alice!' }),
    ].join('\n') + '\n';
    await writeFile(join(agyRoot, 'brain', oldAgyId, '.system_generated/logs/transcript_full.jsonl'), agyTranscriptRows);

    await forkAgyConversation(dir, oldAgyId, newAgyId, agyFolder);

    const forkedDb = new DatabaseSync(join(agyRoot, 'conversations', `${newAgyId}.db`));
    const metaRow = forkedDb.prepare('SELECT trajectory_id, cascade_id FROM trajectory_meta').get() as { trajectory_id: string; cascade_id: string };
    assert.equal(metaRow.cascade_id, newAgyId);
    assert.notEqual(metaRow.trajectory_id, '11111111-1111-4111-8111-111111111111');
    const blobRow = forkedDb.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get() as { data: Uint8Array };
    const blobText = Buffer.from(blobRow.data).toString('utf8');
    assert.equal(blobText.includes(newAgyId), true, 'rewritten metadata blob contains new cascade_id');
    assert.equal(blobText.includes(agyFolder), true, 'rewritten metadata blob contains new folder URI');
    assert.equal(blobText.includes(oldAgyId), false, 'old cascade_id replaced');
    const stepRow = forkedDb.prepare('SELECT metadata, step_payload FROM steps WHERE idx = 0').get() as { metadata: Uint8Array; step_payload: Uint8Array };
    assert.equal(Buffer.from(stepRow.metadata).toString('utf8'), `meta:${newAgyId}`);
    assert.equal(Buffer.from(stepRow.step_payload).toString('utf8'), `payload:${newAgyId}`);
    forkedDb.close();

    const cacheAfter = JSON.parse(await readFile(join(agyRoot, 'cache/last_conversations.json'), 'utf8'));
    assert.equal(cacheAfter[oldFolder], oldAgyId, 'old folder mapping stays untouched');
    assert.equal(cacheAfter[agyFolder], newAgyId, 'new folder maps to new AGY conversation ID');

    // readSession reads the forked AGY conversation with its model and effort.
    const agySession = await readSession(
      'AGY',
      join(agyRoot, 'brain', newAgyId, '.system_generated/logs/transcript_full.jsonl'),
      join(agyRoot, 'brain'),
      dir,
    );
    assert.ok(agySession);
    assert.equal(agySession!.id, newAgyId);
    assert.equal(agySession!.activeModel, 'gemini-4-argon-high');
    assert.equal(agySession!.lastEffort, 'high');
    assert.equal(agySession!.logs.length, 2);

    // 1b. WAL mode test: a committed row that lives only in the -wal file (wal_autocheckpoint=0, writer still open) is included in the forked DB.
    const walOldId = '12121212-0000-4000-8000-000000000012';
    const walNewId = '13131313-0000-4000-8000-000000000013';
    const walFolder = join(dir, 'repo-agy-wal');
    await mkdir(walFolder, { recursive: true });
    const walSrcPath = join(agyRoot, 'conversations', `${walOldId}.db`);
    await writeFile(walSrcPath, await readFile(srcDbPath));
    const walWriter = new DatabaseSync(walSrcPath);
    try {
      walWriter.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
      walWriter.prepare('UPDATE trajectory_meta SET cascade_id = ?').run(walOldId);
      walWriter.prepare('INSERT INTO steps (idx, metadata, step_payload) VALUES (99, ?, ?)').run(
        Buffer.from(`wal-only-meta:${walOldId}`, 'utf8'),
        Buffer.from(`wal-only-payload:${walOldId}`, 'utf8'),
      );
      const rollbackWal = await forkAgyConversation(dir, walOldId, walNewId, walFolder);
      const walForkedDb = new DatabaseSync(join(agyRoot, 'conversations', `${walNewId}.db`));
      const walRow = walForkedDb.prepare('SELECT metadata, step_payload FROM steps WHERE idx = 99').get() as { metadata: Uint8Array; step_payload: Uint8Array } | undefined;
      assert.ok(walRow, 'WAL-only committed row is present in the forked database');
      assert.equal(Buffer.from(walRow!.metadata).toString('utf8'), `wal-only-meta:${walNewId}`);
      assert.equal(Buffer.from(walRow!.step_payload).toString('utf8'), `wal-only-payload:${walNewId}`);
      walForkedDb.close();

      // 1c. Failure cleanup test: even if -wal and -shm files exist alongside <new>.db, rollback removes .db, .db-wal, .db-shm, brain, annotations and restores last_conversations.json.
      const walDstPath = join(agyRoot, 'conversations', `${walNewId}.db`);
      await writeFile(`${walDstPath}-wal`, 'wal-bytes');
      await writeFile(`${walDstPath}-shm`, 'shm-bytes');
      await rollbackWal();
      for (const removed of [walDstPath, `${walDstPath}-wal`, `${walDstPath}-shm`, join(agyRoot, 'brain', walNewId), join(agyRoot, 'annotations', `${walNewId}.pbtxt`)]) {
        await assert.rejects(readFile(removed), /ENOENT/);
      }
      const cacheAfterRollback = JSON.parse(await readFile(join(agyRoot, 'cache/last_conversations.json'), 'utf8'));
      assert.equal(Object.hasOwn(cacheAfterRollback, walFolder), false, 'mapping entry added for the failed fork is removed');
      assert.equal(cacheAfterRollback[oldFolder], oldAgyId, 'existing mapping entries remain intact');
    } finally {
      walWriter.close();
    }

    // 1d. Schema guard test: a database missing expected tables or columns is refused cleanly and leaves no destination file or cache entry.
    const badSchemaOldId = '14141414-0000-4000-8000-000000000014';
    const badSchemaNewId = '15151515-0000-4000-8000-000000000015';
    const badSchemaFolder = join(dir, 'repo-agy-badschema');
    await mkdir(badSchemaFolder, { recursive: true });
    const badDbPath = join(agyRoot, 'conversations', `${badSchemaOldId}.db`);
    const badDb = new DatabaseSync(badDbPath);
    badDb.exec('CREATE TABLE trajectory_meta (trajectory_id text PRIMARY KEY);');
    badDb.close();
    await assert.rejects(
      forkAgyConversation(dir, badSchemaOldId, badSchemaNewId, badSchemaFolder),
      /AGY 的對話資料格式有變，暫時未能更改工作資料夾/,
    );
    await assert.rejects(readFile(join(agyRoot, 'conversations', `${badSchemaNewId}.db`)), /ENOENT/, 'no destination DB file created when schema check fails');
    const cacheAfterBadSchema = JSON.parse(await readFile(join(agyRoot, 'cache/last_conversations.json'), 'utf8'));
    assert.equal(Object.hasOwn(cacheAfterBadSchema, badSchemaFolder), false);

    // 1e. Protobuf fallback test: an unparseable non-empty blob is refused instead of fabricating a project; an empty/missing blob row still works.
    assert.throws(
      () => rewriteAgyMetadataBlob(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]), newAgyId, agyFolder),
      /AGY 的對話資料格式有變，暫時未能更改工作資料夾/,
    );
    const fromEmptyBlob = rewriteAgyMetadataBlob(undefined, newAgyId, agyFolder);
    assert.equal(fromEmptyBlob.toString('utf8').includes(newAgyId), true);
    assert.equal(fromEmptyBlob.toString('utf8').includes('default-cli-project'), true);

    // 2. Prove readSession and Rooms.sync bind a forked Codex rollout (with forked_from_id & thread_settings_applied) and merge parent logs.
    const oldCodexId = ids.codex;
    const newCodexId = '77777777-0000-4000-8000-000000000007';
    const codexRoot = join(dir, '.codex/sessions');
    await mkdir(join(codexRoot, '2026/11/21'), { recursive: true });
    const parentRollout = join(codexRoot, '2026/11/21', `rollout-2026-11-21T10-00-00-${oldCodexId}.jsonl`);
    const forkedRollout = join(codexRoot, '2026/11/21', `rollout-2026-11-21T10-05-00-${newCodexId}.jsonl`);
    await writeFile(parentRollout, [
      JSON.stringify({ timestamp: '2026-11-21T10:00:00Z', ordinal: 0, type: 'session_meta', payload: { id: oldCodexId, session_id: oldCodexId, cwd: oldFolder } }),
      JSON.stringify({ timestamp: '2026-11-21T10:00:01Z', ordinal: 1, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build feature A' }] } }),
      JSON.stringify({ timestamp: '2026-11-21T10:00:02Z', ordinal: 2, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Feature A built.' }] } }),
    ].join('\n') + '\n');
    await writeFile(forkedRollout, [
      JSON.stringify({ timestamp: '2026-11-21T10:05:00Z', ordinal: 0, type: 'session_meta', payload: { id: newCodexId, session_id: newCodexId, forked_from_id: oldCodexId, cwd: codexFolder, history_mode: 'paginated' } }),
      JSON.stringify({ timestamp: '2026-11-21T10:05:00Z', ordinal: 1, type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: newCodexId, thread_settings: { model: 'gpt-6.2-sol', reasoning_effort: 'high' } } }),
    ].join('\n') + '\n');

    const parentCodexSession = await readSession('CODEX', parentRollout, codexRoot, dir);
    const forkedCodexSession = await readSession('CODEX', forkedRollout, codexRoot, dir);
    assert.ok(parentCodexSession && forkedCodexSession);
    assert.equal(forkedCodexSession!.id, newCodexId);
    assert.equal(forkedCodexSession!.forkedFromId, oldCodexId);
    assert.equal(forkedCodexSession!.cwd, codexFolder);
    assert.equal(forkedCodexSession!.activeModel, 'gpt-6.2-sol');
    assert.equal(forkedCodexSession!.lastEffort, 'high');

    // Rooms.sync matches the forked Codex rollout to the live forked Codex room and merges parent logs.
    const roomsMgr = new Rooms(dir, () => {});
    roomsMgr.sessionHome = dir;
    (roomsMgr as any).sync(parentCodexSession);
    const liveForkedCodexId = '88888888-0000-4000-8000-000000000008';
    const liveForkedCodex: TerminalRoom = {
      ...room(liveForkedCodexId, 'CODEX', '光 · 實作', undefined as unknown as string),
      sessionId: undefined,
      repoPath: codexFolder,
      selectedSubModel: 'GPT-6.2-Sol',
      effortLevel: 'high',
      logs: [],
      live: true,
    };
    roomsMgr.rooms.set(liveForkedCodex.id, liveForkedCodex);
    (roomsMgr as any).live.set(liveForkedCodex.id, {
      process: { kill() {} }, terminal: {}, queued: 0, dirty: false,
      forkedFromSession: oldCodexId, resolvedCwd: codexFolder,
      seenTranscriptAgents: new Set(), seenTranscriptUsers: new Set(), matchedLocalUsers: new Set(),
    });
    (roomsMgr as any).sync(forkedCodexSession);
    assert.equal(liveForkedCodex.sessionId, newCodexId, 'forked Codex room binds its new session ID via sync');
    assert.equal(liveForkedCodex.logs.length, 2, 'forked Codex room merges parent conversation history');

    // Model and effort display check for AGY when screen has no footer line (noteClaudeModel & noteEffort).
    roomsMgr.characters.AGY.availableSubModels = ['gemini-4-argon-high', 'gemini-4-hydrogen-medium'];
    (roomsMgr as any).rememberAgyModel('agy-moved', 'gemini-4-argon-high');
    const agyMovedRoom: TerminalRoom = {
      ...room('agy-moved', 'AGY', '瞳 · 鑑識', newAgyId),
      selectedSubModel: '—',
      effortLevel: null,
      live: true,
    };
    (roomsMgr as any).noteClaudeModel(agyMovedRoom);
    (roomsMgr as any).noteEffort(agyMovedRoom, undefined);
    assert.equal(agyMovedRoom.selectedSubModel, 'gemini-4-argon', 'AGY room without screen header shows saved launch model');
    assert.equal(agyMovedRoom.effortLevel, 'high', 'AGY room without screen header shows saved launch effort');

    // 3. Full moveRoom flow for both Codex and AGY rooms (failure reopen + success handover, no Claude memory copy).
    const freshCodexRoomId = '99999999-0000-4000-8000-000000000009';
    const freshAgyRoomId = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const roomMap = new Map<string, TerminalRoom>([
      [ids.crown, { ...room(ids.crown, 'CLAUDE', '總管', ids.crown), repoPath: oldFolder, resumable: true }],
      [ids.codex, { ...room(ids.codex, 'CODEX', '光房', oldCodexId), repoPath: oldFolder, selectedSubModel: 'GPT-6.2-Sol', effortLevel: 'high', fastMode: true, resumable: true }],
      [oldAgyId, { ...room(oldAgyId, 'AGY', '瞳房', oldAgyId), repoPath: oldFolder, selectedSubModel: 'Gemini 4 Argon', effortLevel: 'high', resumable: true }],
    ]);
    const groups = new Groups(join(dir, 'groups.json'), () => {}, id => roomMap.get(id));
    const group = groups.create('Trio', [
      { roomId: ids.crown, modelId: 'CLAUDE' },
      { roomId: ids.codex, modelId: 'CODEX' },
      { roomId: oldAgyId, modelId: 'AGY' },
    ]);
    groups.setOrchestrator(group.id, ids.crown);
    groups.setMemberRole(group.id, ids.codex, { preset: 'implement' });
    groups.setMemberDirection(group.id, ids.codex, '光負責實作', 'implement');
    groups.setMemberRole(group.id, oldAgyId, { preset: 'review' });
    groups.setMemberDirection(group.id, oldAgyId, '瞳負責鑑識', 'review');

    const bench = new Bench();
    const successors = new Successors();
    const log: string[] = [];
    const notes: string[] = [];
    let forkFails = false;

    const deps: MoveRoomDeps = {
      workspace: dir,
      claudeProjectsRoot: join(dir, 'unused-claude-projects'),
      rooms: {
        isBusy: () => false,
        fork: async (old, folder) => {
          log.push(`fork:${old.modelId}:${old.id}:${folder}`);
          if (forkFails) throw new Error(`${old.modelId} 啟動失敗`);
          const nextId = old.modelId === 'CODEX' ? freshCodexRoomId : freshAgyRoomId;
          const forked: TerminalRoom = {
            ...room(nextId, old.modelId, old.roomName, old.modelId === 'AGY' ? newAgyId : (undefined as unknown as string)),
            sessionId: old.modelId === 'AGY' ? newAgyId : undefined,
            repoPath: folder,
            selectedSubModel: old.selectedSubModel,
            effortLevel: old.effortLevel,
            fastMode: old.fastMode,
            resumable: true,
          };
          roomMap.set(forked.id, forked);
          return forked;
        },
        close: async old => { log.push(`close:${old.id}`); old.live = false; },
        reopen: async old => { log.push(`reopen:${old.id}`); old.live = true; },
        archive: async old => { log.push(`archive:${old.id}`); },
        find: id => roomMap.get(id),
        greet: async fresh => {
          log.push(`greet:${fresh.id}`);
          if (fresh.modelId === 'CODEX') fresh.sessionId = newCodexId;
        },
      },
      groups,
      bench,
      successors,
      note: (id, text) => { notes.push(`${id}:${text}`); },
      pause: async () => {},
    };

    // Failure path for Codex and AGY: reopens old room on its own session.
    forkFails = true;
    await assert.rejects(moveRoom(deps, roomMap.get(ids.codex)!, { folder: codexFolder }), /CODEX 啟動失敗/);
    assert.equal(roomMap.get(ids.codex)!.live, true, 'old Codex room reopened on fork failure');
    await assert.rejects(moveRoom(deps, roomMap.get(oldAgyId)!, { folder: agyFolder }), /AGY 啟動失敗/);
    assert.equal(roomMap.get(oldAgyId)!.live, true, 'old AGY room reopened on fork failure');
    forkFails = false;
    log.length = 0;

    // Success path for Codex room.
    const leadParty = { sessionId: ids.crown, roomName: '總管', modelId: 'CLAUDE' as const };
    const codexParty = { sessionId: oldCodexId, roomName: '光房', modelId: 'CODEX' as const };
    const agyParty = { sessionId: oldAgyId, roomName: '瞳房', modelId: 'AGY' as const };
    const codexTicket = bench.send({ groupId: group.id, from: leadParty, to: codexParty, body: 'Codex task' });
    const agyTicket = bench.send({ groupId: group.id, from: leadParty, to: agyParty, body: 'AGY task' });
    bench.claim(group.id, codexParty, 'bridge/codex.ts');
    bench.claim(group.id, agyParty, 'bridge/agy.ts');

    const movedCodex = await moveRoom(deps, roomMap.get(ids.codex)!, { folder: codexFolder, copyMemory: true });
    assert.equal(movedCodex.room.id, freshCodexRoomId);
    assert.equal(movedCodex.room.sessionId, newCodexId);
    assert.equal(movedCodex.room.selectedSubModel, 'GPT-6.2-Sol');
    assert.equal(movedCodex.room.effortLevel, 'high');
    assert.equal(movedCodex.room.fastMode, true);
    assert.equal(movedCodex.memory, undefined, 'Codex room move never copies Claude memory');
    assert.equal(bench.mine(newCodexId).some(t => t.id === codexTicket.id), true);
    assert.equal(bench.claims(group.id).some(c => c.scope === 'bridge/codex.ts' && c.by.sessionId === newCodexId), true);
    assert.equal(successors.snapshot()[oldCodexId], newCodexId);

    // Success path for AGY room.
    const movedAgy = await moveRoom(deps, roomMap.get(oldAgyId)!, { folder: agyFolder, copyMemory: true });
    assert.equal(movedAgy.room.id, freshAgyRoomId);
    assert.equal(movedAgy.room.sessionId, newAgyId);
    assert.equal(movedAgy.room.selectedSubModel, 'Gemini 4 Argon');
    assert.equal(movedAgy.room.effortLevel, 'high');
    assert.equal(movedAgy.memory, undefined, 'AGY room move never copies Claude memory');
    assert.equal(bench.mine(newAgyId).some(t => t.id === agyTicket.id), true);
    assert.equal(bench.claims(group.id).some(c => c.scope === 'bridge/agy.ts' && c.by.sessionId === newAgyId), true);
    assert.equal(successors.snapshot()[oldAgyId], newAgyId);

    const finalMembers = groups.get(group.id)!.members;
    assert.deepEqual(finalMembers.find(m => m.roomId === freshCodexRoomId)?.role, { key: 'implement', direction: '光負責實作' });
    assert.deepEqual(finalMembers.find(m => m.roomId === freshAgyRoomId)?.role, { key: 'review', direction: '瞳負責鑑識' });
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test('a normal room starts with the resolved realpath cwd from roomDirectory, and Rooms.start does not override cwd with room.repoPath', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-normal-cwd-')));
  try {
    const physical = join(dir, 'physical-repo');
    const alias = join(dir, 'alias-repo');
    await mkdir(physical, { recursive: true });
    await symlink(physical, alias);
    assert.equal(await roomDirectory(dir, alias), physical, 'roomDirectory resolves symlink to realpath');
    const roomsSource = await readFile(new URL('./rooms.ts', import.meta.url), 'utf8');
    assert.match(roomsSource, /const cwd = await roomDirectory\(this\.workspace, room\.repoPath\);/);
    assert.doesNotMatch(roomsSource, /const cwd = isAbsolute\(room\.repoPath\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('UI: RoomMoveAction is enabled for Claude, Codex and AGY; MoveRoomModal shows memory checkbox for Claude and hides it with per-project memory note for Codex and AGY, with all hooks before early return and zh/en/ja text', async () => {
  for (const modelId of ['CLAUDE', 'CODEX', 'AGY'] as const) {
    const html = renderToStaticMarkup(createElement(RoomMoveAction, {
      room: { id: `r-${modelId}`, modelId, repoPath: '/Volumes/Komorebi/Repo' },
      onMove() {},
    }));
    assert.match(html, new RegExp(`data-move-room="r-${modelId}"`));
    assert.doesNotMatch(html, /disabled=""/);
    assert.doesNotMatch(html, /data-move-room-unsupported/);
    assert.match(html, /更改工作資料夾/);
  }

  const closedHtml = renderToStaticMarkup(createElement(MoveRoomModal, {
    isOpen: false,
    roomName: '響 · 總管',
    currentFolder: '/Volumes/Komorebi/Old',
    workspaceRoot: '/Volumes/Komorebi',
    onBrowseFolder() {},
    onClose() {},
    onMoveRoom() {},
  }));
  assert.equal(closedHtml, '');

  const claudeModalHtml = renderToStaticMarkup(createElement(MoveRoomModal, {
    isOpen: true,
    modelId: 'CLAUDE',
    roomName: '響 · 總管',
    currentFolder: '/Volumes/Komorebi/Old',
    workspaceRoot: '/Volumes/Komorebi',
    onBrowseFolder() {},
    onClose() {},
    onMoveRoom() {},
  }));
  assert.match(claudeModalHtml, /role="dialog"[^>]*aria-label="更改工作資料夾"/);
  assert.match(claudeModalHtml, /同時複製記憶/);
  assert.match(claudeModalHtml, /data-move-copy-memory(?![^>]*checked)/, 'copy memory checkbox is OFF by default for Claude');
  assert.doesNotMatch(claudeModalHtml, /data-move-project-memory/);

  for (const modelId of ['CODEX', 'AGY'] as const) {
    const nonClaudeModalHtml = renderToStaticMarkup(createElement(MoveRoomModal, {
      isOpen: true,
      modelId,
      roomName: modelId === 'CODEX' ? '光 · 實作' : '瞳 · 鑑識',
      currentFolder: '/Volumes/Komorebi/Old',
      workspaceRoot: '/Volumes/Komorebi',
      onBrowseFolder() {},
      onClose() {},
      onMoveRoom() {},
    }));
    assert.doesNotMatch(nonClaudeModalHtml, /data-move-copy-memory/, `copy memory checkbox is hidden for ${modelId}`);
    assert.match(nonClaudeModalHtml, /data-move-project-memory[^>]*>記憶按專案存放，會自動跟新專案<\/p>/);
  }

  const modalsSource = await readFile(new URL('../src/components/GuildModals.tsx', import.meta.url), 'utf8');
  const moveModalBody = modalsSource.slice(modalsSource.indexOf('export function MoveRoomModal'), modalsSource.indexOf('const dayMs ='));
  const earlyReturnAt = moveModalBody.indexOf('if (!isOpen) return null;');
  assert.ok(earlyReturnAt > 0, 'MoveRoomModal has early return when closed');
  const afterEarlyReturn = moveModalBody.slice(earlyReturnAt);
  assert.equal(/\buse[A-Z]\w*\s*\(/.test(afterEarlyReturn), false, 'no React hook is called after if (!isOpen) return null');

  assert.equal(zh['room.move.action'], '更改工作資料夾');
  assert.equal(en['room.move.action'], 'Change working folder');
  assert.equal(ja['room.move.action'], '作業フォルダを変更');
  assert.equal(zh['room.move.copyMemory'], '同時複製記憶');
  assert.equal(zh['room.move.projectMemory'], '記憶按專案存放，會自動跟新專案');
  assert.equal(en['room.move.projectMemory'], 'Memory is stored per project and follows the new project automatically');
  assert.equal(ja['room.move.projectMemory'], 'メモリはプロジェクトごとに保存され、新しいプロジェクトに自動で切り替わります');
});
