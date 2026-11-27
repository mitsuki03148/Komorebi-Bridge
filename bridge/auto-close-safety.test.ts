import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Rooms } from './rooms';
import { RoomPresence } from './presence';
import { GroupCloser } from './group-closer';
import type { CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';

const box = (draft = '', footer = 'Gemini 4 Neon · medium') => `────────\n> ${draft}\n────────\n${footer}`;
const idle = {
  CODEX: '› Ask Codex to do anything\nGPT-6.1 Terra high · /tmp',
  CLAUDE: 'bypass permissions on (shift+tab to cycle)\n$',
  AGY: box(),
};

function setup(modelId: CLIModelId, screen: string) {
  const rooms = new Rooms(process.cwd(), () => {});
  const sessionId = '00000006-0006-4006-8006-000000000006';
  const room = { id: 'worker', sessionId, modelId, roomName: 'Worker', repoPath: '/tmp', logs: [], live: true,
    ready: false, status: 'running', resumable: true, remoteControl: {} } as unknown as TerminalRoom;
  let kills = 0;
  const live = { process: { kill: () => kills++, write() {} }, queued: 0, dirty: false, terminal: {} };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  (rooms as any).durableBindings.add(`session-${modelId.toLowerCase()}-${sessionId}`);
  (rooms as any).roomBindings.set(`session-${modelId.toLowerCase()}-${sessionId}`, { roomId: room.id });
  (rooms as any).agyChoices.set(room.id, 'gemini');
  const refresh = (text: string) => {
    live.terminal = { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0,
      translateToString: () => text.split('\n')[n] ?? '' }) } } };
    (rooms as any).refresh(room, live, false);
  };
  refresh(screen);
  return { rooms, room, live, refresh, kills: () => kills };
}

for (const [model, screen] of Object.entries({
  CODEX: 'Build started\n1 background terminal running · /ps to view\n' + idle.CODEX,
  CLAUDE: 'Build started\n1 shell still running\n' + idle.CLAUDE,
  AGY: box('', 'Gemini 4 Neon · medium · 1 task(s) · /tasks'),
})) {
  test(`${model}: an input-ready background build survives both member and crown clocks`, t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const s = setup(model as CLIModelId, screen);
    assert.equal(s.room.ready, true, 'the composer remains usable');
    assert.equal(s.room.backgroundTasks, 1, 'the real parser observes the running build');
    const group = { id: 'g', orchestratorRoomId: s.room.id, members: [{ roomId: s.room.id }] } as GroupChat;
    const closer = new GroupCloser({ groups: () => [group], busy: id => s.rooms.isWorking(id),
      isOpen: id => s.rooms.isOpen(id), report: () => undefined, close: id => { s.rooms.closeUnviewed(id); } });
    const presence = new RoomPresence<string>(id => s.rooms.closeUnviewed(id), 120_000);
    presence.view('phone', s.room.id);
    presence.disconnect('phone');
    closer.checkAll();
    t.mock.timers.tick(600_000);
    assert.equal(s.kills(), 0, 'disconnect must not terminate a background build');
    s.refresh(idle[model as CLIModelId]);
    closer.checkAll();
    t.mock.timers.tick(180_000);
    assert.equal(s.kills(), 1, 'the crown can close after the actual build finishes');
    closer.dispose(); presence.dispose();
  });
}

test('AGY: a stop hint protects reading or compiling even without an English spinner', () => {
  const s = setup('AGY', box('', 'esc to cancel                 Gemini 4 Neon · medium'));
  assert.equal(s.room.ready, false);
  assert.equal(s.rooms.closeUnviewed(s.room.id), false);
  assert.equal(s.kills(), 0);
});

for (const [model, screen] of Object.entries({
  CODEX: '› unfinished instruction\nGPT-6.1 Terra high · /tmp',
  CLAUDE: 'bypass permissions on (shift+tab to cycle)\n$  unfinished instruction',
  AGY: box('unfinished instruction'),
})) {
  test(`${model}: a terminal draft is preserved, clearing it permits closure`, () => {
    const s = setup(model as CLIModelId, screen);
    assert.equal(s.rooms.closeUnviewed(s.room.id), false);
    assert.equal(s.kills(), 0);
    s.refresh(idle[model as CLIModelId]);
    assert.equal(s.rooms.closeUnviewed(s.room.id), true);
    assert.equal(s.kills(), 1);
  });
}

