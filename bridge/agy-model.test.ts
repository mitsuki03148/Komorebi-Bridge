import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import type { ServerEvent } from '../src/types/bridge';
import { Rooms, cliLaunch } from './rooms';

const models = ['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-hydrogen-low', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-high', 'gemini-3.8-flash-medium'];
const agyRoom = (id: string, extra: Partial<TerminalRoom> = {}) => ({
  id, modelId: 'AGY', roomName: id, repoPath: '/tmp', gitBranch: '—', effortLevel: 'medium', contextUsagePct: null, progressPercent: null,
  syncSource: '', syncedStateFile: '', currentActionSummary: '', bubbleSnippet: '', screen: '', logs: [], live: true, sessionId: `sess-${id}`, resumable: true,
  remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' },
  status: 'idle', selectedSubModel: 'Gemini 4 Hydrogen', updatedAt: '', ready: true, steerable: false, ...extra,
}) as TerminalRoom;

test('an AGY room is launched with its own model, so the CLI default is not what it follows', () => {
  const room = agyRoom('a', { sessionId: undefined });
  assert.ok(!cliLaunch(room, false, true)[1].includes('--model'), 'no choice yet: the CLI default');
  const [, args] = cliLaunch(room, false, true, false, undefined, 'gemini-4-argon-high');
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'gemini-4-argon-high']);
});

test('refresh publishes a newly available AGY model and keeps the last catalog on failure', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const dir = await mkdtemp(join(tmpdir(), 'agy-catalog-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const events: ServerEvent[] = [];
    const rooms = new Rooms(dir, event => events.push(event));
    rooms.characters.AGY.availableSubModels = models;
    const carbon = [
      'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)',
      'gemini-4-carbon-high\tGemini 4 Carbon (High)',
      'gemini-4-carbon-low\tGemini 4 Carbon (Low)',
    ];
    const catalog = [...models, ...carbon, carbon[0]].join('\r\n');
    let reads = 0;
    const fetchModels = async () => { reads++; return catalog; };
    const refresh = (read: () => Promise<string>) => (rooms as any).refreshAgyModels(read);
    await refresh(fetchModels);
    await refresh(fetchModels);
    assert.equal(reads, 1, 'the next usage tick does not repeat the request');
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.type, 'SYNC_UPDATE');
    assert.deepEqual(event.character?.availableSubModels, [...models, ...carbon.map(line => line.split('\t')[0])]);

    const missing = async () => { throw Object.assign(new Error('missing CLI'), { code: 'ENOENT' }); };
    const denied = async () => { throw Object.assign(new Error('command failed'), { code: 1, stderr: 'private CLI output' }); };
    for (const read of [fetchModels, async () => '', missing, denied, denied]) {
      (rooms as any).nextAgyModelCheck = 0;
      await refresh(read);
      assert.equal(events.length, 1, 'only a fresh, different catalog is published');
    }
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [['無法刷新 AGY 模型目錄', 1]]);
    assert.ok(rooms.characters.AGY.availableSubModels.includes('gemini-4-carbon-high'));
    await rooms.close();
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});

test('/model and /effort in an AGY room change that room only: remembered, the CLI reopened on the same conversation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-model-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const rooms = new Rooms(dir, () => {});
    rooms.characters.AGY.availableSubModels = models;
    const a = agyRoom('a'), b = agyRoom('b');
    rooms.rooms.set(a.id, a); rooms.rooms.set(b.id, b);
    const opened: string[] = [];
    const liveFor = (room: TerminalRoom) => { const live: any = { process: { kill: () => live.resolveClose() }, terminal: {}, queued: 0, dirty: false }; (rooms as any).live.set(room.id, live); return live; };
    // Reopening replaces the closed CLI with a new one that waits at its prompt, as the real thing does.
    (rooms as any).resumeForInput = async (room: TerminalRoom) => { opened.push(room.id); liveFor(room); room.ready = true; };
    liveFor(a); liveFor(b);
    const send = (room: TerminalRoom, text: string) => new Promise<string>((resolve, reject) => {
      void rooms.handle({ type: 'INPUT', roomId: room.id, text, requestId: 'r' }, event => { if (event.type === 'ACTION_RESULT') event.ok ? resolve(event.message) : reject(new Error(event.message)); }).catch(reject);
    });
    // The model on screen is pinned the first time it is seen; here it is set by hand the same way.
    (rooms as any).rememberAgyModel(a.id, 'gemini-4-hydrogen-medium'); (rooms as any).rememberAgyModel(b.id, 'gemini-4-hydrogen-medium');

    assert.match(await send(a, '/model gemini-4-argon'), /gemini-4-argon-medium/, 'the family keeps the effort it had');
    assert.match(await send(a, '/effort high'), /gemini-4-argon-high/);
    assert.deepEqual(opened, ['a', 'a'], 'only the room that changed was reopened');
    assert.equal((rooms as any).agyChoices.get('a'), 'gemini-4-argon-high');
    assert.equal((rooms as any).agyChoices.get('b'), 'gemini-4-hydrogen-medium', 'the other room is untouched');
    assert.deepEqual(JSON.parse(await readFile(join(dir, '.env.komorebi-agy-models.json'), 'utf8')), { a: 'gemini-4-argon-high', b: 'gemini-4-hydrogen-medium' });
    assert.match(await send(a, '/effort high'), /已經是這個設定/);
    await assert.rejects(send(a, '/model'), /選單/, 'the CLI\'s own menu is never opened');
    await assert.rejects(send(a, '/model nonsense'), /沒有提供/);
    // Not at its prompt: it waits, nothing is reopened.
    b.ready = false;
    await assert.rejects(send(b, '/effort low'), /CLI 工作中/);
    assert.equal((rooms as any).agyChoices.get('b'), 'gemini-4-hydrogen-medium');
    // A closed room just remembers the choice for its next start.
    (rooms as any).live.delete(b.id);
    assert.match(await send(b, '/effort low'), /下次開房生效/);
    assert.equal((rooms as any).agyChoices.get('b'), 'gemini-4-hydrogen-low');
    // Carbon is selectable even from a model with an effort Carbon does not offer.
    rooms.characters.AGY.availableSubModels = [...models, 'gemini-4-neon-xhigh', 'gemini-4-carbon-medium', 'gemini-4-carbon-high', 'gemini-4-carbon-low'];
    await send(b, '/model gemini-4-neon-xhigh');
    await assert.rejects(send(b, '/model gemini-4-carbon-xhigh'), /沒有提供/);
    assert.match(await send(b, '/model gemini-4-carbon'), /gemini-4-carbon-medium/);
    assert.match(await send(b, '/effort high'), /gemini-4-carbon-high/);
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});
