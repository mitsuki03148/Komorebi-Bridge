import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { ComposerStopButton, ScrollToLatestButton } from '../src/components/GuildActions';
import { ContextRing } from '../src/components/ControlBar';
import { RejectReason } from '../src/components/RejectReason';
import { MessageBubble, longReplyChars } from '../src/components/MessageBubble';
import { EmptyRoomState } from '../src/components/EmptyRoomState';
import { GuildHallHome } from '../src/components/GuildHallHome';
import { LeftCharacterMenu } from '../src/components/LeftCharacterMenu';
import { GroupChatView } from '../src/components/GroupChat';
import { GroupRoomSidebar } from '../src/components/GroupRoomSidebar';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { zh } from '../src/i18n/zh';
import { getThemeMode, setThemeMode } from '../src/utils/theme';
import type { TerminalRoom } from '../src/types/guild';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const room = (id: string, modelId = 'CODEX', extra = {}) => ({ id, modelId, roomName: id, live: true, ready: true, status: 'idle', logs: [], remoteControl: {}, effortLevel: null, selectedSubModel: 'x', bubbleSnippet: '', ...extra }) as unknown as TerminalRoom;

test('the latest-message button is a round arrow that floats, with a dot only for news', () => {
  const quiet = renderToStaticMarkup(createElement(ScrollToLatestButton, { onClick() {} }));
  assert.match(quiet, /data-scroll-latest/);
  assert.match(quiet, /absolute bottom-full/, 'it floats over the composer instead of adding a row');
  assert.doesNotMatch(quiet, /最新訊息<|新訊息</, 'no words in the button');
  assert.doesNotMatch(quiet, /data-new-dot/);
  assert.match(renderToStaticMarkup(createElement(ScrollToLatestButton, { onClick() {}, newMessages: true })), /data-new-dot/);
  // The three screens use it, and none keeps the old wide text button.
  for (const file of ['src/App.tsx', 'src/components/RightRoomWorkspace.tsx', 'src/components/GroupChat.tsx']) {
    assert.match(source(file), /<ScrollToLatestButton/);
    assert.doesNotMatch(source(file), /↓ 最新訊息/);
  }
});

test('the compact ring shows the share used and turns amber from 70%', () => {
  assert.match(renderToStaticMarkup(createElement(ContextRing, { pct: 40 })), /data-context-ring="40"[\s\S]*#8FB596/);
  assert.match(renderToStaticMarkup(createElement(ContextRing, { pct: 70 })), /#D68631/);
  const unknown = renderToStaticMarkup(createElement(ContextRing, { pct: null }));
  assert.match(unknown, /data-context-ring="unknown"/);
  assert.doesNotMatch(unknown, /stroke-dasharray/, 'no arc when the share is not known');
});

test('stop is not drawn while nothing runs, and the unknown-quota button is gone', () => {
  assert.equal(renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {}, hidden: true })), '');
  assert.match(renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {} })), /data-composer-stop/);
  for (const file of ['src/App.tsx', 'src/components/RightRoomWorkspace.tsx']) assert.doesNotMatch(source(file), /'×\?'/);
});