test('open work protects an ungrouped room too', () => {
  const s = setup('CLAUDE', idle.CLAUDE);
  s.rooms.hasOpenTickets = () => true;
  assert.equal(s.rooms.closeUnviewed(s.room.id), false);
  assert.equal(s.kills(), 0);
});

test('a browser draft holds an unviewed room and its crown; clearing it starts a fresh clock', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = setup('CLAUDE', idle.CLAUDE);
  const presence = new RoomPresence<string>(id => s.rooms.closeUnviewed(id), 120_000);
  const g = { id: 'g', orchestratorRoomId: s.room.id, members: [{ roomId: s.room.id }] } as GroupChat;
  const closer = new GroupCloser({ groups: () => [g], busy: id => presence.hasViewers(id) || s.rooms.isWorking(id),
    isOpen: id => s.rooms.isOpen(id), report: () => undefined, close: id => { s.rooms.closeUnviewed(id, 'group-idle'); } });
  presence.onViewChange = () => closer.checkAll();
  presence.view('phone', s.room.id);
  presence.draftMany('phone', [s.room.id]);
  presence.view('phone', 'another-room');
  t.mock.timers.tick(600_000);
  assert.equal(s.kills(), 0, 'switching rooms does not abandon an unfinished draft');
  presence.draftMany('phone', []);
  t.mock.timers.tick(119_999);
  assert.equal(s.kills(), 0);
  t.mock.timers.tick(1);
  assert.equal(s.kills(), 1);
  closer.dispose(); presence.dispose();
});

test('disconnect releases only that client draft, and reconnect within grace restores it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closed: string[] = [];
  const presence = new RoomPresence<string>(id => { closed.push(id); }, 120_000);
  presence.draftMany('phone', ['a']);
  presence.draftMany('mac', ['a']);
  presence.disconnect('phone');
  t.mock.timers.tick(300_000);
  assert.deepEqual(closed, [], 'the Mac still holds its draft');
  presence.disconnect('mac');
  t.mock.timers.tick(119_999);
  presence.register('new-phone');
  presence.draftMany('new-phone', ['a']);
  presence.view('new-phone', null);
  t.mock.timers.tick(300_000);
  assert.deepEqual(closed, []);
  presence.disconnect('new-phone');
  t.mock.timers.tick(120_000);
  assert.deepEqual(closed, ['a'], 'an offline client does not retain the process forever');
  presence.dispose();
});

test('automatic closure logs the reason and pre-close state without conversation or draft text', t => {
  const messages: string[] = [];
  t.mock.method(console, 'info', (message: string) => messages.push(message));
  const s = setup('CLAUDE', idle.CLAUDE);
  assert.equal(s.rooms.closeUnviewed(s.room.id, 'group-idle'), true);
  assert.equal(s.kills(), 1);
  assert.equal(messages.length, 1);
  const record = JSON.parse(messages[0].slice('自動關房 '.length));
  assert.equal(record.reason, 'group-idle');
  assert.equal(record.roomName, 'Worker');
  assert.equal(record.sessionId, s.room.sessionId);
  assert.equal(record.before.status, 'idle');
  assert.equal(record.before.ready, true);
  assert.equal(record.before.backgroundTasks, 0);
  assert.equal(record.before.terminalDraft, false);
  assert.equal(s.room.ready, false, 'the record captured the state before closing');
  assert.ok(!('screen' in record.before) && !('logs' in record));
  s.rooms.closeUnviewed(s.room.id);
  assert.equal(messages.length, 1, 'a second request does not log another kill');
});

test('a foreground tool stays protected while its composer is visible in each CLI', () => {
  for (const model of ['CODEX', 'CLAUDE', 'AGY'] as const) {
    const s = setup(model, 'Working (10m • esc to interrupt)\n' + idle[model]);
    assert.equal(s.room.ready, false, model);
    assert.equal(s.rooms.closeUnviewed(s.room.id), false, model);
    assert.equal(s.kills(), 0, model);
  }
});

test('browser draft presence is capability-gated and carries only known room IDs', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(server, /roomDraftsSupported: true/);
  assert.match(server, /event\.roomIds\.some\(id => typeof id !== 'string' \|\| !rooms\.rooms\.has\(id\)\)/);
  assert.match(server, /presence\.draftMany\(ws, event\.roomIds\)/);
  assert.match(app, /bridge\.state === 'connected' && roomDraftsSupported/);
  assert.match(app, /type: 'DRAFT_ROOMS', roomIds: JSON\.parse\(draftRoomsKey\)/);
});
