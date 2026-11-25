import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupChatView, GroupCreateModal, orderGroupTimeline } from '../src/components/GroupChat';
import { GroupRoomSidebar } from '../src/components/GroupRoomSidebar';
import { LeftCharacterMenu } from '../src/components/LeftCharacterMenu';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { zh } from '../src/i18n/zh';
import type { TerminalRoom } from '../src/types/guild';

test('group timeline sorts by date across midnight and places undated records near their room entries', () => {
  const old = { id: 'old-room', modelId: 'CODEX', logs: [
    { id: 'legacy', timestamp: '—', sender: 'user', text: '舊資料' },
    { id: 'yesterday', timestamp: '7:00:00 AM', createdAt: '2026-11-11T07:00:00Z', sender: 'agent', text: '昨日' },
  ] } as unknown as TerminalRoom;
  const today = { id: 'new-room', modelId: 'CLAUDE', logs: [
    { id: 'today', timestamp: '6:00:00 AM', createdAt: '2026-11-12T06:00:00Z', sender: 'agent', text: '今日' },
  ] } as unknown as TerminalRoom;
  const members = [old, today].map(room => ({ roomId: room.id, modelId: room.modelId, room }));
  assert.deepEqual(orderGroupTimeline(members).map(item => item.entry.id), ['legacy', 'yesterday', 'today']);
});

test('an undated long transcript entry does not bury a newer group response', () => {
  const claude = { id: 'claude', modelId: 'CLAUDE', logs: [
    { id: 'unknown', timestamp: '—', sender: 'user', text: '舊'.repeat(20485) },
    { id: 'old', timestamp: '3:49:31 AM', sender: 'agent', text: '舊回覆' },
  ] } as unknown as TerminalRoom;
  const agy = { id: 'agy', modelId: 'AGY', logs: [
    { id: 'new', timestamp: '5:58:18 AM', sender: 'agent', text: '新回覆' },
  ] } as unknown as TerminalRoom;
  const members = [claude, agy].map(room => ({ roomId: room.id, modelId: room.modelId, room }));
  assert.deepEqual(orderGroupTimeline(members).map(item => item.entry.id), ['unknown', 'old', 'new']);
  const html = renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', members, characters: INITIAL_CHARACTERS,
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  assert.ok(html.indexOf('新回覆') > html.indexOf('舊回覆'));
});

test('group replies keep their own speaker after repeated system messages collapse', () => {
  const entry = (id: string, sender: 'system' | 'agent', text: string, minute: string) =>
    ({ id, sender, text, timestamp: `7:${minute} PM`, createdAt: `2026-11-13T19:${minute}:00Z` });
  const claude = { id: 'claude', modelId: 'CLAUDE', roomName: 'CLI app', logs: [
    entry('a1', 'system', 'CLI 已關閉', '08'),
    entry('a2', 'agent', '已派工作台工單', '10'),
  ] } as unknown as TerminalRoom;
  const agy = { id: 'agy', modelId: 'AGY', roomName: 'Komorebi CLI Bridge', logs: [
    entry('b1', 'system', 'CLI 已關閉', '07'),
    entry('b2', 'system', 'CLI 已關閉', '09'),
  ] } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', characters: INITIAL_CHARACTERS,
    members: [claude, agy].map(room => ({ roomId: room.id, modelId: room.modelId, room })),
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  // One room per character: the bubble title is just the character, not the room's long name.
  assert.match(html, />響<\/span>(?:(?!<article)[\s\S])*已派工作台工單/);
  assert.doesNotMatch(html, />瞳<\/span>(?:(?!<article)[\s\S])*已派工作台工單/);
});