test('reject with a reason is a fold under the buttons, the plain reject stays, and the reason follows only after the Bridge took the reject', () => {
  const html = renderToStaticMarkup(createElement(RejectReason, { onSubmit() {} }));
  assert.match(html, /data-reject-reason/);
  assert.match(html, /拒絕並說明原因/);
  assert.match(html, /aria-label="拒絕原因"/);
  const app = source('src/App.tsx'), group = source('src/components/GroupChat.tsx'), mac = source('src/components/RightRoomWorkspace.tsx');
  for (const [file, text] of [['App', app], ['GroupChat', group], ['RightRoomWorkspace', mac]]) {
    assert.match(text, /<RejectReason/, file);
    assert.doesNotMatch(text.slice(text.indexOf('<RejectReason') - 400, text.indexOf('<RejectReason') + 400), /setTimeout/, `${file}: no fixed wait before the reason`);
  }
  assert.match(app, /handleDecision\(roomId, 'reject', \(\) => handleSendPrompt\(roomId, reason\)\)/, 'the phone sends the reason once the reject is accepted');
  assert.match(app, /if \(decision !== 'reject'\) playGuildChime\('approve', soundEnabled\);\n\s*accepted\?\.\(\);/, 'accepted runs only from the success path');
  assert.match(app, /onReject=\{\(roomId, reason\) => handleDecision\(roomId, 'reject', reason \?/, 'the desktop passes its reason the same way');
  assert.match(group, /onDecision\(id, 'reject', \(\) => onCommand\?\.\(id, reason\)\)/, 'a group sends plain text, without the draft attachment');
  assert.doesNotMatch(group.slice(group.indexOf('<RejectReason')), /^[^\n]*onSend\(/, 'and not through the attachment path');
  assert.equal((mac.match(/<RejectReason/g) ?? []).length, 2, 'the inline approval card and the pop-up both offer it');
  assert.doesNotMatch(source('src/components/RejectReason.tsx'), /setReason\(''\)/, 'the text stays until the approval is answered');
  assert.match(app, /onClick=\{\(\) => handleDecision\(selectedRoom\.id, 'reject'\)\}/, 'one tap still rejects');
});

test('a long agent reply is folded with a way to open it, a short one and the user\'s own are not', () => {
  const entry = (text: string, sender: 'agent' | 'user' = 'agent') => ({ id: 'e', sender, text, timestamp: '', createdAt: '2026-11-14T01:00:00Z' });
  const bubble = (text: string, sender: 'agent' | 'user' = 'agent') => renderToStaticMarkup(createElement(MessageBubble, { entry: entry(text, sender) as never, modelId: 'AGY', name: '瞳' }));
  assert.match(bubble('x'.repeat(longReplyChars + 1)), /data-long-reply="folded"[\s\S]*展開全文/);
  assert.match(bubble('line\n'.repeat(40)), /data-long-reply="folded"/);
  assert.doesNotMatch(bubble('short'), /data-long-reply/);
  assert.doesNotMatch(bubble('x'.repeat(longReplyChars + 1), 'user'), /data-long-reply/);
});

test('the user bubble is warm washi, still called Me', () => {
  const html = renderToStaticMarkup(createElement(MessageBubble, { entry: { id: 'u', sender: 'user', text: 'hi', timestamp: '', createdAt: '2026-11-14T01:00:00Z' } as never, modelId: 'AGY', name: '瞳' }));
  assert.match(html, /bg-\[#F7EFE4\]/);
  assert.match(html, /Me</);
  assert.doesNotMatch(html, /#FFF3F5|#F2CFD5/);
});

test('the empty screen shows the character with a line of her own and nothing to press', () => {
  const html = renderToStaticMarkup(createElement(EmptyRoomState, { modelId: 'CLAUDE', character: INITIAL_CHARACTERS.CLAUDE }));
  assert.match(html, /data-empty-state="CLAUDE"/);
  assert.match(html, /hibiki-chibi\.webp/);
  assert.match(html, new RegExp(INITIAL_CHARACTERS.CLAUDE.quotes.idle));
  assert.match(html, />待機中</);
  assert.match(renderToStaticMarkup(createElement(EmptyRoomState, { modelId: 'CLAUDE', character: INITIAL_CHARACTERS.CLAUDE, working: true })), />運転中</);
  assert.doesNotMatch(html, /<button/, 'no shortcut buttons, as asked');
  assert.match(source('src/index.css'), /prefers-reduced-motion: reduce\) \{\n  \.guild-empty-sway/);
});

test('a character with more than three rooms can be folded, and groups are one tap away in the room list', () => {
  const rooms = ['a', 'b', 'c', 'd'].map(id => room(id));
  const menu = (items: TerminalRoom[], extra = {}) => renderToStaticMarkup(createElement(LeftCharacterMenu, { characters: INITIAL_CHARACTERS, rooms: items, selectedRoomId: 'a', onSelectRoom() {}, onOpenNewRoomModal() {}, onOpenUsageModal() {}, onPokeCharacter() {}, ...extra }));
  assert.match(menu(rooms), /data-fold-rooms/);
  assert.doesNotMatch(menu(rooms.slice(0, 3)), /data-fold-rooms/, 'three rooms or fewer need no fold');
  assert.doesNotMatch(menu(rooms), /data-group-chips/);
  assert.match(menu(rooms, { groups: [{ id: 'g', name: '測試群', members: [], createdAt: '' }], onSelectGroup() {} }), /data-group-chips[\s\S]*群組 · 測試群/);
});

test('in a group a character with one room is named alone, with two rooms the room is added, and a name tap addresses that member', () => {
  const stamp = (id: string, text: string) => ({ id, sender: 'agent', text, timestamp: '', createdAt: '2026-11-14T01:00:00Z' });
  const one = room('x', 'CODEX', { logs: [stamp('1', 'hello')] }), two = room('y', 'CLAUDE', { roomName: '響房', logs: [stamp('2', 'yo')] }), three = room('z', 'CLAUDE', { roomName: '響房二' });
  const view = (members: TerminalRoom[], extra = {}) => renderToStaticMarkup(createElement(GroupChatView, {
    name: '群', characters: INITIAL_CHARACTERS, recipientId: 'x', members: members.map(item => ({ roomId: item.id, modelId: item.modelId, room: item })),
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {}, ...extra }));
  const bubbles = (html: string) => (html.match(/<article[\s\S]*?<\/article>/g) ?? []).join('\n');
  const single = bubbles(view([one, two]));
  assert.match(single, />光<\/span>/);
  assert.doesNotMatch(single, /光 · x/);
  assert.match(bubbles(view([one, two, three])), />響 · 響房</, 'two rooms of one character keep the room name');
  const tap = bubbles(view([one, two], { onSelectRecipient() {} }));
  assert.match(tap, /data-address-name[^>]*>響</, 'another member\'s name is a button');
  assert.doesNotMatch(tap, /data-address-name[^>]*>光</, 'the member already addressed needs no button');
});

test('the group header is one line, and on the phone the members are a row, not a column', () => {
  const header = source('src/components/GroupChat.tsx');
  assert.doesNotMatch(header, /協作群組 · \{members\.length\}/);
  assert.doesNotMatch(header, /設定範圍以 CLI 選單為準/);
  const strip = renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [{ id: 'g', name: '群', members: [{ roomId: 'a', modelId: 'CODEX' }], createdAt: '' }], rooms: [room('a')], characters: INITIAL_CHARACTERS, selectedGroupId: 'g', onSelectGroup() {}, onSelectRoom() {}, compact: true }));
  assert.match(strip, /data-member-strip/);
  assert.match(source('src/App.tsx'), /streetMobileView \? 'flex-col' : ''/);
});

test('the phone has no white info card above the conversation, and capsules carry no repeated character name', () => {
  const app = source('src/App.tsx');
  assert.doesNotMatch(app, /Session ID <code className="break-all">/);
  assert.doesNotMatch(app, /<span>\{c\.characterName\}<\/span>\s*<span>·<\/span>/);
  assert.doesNotMatch(app, /<span>⚠️<\/span>/);
});

test('a folded long reply shows a real, usable preview (nothing inert) and tells the buttons\' state', () => {
  const html = renderToStaticMarkup(createElement(MessageBubble, { entry: { id: 'l', sender: 'agent', text: 'x [a](https://example.com) '.repeat(400), timestamp: '', createdAt: '2026-11-14T01:00:00Z' } as never, modelId: 'AGY', name: '瞳' }));
  assert.doesNotMatch(html, /inert/, 'no part of the reply is switched off: the links in the preview work and its text can be selected');
  assert.match(html, /data-long-reply="folded"[\s\S]*?<a [^>]*href="https:\/\/example\.com"/, 'a link in the folded preview is a real link');
  assert.ok((html.match(/href="https:\/\/example\.com"/g) ?? []).length < 400, 'folded, only the preview is on the page, not all 400 links');
  assert.match(html, /aria-expanded="false"[^>]*>展開全文/);
  const bubble = source('src/components/MessageBubble.tsx');
  assert.match(bubble, /aria-expanded="true"[\s\S]*?t\('chat\.fold'\)/);
  assert.equal(zh['chat.fold'], '收起長文');
  assert.match(bubble, /expand\.current\?\.focus\(\)/, 'folding puts the focus back on the button that opens it');
});

test('on the phone the member row sits under the group header with a plus, and Escape returns focus to the menu button', () => {
  const header = '<header'; const strip = createElement('i', { id: 'strip' });
  let received: { onAdd?: () => void } | undefined;
  const render = (extra: object) => renderToStaticMarkup(createElement(GroupChatView, { name: '群', characters: INITIAL_CHARACTERS, members: [{ roomId: 'a', modelId: 'CODEX', room: room('a') }],
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {}, memberStrip: (controls: { onAdd?: () => void }) => { received = controls; return strip; }, ...extra } as never));
  const withAdd = render({ onAddMember() {} });
  assert.ok(withAdd.indexOf('</header>') > withAdd.indexOf(header) && withAdd.indexOf('id="strip"') > withAdd.indexOf('</header>') && withAdd.indexOf('id="strip"') < withAdd.indexOf('aria-label="群組對話"'), 'the row is after the header and before the conversation');
  assert.equal(typeof received?.onAdd, 'function');
  render({});
  assert.equal(received?.onAdd, undefined, 'no plus when nobody can be added');
  const sidebar = (onAddMember?: () => void) => renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [{ id: 'g', name: '群', members: [{ roomId: 'a', modelId: 'CODEX' }], createdAt: '' }], rooms: [room('a')], characters: INITIAL_CHARACTERS, selectedGroupId: 'g', onSelectGroup() {}, onSelectRoom() {}, compact: true, onAddMember }));
  assert.match(sidebar(() => {}), /data-add-member[\s\S]*?<\/button><\/nav>/, 'the plus ends the row');
  assert.doesNotMatch(sidebar(), /data-add-member/);
  const app = source('src/App.tsx');
  assert.match(app, /memberStrip=\{streetMobileView \? \(\{ onAdd \}\) => renderGroupSidebar\(onAdd\)/);
  assert.match(app, /\{!streetMobileView && renderGroupSidebar\(\)\}/, 'the desktop keeps its side list');
  assert.match(source('src/components/GroupChat.tsx'), /:scope > summary'\)\?\.focus\(\)/, 'Escape hands the focus back');
});

test('a group shows send status by the same rule as a single room: 400ms before "waiting", and no success line for a plain send', () => {
  const app = source('src/App.tsx');
  assert.match(app, /statuses=\{Object\.fromEntries\(Object\.keys\(feedback\)[\s\S]*?visibleFeedback\(id\)/);
  assert.match(app, /item\.state === 'pending' && slowRooms\[roomId\]/);
  assert.match(app, /item\.state === 'success' && item\.type !== 'INPUT'/);
  assert.match(app, /setTimeout\(\(\) => setSlowRooms\(current => \(\{ \.\.\.current, \[id\]: true \}\)\), 400\)/);
});

test('the compact tooltip uses the same clamped share as the ring, and a folded character never says "0 hidden"', async () => {
  const { contextShare, ControlBar } = await import('../src/components/ControlBar');
  assert.equal(contextShare(150), 100);
  assert.equal(contextShare(-5), 0);
  assert.equal(contextShare(null), undefined);
  assert.equal(contextShare(Number.NaN), undefined);
  const bar = renderToStaticMarkup(createElement(ControlBar, { room: room('c', 'CODEX', { contextUsagePct: 150 }), character: INITIAL_CHARACTERS.CODEX, onCommand() {}, compact: { title: '/compact', onRun() {} }, terminal: { open: false, onToggle() {} }, shield: { onPermissions() {} } } as never));
  assert.match(bar, /已用 100%/);
  assert.match(bar, /data-context-ring="100"/);
  const store = (value: string | null) => { (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => value, setItem() {} }; };
  const menu = (items: TerminalRoom[], working = {}) => renderToStaticMarkup(createElement(LeftCharacterMenu, { characters: INITIAL_CHARACTERS, rooms: items, selectedRoomId: '', working, onSelectRoom() {}, onOpenNewRoomModal() {}, onOpenUsageModal() {}, onPokeCharacter() {} }));
  const four = ['a', 'b', 'c', 'd'].map(id => room(id));
  try {
    for (const bad of ['null', '[]', '7', '"x"', '{not json']) { store(bad); assert.match(menu(four), /data-fold-rooms/, `a saved value of ${bad} is ignored`); }
    store('{"CODEX":true}');
    assert.match(menu(four), /已收起其他 4 間/);
    const allWorking = { a: 'working', b: 'working', c: 'working', d: 'working' } as const;
    const busy = menu(four, allWorking);
    assert.doesNotMatch(busy, /data-fold-rooms/, 'nothing would be hidden, so no fold button');
    assert.doesNotMatch(busy, /已收起其他/);
    assert.equal((busy.match(/data-room-id=/g) ?? []).length, 4, 'every working room stays in view');
    assert.match(menu(four, { a: 'working' }), /已收起其他 3 間/);
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test('group member cards wear character colours and stay above the scrim, the top rail runs GitHub, groups, archive, potion, settings, the bottom bar shows HP/MP, and the chibi breathes and blinks', async () => {
  const { ControlBar } = await import('../src/components/ControlBar');
  const strip = renderToStaticMarkup(createElement(GroupRoomSidebar, {
    groups: [{ id: 'g', name: '群', members: [{ roomId: 'a', modelId: 'AGY' }, { roomId: 'b', modelId: 'CODEX' }, { roomId: 'c', modelId: 'CLAUDE' }], createdAt: '' }],
    rooms: [room('a', 'AGY', { roomName: 'Komorebi CLI Bridge' }), room('b', 'CODEX', { roomName: 'Komorebi CLI App' }), room('c', 'CLAUDE', { roomName: 'CLI app' })],
    characters: INITIAL_CHARACTERS, selectedGroupId: 'g', selectedRoomId: 'a', onSelectGroup() {}, onSelectRoom() {}, compact: true,
  }));
  assert.match(strip, /data-member-strip[^>]*relative z-20/, 'member strip sits above the z-0 background scrim');
  assert.match(strip, /data-room-id="a"[^>]*data-cli="AGY"[^>]*border-\[#AD5E7E\] bg-\[#F8E1EB\]/, 'selected AGY card wears Hitomi rose');
  assert.match(strip, /data-room-id="b"[^>]*data-cli="CODEX"[^>]*border-\[#B8D4BE\] bg-\[#F7FBF7\]/, 'CODEX card wears Hikaru sage');
  assert.match(strip, /data-room-id="c"[^>]*data-cli="CLAUDE"[^>]*border-\[#BDD0E4\] bg-\[#F7F9FD\]/, 'CLAUDE card wears Hibiki blue');
  assert.match(strip, /aria-label="瞳 · Komorebi CLI Bridge/, 'character and room name stay accessible on circular compact pill');
  assert.match(strip, /data-room-id="a"[^>]*aria-pressed="true"[^>]*scale-\[1\.1\]/, 'active member circle stands out clearly');

  const roleStrip = renderToStaticMarkup(createElement(GroupRoomSidebar, {
    groups: [{ id: 'g', name: '群', members: [{ roomId: 'a', modelId: 'AGY', role: { key: 'review' } }, { roomId: 'b', modelId: 'CODEX', role: { key: 'implement' } }], createdAt: '' }],
    rooms: [room('a', 'AGY', { roomName: 'Komorebi CLI Bridge' }), room('b', 'CODEX', { roomName: 'Komorebi CLI App' })],
    characters: INITIAL_CHARACTERS, selectedGroupId: 'g', selectedRoomId: 'a', onSelectGroup() {}, onSelectRoom() {}, compact: true, showMemberRoles: true,
  }));
  assert.match(roleStrip, /data-role-icon-badge="review"/);
  assert.match(roleStrip, /data-role-icon-badge="implement"/);

  const app = source('src/App.tsx');
  const slider = app.slice(app.indexOf('Room Bubbles Horizontal Pill Bar'), app.indexOf('Minimalist Komorebi Top Bar'));
  assert.doesNotMatch(slider, /群組 · \{group\.name\}/, 'group pills are removed from the mobile room slider');
  const topBar = app.slice(app.indexOf('Minimalist Komorebi Top Bar'), app.indexOf('Main Content Area'));
  // The top rail, left to right: GitHub, groups, archive, potion, QR code (Mac only), settings.
  const githubIdx = topBar.indexOf('aria-label="GitHub"');
  const flaskIdx = topBar.indexOf('<FlaskConical');
  const dropdownIdx = topBar.indexOf('data-group-dropdown');
  const archiveIdx = topBar.indexOf('<Archive');
  const settingsIdx = topBar.indexOf("aria-label={t('topbar.settings')}");
  assert.equal((await import('../src/i18n/zh.ts')).zh['topbar.settings'], '設定與診斷');
  const qrIdx = topBar.indexOf('<QrCode');
  assert.ok(flaskIdx > 0 && qrIdx > flaskIdx && qrIdx < settingsIdx, 'on the Mac the QR code button sits after the potion and before settings (the phone hides it)');
  assert.ok(githubIdx > 0 && dropdownIdx > githubIdx && archiveIdx > dropdownIdx && flaskIdx > archiveIdx && settingsIdx > flaskIdx, 'the top rail runs GitHub, groups, archive, potion, settings');

  const bar = renderToStaticMarkup(createElement(ControlBar, {
    room: room('c', 'AGY'),
    character: { ...INITIAL_CHARACTERS.AGY, mpWeekly: { ...INITIAL_CHARACTERS.AGY.mpWeekly, current: 80 }, hp5h: { ...INITIAL_CHARACTERS.AGY.hp5h, current: 96 } },
    onCommand() {},
    compact: { title: '/compact', onRun() {} }, terminal: { open: false, onToggle() {} }, shield: { onPermissions() {} },
  } as never));
  assert.match(bar, /top-0[\s\S]*?data-hp-bar="80"[^>]*bg-\[#D97786\][^>]*width:80%/, 'top edge of the bottom bubble carries the rose HP bar');
  assert.match(bar, /bottom-0[\s\S]*?data-mp-bar="96"[^>]*bg-\[#648EB5\][^>]*width:96%/, 'bottom edge of the bottom bubble carries the blue MP bar');
  assert.doesNotMatch(bar, />HP 80%</, 'no separate HP/MP text column inside the bubble');

  const expectedLabels = { AGY: ['瞳', 'Gemini'], CODEX: ['光', 'Codex'], CLAUDE: ['響', 'Claude'] } as const;
  assert.match(INITIAL_CHARACTERS.CLAUDE.quotes.idle, /claude --resume/i, 'Claude idle quote keeps his signature CLI phrasing');
  for (const modelId of ['AGY', 'CODEX', 'CLAUDE'] as const) {
    const empty = renderToStaticMarkup(createElement(EmptyRoomState, { modelId, character: INITIAL_CHARACTERS[modelId] }));
    assert.match(empty, new RegExp(`data-chibi-expression="${modelId}"`));
    assert.match(empty, new RegExp(`data-speech-bubble="${modelId}"`));
    assert.doesNotMatch(empty, new RegExp(`data-speech-bubble="${modelId}"[^>]*>[\\s\\S]*?「`), 'speech bubble omits quotation marks');
    assert.match(empty, new RegExp(`data-character-intro="${modelId}"`));
    assert.match(empty, new RegExp(expectedLabels[modelId][0]));
    assert.match(empty, new RegExp(`>${expectedLabels[modelId][1]}<`));
    assert.match(empty, /guild-chibi-blink/);
    assert.match(empty, /guild-chibi-smile/);
    assert.match(empty, /guild-chibi-lantern/);
  }
});

test('context share is read from each CLI\'s own record: Codex window, Claude by model family, AGY with cache', async () => {
  const { contextOf } = await import('./sessions');
  const codex = [{ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 95_000 }, model_context_window: 475_000 } } }];
  assert.equal(contextOf('CODEX', codex), 20);
  assert.equal(contextOf('CODEX', [{ type: 'event_msg', payload: { type: 'token_count', info: null } }]), undefined, 'a record with no count says nothing');
  const claude = (model: string, input: number, read: number, create = 0) => [{ type: 'assistant', message: { model, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create } } }];
  assert.equal(contextOf('CLAUDE', claude('claude-sonnet-5-5', 2, 358_346, 699)), 36, 'Claude 5 models run a 1M window');
  assert.equal(contextOf('CLAUDE', claude('claude-opus-4-5', 10, 99_990)), 50, 'older Claude models have 200k');
  assert.equal(contextOf('CLAUDE', claude('claude-3-5-sonnet-20241022', 0, 100_000)), 50, 'an old name with a 5 inside is not a Claude 5');
  assert.equal(contextOf('CLAUDE', claude('claude-opus-4-5', 0, 300_000)), 30, 'more than 200k proves the bigger window');
  assert.equal(contextOf('CLAUDE', [{ type: 'assistant', isSidechain: true, message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 900_000 } } }]), undefined, 'a side task is not the conversation');
  assert.equal(contextOf('CLAUDE', claude('<synthetic>', 0, 0)), undefined);
  const agy = [{ type: 'PLANNER_RESPONSE', input_tokens: 2_459, cache_read_tokens: 145_798 }, { type: 'USER_INPUT' }];
  assert.equal(contextOf('AGY', agy), 29, 'the latest model turn, with its cached part, over the ~510k at which AGY now compacts (512k window, seen at 509,644 and 510,222 tokens)');
  assert.equal(contextOf('AGY', [{ type: 'PLANNER_RESPONSE', input_tokens: 500_000, cache_read_tokens: 10_222 }]), 100, 'the ring is full at the point where AGY compacts');
  assert.equal(contextOf('AGY', [{ type: 'USER_INPUT' }]), undefined);
  // It reaches the room, and the ring warns harder when nearly full.
  assert.match(source('bridge/rooms.ts'), /room\.contextUsagePct = session\.contextUsagePct/);
  const { ContextRing } = await import('../src/components/ControlBar');
  assert.match(renderToStaticMarkup(createElement(ContextRing, { pct: 90 })), /data-context-level="full"[\s\S]*guild-ring-alert[\s\S]*#D9667A/);
  assert.match(renderToStaticMarkup(createElement(ContextRing, { pct: 75 })), /data-context-level="high"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ContextRing, { pct: 75 })), /guild-ring-alert/);
});

test('a run of bubbles ends at one edge: the copy button of a later bubble sits inside the bubble corner, and the personal composer box is nudged one pixel', () => {
  const bubble = source('src/components/MessageBubble.tsx');
  assert.doesNotMatch(bubble, /'pr-7'/, 'no extra right padding that makes later bubbles narrower');
  assert.match(bubble, /data-copy-inside[^>]*float-right/);
  assert.doesNotMatch(bubble, /right-full|left-full/, 'the copy button never leaves the bubble');
  for (const file of ['src/App.tsx', 'src/components/RightRoomWorkspace.tsx']) assert.match(source(file), /pt-\[(?:9|11)px\]/, file);
  assert.doesNotMatch(source('src/components/GroupChat.tsx'), /pt-\[1[01]px\]/, 'the group box is left as it was');
});

test('phone: a long press on a character card opens the new-room dialog for that character, and the card keeps its normal tap', () => {
  const app = source('src/App.tsx');
  const block = app.slice(app.indexOf('data-role-longpress'), app.indexOf('<RoleCard', app.indexOf('data-role-longpress')));
  assert.match(block, /setTimeout\(\(\) => \{\s*roleLongPressed\.current = true;[^}]*openRoleRoom\(m\)/);
  assert.match(block, /Math\.hypot\(/, 'moving the finger cancels the press');
  assert.match(block, /onClickCapture[^]*roleLongPressed\.current/, 'the click after a long press is swallowed');
  assert.match(app, /const openRoleRoom = \(modelId: CLIModelId\) => \{ setNewRoomModalModel\(modelId\); setNewRoomModalOpen\(true\); \}/);
});

test('AGY context fills up at its compaction point (about 510k tokens since the window opened to 512k), not at a million', async () => {
  const { contextOf } = await import('./sessions');
  const row = (input: number, cache: number) => ({ type: 'PLANNER_RESPONSE', input_tokens: input, cache_read_tokens: cache });
  assert.equal(contextOf('AGY', [row(7446, 502_000)]), 100, 'the turn seen at 509,446 tokens is the compaction point');
  assert.equal(contextOf('AGY', [row(7446, 246270)]), 50, 'a turn at the old ~254k point is half full now');
  assert.equal(contextOf('AGY', [row(3000, 125000)]), 25);
  assert.equal(contextOf('AGY', [row(21672, 0)]), 4);
  assert.equal(contextOf('AGY', [row(600_000, 0)]), 100, 'past the point it stays at 100, it does not drop');
});

test('the context ring tooltip gives the real numbers next to the share', async () => {
  const { contextUsage } = await import('./sessions');
  const { contextLabel } = await import('../src/components/ControlBar');
  const usage = contextUsage('AGY', [{ type: 'PLANNER_RESPONSE', input_tokens: 3000, cache_read_tokens: 145_000 }]);
  assert.deepEqual(usage, { pct: 29, tokens: 148_000, window: 510_000 });
  assert.equal(contextLabel({ contextUsagePct: 29, contextTokens: 148_000, contextWindow: 510_000 }), '148k / 510k（29%）');
  assert.equal(contextLabel({ contextUsagePct: 19, contextTokens: 90_250, contextWindow: 475_000 }), '90k / 475k（19%）');
  assert.equal(contextLabel({ contextUsagePct: 40, contextTokens: 400_000, contextWindow: 1_000_000 }), '400k / 1M（40%）');
  assert.equal(contextLabel({ contextUsagePct: 42 }), '42%', 'with no numbers it is the share alone');
  assert.equal(contextLabel({ contextUsagePct: null }), '');
});

test('desktop welcome screen shows an independent Komorebi guild hall with the unified trio artwork, staggered blinks, and no speech bubble or shortcut buttons', t => {
  // The theme follows the clock by default (night from 18:00), so the day artwork is only on screen in daytime. Pin the theme.
  const mode = getThemeMode();
  setThemeMode('light');
  t.after(() => setThemeMode(mode));
  const html = renderToStaticMarkup(createElement(GuildHallHome, { characters: INITIAL_CHARACTERS, rooms: [room('a', 'AGY'), room('b', 'CODEX')], working: { a: 'working' } }));
  assert.match(html, /data-guild-hall-home/);
  assert.match(html, /木漏れ日公會大廳/);
  assert.match(html, /2 間部屋 · 1 間運行中/);
  assert.match(html, /data-guild-trio/);
  assert.match(html, /\/avatars\/guild-team-desktop\.webp/);
  assert.match(html, /\/avatars\/guild-team-mobile\.webp/);
  assert.doesNotMatch(html, /data-hall-speech/, 'no speech bubble on desktop welcome screen');
  assert.doesNotMatch(html, /<button/);
  assert.match(source('src/App.tsx'), /<GuildHallHome characters=\{characters\} rooms=\{rooms\} working=\{working\} \/>/);

  const pinnedRooms = [
    room('p1', 'AGY', { roomName: '美術室' }),
    room('p2', 'CODEX', { roomName: '修 bug' }),
    room('p3', 'AGY', { roomName: '策劃' }),
    room('p4', 'AGY', { roomName: '測試房' }),
    room('p5', 'AGY', { roomName: '文檔房' }),
    room('p6', 'AGY', { roomName: '第五間不顯示' }),
  ];
  const roleEmptyWithBoard = renderToStaticMarkup(createElement(EmptyRoomState, {
    modelId: 'AGY',
    character: INITIAL_CHARACTERS.AGY,
    rooms: pinnedRooms,
    pinnedKeys: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    onSelectRoom() {},
  }));
  assert.match(roleEmptyWithBoard, /data-guild-quest-board/);
  assert.match(roleEmptyWithBoard, /美術室/);
  assert.match(roleEmptyWithBoard, /測試房/);
  assert.doesNotMatch(roleEmptyWithBoard, /修 bug/, 'personal home quest board shows only that character pinned rooms');
  assert.doesNotMatch(roleEmptyWithBoard, /第五間不顯示/, 'quest board caps at 4 pinned rooms');
});

test('on the page a question for the Founder chimes like an approval and shows one bubble (no extra toast) when the room is not in view', () => {
  const app = source('src/App.tsx');
  assert.match(app, /kind === 'question' \? t\('notification\.question', \{ name \}\)/);
  assert.equal(zh['notification.question'], '{name} 有問題等你回答');
  assert.match(app, /playGuildChime\(kind === 'done' \? 'poke' : 'approve', soundEnabled\)/);
  // Only finished work gets a toast. A question and an approval each keep their own bubble; a question used to get a toast as well (two cards for one question).
  assert.match(app, /if \(!watching && kind === 'done'\) showToast\(message, 15_000, room\.id\)/, 'finished work gets a toast that stays a while');
  // A question keeps its own bubble, like an approval, until it is answered or closed; the bubble opens the room.
  assert.match(app, /const questionAlerts = rooms[\s\S]*?room\.pendingQuestion && !cardIds\.includes\(room\.id\)/);
  assert.match(app, /approvals=\{\[\.\.\.approvalAlerts, \.\.\.questionAlerts\]\}/);
  assert.equal(zh['notification.room.question'], '{character} · {room} 有問題等你回答');
  assert.match(source('src/components/RoomAlerts.tsx'), /sm:bottom-6 sm:left-auto sm:right-6/, 'on a computer the bubbles sit at the bottom right');
  assert.match(source('public/sw.js'), /renotify: true/, 'a repeated notification with the same tag alerts again');
});

test('the folded preview is cut at a paragraph or line end, closes a code block it cuts open, and leaves short text alone', async () => {
  const { foldPreview, foldPreviewChars } = await import('../src/components/MessageBubble');
  assert.equal(foldPreview('short'), 'short');
  const paragraphs = Array.from({ length: 40 }, (_, index) => `段落 ${index} ${'字'.repeat(40)}`).join('\n\n');
  const cut = foldPreview(paragraphs);
  assert.ok(cut.length <= foldPreviewChars && cut.length > foldPreviewChars * 0.4);
  assert.ok(paragraphs.startsWith(cut) && paragraphs[cut.length] === '\n', 'it ends where a paragraph ends, not in the middle of one');
  const code = '前言\n\n```ts\n' + 'const a = 1;\n'.repeat(120) + '```\n\n後記';
  const opened = foldPreview(code);
  assert.equal((opened.match(/^```/gm) ?? []).length % 2, 0, 'a code block cut open is closed again');
});

test('the send disc takes the colour of the role it goes to, in a single room and a group alike; an empty message cannot be sent from a single room either', async () => {
  const { roleAccent } = await import('../src/utils/roleAccent');
  const { GuildActionButton } = await import('../src/components/GuildActions');
  for (const role of ['AGY', 'CODEX', 'CLAUDE'] as const) {
    const html = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true, role }));
    assert.ok(html.includes(roleAccent[role].send.from) && html.includes(roleAccent[role].send.to), `${role} gradient`);
    assert.match(html, new RegExp(`data-send-role="${role}"`));
  }
  const plain = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true, role: 'CODEX', disabled: true }));
  assert.ok(plain.includes(roleAccent.CODEX.sendDisabled.from) && plain.includes(roleAccent.CODEX.sendDisabled.to), 'a disabled send uses a muted tint of its role colour');
  assert.match(plain, /box-shadow:none/, 'a disabled send has no shadow');
  for (const file of ['src/components/RightRoomWorkspace.tsx', 'src/App.tsx', 'src/components/GroupChat.tsx']) assert.match(source(file), /<ComposerActionButton[\s\S]*?role=\{/, file);
  assert.match(source('src/components/GuildActions.tsx'), /<GuildActionButton[\s\S]*?kind="send"[\s\S]*?iconOnly[\s\S]*?role=\{role\}/);
  assert.match(source('src/components/RightRoomWorkspace.tsx'), /hasDraft=\{Boolean\(promptInput\.trim\(\) \|\| hasAttachment\)\}[\s\S]*?blocked=\{blocked\}/);
  assert.match(source('src/App.tsx'), /hasDraft=\{Boolean\(mobileInput\.trim\(\) \|\| attachments\[selectedRoom\.id\]\?\.length\)\}[\s\S]*?blocked=\{mobileBlocked\}/);
  assert.match(source('src/components/GroupChat.tsx'), /data-group-approval className="guild-approval max-h-\[34dvh\][^"]*overflow-y-auto/, 'a long group approval scrolls inside its own box');
});

test('the welcome screen uses the night artwork in the dark theme and the day artwork in the light theme, whatever the time is', t => {
  const mode = getThemeMode();
  t.after(() => setThemeMode(mode));
  const draw = () => renderToStaticMarkup(createElement(GuildHallHome, { characters: INITIAL_CHARACTERS, rooms: [], working: {} }));
  setThemeMode('dark');
  assert.match(draw(), /guild-team-desktop-night\.webp/);
  assert.match(draw(), /guild-team-mobile-night\.webp/);
  setThemeMode('light');
  assert.doesNotMatch(draw(), /-night\.webp/);
  assert.match(draw(), /guild-team-desktop\.webp/);
});
