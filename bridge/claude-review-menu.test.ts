import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLang } from '../src/i18n';
import { LiveTerminal } from '../src/components/LiveTerminal';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';
import { answersReview, modelConfirmationChoices, visibleMenu } from './terminal';

// The last screen of a Claude question card with two questions, as the real CLI (2.1.329, screen-reader mode) draws it.
const review = (typed = '') => ['Questions: 5-bar B (answered), Side marker (answered)', 'Review your answers',
  '> On iPhone, the 5-bar page came out as two tiny lines. Which layout do you want?', '→ A1 one line, sideways (Recommended)',
  '> What marker should show that the strip can be swiped?', '→ B1 edge chevron (Recommended)', 'y. Submit answers', 'n. Cancel', `Enter y/n: ${typed}`.trimEnd()].join('\n');

test('the review step of a question card is a menu with send and cancel, so its y can be pressed', () => {
  assert.equal(answersReview('CLAUDE', review()), true);
  assert.equal(answersReview('CLAUDE', review('y')), true, 'with the y already typed it is still that screen');
  assert.equal(modelConfirmationChoices('CLAUDE', review()), true);
  assert.deepEqual(visibleMenu('CLAUDE', review(), undefined), { title: '提交答案', confirm: true });
  // Other CLIs, a quoted sentence, a changed list and the ordinary prompt are not it.
  assert.equal(answersReview('CODEX', review()), false);
  assert.equal(answersReview('CLAUDE', 'claude: the CLI said "Review your answers" and then "Enter y/n:"\n$'), false);
  assert.equal(answersReview('CLAUDE', review().replace('y. Submit answers', 'y. Do something else')), false);
  assert.equal(answersReview('CLAUDE', review().replace(/Enter y\/n:.*$/, '$')), false);
  assert.equal(visibleMenu('CLAUDE', ['claude: done', 'manual mode on', '$'].join('\n'), undefined), undefined);
});

test('pressing y on the review writes y and Enter to that room only, and n likewise', async () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const room = { id: 'rv', modelId: 'CLAUDE', roomName: 'R', repoPath: '/tmp', logs: [], live: true, status: 'running', ready: false, screen: '', remoteControl: { enabled: false, sessionUrl: '' } } as unknown as TerminalRoom;
  const writes: string[] = [];
  const lines = (text: string) => ({ modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => text.split('\n')[n] ?? '' }) } } });
  const live: any = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: lines(review()), queued: 0, dirty: true };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    (rooms as any).refresh(room, live);
    assert.equal(room.menu?.title, '提交答案');
    assert.equal(room.menu?.yesNo, true);
    live.dirty = false;
    await rooms.handle({ type: 'MENU', roomId: room.id, menuId: room.menu!.id, key: 'y' }, () => {});
    assert.deepEqual(writes, ['y\r']);
    // Right after a key the screen counts as changing, so a second press waits; and a stale menu id sends nothing.
    await assert.rejects(rooms.handle({ type: 'MENU', roomId: room.id, menuId: room.menu!.id, key: 'n' }, () => {}), /畫面更新中/);
    live.dirty = false; live.terminal = lines(review());
    // A flag that stands with nothing more coming (the CLI waits for a person and writes nothing) is read again, so the button works.
    live.dirty = true; live.keyAt = Date.now() - 5_000; live.lastOutputAt = Date.now() - 5_000;
    await rooms.handle({ type: 'MENU', roomId: room.id, menuId: room.menu!.id, key: 'n' }, () => {});
    assert.deepEqual(writes, ['y\r', 'n\r'], 'a stuck flag no longer blocks the button');
    live.dirty = false;
    await assert.rejects(rooms.handle({ type: 'MENU', roomId: room.id, menuId: 'old', key: 'y' }, () => {}), /選單已更新/);
    assert.deepEqual(writes, ['y\r', 'n\r']);
  } finally { (rooms as any).live.delete(room.id); }
});

test('the live terminal offers "send answers" and "cancel" on the review, in each language', () => {
  const room = { id: 'rv', modelId: 'CLAUDE', roomName: 'R', repoPath: '/tmp', logs: [], live: true, ready: false, status: 'running', screen: review(),
    menu: { id: 'm', title: '提交答案', confirm: true, numberKeys: [], yesNo: true } } as unknown as TerminalRoom;
  const names: Record<string, [string, string]> = { zh: ['送出答案', '取消'], en: ['Send answers', 'Cancel'], ja: ['回答を送信', 'キャンセル'] };
  try {
    for (const [lang, [send, cancel]] of Object.entries(names)) {
      setLang(lang as 'zh');
      const html = renderToStaticMarkup(createElement(LiveTerminal, { room, forceOpen: true, disabled: false, onKey() {}, onMenu() {}, onSend() {} } as any));
      assert.ok(html.includes(send) && html.includes(cancel), `${lang}: ${html.slice(0, 200)}`);
    }
  } finally { setLang('zh'); }
});