test('flat group navigation keeps ordinary rooms visible and shows the current group crown on Mac and phone', () => {
  const rooms = [
    { id: 'lead', modelId: 'CODEX', roomName: '甲統籌', status: 'idle' },
    { id: 'member', modelId: 'CLAUDE', roomName: '乙組員', status: 'idle' },
    { id: 'outside', modelId: 'AGY', roomName: '獨立房', status: 'idle' },
  ] as TerminalRoom[];
  const members = rooms.slice(0, 2).map(({ id, modelId }) => ({ roomId: id, modelId }));
  const group = { id: 'group-a', name: '甲群組', createdAt: '', members, orchestratorRoomId: 'lead' };
  const peer = { ...group, id: 'group-b', name: '乙群組', orchestratorRoomId: 'member' };
  for (const groups of [[], [group], [peer, group]]) {
    const html = renderToStaticMarkup(createElement(LeftCharacterMenu, {
      characters: INITIAL_CHARACTERS, rooms, groups, selectedRoomId: '',
      onSelectGroup() {}, onSelectRoom() {}, onOpenNewRoomModal() {}, onOpenUsageModal() {}, onPokeCharacter() {},
    }));
    for (const room of rooms) assert.ok(html.includes(`data-room-id="${room.id}"`));
    if (groups.length === 2) assert.match(html, /data-group-chips[\s\S]*乙群組[\s\S]*甲群組/);
  }
  for (const compact of [false, true]) {
    const render = (id: string) => renderToStaticMarkup(createElement(GroupRoomSidebar, {
      characters: INITIAL_CHARACTERS, rooms, groups: [peer, group], selectedGroupId: id, compact,
      onSelectGroup() {}, onSelectRoom() {},
    }));
    assert.match(render(group.id), /data-room-id="lead"[^]*?data-orchestrator="true"[^]*?<\/button>/);
    const second = render(peer.id);
    assert.match(second, /data-room-id="member"[^]*?data-orchestrator="true"[^]*?<\/button>/);
    assert.equal([...second.matchAll(/data-orchestrator="true"/g)].length, 1);
    if (!compact) assert.match(second, /data-group-id="group-b"[^]*?aria-current="page"[^]*?data-group-id="group-a"/);
  }
});

