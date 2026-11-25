import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AutoCompactRooms, autoCompactArgs, supportsAutoCompact } from './auto-compact';
import { Rooms } from './rooms';
import { contextUsage, type SavedSession } from './sessions';
import type { TerminalRoom } from '../src/types/guild';

test('Codex uses the raw usable window to compact after a turn and keeps its native threshold', () => {
  const record = (window: number) => ({
    type: 'event_msg', payload: {
      type: 'token_count', info: { last_token_usage: { total_tokens: 270_000 }, model_context_window: window },
    },
  });
  const usage = contextUsage('CODEX', [record(258_400)])!;
  assert.equal(usage.codexUsableWindow, 258_400);
  assert.deepEqual(autoCompactArgs('CODEX', false, usage.codexUsableWindow), ['-c', 'model_post_turn_compact_threshold_percent=96']);
  assert.deepEqual(autoCompactArgs('CODEX', false, 475_000), ['-c', 'model_post_turn_compact_threshold_percent=52']);
  assert.deepEqual(autoCompactArgs('CODEX', false, contextUsage('CODEX', [record(200_000)])?.codexUsableWindow), []);
  assert.deepEqual(autoCompactArgs('CODEX', true, 475_000), []);
  assert.deepEqual(autoCompactArgs('CODEX', false), []);
  assert.deepEqual(autoCompactArgs('CLAUDE', false), ['--autocompact', '250000']);
  assert.equal(supportsAutoCompact('CODEX', 'codex-cli 0.168.0'), false);
  assert.equal(supportsAutoCompact('CLAUDE', 'no compact option'), false);
  assert.equal(supportsAutoCompact('AGY', '1.5.14'), false);
  assert.equal(supportsAutoCompact('AGY', '1.5.15'), true);
});

test('a damaged preference file is preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-auto-compact-file-'));
  try {
    const file = join(root, '.komorebi-auto-compact.json');
    await writeFile(file, '["room",null]');
    const store = new AutoCompactRooms(file);
    assert.equal(store.enabled(['room']), false);
    assert.throws(() => store.set(['room'], true), /Auto Compact/);
    assert.equal(await readFile(file, 'utf8'), '["room",null]');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('room preferences apply to native CLI launches without changing a running or neighbouring session', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-auto-compact-'));
  const previousPath = process.env.PATH;
  const previousAgyTarget = process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE;
  const previousPairing = process.env.KOMOREBI_PAIRING_KEY;
  let agyOutput: ((value: string) => void) | undefined;
  const rooms = new Rooms(root, event => {
    if (event.type === 'ROOM' && event.room.modelId === 'AGY') {
      const value = /FIXTURE_TARGET=(\S+)/.exec(event.room.screen ?? '')?.[1];
      if (value) { agyOutput?.(value); agyOutput = undefined; }
    }
  });
  try {
    const bin = join(root, 'bin');
    await mkdir(bin);
    const fixture = '#!/bin/sh\nif [ -n "$KOMOREBI_PAIRING_KEY" ]; then exit 16; fi\nwhile IFS= read -r line; do :; done\n';
    await writeFile(join(bin, 'codex'), fixture.replace('while', 'if [ "$1" = "--version" ]; then echo "codex-cli 0.169.0"; exit; fi\nwhile'), { mode: 0o700 });
    await writeFile(join(bin, 'claude'), fixture.replace('while', 'if [ "$1" = "--help" ]; then echo "   --autocompact <auto|tokens>"; exit; fi\nwhile'), { mode: 0o700 });
    await writeFile(join(bin, 'agy'), fixture.replace('while', 'if [ "$1" = "--version" ]; then echo "1.5.15"; exit; fi\necho "FIXTURE_TARGET=${AGY_CLI_AUTO_COMPACT_OVERRIDE:-unset}"\nwhile'), { mode: 0o700 });
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    process.env.KOMOREBI_PAIRING_KEY = 'fixture-pairing-key';
    delete process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE;

    const resume = async (modelId: TerminalRoom['modelId'], name: string) => {
      const room = await rooms.ensureGroupMember(modelId, name);
      room.sessionId = randomUUID();
      const session: SavedSession = {
        id: room.sessionId, modelId, cwd: room.repoPath, branch: 'main', file: '~/fixture.jsonl',
        updated: new Date().toISOString(), logs: [], resumable: true,
        ...(modelId === 'CODEX' ? { codexUsableContextWindow: 475_000 } : {}),
      };
      (rooms as unknown as { sync(session: SavedSession): void }).sync(session);
      return room;
    };
    const start = (room: TerminalRoom) => rooms.handle({ type: 'START', roomId: room.id }, () => {});
    const set = (room: TerminalRoom, enabled: boolean) => rooms.handle({ type: 'SET_AUTO_COMPACT', roomId: room.id, enabled }, () => {});
    const codex = await resume('CODEX', 'Codex pilot');
    const claude = await resume('CLAUDE', 'Claude pilot');
    const agy = await resume('AGY', 'AGY pilot');
    const other = await resume('CODEX', 'Other room');

    await start(codex);
    await set(codex, true);
    assert.equal(codex.autoCompact, true);
    assert.equal(codex.autoCompactActive, false);
    assert.doesNotMatch(codex.remoteControl.autoLaunchedFlag, /compact_threshold/);
    await rooms.closeRoomAndWait(codex.id);
    await start(codex);
    assert.equal(codex.autoCompactActive, true);
    assert.match(codex.remoteControl.autoLaunchedFlag, /model_post_turn_compact_threshold_percent=52/);
    assert.doesNotMatch(codex.remoteControl.autoLaunchedFlag, /model_auto_compact_token_limit/);
    assert.ok(codex.remoteControl.autoLaunchedFlag.endsWith(codex.sessionId!));

    await start(other);
    assert.equal(other.autoCompactActive, false);
    assert.doesNotMatch(other.remoteControl.autoLaunchedFlag, /compact_threshold/);
    await set(claude, true);
    await start(claude);
    assert.equal(claude.autoCompactActive, true);
    assert.ok(claude.remoteControl.autoLaunchedFlag.includes(`--autocompact 250000 --resume ${claude.sessionId}`));

    await set(agy, true);
    const enabledOutput = new Promise<string>(resolve => { agyOutput = resolve; });
    await start(agy);
    assert.equal(await enabledOutput, '250000');
    assert.equal(agy.autoCompactActive, true);
    assert.equal(process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE, undefined);
    const persisted = new AutoCompactRooms(join(root, '.komorebi-auto-compact.json'));
    assert.equal(persisted.enabled([`session-agy-${agy.sessionId}`]), true);

    await set(agy, false);
    assert.equal(agy.autoCompactActive, true, 'saving does not restart a running CLI');
    await rooms.closeRoomAndWait(agy.id);
    const defaultOutput = new Promise<string>(resolve => { agyOutput = resolve; });
    await start(agy);
    assert.equal(await defaultOutput, 'unset');
    assert.equal(agy.autoCompactActive, false);
    assert.equal(new AutoCompactRooms(join(root, '.komorebi-auto-compact.json')).enabled([agy.id]), false);
  } finally {
    const live = (rooms as unknown as { live: Map<string, { process: { onExit(listener: () => void): unknown } }> }).live;
    const exits = [...live.values()].map(({ process }) => new Promise<void>(resolve => process.onExit(resolve)));
    await rooms.close();
    await Promise.all(exits);
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousAgyTarget === undefined) delete process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE;
    else process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE = previousAgyTarget;
    if (previousPairing === undefined) delete process.env.KOMOREBI_PAIRING_KEY;
    else process.env.KOMOREBI_PAIRING_KEY = previousPairing;
    await rm(root, { recursive: true, force: true });
  }
});

