import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms, cliLaunch } from './rooms';

test('a Claude room keeps its own model and effort across a Bridge restart, and a bad saved entry is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-model-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const first = new Rooms(dir, () => {});
    (first as any).rememberClaudeModel('lead', { model: 'claude-opus-5-5', effort: 'high' });
    (first as any).rememberClaudeModel('worker', { model: 'claude-sonnet-5-5', effort: 'medium' });
    // Nothing new seen: the saved choice stays, and an effort that is not shown does not erase the last one.
    (first as any).rememberClaudeModel('worker', { effort: undefined });
    (first as any).rememberClaudeModel('worker', { model: 'claude-sonnet-5-5' });
    const file = join(dir, '.env.komorebi-claude-models.json');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      lead: { model: 'claude-opus-5-5', effort: 'high' }, worker: { model: 'claude-sonnet-5-5', effort: 'medium' },
    });

    const second = new Rooms(dir, () => {});
    assert.deepEqual((second as any).claudeChoices.get('lead'), { model: 'claude-opus-5-5', effort: 'high' }, 'a new Bridge starts the room as it was');
    assert.deepEqual((second as any).claudeChoices.get('worker'), { model: 'claude-sonnet-5-5', effort: 'medium' }, 'the other room is untouched');

    // The room changes model: that room only.
    (second as any).rememberClaudeModel('worker', { model: 'claude-opus-5-5', effort: 'high' });
    assert.equal((second as any).claudeChoices.get('lead').model, 'claude-opus-5-5');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).worker.model, 'claude-opus-5-5');

    await writeFile(file, JSON.stringify({ ok: { model: 'claude-sonnet-5-5' }, bad: { model: 'not a model; rm -rf' }, worse: 7 }));
    const third = new Rooms(dir, () => {});
    assert.deepEqual([...(third as any).claudeChoices.keys()], ['ok']);
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});

const claudeRoom = (id: string, extra: Partial<TerminalRoom> = {}) => ({
  id, modelId: 'CLAUDE', roomName: id, repoPath: '/tmp', gitBranch: '—', effortLevel: 'high', contextUsagePct: null, progressPercent: null,
  syncSource: '', syncedStateFile: '', currentActionSummary: '', bubbleSnippet: '', screen: '', logs: [], live: true, sessionId: `sess-${id}`, resumable: true,
  remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' },
  status: 'idle', selectedSubModel: 'Sonnet 5.5', updatedAt: '', ready: true, steerable: false, ...extra,
}) as TerminalRoom;

