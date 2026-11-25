import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

async function verifyCodexFileWatch(liveWithoutViewer: boolean) {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-watch-'));
  const roomsUrl = pathToFileURL(resolve('bridge/rooms.ts')).href;
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import { mkdir, writeFile, appendFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { Rooms } from ${JSON.stringify(roomsUrl)};
    import { readSession } from ${JSON.stringify(sessionsUrl)};
    const root = join(process.env.HOME, '.codex/sessions');
    const directory = join(root, '2026/11/12');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'rollout-test.jsonl');
    const id = '00000006-0006-4006-8006-000000000006';
    const meta = {type:'session_meta',payload:{id,cwd:process.env.HOME}};
    await writeFile(file, JSON.stringify(meta) + '\\n');
    process.chdir(process.env.HOME);
    let resolveUpdate;
    const update = new Promise(resolve => { resolveUpdate = resolve; });
    const rooms = new Rooms(process.env.HOME, event => {
      if (event.type === 'SYNC_UPDATE' && event.room?.logs.some(item => item.text === 'new response')) resolveUpdate();
    });
    const session = await readSession('CODEX', file, root, process.env.HOME);
    rooms.sync(session);
    const room = rooms.snapshot()[0];
    if (${liveWithoutViewer}) {
      room.live = true;
      rooms.live.set(room.id, { process: { kill() {} } });
    }
    rooms.watchGroupRooms(${liveWithoutViewer} ? [] : [room.id]);
    await appendFile(file, JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'new response'}]}}) + '\\n');
    let timeout;
    try {
      await Promise.race([update, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('watch timeout')), 4000); })]);
    } finally {
      clearTimeout(timeout);
    }
    if (!rooms.snapshot()[0].logs.some(item => item.text === 'new response')) throw new Error('missing response');
    rooms.live.delete(room.id);
    rooms.watchGroupRooms([]);
    if (rooms.groupWatches.size) throw new Error('unused fallback survived close');
    await rooms.close();
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp }, timeout: 7000,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

test('a viewed group receives transcript updates without reopening the room', { timeout: 8000 }, () => verifyCodexFileWatch(false));

test('a live Codex room catches up without a viewer or native directory watch', { timeout: 8000 }, () => verifyCodexFileWatch(true));

