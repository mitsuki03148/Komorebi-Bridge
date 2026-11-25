import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerEvent } from '../src/types/bridge';

// The idle action lists rooms that can close, and closing re-checks each one.
test('idle rooms: busy and ticket-holding rooms are left open, idle ones are closed and archived', async () => {
  const { Rooms } = await import('./rooms');
  const original = process.cwd();
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-idle-'));
  try {
    process.chdir(tmp);
    const events: ServerEvent[] = [];
    const manager = new Rooms(tmp, event => events.push(event));
    const sessions = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'idle' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'busy' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'tickets' },
      { id: '44444444-4444-4444-8444-444444444444', name: 'late' },
    ];
    for (const item of sessions) {
      const file = join(tmp, `${item.name}.jsonl`);
      await writeFile(file, 'session');
      (manager as any).sync({ id: item.id, modelId: 'CODEX', cwd: tmp, branch: 'main', file,
        updated: '2026-11-11T00:00:00Z', logs: [], resumable: true });
    }
    const byName = (name: string) => manager.snapshot().find(room => room.sessionId === sessions.find(item => item.name === name)!.id)!;
    // The hooks decide what counts as busy or holding tickets; tests stand in for the Bridge's live state.
    const busyId = byName('busy').id;
    const ticketId = byName('tickets').id;
    const lateId = byName('late').id;
    manager.retainGroupRooms([byName('idle').id, lateId]);
    (manager as any).isWorking = (id: string) => id === busyId;
    manager.hasOpenTickets = room => room.id === ticketId;

    const replies: ServerEvent[] = [];
    await manager.handle({ type: 'IDLE_ROOMS' }, event => replies.push(event));
    const listed = replies.find(event => event.type === 'IDLE_ROOMS_RESULT');
    assert.ok(listed && listed.type === 'IDLE_ROOMS_RESULT');
    assert.deepEqual(listed.candidates.map(room => room.roomId), [byName('idle').id, lateId]);
    assert.equal(listed.busy, 1);
    assert.equal(listed.tickets, 1);

    // A wake started after the confirmation opened. The same validator must reject it at execution.
    manager.hasDeliveryHold = room => room.id === lateId;
    const closeReplies: ServerEvent[] = [];
    await manager.handle({ type: 'CLOSE_IDLE', roomIds: [byName('idle').id, busyId, ticketId, lateId] }, event => closeReplies.push(event));
    const result = closeReplies.find(event => event.type === 'CLOSE_IDLE_RESULT');
    assert.ok(result && result.type === 'CLOSE_IDLE_RESULT');
    assert.deepEqual(result.closed, [byName('idle').id]);
    assert.deepEqual(result.skipped.map(item => item.reason).sort(), ['busy', 'tickets', 'tickets']);
    assert.deepEqual(result.skipped.find(item => item.roomId === lateId), { roomId: lateId, reason: 'tickets' });
    assert.ok(events.some(event => event.type === 'ARCHIVED' && event.archivedKeys.includes(byName('idle').id)));
    // Each closed room is announced with its id, so the server removes it from its groups.
    assert.ok(events.some(event => event.type === 'ARCHIVED' && event.archivedRoomId === byName('idle').id));
    assert.ok(!events.some(event => event.type === 'ARCHIVED' && event.archivedRoomId === busyId));
    // The idle action asks for quiet group removal, so a group's last member raises no warning.
    assert.ok(events.some(event => event.type === 'ARCHIVED' && event.archivedRoomId === byName('idle').id && event.quiet === true));
    // A single archive keeps its warning.
    const singleArchive: ServerEvent[] = [];
    const before = events.length;
    await manager.handle({ type: 'ARCHIVE', roomId: ticketId, archived: true }, event => singleArchive.push(event));
    assert.ok(events.slice(before).some(event => event.type === 'ARCHIVED' && event.archivedRoomId === ticketId && event.quiet === undefined));
    await manager.handle({ type: 'ARCHIVE', roomId: ticketId, archived: false }, () => {});

    // The archived room is no longer listed; the others are still open.
    const again: ServerEvent[] = [];
    await manager.handle({ type: 'IDLE_ROOMS' }, event => again.push(event));
    const relisted = again.find(event => event.type === 'IDLE_ROOMS_RESULT');
    assert.ok(relisted && relisted.type === 'IDLE_ROOMS_RESULT');
    assert.deepEqual(relisted.candidates, []);

    // Restoring announces the room, so the server can put it back into its groups.
    const restoreReplies: ServerEvent[] = [];
    const restoredEvents = events.length;
    await manager.handle({ type: 'ARCHIVE', roomId: byName('idle').id, archived: false }, event => restoreReplies.push(event));
    assert.ok(events.slice(restoredEvents).some(event => event.type === 'ARCHIVED' && event.restoredRoomId === byName('idle').id));
  } finally {
    process.chdir(original);
    await rm(tmp, { recursive: true, force: true });
  }
});