test('the all-rooms switch turns Auto Compact on for every room, keeps room choices, and reads the older list file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-auto-compact-all-'));
  try {
    const file = join(root, '.komorebi-auto-compact.json');
    await writeFile(file, '["lead"]');
    const store = new AutoCompactRooms(file);
    assert.equal(store.all, false);
    assert.equal(store.enabled(['lead']), true);
    assert.equal(store.enabled(['member']), false);
    store.setAll(true);
    assert.equal(store.enabled(['member']), true);
    const reread = new AutoCompactRooms(file);
    assert.equal(reread.all, true);
    assert.equal(reread.enabled(['anyone']), true);
    reread.setAll(false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, all: false, rooms: ['lead'] });
    const last = new AutoCompactRooms(file);
    assert.equal(last.enabled(['lead']), true);
    assert.equal(last.enabled(['member']), false);
    await writeFile(file, '{"version":1,"all":"yes","rooms":[]}');
    const damaged = new AutoCompactRooms(file);
    assert.equal(damaged.enabled(['lead']), false);
    assert.throws(() => damaged.setAll(true), /Auto Compact/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('SET_AUTO_COMPACT_ALL updates every room preference and announces the switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-auto-compact-rooms-'));
  const events: { type: string; enabled?: boolean }[] = [];
  const rooms = new Rooms(root, event => { if (event.type === 'AUTO_COMPACT_ALL') events.push(event); });
  try {
    assert.equal(rooms.autoCompactAll(), false);
    await rooms.handle({ type: 'SET_AUTO_COMPACT_ALL', enabled: true }, () => {});
    assert.equal(rooms.autoCompactAll(), true);
    assert.deepEqual(events, [{ type: 'AUTO_COMPACT_ALL', enabled: true }]);
    assert.deepEqual(JSON.parse(await readFile(join(root, '.komorebi-auto-compact.json'), 'utf8')), { version: 1, all: true, rooms: [] });
    await assert.rejects(rooms.handle({ type: 'SET_AUTO_COMPACT_ALL', enabled: 'yes' as unknown as boolean }, () => {}), /Auto Compact/);
  } finally { await rooms.close(); await rm(root, { recursive: true, force: true }); }
});