test('/model and /effort with a value in a Claude room change that room only: remembered, the CLI reopened on the same conversation, never typed into the CLI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-model-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const rooms = new Rooms(dir, () => {});
    const a = claudeRoom('a'), b = claudeRoom('b');
    rooms.rooms.set(a.id, a); rooms.rooms.set(b.id, b);
    const opened: string[] = [];
    const typed: string[] = [];
    const liveFor = (room: TerminalRoom) => { const live: any = { process: { kill: () => live.resolveClose(), write: (text: string) => typed.push(text) }, terminal: {}, queued: 0, dirty: false }; (rooms as any).live.set(room.id, live); return live; };
    (rooms as any).resumeForInput = async (room: TerminalRoom) => { opened.push(room.id); liveFor(room); room.ready = true; };
    liveFor(a); liveFor(b);
    const send = (room: TerminalRoom, text: string) => new Promise<string>((resolve, reject) => {
      void rooms.handle({ type: 'INPUT', roomId: room.id, text, requestId: 'r' }, event => { if (event.type === 'ACTION_RESULT') event.ok ? resolve(event.message) : reject(new Error(event.message)); }).catch(reject);
    });
    (rooms as any).setClaudeChoice('a', { model: 'claude-sonnet-5-5', effort: 'high' });
    (rooms as any).setClaudeChoice('b', { model: 'claude-sonnet-5-5', effort: 'high' });

    assert.match(await send(a, '/model opus'), /opus · high/, 'the family keeps the effort it had');
    assert.match(await send(a, '/effort max'), /opus · max/);
    assert.equal(a.selectedSubModel, 'opus', 'the picker names the new model, not the one from before the switch');
    assert.deepEqual(opened, ['a', 'a'], 'only the room that changed was reopened');
    assert.deepEqual(typed, [], 'nothing was typed into the CLI, so its global default is not written');
    assert.deepEqual((rooms as any).claudeChoices.get('a'), { model: 'opus', effort: 'max' });
    assert.deepEqual((rooms as any).claudeChoices.get('b'), { model: 'claude-sonnet-5-5', effort: 'high' }, 'the other room is untouched');
    assert.deepEqual(JSON.parse(await readFile(join(dir, '.env.komorebi-claude-models.json'), 'utf8')), {
      a: { model: 'opus', effort: 'max' }, b: { model: 'claude-sonnet-5-5', effort: 'high' },
    });
    assert.match(await send(a, '/effort max'), /已經是這個設定/);
    assert.match(await send(b, '/model sonnet'), /已經是這個設定/, 'a family name matches the full id the room already runs');
    await assert.rejects(send(a, '/model gpt-9'), /沒有提供/);
    await assert.rejects(send(a, '/effort ultra'), /ultra/);
    await assert.rejects(send(a, '/effort turbo'), /沒有提供/);
    // Not at its prompt: it waits, nothing is reopened.
    b.ready = false;
    await assert.rejects(send(b, '/model opus'), /CLI 工作中/);
    assert.equal((rooms as any).claudeChoices.get('b').model, 'claude-sonnet-5-5');
    assert.deepEqual(opened, ['a', 'a']);
    // A closed room just remembers the choice for its next start.
    (rooms as any).live.delete(b.id);
    assert.match(await send(b, '/effort low'), /下次開房生效/);
    assert.deepEqual((rooms as any).claudeChoices.get('b'), { model: 'claude-sonnet-5-5', effort: 'low' });
    // A saved family name survives a restart.
    assert.deepEqual((new Rooms(dir, () => {}) as any).claudeChoices.get('a'), { model: 'opus', effort: 'max' });
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});

test('a Claude room is launched with its saved model and effort, and with none the CLI default applies', () => {
  const room = claudeRoom('a', { sessionId: undefined });
  const flags = (args: string[]) => args.filter((arg, index) => arg === '--model' || arg === '--effort' || args[index - 1] === '--model' || args[index - 1] === '--effort');
  assert.deepEqual(flags(cliLaunch(room, false)[1]), []);
  assert.deepEqual(flags(cliLaunch(room, false, false, false, undefined, undefined, undefined, { model: 'opus', effort: 'max' })[1]), ['--model', 'opus', '--effort', 'max']);
});

test('a Claude room whose screen does not show the effort line shows the effort it was launched with, not the one from the old transcript', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-model-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const rooms = new Rooms(dir, () => {});
    const room = claudeRoom('lead', { effortLevel: 'medium', effortSource: 'session' });
    (rooms as any).setClaudeChoice('lead', { model: 'claude-sonnet-5-5', effort: 'high' });
    // No effort line on the screen: the saved choice is what the CLI runs with.
    (rooms as any).noteEffort(room, undefined);
    assert.equal(room.effortLevel, 'high');
    assert.equal(room.effortSource, 'live');
    // The screen shows it: the screen wins.
    (rooms as any).noteEffort(room, 'low');
    assert.equal(room.effortLevel, 'low');
    // A closed room keeps what the transcript said, and a room with no saved choice is left alone.
    const closed = claudeRoom('lead', { effortLevel: 'medium', effortSource: 'session', live: false });
    (rooms as any).noteEffort(closed, undefined);
    assert.equal(closed.effortLevel, 'medium');
    const none = claudeRoom('other', { effortLevel: 'medium', effortSource: 'session' });
    (rooms as any).noteEffort(none, undefined);
    assert.equal(none.effortLevel, 'medium');
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});