test('group sidebar selects member rooms and distinguishes same-role session IDs', () => {
  const room = (id: string, sessionId: string) => ({ id, sessionId, roomName: id, modelId: 'CODEX', live: true,
    logs: [{ id: `msg-${id}`, sender: 'agent', text: `回覆 ${id}`, timestamp: '12:00:00' }] }) as unknown as TerminalRoom;
  const a = room('first', '11111111-1111-1111-1111-111111111111');
  const b = room('second', '22222222-2222-2222-2222-222222222222');
  const html = renderToStaticMarkup(createElement(GroupChatView, {
    name: '協作', characters: INITIAL_CHARACTERS,
    members: [a, b].map(item => ({ roomId: item.id, modelId: item.modelId, room: item })),
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  assert.doesNotMatch(html, /選擇光的房間/);
  assert.ok(!html.includes(a.sessionId!) && !html.includes(b.sessionId!), 'group options no longer expose a member list of full session IDs');
  assert.doesNotMatch(html, /data-role-menu/);
  const modal = renderToStaticMarkup(createElement(GroupCreateModal, { characters: INITIAL_CHARACTERS, availableRooms: [a, b], onCreate() {}, onClose() {} }));
  assert.match(modal, /first/);
  assert.match(modal, /second/);
  assert.ok(modal.includes(a.sessionId!) && modal.includes(b.sessionId!), 'the existing-room picker still distinguishes full session IDs');
  assert.match(modal, /搜尋現有房間/);
  const sidebar = renderToStaticMarkup(createElement(GroupRoomSidebar, {
    groups: [{ id: 'group', name: '協作', members: [a, b].map(item => ({ roomId: item.id, modelId: item.modelId })), createdAt: '' }],
    rooms: [a, b, room('outside', '33333333-3333-3333-3333-333333333333')], characters: INITIAL_CHARACTERS, selectedGroupId: 'group', selectedRoomId: 'second', compact: true,
    onSelectGroup() {}, onSelectRoom() {},
  }));
  assert.match(sidebar, /data-member-strip/, 'on the phone the members are one row under the title, not a 66px column');
  assert.doesNotMatch(sidebar, /w-\[66px\]/);
  assert.doesNotMatch(sidebar, /data-group-id/, 'a single group needs no group chips on the phone');
  assert.match(sidebar, /first/);
  assert.match(sidebar, /aria-label="[^"]*11111111-1111-1111-1111-111111111111/);
  assert.match(sidebar, /aria-label="[^"]*22222222-2222-2222-2222-222222222222/);
  assert.match(sidebar, /aria-pressed="true"/);
  assert.doesNotMatch(sidebar, /outside/);
});

test('the group room shows its shield like a single room: pink and labelled when the room runs without approval', () => {
  const live = (id: string, modelId: 'CODEX' | 'CLAUDE') => ({ id, modelId, roomName: id, live: true, ready: true, status: 'idle', logs: [], remoteControl: {}, effortLevel: null, selectedSubModel: 'x' }) as unknown as TerminalRoom;
  const members = [live('a', 'CODEX'), live('b', 'CLAUDE')].map(room => ({ roomId: room.id, modelId: room.modelId, room }));
  const render = (autoMode: boolean | undefined, recipientId = 'a') => renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', members, recipientId, characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onCommand() {}, onDecision() {}, onMenu() {},
    autoModeOf: autoMode === undefined ? undefined : (roomId: string) => roomId === 'a' ? autoMode : false, onMode: autoMode === undefined ? undefined : () => {},
  }));
  const on = render(true);
  assert.match(on, /aria-label="CLI 權限設定（免審批 開）"/);
  assert.match(on, /aria-label="CLI 權限設定（免審批 開）"[^>]*style="color:#7A9580"/);
  assert.doesNotMatch(on, /!bg-\[#FDECEF\]/);
  const off = render(true, 'b');
  assert.match(off, /aria-label="CLI 權限設定（免審批 關）"/);
  assert.doesNotMatch(off, /aria-label="CLI 權限設定（免審批 關）"[^>]*style="color:/);
  // Without the Bridge's mode information the shield stays the plain /permissions shortcut.
  assert.match(render(undefined), /aria-label="CLI 權限設定" title="CLI 權限設定"/);
});

test('the group conversation sits on the same conservatory background as a single room, with the messages above it', () => {
  const room = { id: 'a', modelId: 'CODEX', roomName: 'a', live: true, ready: true, status: 'idle', remoteControl: {}, logs: [{ id: 'x', timestamp: '1:00:00 PM', sender: 'agent', text: '你好' }] } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', members: [{ roomId: 'a', modelId: 'CODEX', room }], characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  assert.match(html, /<img src="[^"]+" alt="" [^>]*opacity-35/);
  assert.match(html, /from-\[#FBF8F3\]\/85/);
  assert.match(html, /<div[^>]*class="relative z-10 min-h-0 flex-1[^"]*"[^>]*aria-label="群組對話"/);
});

test('the panel under the conversation is 50% see-through, with no blur, in group and single rooms alike', async () => {
  const { readFile } = await import('node:fs/promises');
  const panel = 'bg-[#F7F2E9]/50';
  for (const file of ['src/App.tsx', 'src/components/GroupChat.tsx', 'src/components/RightRoomWorkspace.tsx']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const line = source.split('\n').find(text => text.includes(panel));
    assert.ok(line, `${file} keeps the composer panel semi-transparent`);
    assert.doesNotMatch(line!, /backdrop-blur/, `${file}: a blur would hide the picture behind the panel`);
  }
  const room = { id: 'a', modelId: 'CODEX', roomName: 'a', live: true, ready: true, status: 'idle', remoteControl: {}, logs: [] } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(GroupChatView, { name: '測試', members: [{ roomId: 'a', modelId: 'CODEX', room }], characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onDecision() {}, onMenu() {} }));
  assert.match(html, /border-t border-\[#E6DCD0\] bg-\[#F7F2E9\]\/50 p-3 sm:px-5/);
});

test('the composers have no slash button', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/App.tsx', 'src/components/GroupChat.tsx', 'src/components/RightRoomWorkspace.tsx']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /顯示 CLI 指令選單/, `${file} has no slash button`);
  }
});

test('the group shows who leads it, lets the Founder name another lead, and a room can hand over to a successor from its menu', async () => {
  const { readFile } = await import('node:fs/promises');
  const claude = { id: 'claude', modelId: 'CLAUDE', roomName: 'CLI app', sessionId: '11111111-1111-1111-1111-111111111111', logs: [] } as unknown as TerminalRoom;
  const agy = { id: 'agy', modelId: 'AGY', roomName: 'Bridge', sessionId: '22222222-2222-2222-2222-222222222222', logs: [] } as unknown as TerminalRoom;
  const members = [claude, agy].map(room => ({ roomId: room.id, modelId: room.modelId, room }));
  const view = (leadRoomId: string) => renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', members, characters: INITIAL_CHARACTERS, recipientId: 'claude', orchestratorRoomId: leadRoomId, onSetOrchestrator() {},
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  assert.doesNotMatch(view('agy'), /設為總指揮/, 'orchestrator assignment lives in the member long-press menu, not duplicated in the ⋯ menu');
  assert.doesNotMatch(view('agy'), /移出群組/, 'remove-from-group lives in the member long-press menu, not duplicated in the ⋯ menu');
  assert.doesNotMatch(view('agy'), /data-orchestrator-note/);
  assert.match(view('claude'), /data-orchestrator-note/, 'the lead is still indicated when selected');
  const sidebar = (compact: boolean) => renderToStaticMarkup(createElement(GroupRoomSidebar, {
    groups: [{ id: 'g', name: '協作', members: members.map(item => ({ roomId: item.roomId, modelId: item.modelId })), createdAt: '', orchestratorRoomId: 'agy' }],
    rooms: [claude, agy], characters: INITIAL_CHARACTERS, selectedGroupId: 'g', compact, onSelectGroup() {}, onSelectRoom() {},
  }));
  for (const compact of [true, false]) {
    const html = sidebar(compact);
    assert.equal(html.match(/data-orchestrator(?!-)/g)?.length, 1, `one crown, on the lead only (compact=${compact})`);
    assert.match(html, /Bridge（總指揮）/);
  }
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /type: 'SET_SUCCESSOR', roomId: menuRoom\.id, successorRoomId: room\.id/);
  assert.match(app, /type: 'SET_SUCCESSOR', roomId: menuRoom\.id, successorRoomId: null/);
  assert.match(app, /type: 'GROUP_SET_ORCHESTRATOR', groupId: selectedGroup\.id, roomId/);
});

test('the room menu of a group member offers "move out of the group" instead of archive, and copies the Session ID from an icon on its banner', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile('src/App.tsx', 'utf8');
  assert.equal(zh['room.menu.label'], '房間操作');
  assert.equal(zh['room.session.copy'], '複製 Session ID');
  assert.equal(zh['group.member.remove'], '移出群組');
  assert.equal(zh['room.archive'], '封存房間');
  assert.equal(zh['room.successor.choose'], '由另一間房接手…');
  const start = app.indexOf("aria-label={t('room.menu.label')}");
  assert.ok(start >= 0);
  const menu = app.slice(start, app.indexOf('{renameRoom && (', start));
  assert.match(menu, /data-session-banner[\s\S]*aria-label=\{t\('room\.session\.copy'\)\}[\s\S]*<Copy size=\{16\}/, 'the copy icon sits inside the Session ID banner');
  assert.doesNotMatch(menu, />\{t\('room\.session\.copy'\)\}</, 'no separate copy button');
  assert.match(app, /const runArchive =[\s\S]*type: 'ARCHIVE'/);
  assert.match(menu, /menuGroup\s*\?[\s\S]*data-remove-from-group[\s\S]*removeFromGroup\(menuGroup, menuRoom\.id\)[\s\S]*\{t\('group\.member\.remove'\)\}[\s\S]*:[\s\S]*onClick=\{runArchive\}[\s\S]*\{t\('room\.archive'\)\}/, 'a group member leaves the group; any other room is still archived');
  assert.match(menu, /\(menuGroup \|\| heirKey\) &&[\s\S]*t\('room\.successor\.choose'\)/, 'handoff option is hidden in plain single-room mode');
  assert.match(app, /const menuGroup = menuRoom \? groups\.find\(group => group\.id === selectedGroupId && group\.members\.some/);
});

test('taking the last member out of a group asks to delete the group instead of leaving it empty, and always asks first', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile('src/App.tsx', 'utf8');
  const fn = app.slice(app.indexOf('const removeFromGroup'), app.indexOf('const menuGroup'));
  assert.equal(zh['group.remove.last.confirm'], '「{room}」係群組「{group}」最後一位成員。\n移出後群組會被刪除（房間同對話會保留）。確定刪除群組？');
  assert.equal(zh['group.remove.confirm'], '將「{room}」移出群組？原有 CLI 房間和對話會保留。');
  assert.match(fn, /group\.members\.length <= 1[\s\S]*confirm\(\{[\s\S]*t\('group\.remove\.last\.confirm'[\s\S]*type: 'GROUP_DELETE', groupId: group\.id/);
  assert.match(fn, /confirm\(\{[\s\S]*t\('group\.remove\.confirm'[\s\S]*type: 'GROUP_REMOVE_MEMBER', groupId: group\.id, roomId/);
  assert.match(app, /onRemoveMember=\{roomId => \{ void removeFromGroup\(selectedGroup, roomId\); \}\}/, 'the group view uses the same function');
  assert.doesNotMatch(await readFile('src/components/GroupChat.tsx', 'utf8'), /onRemoveMember && members\.length > 1/, 'the button is no longer hidden for the last member');
});

test('the room menu title carries a crown: lit for the current lead, tapping assigns or unassigns it', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile('src/App.tsx', 'utf8');
  const crown = app.slice(app.indexOf('data-orchestrator-toggle') - 200, app.indexOf('data-orchestrator-toggle') + 1200);
  assert.match(crown, /menuGroup &&/, 'only for a member of the group in view');
  assert.match(crown, /aria-pressed=\{lead\}/);
  assert.match(crown, /type: 'GROUP_SET_ORCHESTRATOR', groupId: menuGroup\.id, roomId: lead \? null : menuRoom\.id/, 'tapping the lead unassigns; tapping another assigns, and the Bridge replaces the old lead');
  assert.match(crown, /fill=\{lead \? 'currentColor' : 'none'\}/, 'filled and glowing when lit, an outline when not');
});

test('a group shows who else waits for the Founder: a "待你處理 N" entry listing each member and what it waits for, until it is handled', async () => {
  const { readFile } = await import('node:fs/promises');
  const member = (id: string, modelId: 'CLAUDE' | 'AGY' | 'CODEX', roomName: string, extra: object = {}) => ({ id, modelId, roomName, logs: [], ...extra }) as unknown as TerminalRoom;
  const hikari = member('hikari', 'CODEX', 'UI review');
  const hibiki = member('hibiki', 'CLAUDE', 'R5 Debug', { pendingQuestion: { id: 'q1', questions: [{ title: '用邊個？', options: null }] } });
  const hitomi = member('hitomi', 'AGY', 'Native', { pendingApproval: { id: 'a1', title: '跑指令', reason: '', commandOrFile: 'ls', diffLines: [] } });
  const view = (...rooms: TerminalRoom[]) => renderToStaticMarkup(createElement(GroupChatView, {
    name: '群', members: rooms.map(room => ({ roomId: room.id, modelId: room.modelId, room })), characters: INITIAL_CHARACTERS, recipientId: 'hikari',
    onSelectRecipient() {}, onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  }));
  const html = view(hikari, hibiki, hitomi);
  assert.match(html, /data-waiting-list/);
  assert.match(html, /aria-label="待你處理 2"/);
  assert.match(html, /data-waiting-item="hibiki"[\s\S]*?響 · R5 Debug[\s\S]*?等待回答/);
  assert.match(html, /data-waiting-item="hitomi"[\s\S]*?瞳 · Native[\s\S]*?等待審批/);
  assert.doesNotMatch(view(hikari, { ...hibiki, pendingQuestion: undefined } as TerminalRoom), /data-waiting-list/, 'nothing waits: no entry');
  // The addressed member's own card is already on screen, so it is not listed as waiting.
  const own = renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [hikari, hibiki].map(room => ({ roomId: room.id, modelId: room.modelId, room })), characters: INITIAL_CHARACTERS, recipientId: 'hibiki', onSelectRecipient() {}, onBack() {}, onSend() {}, onDecision() {}, onMenu() {} }));
  assert.doesNotMatch(own, /data-waiting-list/);
  // The member row marks a question the way it marks an approval.
  const strip = renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [{ id: 'g', name: '協作', members: [hikari, hibiki].map(room => ({ roomId: room.id, modelId: room.modelId })), createdAt: '' }], rooms: [hikari, hibiki], characters: INITIAL_CHARACTERS, selectedGroupId: 'g', compact: true, onSelectGroup() {}, onSelectRoom() {} }));
  assert.equal(strip.match(/data-question-mark/g)?.length, 1);
  // Only the addressed member's cards count as seen: another member's approval and question still call out while the group is open.
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /const cardIds = selectedGroup \? \(groupRecipient \? \[groupRecipient\] : \[\]\) : selectedRoom \? \[selectedRoom\.id\] : \[\]/);
  assert.match(app, /const watching = \(kind === 'done' \? viewedIds : cardIds\)\.includes\(room\.id\) && !document\.hidden/);
  assert.match(app, /filter\(room => room\.pendingApproval && !cardIds\.includes\(room\.id\)/);
});