async function verifyCodexFork(dropInitialEvents: boolean) {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-fork-watch-')));
  const roomsUrl = pathToFileURL(resolve('bridge/rooms.ts')).href;
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, open, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { readSession } from ${JSON.stringify(sessionsUrl)};
    const home = process.env.HOME;
    process.chdir(home);
    const root = join(home, '.codex/sessions');
    const today = new Date();
    const directory = join(root, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));
    const cwd = join(home, 'new-workspace');
    await mkdir(directory, { recursive: true });
    await mkdir(cwd);
    const parentId = '77777777-0000-4000-8000-000000000007';
    const sessionId = '88888888-0000-4000-8000-000000000008';
    let dropping = false;
    let maskedWatchers = 0;
    if (${dropInitialEvents}) {
      const nativeWatch = fs.watch;
      fs.watch = (path, ...args) => {
        const watcher = nativeWatch(path, ...args);
        if (String(path) === directory) {
          maskedWatchers++;
          const emit = watcher.emit;
          watcher.emit = function(type, ...values) {
            if (dropping && type === 'change') return true;
            return emit.call(this, type, ...values);
          };
        }
        return watcher;
      };
      syncBuiltinESMExports();
    }
    const { Rooms } = await import(${JSON.stringify(roomsUrl)});
    let roomId;
    const row = value => JSON.stringify(value) + '\\n';
    const meta = (id, extra = {}) => row({ type: 'session_meta', payload: { id, cwd, ...extra } });
    const file = id => join(directory, 'rollout-2026-11-21T10-05-00-' + id + '.jsonl');
    await writeFile(file(parentId), meta(parentId));
    const { promise: initialScan, resolve: ready } = Promise.withResolvers();
    const { promise: metadataSeen, resolve: seen } = Promise.withResolvers();
    const { promise: updated, resolve } = Promise.withResolvers();
    const rooms = new Rooms(cwd, event => {
      if (event.type !== 'SYNC_UPDATE' || !event.room) return;
      if (event.room.sessionId === parentId) ready();
      if (event.room.id !== roomId) return;
      if (event.room.logs.length === 40) seen();
      if (event.room.logs.some(entry => entry.text === 'fork reply')) resolve();
    });
    rooms.refreshUsage = async () => {};
    const parent = await rooms.ensureGroupMember('CODEX', 'Parent');
    parent.sessionId = parentId;
    parent.logs = Array.from({ length: 40 }, (_, n) => ({
      id: parentId + '-' + n, sender: 'agent', text: 'parent ' + n, timestamp: '—',
    }));
    const copied = parent.logs.map(entry => entry.id);
    const lines = ['│ Session: ' + sessionId + ' │', '› Ask Codex to do anything', 'GPT-6.2-Sol high'];
    const live = {
      requested: '/status', queued: 0, dirty: false, resolvedCwd: cwd,
      process: { kill() {} },
      terminal: { buffer: { active: { viewportY: 0, getLine: index => ({
        translateToString: () => lines[index] ?? '',
      }) } } },
    };
    rooms.start = async (fork, _, { forkFromSession }) => {
      fork.live = true;
      rooms.rooms.set(fork.id, fork);
      live.forkedFromSession = forkFromSession;
      rooms.live.set(fork.id, live);
    };
    const room = await rooms.forkRoom(parent, cwd);
    roomId = room.id;
    rooms.refresh(room, live);
    assert.equal(room.sessionId, sessionId);
    assert.equal(room.syncedStateFile, '');
    const messages = [
      { role: 'user', type: 'input_text', text: 'fork prompt' },
      { role: 'assistant', type: 'output_text', text: 'fork progress' },
      { role: 'assistant', type: 'output_text', text: 'fork reply' },
    ];
    const wait = async (event, stage) => {
      const deadline = AbortSignal.timeout(8_000);
      await Promise.race([event, new Promise((_, reject) => {
        deadline.addEventListener('abort', () => reject(new Error(stage)), { once: true });
        if (deadline.aborted) reject(new Error(stage));
      })]);
    };
    try {
      await rooms.watch();
      await wait(initialScan, 'initial transcript was not read');
      dropping = ${dropInitialEvents};
      if (dropping) assert.ok(maskedWatchers > 0, 'fixture masks the native directory watcher');
      const rollout = await open(file(sessionId), 'w');
      try {
        await rollout.writeFile(meta(sessionId, { forked_from_id: parentId }));
        await wait(metadataSeen, 'metadata-only rollout was not synced');
        dropping = false;
        await rollout.appendFile(messages.map(({ role, type, text }, index) => row({
          ordinal: index + 1, type: 'response_item',
          payload: { type: 'message', role, content: [{ type, text }] },
        })).join(''));
        await wait(updated, 'later rollout rows did not sync while the file was open');
        assert.equal(room.live, true);
        const expected = [...copied, ...messages.map((_, n) => sessionId + '-' + (n + 1))];
        assert.deepEqual(room.logs.map(entry => entry.id), expected);
        await rooms.syncWatchedSession(await readSession('CODEX', file(sessionId), root, cwd));
        assert.deepEqual(room.logs.map(entry => entry.id), expected, 'a repeated read does not duplicate any rows');
      } finally { await rollout.close(); }
    } finally { await rooms.close(); }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp, CODEX_HOME: join(tmp, '.codex'), PATH: '' }, timeout: 27_000,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

test('a live Codex fork bound by /status receives later rollout rows', { timeout: 30_000 }, () => verifyCodexFork(false));

test('a live Codex fork finds its rollout when the directory event is missed', { timeout: 30_000 }, () => verifyCodexFork(true));

