import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveTerminal } from '../src/components/LiveTerminal';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';

const roomWithDraft = { id: 'terminal-controls', modelId: 'AGY', live: true, ready: true,
  screen: '> Draft', screenId: 'live-screen' } as TerminalRoom;

test('Ctrl+U reaches the current terminal while idle or busy; existing key and screen guards remain', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'komorebi-terminal-controls-'));
  const rooms = new Rooms(cwd, () => {});
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const room = { ...roomWithDraft };
  const writes: string[] = [];
  const live = { queued: 0, dirty: false, process: { write: (key: string) => writes.push(key) } };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  const event = { type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen!, screenId: room.screenId, key: 'ctrl-u' } as const;
  const send = (change: Partial<Pick<typeof event, 'screen' | 'screenId'>> = {}) => rooms.handle({ ...event, ...change }, () => {});
  try {
    await assert.rejects(send({ screen: 'older screen' }));
    await assert.rejects(send({ screenId: 'older id' }));
    await assert.rejects(rooms.handle({ ...event, key: 'enter' }, () => {}));
    await assert.rejects(rooms.handle({ ...event, key: 'escape' }, () => {}));
    live.queued = 1;
    await assert.rejects(send(), /更新中/);
    live.queued = 0;
    room.pendingApproval = {} as TerminalRoom['pendingApproval'];
    await assert.rejects(send());
    room.pendingApproval = undefined;
    room.menu = { id: 'menu', title: '權限設定', confirm: true };
    await assert.rejects(send());
    await assert.rejects(rooms.handle({ type: 'MENU', roomId: room.id, menuId: room.menu.id, key: 'ctrl-u' }, () => {}));
    room.menu = undefined;
    assert.deepEqual(writes, []);
    await send();
    await assert.rejects(send(), /更新中/);
    // Simulate the PTY redraw from the first key, then check the same action while busy.
    live.dirty = false;
    room.ready = false;
    await send();
    assert.deepEqual(writes, ['\x15', '\x15']);
  } finally { (rooms as any).live.delete(room.id); }
});

const panel = (room: TerminalRoom, forceOpen: boolean, compact = true) =>
  renderToStaticMarkup(createElement(LiveTerminal, { room, compact, forceOpen, onMenu() {}, onManualKey() {} }));

test('the expanded terminal displays clear, Esc and Enter without a menu; idle disables Esc and Enter', () => {
  assert.equal(panel(roomWithDraft, false), '');
  const busy = panel({ ...roomWithDraft, ready: false }, true);
  assert.match(busy, /aria-label="手動終端按鍵"/);
  assert.match(busy, /min-h-10 min-w-10[^>]*>清除輸入<\/button>/);
  assert.match(busy, /aria-label="Esc：中斷目前工作" title="Esc：中斷目前工作"/);
  assert.doesNotMatch(busy, /<button[^>]*\sdisabled=""/);
  const idle = panel(roomWithDraft, true, false);
  assert.doesNotMatch(idle, /<button[^>]*\sdisabled=""[^>]*>清除輸入<\/button>/);
  assert.match(idle, /<button[^>]*\sdisabled=""[^>]*>Esc<\/button>/);
  assert.match(idle, /<button[^>]*\sdisabled=""[^>]*>Enter<\/button>/);
  const menu = panel({ ...roomWithDraft, menu: { id: 'menu', title: '權限設定', confirm: true } }, true);
  assert.match(menu, /aria-label="向下"/);
  assert.doesNotMatch(menu, /清除輸入|中斷目前工作/);
  assert.doesNotMatch(panel({ ...roomWithDraft, pendingApproval: {} as TerminalRoom['pendingApproval'] }, true), /清除輸入/);
});

test('compact terminal opens with a screen or an explicit empty message', () => {
  const opened = panel(roomWithDraft, true);
  assert.match(opened, /<pre[^>]*aria-label="CLI 即時畫面"/);
  assert.match(opened, /&gt; Draft/);
  assert.doesNotMatch(opened, /暫時沒有畫面|hidden=""/);
  const empty = panel({ ...roomWithDraft, screen: '' }, true);
  assert.match(empty, /role="status"[^>]*>暫時沒有畫面<\/p>/);
  assert.doesNotMatch(empty, /<pre|清除輸入|hidden=""/);
});