test('a room row on the phone starts with a plus for the character, and offers search for many rooms', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /data-room-add[\s\S]*onClick=\{\(\) => openRoleRoom\(mobileRole\)\}/);
  assert.match(app, /const roomSearchThreshold = 8/);
  assert.match(app, /const mobileRooms = rooms\.filter\(room => room\.modelId === mobileRole\)/, 'the full character list goes into search');
  assert.match(app, /mobileRooms\.length > roomSearchThreshold && \(roomSearchOpen/);
  assert.match(app, /const filteredMobileRooms = mobileRooms\.filter\(room => room\.roomName\.toLowerCase\(\)\.includes\(mobileRoomSearch\)\)/);
  assert.match(app, /text-\[16px\][^"]*outline-none/, 'the search box is 16px so iOS does not zoom in');
});

test('in a group, a workbench ticket shows as its small line only; the big handed-over bubble is left out, other handoffs stay', () => {
  const log = (id: string, sender: 'user' | 'agent' | 'system', text: string, minute: number) =>
    ({ id, sender, text, timestamp: `8:4${minute}:00 AM`, createdAt: `2026-11-15T08:4${minute}:00Z` });
  const room = { id: 'r', modelId: 'CLAUDE', roomName: '響實作', repoPath: '/tmp', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', gitBranch: 'main', progressPercent: null, contextUsagePct: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [
    log('n', 'system', '工作台 #101：光 → 響「Animation round 3」', 1),
    log('d', 'user', '[交接｜來自 DemoProject 總指揮] [工作台 #101] Animation round 3｜SQLite甜品題\n（內容較長，會自動附上）', 2),
    log('c', 'user', '[交接｜來自 DemoProject 總指揮] [工作台 #102｜DemoProject 總指揮 → 你｜完成通知] 做完', 3),
    log('h', 'user', '[交接｜來自 R5 Orchestrator] 請睇下呢個', 4),
    log('a', 'agent', '收到', 5),
  ] } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(GroupChatView, {
    name: '測試', members: [{ roomId: 'r', modelId: 'CLAUDE', room }], characters: INITIAL_CHARACTERS,
    onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  } as never));
  assert.match(html, /工作台 #101：光 → 響/, 'the small line stays');
  assert.doesNotMatch(html, /SQLite甜品題/, 'the big delivered bubble is gone');
  assert.doesNotMatch(html, /完成通知\] 做完/, 'a completion notice delivered the same way is gone too');
  assert.match(html, /請睇下呢個/, 'a handoff that is not a workbench ticket stays');
  assert.match(html, /收到/);
});