test('fork recovery expires and stops when a room leaves or the watcher closes', { timeout: 15_000 }, async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-fork-recovery-')));
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { mkdir, writeFile } from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const home = process.env.HOME;
    const root = join(home, '.codex/sessions');
    const today = new Date();
    const directory = join(root, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));
    const parentId = '77777777-0000-4000-8000-000000000007';
    const id = '88888888-0000-4000-8000-000000000008';
    const file = value => join(directory, 'rollout-2026-11-21T10-05-00-' + value + '.jsonl');
    const meta = value => JSON.stringify({ type: 'session_meta', payload: { id: value, cwd: home } }) + '\\n';
    await mkdir(directory, { recursive: true });
    await writeFile(file(parentId), meta(parentId));
    const nativeWatch = fs.watch;
    fs.watch = (path, ...args) => {
      const watcher = nativeWatch(path, ...args);
      if (String(path) === directory) {
        const emit = watcher.emit;
        watcher.emit = function(type, ...values) {
          if (type === 'change') return true;
          return emit.call(this, type, ...values);
        };
      }
      return watcher;
    };
    syncBuiltinESMExports();
    const { watchSessions } = await import(${JSON.stringify(sessionsUrl)});
    const originalNow = Date.now;
    let offset = 0;
    Date.now = () => originalNow() + offset;
    const initial = Promise.withResolvers();
    const seen = [];
    let pending = [];
    let recoveryChecks = 0;
    const stop = watchSessions(() => home, session => {
      seen.push(session.id);
      if (session.id === parentId) initial.resolve();
    }, () => {}, () => {}, undefined, undefined, undefined, () => { recoveryChecks++; return pending; });
    try {
      const deadline = AbortSignal.timeout(8_000);
      await Promise.race([initial.promise, new Promise((_, reject) => deadline.addEventListener('abort', () => reject(new Error('initial scan timeout')), { once: true }))]);
      pending = [id];
      await new Promise(resolve => setTimeout(resolve, 1_200)); // Let the first recovery attempt start its 30-second budget.
      offset = 31_000;
      await writeFile(file(id), meta(id));
      await new Promise(resolve => setTimeout(resolve, 1_500));
      assert.deepEqual(seen, [parentId], 'expired recovery does not import a missed event');
      const leavingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      pending = [leavingId];
      await new Promise(resolve => setTimeout(resolve, 1_200));
      pending = [];
      await writeFile(file(leavingId), meta(leavingId));
      await new Promise(resolve => setTimeout(resolve, 1_500));
      assert.deepEqual(seen, [parentId], 'a room that left is not recovered');
      await stop();
      const checksAtClose = recoveryChecks;
      pending = ['99999999-0000-4000-8000-000000000009'];
      await writeFile(file(pending[0]), meta(pending[0]));
      await new Promise(resolve => setTimeout(resolve, 1_500));
      assert.deepEqual(seen, [parentId], 'closed watcher does not recover files');
      assert.equal(recoveryChecks, checksAtClose, 'closed watcher stops recovery checks');
    } finally { await stop(); Date.now = originalNow; }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp, CODEX_HOME: join(tmp, '.codex'), PATH: '' }, timeout: 12_000,
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