test('a Claude room with no model name on screen (a forked room) shows the model it was launched with', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-model-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const rooms = new Rooms(dir, () => {});
    (rooms as any).setClaudeChoice('moved', { model: 'claude-sonnet-5-5', effort: 'medium' });
    const room = claudeRoom('moved', { selectedSubModel: '—' });
    (rooms as any).noteClaudeModel(room);
    assert.equal(room.selectedSubModel, 'claude-sonnet-5-5');
    // A name already known is kept, a closed room and a room with no saved choice are left alone.
    const known = claudeRoom('moved', { selectedSubModel: 'Opus 5.5' });
    (rooms as any).noteClaudeModel(known);
    assert.equal(known.selectedSubModel, 'Opus 5.5');
    const closed = claudeRoom('moved', { selectedSubModel: '—', live: false });
    (rooms as any).noteClaudeModel(closed);
    assert.equal(closed.selectedSubModel, '—');
    const none = claudeRoom('other', { selectedSubModel: '—' });
    (rooms as any).noteClaudeModel(none);
    assert.equal(none.selectedSubModel, '—');
  } finally { process.chdir(cwd); await rm(dir, { recursive: true, force: true }); }
});

test('a wake text pasted but not submitted is taken out of the input box, and text the Founder typed is left alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clear-paste-'));
  try {
    const rooms = new Rooms(dir, () => {});
    const writes: string[] = [];
    const live: any = { dirty: false, queued: 0, process: { write: (text: string) => writes.push(text) } };
    const codex = (screen: string) => ({ ...claudeRoom('c'), modelId: 'CODEX', screen }) as TerminalRoom;
    const message = '[交接｜來自 工作台] 你的工作台有 2 張新工單：#1 a；#2 b。';
    (rooms as any).clearOwnPaste(codex(`output\n\n› ${message}\n\n  gpt-6 high · ~/p`), live, message);
    assert.deepEqual(writes, ['\x15'], 'our own text is cleared (Ctrl-U)');
    (rooms as any).clearOwnPaste(codex('output\n\n› [Pasted Content 1520 chars]\n\n  gpt-6 high · ~/p'), live, message + '\n' + 'abc'.repeat(500));
    assert.equal(writes.length, 2, 'a paste placeholder is ours too');
    (rooms as any).clearOwnPaste(codex('output\n\n› fix the footer later\n\n  gpt-6 high · ~/p'), live, message);
    (rooms as any).clearOwnPaste(codex('output\n\n›\n\n  gpt-6 high · ~/p'), live, message);
    (rooms as any).clearOwnPaste(codex(`output\n\n› another draft ${message}\n\n  gpt-6 high · ~/p`), live, message);
    (rooms as any).clearOwnPaste({ ...codex(`› ${message}`), pendingQuestion: { id: 'question', questions: [] } }, live, message);
    assert.equal(writes.length, 2, 'unowned drafts and pending questions do not receive a control key');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a reserved bench paste waits for the pending redraw then rechecks authorization before its first Enter', async () => {
  for (const allowed of [true, false]) {
    const rooms = new Rooms(tmpdir(), () => {});
    const item = claudeRoom('worker');
    const writes: string[] = [];
    const live = { queued: 1, process: { write: (value: string) => writes.push(value) } };
    (rooms as any).live.set(item.id, live);
    const result = new Promise<boolean>(resolve => (rooms as any).submitInput(item, live, 'ticket', undefined, 1,
      resolve, undefined, false, undefined, undefined, (phase: string) => phase === 'paste' || allowed));
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.deepEqual(writes, ['ticket']);
    live.queued = 0;
    assert.equal(await result, allowed);
    assert.deepEqual(writes, allowed ? ['ticket', '\r'] : ['ticket']);
    (rooms as any).live.delete(item.id);
  }
});