test('the member strip puts the crown first and keeps the others in the order they were added', async () => {
  const { crownFirst } = await import('../src/components/GroupRoomSidebar')
  const members = ['a', 'b', 'c', 'd'].map(roomId => ({ roomId }))
  assert.deepEqual(crownFirst(members, 'c').map(member => member.roomId), ['c', 'a', 'b', 'd'])
  assert.deepEqual(crownFirst(members, 'a').map(member => member.roomId), ['a', 'b', 'c', 'd'], 'already first')
  assert.deepEqual(crownFirst(members, undefined).map(member => member.roomId), ['a', 'b', 'c', 'd'], 'no crown: unchanged')
  assert.deepEqual(crownFirst(members, 'zzz').map(member => member.roomId), ['a', 'b', 'c', 'd'], 'a crown that is not a member changes nothing')
})

test('the group file panel opens on the lead independently of the chat recipient and resets member overrides on close', async () => {
  const { readFile } = await import('node:fs/promises');
  const group = await readFile('src/components/GroupChat.tsx', 'utf8');
  const panel = await readFile('src/components/WorktreePanel.tsx', 'utf8');
  assert.match(group, /const worktreeRoomId = choices\.find\(choice => choice\.id === orchestratorRoomId\)\?\.id \?\? choices\[0\]\?\.id;/);
  assert.match(group, /<WorktreeLayer roomId=\{worktreeRoomId\} call=\{worktreeCall\} choices=\{choices\} initialDiffMode="branch"/);
  assert.match(panel, /if \(!value\) \{\s*setSearching\(false\);\s*setPicked\(undefined\);/);
});