async function verifyForkRecoveryDates(fixedDate = '') {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'codex-recovery-dates-')));
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    if (${JSON.stringify(fixedDate)}) {
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) { if (args.length) super(...args); else super(${JSON.stringify(fixedDate)}); }
      };
    }
    const home = process.env.HOME;
    const root = join(home, '.codex/sessions');
    const now = new Date();
    const directory = offset => {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      return join(root, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    };
    const dirs = [directory(0), directory(1), directory(2)];
    const ids = ['11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000003'];
    const parent = '44444444-0000-4000-8000-000000000004';
    const file = (dir, id) => join(dir, 'rollout-fixture-' + id + '.jsonl');
    const meta = id => JSON.stringify({ type: 'session_meta', payload: { id, cwd: home } }) + '\\n';
    await Promise.all(dirs.map(dir => fsp.mkdir(dir, { recursive: true })));
    await fsp.writeFile(file(dirs[0], parent), meta(parent));
    let checking = false, oldReads = 0, masked = 0;
    const originalReaddir = fsp.readdir;
    fsp.readdir = (path, ...args) => {
      if (checking && String(path) === dirs[2]) oldReads++;
      return originalReaddir(path, ...args);
    };
    const nativeWatch = fs.watch;
    fs.watch = (path, ...args) => {
      const watcher = nativeWatch(path, ...args);
      if (dirs.includes(String(path))) {
        masked++;
        const emit = watcher.emit;
        watcher.emit = function(type, ...values) {
          if (checking && type === 'change') return true;
          return emit.call(this, type, ...values);
        };
      }
      return watcher;
    };
    syncBuiltinESMExports();
    const { watchSessions } = await import(${JSON.stringify(sessionsUrl)});
    const initial = Promise.withResolvers(), recent = Promise.withResolvers();
    const seen = new Set();
    let pending = [];
    const stop = watchSessions(() => home, session => {
      seen.add(session.id);
      if (session.id === parent) initial.resolve();
      if (seen.has(ids[0]) && seen.has(ids[1])) recent.resolve();
    }, () => {}, () => {}, undefined, undefined, undefined, () => pending);
    const wait = async promise => {
      let timer;
      try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('date recovery timeout')), 8_000); })]); }
      finally { clearTimeout(timer); }
    };
    try {
      await wait(initial.promise);
      assert.ok(masked >= 3, 'all date-directory native events are masked');
      pending = ids;
      checking = true;
      await Promise.all(dirs.map((dir, index) => fsp.writeFile(file(dir, ids[index]), meta(ids[index]))));
      await wait(recent.promise);
      await new Promise(resolve => setTimeout(resolve, 1_200));
      assert.equal(oldReads, 0, 'the older directory was never scanned');
      assert.equal(seen.has(ids[2]), false, 'an older session was not imported');
    } finally { await stop(); }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp, CODEX_HOME: join(tmp, '.codex'), PATH: '' }, timeout: 17_000,
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

test('fork recovery reads today and yesterday, but not an older day', { timeout: 20_000 }, () => verifyForkRecoveryDates());
test('fork recovery follows local dates across the new year', { timeout: 20_000 }, () => verifyForkRecoveryDates('2026-01-01T00:01:00'));

