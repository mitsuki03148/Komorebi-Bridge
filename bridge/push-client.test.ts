import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { PushPanel } from '../src/components/SettingsModals';
import { urlBase64ToUint8Array } from '../src/utils/pushClient';
import type { PushControl } from '../src/utils/usePush';

const source = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8');

/** Runs the real service worker file against a stand-in for its environment and returns what it did. */
function worker(windows: { focus: () => Promise<void>; postMessage: (message: unknown) => void }[] = []) {
  const handlers: Record<string, (event: any) => void> = {};
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, handler: (event: any) => void) => { handlers[type] = handler; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => windows.map(client => ({ ...client, focus: client.focus })), openWindow: async (url: string) => { opened.push(url); } },
    registration: { showNotification: async (title: string, options: unknown) => { shown.push({ title, options }); } },
  };
  runInNewContext(source, { self, encodeURIComponent });
  const run = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  };
  return { run, shown, opened };
}
const pushEvent = (data: string | undefined, text = '') => ({ data: data === undefined ? null : { json: () => JSON.parse(data), text: () => text } });

test('a push always shows a notification, because Safari drops the subscription of a site that stays silent', async () => {
  const sw = worker();
  await sw.run('push', pushEvent(JSON.stringify({ title: '木漏れ日ギルド', body: '響 · R5 等待你審批', tag: 'komorebi-r1-approval', roomId: 'r1', kind: 'approval' })));
  // Objects made inside the worker's own realm have another prototype, so compare them as plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(sw.shown[0])), { title: '木漏れ日ギルド', options: { body: '響 · R5 等待你審批', tag: 'komorebi-r1-approval', renotify: true, icon: '/icons/icon-192.png', data: { roomId: 'r1' } } });
  await sw.run('push', pushEvent(undefined));
  await sw.run('push', pushEvent('{ not json', '純文字內容'));
  await sw.run('push', pushEvent(JSON.stringify({ title: 42, body: { nested: true }, tag: null, roomId: ['x'] })));
  assert.equal(sw.shown.length, 4, 'every push produced a notification');
  assert.equal(sw.shown[1].title, 'Komorebi Bridge');
  assert.equal(sw.shown[2].options.body, '純文字內容');
  assert.deepEqual([sw.shown[3].title, sw.shown[3].options.body, sw.shown[3].options.tag, sw.shown[3].options.data.roomId], ['Komorebi Bridge', '', 'komorebi', undefined]);
});

test('tapping a notification brings an open app forward and opens the room, or starts the app on that room', async () => {
  const calls: string[] = [];
  const open = worker([{ focus: async () => { calls.push('focus'); }, postMessage: message => { calls.push(JSON.stringify(message)); } }]);
  const closed: boolean[] = [];
  await open.run('notificationclick', { notification: { close: () => closed.push(true), data: { roomId: 'session-claude-abc' } } });
  assert.deepEqual(calls, ['focus', JSON.stringify({ type: 'komorebi-open-room', roomId: 'session-claude-abc' })]);
  assert.deepEqual(closed, [true]);
  assert.deepEqual(open.opened, []);
  const cold = worker();
  await cold.run('notificationclick', { notification: { close() {}, data: { roomId: 'a b/c' } } });
  assert.deepEqual(cold.opened, ['/?room=a%20b%2Fc']);
  await cold.run('notificationclick', { notification: { close() {}, data: {} } });
  await cold.run('notificationclick', { notification: { close() {} } });
  assert.deepEqual(cold.opened.slice(1), ['/', '/']);
});

test('Inbox push opens the pending view for an open or closed app', async () => {
  const calls: unknown[] = [];
  const open = worker([{ focus: async () => {}, postMessage: message => { calls.push(JSON.parse(JSON.stringify(message))); } }]);
  await open.run('push', pushEvent(JSON.stringify({ kind: 'inbox', openInbox: true })));
  await open.run('notificationclick', { notification: { close() {}, data: open.shown[0].options.data } });
  assert.deepEqual(calls, [{ type: 'komorebi-open-inbox' }]);
  const cold = worker();
  await cold.run('notificationclick', { notification: { close() {}, data: { openInbox: true } } });
  assert.deepEqual(cold.opened, ['/?inbox=pending']);
});

test('the Bridge\'s public key is turned into the bytes a browser subscription needs', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);
  assert.equal(urlBase64ToUint8Array('B'.repeat(87)).length, 65);
});

const control = (change: Partial<PushControl> = {}): PushControl => ({ bridgeReady: true, support: { ok: true }, enabled: false, busy: false, enable: async () => {}, disable: async () => {}, test() {}, receive() {}, ...change });
const render = (change?: Partial<PushControl>) => renderToStaticMarkup(createElement(PushPanel, { push: control(change) }));

test('the settings explain what is missing before notifications can be turned on, and offer a test once they are', () => {
  assert.match(render(), /鎖屏推送通知/);
  assert.match(render(), /通知聲跟 iPhone 預設/);
  assert.doesNotMatch(render(), /送一個測試通知/);
  assert.match(render({ enabled: true }), /送一個測試通知/);
  assert.match(render({ bridgeReady: false }), /重啟 Mac Bridge/);
  assert.match(render({ support: { ok: false, reason: 'insecure' } }), /HTTPS/);
  assert.match(render({ support: { ok: false, reason: 'not-installed' } }), /加入主畫面/);
  assert.match(render({ support: { ok: false, reason: 'denied' } }), /設定 → 通知/);
  assert.match(render({ support: { ok: false, reason: 'unsupported' } }), /不支援/);
  assert.match(render({ message: '已發出測試通知' }), /已發出測試通知/);
  for (const html of [render({ bridgeReady: false }), render({ support: { ok: false, reason: 'insecure' } }), render({ busy: true })]) assert.match(html, /role="switch"[^>]*disabled/);
});
