import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftCharacterMenu } from '../src/components/LeftCharacterMenu';
import { orderPinnedRooms, RoomPinAction, RoomPinBadge } from '../src/components/RoomPin';
import type { ClientEvent, ServerEvent } from '../src/types/bridge';
import type { TerminalRoom } from '../src/types/guild';
import { RoomPins } from './pins';
import { Rooms } from './rooms';
import type { SavedSession } from './sessions';

function sandbox(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-pins-'));
  const cwd = process.cwd();
  process.chdir(dir);
  t.after(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file: join(dir, '.env.komorebi-pins.json') };
}

const nativeId = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sessionKey = (n: number, role = 'codex') => `session-${role}-${nativeId(n)}`;
const send = (rooms: Rooms, event: ClientEvent) => rooms.handle(event, () => {});
const pin = (rooms: Rooms, roomId: string, pinned = true) => send(rooms, { type: 'PIN_ROOM', roomId, pinned });

function importRoom(rooms: Rooms, n: number, dir: string, modelId: SavedSession['modelId'] = 'CODEX') {
  const session = {
    id: nativeId(n), modelId, cwd: dir, branch: 'main', file: `fixture-${n}.jsonl`, logs: [],
    updated: new Date(Date.UTC(2026, 0, n)).toISOString(), resumable: true,
  } satisfies SavedSession;
  (rooms as unknown as { sync(s: SavedSession): void }).sync(session);
  return rooms.snapshot().find(room => room.sessionId === session.id)!;
}

test('room pins persist in pin order across Bridge instances, broadcast changes, and use private permissions', async t => {
  const { dir, file } = sandbox(t);
  const events: ServerEvent[] = [];
  const rooms = new Rooms(dir, e => events.push(e));
  const first = importRoom(rooms, 1, dir);
  const second = importRoom(rooms, 2, dir);
  await pin(rooms, first.id);
  await pin(rooms, second.id);
  await pin(rooms, first.id); // Repeated action leaves pin time and update stream unchanged.
  assert.deepEqual(events.filter(e => e.type === 'PINS').map(e => e.pinnedKeys), [[first.id], [first.id, second.id]]);
  assert.equal(statSync(file).mode & 0o777, 0o600);

  const restarted = new Rooms(dir, () => {});
  const firstAfter = importRoom(restarted, 1, dir);
  importRoom(restarted, 2, dir);
  assert.deepEqual(restarted.pinSnapshot(), [first.id, second.id]);
  await pin(restarted, firstAfter.id, false);
  assert.deepEqual(new Rooms(dir, () => {}).pinSnapshot(), [second.id]);
});

test('room pin follows native session binding, keeping its rank across the exact room merge', async t => {
  const { dir } = sandbox(t);
  const events: ServerEvent[] = [];
  const rooms = new Rooms(dir, e => events.push(e));
  const imported = importRoom(rooms, 1, dir);
  const normal = importRoom(rooms, 2, dir);
  const pending = { ...imported, id: nativeId(3), sessionId: undefined };
  const internals = rooms as unknown as { rooms: Map<string, TerminalRoom>; bindSession(room: TerminalRoom, sessionId: string): void };
  internals.rooms.set(pending.id, pending);
  await pin(rooms, pending.id);
  await pin(rooms, normal.id);
  await pin(rooms, imported.id);
  internals.bindSession(pending, nativeId(1));
  assert.ok(events.some(event => event.type === 'ROOM_REMOVED' && event.roomId === imported.id && event.replacementRoomId === pending.id));
  assert.deepEqual(rooms.pinSnapshot(), [pending.id, imported.id, normal.id]);

  const restarted = new Rooms(dir, () => {});
  assert.ok(restarted.snapshot().some(room => room.id === pending.id && room.sessionId === nativeId(1)));
  await pin(restarted, pending.id, false);
  assert.deepEqual(restarted.pinSnapshot(), [normal.id]);
});

test('corrupt pin storage logs an error, reads as empty, and refuses to overwrite', async t => {
  const { dir, file } = sandbox(t);
  const corrupt = '[["session-codex-one"],["session-codex-one"]]';
  writeFileSync(file, corrupt);
  const logged = t.mock.method(console, 'error', () => {});
  const rooms = new Rooms(dir, () => {});
  const room = importRoom(rooms, 1, dir);
  assert.deepEqual(rooms.pinSnapshot(), []);
  assert.equal(logged.mock.callCount(), 1);
  await assert.rejects(pin(rooms, room.id), /無法讀取房間置頂設定/);
  assert.equal(readFileSync(file, 'utf8'), corrupt);
});