test('repeated Codex rollout changes do not indefinitely postpone a completed assistant message', { timeout: 8000 }, async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-codex-burst-')));
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, writeFile, appendFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { watchSessions } from ${JSON.stringify(sessionsUrl)};
    const home = process.env.HOME;
    const dir = join(home, '.codex/sessions/2026/11/23');
    await mkdir(dir, { recursive: true });
    const id = '77777777-0000-4000-8000-000000000007';
    const file = join(dir, 'rollout-fixture-' + id + '.jsonl');
    const row = value => JSON.stringify(value) + '\\n';
    await writeFile(file, row({ type: 'session_meta', payload: { id, cwd: home } }));
    const initial = Promise.withResolvers();
    const reply = Promise.withResolvers();
    let notify;
    const stop = watchSessions(() => home, s => {
      if (s.id !== id) return;
      initial.resolve();
      if (s.logs.some(entry => entry.text === 'final reply')) reply.resolve();
    }, () => {}, () => {}, undefined, undefined, (path, changed) => {
      if (path === file) notify = changed;
    });
    const signal = AbortSignal.timeout(3500);
    const timeout = new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('watch deadline')), { once: true }));
    let timer;
    try {
      await Promise.race([initial.promise, timeout]);
      assert.ok(notify);
      await appendFile(file, row({ ordinal: 1, type: 'response_item', payload: {
        type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final reply' }],
      }}));
      notify();
      // Exact-file callbacks stand for a live process producing more changes inside the debounce window.
      timer = setInterval(() => notify(), 40);
      await Promise.race([reply.promise, timeout]);
    } finally {
      clearInterval(timer);
      await stop();
    }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex') }, timeout: 6000,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a new Codex room recovers an initially empty rollout and stops scanning after binding', { timeout: 15_000 }, async () => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(), 'codex-new-room-recovery-')));
  const roomsUrl = pathToFileURL(resolve('bridge/rooms.ts')).href;
  const sessionsUrl = pathToFileURL(resolve('bridge/sessions.ts')).href;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const home = process.env.HOME;
    const root = join(home, '.codex/sessions');
    const now = new Date();
    const dir = join(root, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
    const cwd = join(home, 'workspace');
    const id = '99999999-0000-4000-8000-000000000009';
    const seed = '77777777-0000-4000-8000-000000000007';
    const file = join(dir, 'rollout-fixture-' + id + '.jsonl');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(cwd);
    await fsp.writeFile(join(dir, 'rollout-fixture-' + seed + '.jsonl'), JSON.stringify({ type:'session_meta', payload:{ id:seed, cwd } }) + '\\n');
    await fsp.writeFile(file, '');
    let masked = 0, scans = 0, countScans = false;
    const originalWatch = fs.watch;
    fs.watch = (path, ...args) => {
      const watcher = originalWatch(path, ...args);
      if (String(path) === dir) {
        masked++;
        const emit = watcher.emit;
        watcher.emit = function(type, ...values) {
          if (type === 'change') return true;
          return emit.call(this, type, ...values);
        };
      }
      return watcher;
    };
    const originalReadDir = fsp.readdir;
    fsp.readdir = (path, ...args) => {
      if (countScans && String(path) === dir) scans++;
      return originalReadDir(path, ...args);
    };
    syncBuiltinESMExports();
    const { Rooms } = await import(${JSON.stringify(roomsUrl)});
    const { readSession } = await import(${JSON.stringify(sessionsUrl)});
    process.chdir(home);
    const initial = Promise.withResolvers(), bound = Promise.withResolvers();
    let roomId;
    const rooms = new Rooms(cwd, event => {
      if (event.type !== 'SYNC_UPDATE' || !event.room) return;
      if (event.room.sessionId === seed) initial.resolve();
      if (event.room.id === roomId && event.room.sessionId === id && event.room.syncedStateFile) bound.resolve();
    });
    rooms.refreshUsage = async () => {};
    const room = await rooms.ensureGroupMember('CODEX', 'new room');
    roomId = room.id; room.repoPath = cwd; room.live = true;
    const lines = ['│ Session: ' + id + ' │', '› Ask Codex to do anything', 'GPT-6.2-Sol high'];
    const live = { requested:'/status', queued:0, dirty:false, resolvedCwd:cwd, process:{ kill() {} },
      terminal:{ buffer:{ active:{ viewportY:0, getLine:index => ({ translateToString:() => lines[index] ?? '' }) } } } };
    rooms.live.set(room.id, live);
    try {
      await rooms.watch();
      await Promise.race([initial.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('initial scan timeout')), 5000))]);
      assert.ok(masked, 'native directory changes are suppressed');
      assert.equal(await readSession('CODEX', file, root, cwd), undefined, 'initial rollout has no metadata');
      rooms.refresh(room, live);
      assert.equal(live.discoveredSessionId, id);
      assert.equal(room.sessionId, undefined);
      countScans = true;
      await fsp.writeFile(file, JSON.stringify({ type:'session_meta', payload:{ id, cwd } }) + '\\n');
      await Promise.race([bound.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('new room did not recover')), 5000))]);
      assert.equal(room.sessionId, id);
      assert.ok(scans > 0, 'the bounded recovery scanned the date directory');
      const afterBinding = scans;
      await new Promise(resolve => setTimeout(resolve, 2200));
      assert.equal(scans, afterBinding, 'the recovery stops scanning after binding');
    } finally { await rooms.close(); }
  `;
  try {
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, HOME: tmp, CODEX_HOME: join(tmp, '.codex'), PATH: '' }, timeout: 12_000,
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
