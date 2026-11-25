import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { RoomAlerts } from '../src/components/RoomAlerts';

const noop = () => {};
const render = (approvals: { roomId: string; approvalId: string; label: string }[], toasts: { id: number; message: string; roomId?: string }[] = []) =>
  renderToStaticMarkup(createElement(RoomAlerts, { approvals, toasts, onOpenRoom: noop, onDismissApproval: noop, onCloseToast: noop }));
const approval = (n: number) => ({ roomId: `room-${n}`, approvalId: `ap-${n}`, label: `響 · 房 ${n} 等待你審批` });

test('every room waiting for an approval keeps its own tappable bubble, so several at once cannot hide each other', () => {
  const html = render([approval(1), approval(2)]);
  assert.match(html, /aria-label="響 · 房 1 等待你審批，按一下前往該房間"/);
  assert.match(html, /aria-label="響 · 房 2 等待你審批，按一下前往該房間"/);
  assert.equal((html.match(/收起這個審批提示/g) ?? []).length, 2);
});

test('more than three waiting rooms are summarised instead of filling the screen', () => {
  const html = render([1, 2, 3, 4, 5].map(approval));
  assert.equal((html.match(/等待你審批，按一下前往該房間/g) ?? []).length, 3);
  assert.match(html, /另外 2 間房都等待審批/);
});

test('toasts stack under the approvals and only those for a room can be opened', () => {
  const html = render([approval(1)], [{ id: 1, message: '光 · R5 已完成', roomId: 'r5' }, { id: 2, message: '已複製 Session ID' }]);
  assert.match(html, /aria-label="光 · R5 已完成，按一下前往該房間"/);
  assert.doesNotMatch(html, /已複製 Session ID，按一下/);
  assert.equal((html.match(/關閉通知/g) ?? []).length, 2);
  assert.ok(html.indexOf('等待你審批') < html.indexOf('已完成'));
  assert.equal(render([], []), '');
});