test('pin cap counts rooms, not aliases; releasing a pin makes one spot available', t => {
  const { file } = sandbox(t);
  const pins = new RoomPins(file);
  for (let n = 1; n <= 20; n++) pins.set([nativeId(n), sessionKey(n)], true);
  assert.throws(() => pins.set([sessionKey(21)], true), /20/);
  assert.equal(pins.snapshot().length, 40);
  assert.equal(pins.set([sessionKey(1)], true), false);
  pins.set([sessionKey(1)], false);
  pins.set([sessionKey(21)], true);
  assert.deepEqual(new RoomPins(file).snapshot(), pins.snapshot());
  assert.equal(pins.snapshot().at(-1), sessionKey(21));
});

test('archive and idle-close clear pins; restore stays unpinned; delete also clears an old stale pin', async t => {
  const { dir, file } = sandbox(t);
  const events: ServerEvent[] = [];
  const rooms = new Rooms(dir, event => events.push(event));
  const archived = importRoom(rooms, 1, dir);
  const idle = importRoom(rooms, 2, dir);
  const kept = importRoom(rooms, 3, dir);
  for (const room of [archived, idle, kept]) await pin(rooms, room.id);
  await send(rooms, { type: 'ARCHIVE', roomId: archived.id, archived: true });
  await assert.rejects(pin(rooms, archived.id), /不能置頂/);
  await send(rooms, { type: 'CLOSE_IDLE', roomIds: [idle.id] });
  await send(rooms, { type: 'ARCHIVE', roomId: idle.id, archived: false });
  assert.deepEqual(events.filter(e => e.type === 'PINS').at(-1)?.pinnedKeys, [kept.id]);

  // A stale entry can survive if the archive succeeded but the pin file was unwritable.
  writeFileSync(file, JSON.stringify([[archived.id], [kept.id]]));
  const restarted = new Rooms(dir, () => {});
  // Keep the archived room available without transcript sync doing the cleanup first.
  (restarted as unknown as { rooms: Map<string, TerminalRoom> }).rooms.set(archived.id, archived);
  assert.deepEqual(new RoomPins(file).snapshot(), [archived.id, kept.id]);
  assert.deepEqual(restarted.pinSnapshot(), [kept.id]);
  await send(restarted, { type: 'DELETE_ARCHIVED', roomIds: [archived.id] });
  assert.deepEqual(new RoomPins(file).snapshot(), [kept.id]);
  await assert.rejects(pin(restarted, archived.id), /找不到這間房/);
});

test('pin requests reject non-boolean values and unknown room IDs', async t => {
  const { dir } = sandbox(t);
  const rooms = new Rooms(dir, () => {});
  const room = importRoom(rooms, 1, dir);
  const bad = { type: 'PIN_ROOM', roomId: room.id, pinned: 'false' } as unknown as ClientEvent;
  await assert.rejects(send(rooms, bad), /無效置頂狀態/);
  await assert.rejects(pin(rooms, 'missing'), /找不到這間房/);
  assert.deepEqual(rooms.pinSnapshot(), []);
});

test('both room lists sort pins first by pin time and keep the other rooms stable when unpinned', t => {
  const { dir } = sandbox(t);
  const rooms = new Rooms(dir, () => {});
  const first = importRoom(rooms, 1, dir);
  const second = importRoom(rooms, 2, dir);
  const recent = importRoom(rooms, 3, dir);
  const otherRole = importRoom(rooms, 4, dir, 'AGY');
  const codexRooms = [recent, second, first];
  const keys = [first.id, otherRole.id, second.id];
  assert.deepEqual(orderPinnedRooms(codexRooms, keys), [first, second, recent]);
  assert.deepEqual(orderPinnedRooms(codexRooms, keys.slice(1)), [second, recent, first]);
  assert.deepEqual(codexRooms, [recent, second, first]);

  const html = renderToStaticMarkup(createElement(LeftCharacterMenu, {
    rooms: [otherRole, ...codexRooms], pinnedKeys: keys, characters: rooms.characters, selectedRoomId: '',
    onOpenNewRoomModal() {}, onOpenUsageModal() {}, onPokeCharacter() {}, onSelectRoom() {},
  }));
  assert.deepEqual([...html.matchAll(/data-room-id="([^"]+)"/g)].map(match => match[1]), [otherRole.id, first.id, second.id, recent.id]);
  assert.equal([...html.matchAll(/aria-label="已置頂"/g)].length, 3);
});

test('room menu has no pin action for an old Bridge; current Bridge renders each action and pin badge', () => {
  const menu = (supported: boolean, pinned: boolean) =>
    renderToStaticMarkup(createElement(RoomPinAction, { supported, pinned, onToggle() {} }));
  assert.equal(menu(false, false), '');
  assert.match(menu(true, false), /<button[^>]+min-h-11.*置頂房間/);
  assert.match(menu(true, true), /取消置頂/);
  assert.match(renderToStaticMarkup(createElement(RoomPinBadge)), /<span role="img" aria-label="已置頂"/);
});
