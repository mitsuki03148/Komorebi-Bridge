import { mkdtempSync } from './test-temp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventoryTranscripts, makeStorageUsage } from './storage-usage';
import { RoomProtection } from './room-protection';
import { Rooms } from './rooms';
import type { SavedSession } from './sessions';
import type { TerminalRoom } from '../src/types/guild';

test('inventory sums actual transcript lengths and excludes unrelated files', async t => {
  const base = mkdtempSync(join(tmpdir(), 'storage-inventory-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const roots = { CODEX: [join(base, '.codex', 'sessions')], CLAUDE: [join(base, 'claude')], AGY: [join(base, 'agy')] };
  const codex = join(roots.CODEX[0], '2026', '11', '24');
  const claude = join(roots.CLAUDE[0], 'project');
  const agy = join(roots.AGY[0], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '.system_generated', 'logs');
  for (const dir of [codex, claude, agy]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(codex, 'rollout-test.jsonl'), '1234567');
  writeFileSync(join(codex, 'rollout-compressed.jsonl.zst'), '1234');
  writeFileSync(join(claude, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'), '12345');
  writeFileSync(join(agy, 'transcript_full.jsonl'), '123');
  writeFileSync(join(agy, 'other.jsonl'), 'not a transcript');
  const inventory = await inventoryTranscripts(roots);
  assert.equal(inventory.incomplete, false);
  assert.deepEqual([...inventory.files.values()].map(file => file.bytes).sort((a, b) => a - b), [3, 4, 5, 7]);
  assert.deepEqual(makeStorageUsage(inventory.files, roots, [], base, [], [], () => false, 7, false).totals, { CODEX: 11, CLAUDE: 5, AGY: 3 });
});

test('protection, pin, work, ambiguous aliases, and incomplete scans all withhold candidates', () => {
  const root = '/home/test/.codex/sessions';
  const roots = { CODEX: [root], CLAUDE: [], AGY: [] };
  const file = `${root}/2025/01/01/rollout-old.jsonl`;
  const files = new Map([[file, { path: file, bytes: 10, modified: 100 }]]);
  const room = { id: 'room', modelId: 'CODEX', roomName: 'Test', sessionId: 'abc', syncedStateFile: '~/.codex/sessions/2025/01/01/rollout-old.jsonl', live: false } as TerminalRoom;
  const usage = (protectedKeys: string[] = [], pinnedKeys: string[] = [], busy = false, incomplete = false, rooms = [room]) =>
    makeStorageUsage(files, roots, rooms, '/home/test', protectedKeys, pinnedKeys, () => busy, 7, incomplete, 1_000_000_000);
  assert.equal(usage().rooms[0].candidate, true);
  assert.equal(usage(['session-codex-abc']).rooms[0].candidate, false);
  assert.equal(usage([], ['room']).rooms[0].candidate, false);
  assert.equal(usage([], [], true).rooms[0].candidate, false);
  assert.equal(usage([], [], false, true).rooms[0].candidate, false);
  assert.equal(usage([], [], false, false, [room, { ...room, id: 'alias' }]).rooms[0].candidate, false);
  assert.equal(usage([], [], false, false, [{ ...room, live: true }]).rooms[0].candidate, false);
});

test('compressed Codex history is matched by its session ID only when the file is unique', () => {
  const root = '/home/test/.codex/archived_sessions';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const path = `${root}/rollout-2026-01-01-${id}.jsonl.zst`;
  const file = { path, bytes: 123, modified: 100 };
  const room = { id: 'room', sessionId: id, modelId: 'CODEX', roomName: 'Archived', syncedStateFile: '', live: false } as TerminalRoom;
  const roots = { CODEX: [root], AGY: [], CLAUDE: [] };
  const build = (files: Map<string, typeof file>) => makeStorageUsage(files, roots, [room], '/home/test', [], [], () => false, 7, false, 1_000_000_000);
  assert.equal(build(new Map([[path, file]])).rooms[0].bytes, 123);
  const other = `${root}/rollout-other-${id}.jsonl.zst`;
  assert.equal(build(new Map([[path, file], [other, { ...file, path: other }]])).rooms.length, 0);
});

test('unmatched native sessions remain visible without becoming idle candidates', () => {
  const root = '/home/test/.codex/sessions';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const path = `${root}/2025/01/01/rollout-2025-01-01-${id}.jsonl`;
  const files = new Map([[path, { path, bytes: 123, modified: 100 }]]);
  const usage = makeStorageUsage(files, { CODEX: [root], AGY: [], CLAUDE: [] }, [], '/home/test', [], [], () => false, 7, false, 1_000_000_000);
  assert.equal(usage.rooms.length, 0);
  assert.deepEqual(usage.unassigned, [{ id, modelId: 'CODEX', bytes: 123, modified: new Date(100).toISOString() }]);
});

test('protected aliases survive restart; corrupt protection fails closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-protection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'protected.json');
  const store = new RoomProtection(path);
  store.set(['room'], true);
  store.link(['room', 'session-codex-abc']);
  const reopened = new RoomProtection(path);
  assert.equal(reopened.has(['session-codex-abc']), true);
  reopened.set(['room'], false);
  assert.equal(new RoomProtection(path).has(['session-codex-abc']), false);
  writeFileSync(path, '{broken');
  const corrupt = new RoomProtection(path);
  assert.equal(corrupt.has(['any']), true);
  assert.throws(() => corrupt.set(['any'], false));
});

test('a protection write failure disables removal until protection state is checked', t => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-protection-failure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new RoomProtection(join(dir, 'missing', 'protected.json'));
  assert.throws(() => store.set(['room'], true));
  assert.equal(store.readable, false);
  assert.equal(store.has(['other']), true);
});

test('server-side archive deletion refuses protected rooms, then allows them after unprotect', async t => {
  const previous = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'storage-room-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  process.chdir(dir);
  try {
    const rooms = new Rooms(dir, () => {});
    const session = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', modelId: 'CODEX', cwd: dir, branch: 'main', file: 'fixture.jsonl', logs: [], updated: new Date().toISOString(), resumable: true } satisfies SavedSession;
    (rooms as unknown as { sync(session: SavedSession): void }).sync(session);
    const room = rooms.snapshot()[0];
    await rooms.handle({ type: 'PROTECT_ROOM', roomId: room.id, protected: true }, () => {});
    await rooms.handle({ type: 'ARCHIVE', roomId: room.id, archived: true }, () => {});
    await assert.rejects(rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {}), /受保護/);
    assert.ok(rooms.rooms.has(room.id));
    await rooms.handle({ type: 'PROTECT_ROOM', roomId: room.id, protected: false }, () => {});
    await rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {});
    assert.equal(rooms.rooms.has(room.id), false);
  } finally { process.chdir(previous); }
});
