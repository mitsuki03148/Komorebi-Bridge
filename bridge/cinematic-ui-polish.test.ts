import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { ConfirmProvider } from '../src/components/ConfirmDialog';
import { EmptyRoomState, IDLE_QUOTE_INTERVAL_MS, nextQuoteIndex } from '../src/components/EmptyRoomState';
import { ComposerStopButton, GuildActionButton } from '../src/components/GuildActions';
import { MessageBubble } from '../src/components/MessageBubble';
import { PermissionButton } from '../src/components/PermissionButton';
import { VoiceButton } from '../src/components/VoiceButton';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';
import { zh } from '../src/i18n/zh';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { translateServerNoticeFor } from '../src/i18n/serverNotice';
import { sendFeedback } from '../src/utils/petals';
import { roleAccent } from '../src/utils/roleAccent';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('no production UI file calls native window.confirm directly; ConfirmDialog replaces all confirms', async () => {
  const files = collectTsFiles('src').filter(file => !file.endsWith('ConfirmDialog.tsx'));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /\bwindow\.confirm\s*\(/, `${file} should use useConfirm instead of window.confirm`);
  }
  const dialogText = await readFile('src/components/ConfirmDialog.tsx', 'utf8');
  assert.match(dialogText, /ref=\{focusScope\}/);
  assert.match(dialogText, /role="dialog"/);
});

test('ConfirmDialog renders accessible dialog markup and focuses cancel by default on danger tone', () => {
  const dangerHtml = renderToStaticMarkup(createElement(ConfirmDialog, {
    open: true,
    title: '刪除群組',
    message: '成員房間同對話會保留。',
    confirmLabel: '確認刪除',
    tone: 'danger',
    onCancel() {},
    onConfirm() {},
  }));
  assert.match(dangerHtml, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(dangerHtml, /data-confirm-tone="danger"/);
  assert.match(dangerHtml, /data-confirm-cancel="true"[^>]*data-autofocus=""/, 'danger tone places initial focus on cancel');
  assert.match(dangerHtml, />確認刪除</);

  const warnHtml = renderToStaticMarkup(createElement(ConfirmDialog, {
    open: true,
    title: '切換權限模式',
    message: '進行中的工作會中斷。',
    tone: 'warn',
    onCancel() {},
    onConfirm() {},
  }));
  assert.match(warnHtml, /data-confirm-tone="warn"/);
  assert.match(warnHtml, /data-confirm-accept="true"[^>]*data-autofocus=""/);
});

test('EmptyRoomState sits calmly without portrait tap-to-jump or rubber sway, and rotates quotes over idle time', async () => {
  assert.ok(IDLE_QUOTE_INTERVAL_MS >= 5000);
  assert.equal(nextQuoteIndex(0, 3), 1);
  assert.equal(nextQuoteIndex(2, 3), 0);
  assert.equal(nextQuoteIndex(0, 1), 0);

  const emptySource = await readFile('src/components/EmptyRoomState.tsx', 'utf8');
  assert.doesNotMatch(emptySource, /onClick=/, 'no tap handler on empty room portrait');
  assert.doesNotMatch(emptySource, /guild-chibi-tap|guild-empty-sway|♪/, 'no rubber bounce or tap squash note');
  assert.match(emptySource, /setInterval\(/, 'rotates greeting line automatically while idle');

  const css = await readFile('src/index.css', 'utf8');
  assert.match(css, /\.guild-empty-sway\s*\{\s*animation:\s*none;\s*\}/);

  const html = renderToStaticMarkup(createElement(EmptyRoomState, { modelId: 'AGY', character: INITIAL_CHARACTERS.AGY }));
  assert.match(html, /guild-chibi-blink/);
  assert.doesNotMatch(html, /guild-chibi-tap|guild-empty-sway/);
});

test('sendFeedback honors prefers-reduced-motion on both petals and send arrow animation', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  let arrowAnimated = 0;
  let petalsCreated = 0;
  g.document = {
    createElement: () => ({
      style: { cssText: '' },
      setAttribute() {},
      remove() {},
      animate: () => { petalsCreated++; return {}; },
    }),
    body: { appendChild() {} },
  };
  const fakeButton = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 32, height: 32 }),
    querySelector: () => ({
      animate: () => { arrowAnimated++; return {}; },
    }),
  } as unknown as HTMLElement;

  try {
    g.window = { matchMedia: () => ({ matches: true }) };
    sendFeedback(fakeButton);
    assert.equal(petalsCreated, 0, 'reduced motion skips petals');
    assert.equal(arrowAnimated, 0, 'reduced motion skips arrow spring');

    g.window = { matchMedia: () => ({ matches: false }) };
    sendFeedback(fakeButton);
    assert.equal(petalsCreated, 5);
    assert.equal(arrowAnimated, 1);
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});

test('MessageBubble uses opaque warm stationery surfaces and compact memo-strip handoffs', () => {
  const agentHtml = renderToStaticMarkup(createElement(MessageBubble, {
    entry: { id: 'a1', sender: 'agent', text: 'hello', timestamp: '10:00', createdAt: '2026-11-16T10:00:00Z' },
    modelId: 'AGY',
    name: '瞳',
    header: true,
  }));
  assert.doesNotMatch(agentHtml, /#FFF8F9E0/, 'opaque paper surface instead of alpha wash');
  assert.match(agentHtml, /background-color:#FFF8F9/);

  const handoffHtml = renderToStaticMarkup(createElement(MessageBubble, {
    entry: { id: 'h1', sender: 'user', text: '[交接｜來自 光] done', timestamp: '10:01', createdAt: '2026-11-16T10:01:00Z' },
    modelId: 'AGY',
    name: '瞳',
  }));
  assert.match(handoffHtml, /bg-\[#FAF6EF\]/);
  assert.doesNotMatch(handoffHtml, /border-dashed/);
});

test('topbar uses unified capsule toolbar and multilingual modal headers prevent awkward wrapping', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /<div role="toolbar" aria-label=\{t\('topbar\.toolbar'\)\}/);

  const modals = await readFile('src/components/GuildModals.tsx', 'utf8');
  assert.match(modals, /text-\[13\.5px\] sm:text-base font-bold leading-snug/, 'usage modal chart title fits ja/en cleanly on narrow viewports');
  assert.match(modals, /t\('guild\.modal\.new\.weekly'/, 'new room cards label weekly quota window');
  assert.doesNotMatch(modals, /overflow-y-auto[^>]*overflow-hidden/, 'scroll container is never blocked by overflow-hidden on same element');

  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(Object.keys(en).sort(), zhKeys, 'en.ts matches zh.ts key set');
  assert.deepEqual(Object.keys(ja).sort(), zhKeys, 'ja.ts matches zh.ts key set');
});

test('mic, stop, disabled send, and active shield use each role theme accent', () => {
  for (const role of ['CODEX', 'CLAUDE'] as const) {
    const accent = roleAccent[role];
    const disabledSend = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true, role, disabled: true }));
    assert.match(disabledSend, new RegExp(accent.sendDisabled.from, 'i'), `${role} disabled send uses muted role gradient`);
    assert.match(disabledSend, /box-shadow:none/, `${role} disabled send has no shadow`);

    const stopHtml = renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {}, role }));
    assert.match(stopHtml, new RegExp(`background-color:${accent.soft}`, 'i'), `${role} stop disc uses role soft wash`);
    assert.match(stopHtml, new RegExp(`color:${accent.name}`, 'i'), `${role} stop icon uses role name color`);

    const transcriber = { request: async () => '', receive: () => false, fail() {}, pending: 0 };
    const micHtml = renderToStaticMarkup(createElement(VoiceButton, { supported: true, transcriber, onText() {}, onError() {}, role }));
    assert.match(micHtml, new RegExp(`color:${accent.mic}`, 'i'), `${role} mic icon uses role mic color`);

    const room = { id: `r-${role}`, modelId: role, roomName: 'R', live: true, ready: true, status: 'idle', remoteControl: {}, logs: [] } as unknown as TerminalRoom;
    const shieldHtml = renderToStaticMarkup(
      createElement(ConfirmProvider, null,
        createElement(PermissionButton, { room, autoMode: true, onMode() {}, onPermissions() {}, className: 'btn' }),
      ),
    );
    assert.match(shieldHtml, new RegExp(`color:${accent.name}`, 'i'), `${role} active shield uses role accent color`);
    assert.doesNotMatch(shieldHtml, /#C46F7F/, `${role} active shield does not hardcode rose`);
  }
});

test('translateServerNoticeFor localizes Bridge NOTICE toasts into ja and en', () => {
  const archived = '已封存的房間仍在群組「DemoProject」內（群組至少要保留一間成員房），請稍後自行處理。';
  assert.equal(translateServerNoticeFor('zh', archived), archived);
  assert.match(translateServerNoticeFor('ja', archived), /アーカイブ済みのルームはまだグループ「DemoProject」に残っています/);
  assert.match(translateServerNoticeFor('en', archived), /archived room is still in group "DemoProject"/);

  const deleted = '已刪除的房間仍在群組「木漏れ日ギルド」內（群組至少要保留一間成員房），請稍後自行處理。';
  assert.match(translateServerNoticeFor('ja', deleted), /削除済みのルームはまだグループ「木漏れ日ギルド」に残っています/);
  assert.match(translateServerNoticeFor('en', deleted), /deleted room is still in group "木漏れ日ギルド"/);

  assert.equal(translateServerNoticeFor('ja', 'custom raw notice'), 'custom raw notice');
});

test('hand-drawn stationery accents polish day separators, agent brush edges, question checkmarks, and tactile send discs', async () => {
  const { DaySeparator } = await import('../src/components/MessageBubble');
  const { QuestionCard } = await import('../src/components/QuestionCard');
  const { Markdown } = await import('../src/components/Markdown');

  const sep = renderToStaticMarkup(createElement(DaySeparator, { label: '今日' }));
  assert.match(sep, /<svg[^>]*viewBox="0 0 120 8"/, 'day separator uses tapered hand-drawn SVG strokes');

  const agentBubble = renderToStaticMarkup(createElement(MessageBubble, {
    entry: { id: 'a1', sender: 'agent', text: '你好', timestamp: '10:00', createdAt: '2026-11-16T10:00:00Z' },
    modelId: 'AGY',
    name: '瞳',
    header: true,
    onNameClick() {},
  }));
  assert.match(agentBubble, /guild-agent-brush/, 'agent bubble wears a dual-stroke hand-drawn brush edge');
  assert.doesNotMatch(agentBubble, /underline|guild-sketch-underline/, 'clickable speaker name stays clean without an underline');

  const docMd = renderToStaticMarkup(createElement(Markdown, { variant: 'doc', text: '# 標題一\n\n## 標題二\n\n---' }));
  assert.match(docMd, /guild-sketch-h1/, 'doc h1 uses tapered hand-drawn underline');
  assert.match(docMd, /guild-sketch-hr/, 'doc hr uses tapered hand-drawn rule');
  assert.match(docMd, /viewBox="0 0 8 22"/, 'doc h2 uses organic brush dab');

  const sendHtml = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true, role: 'AGY' }));
  assert.match(sendHtml, /guild-send-disc/, 'send button uses layered tactile wax-and-glass disc');
  assert.match(sendHtml, /guild-send-disc__rim/, 'send button carries inner specular rim');

  const qHtml = renderToStaticMarkup(createElement(QuestionCard, {
    pending: { id: 'q1', questions: [{ title: '揀一個', options: ['A'] }] },
    name: '瞳',
    onAnswer() {},
  }));
  assert.match(qHtml, /M10 9\.4 C7\.2 8\.1/, 'question card header flower uses organic hand-drawn petals');

  const { ComposerActionButton } = await import('../src/components/GuildActions');
  const stopState = renderToStaticMarkup(createElement(ComposerActionButton, { running: true, hasDraft: false, role: 'AGY', onStop() {} }));
  assert.match(stopState, /data-composer-stop/);
  assert.match(stopState, /guild-halt-disc/, 'stop button shares tactile disc shell and press travel');
  assert.doesNotMatch(stopState, /data-composer-send/);
  const steerState = renderToStaticMarkup(createElement(ComposerActionButton, { running: true, hasDraft: true, role: 'AGY', onStop() {} }));
  assert.match(steerState, /data-composer-send[^>]*data-send-mode="steer"/);
  assert.match(steerState, /M12 10\.6 C 10\.1 13\.2/, 'steer state renders top star with wavy thin hand-drawn tail below');
  const blockedRunning = renderToStaticMarkup(createElement(ComposerActionButton, { running: true, hasDraft: true, blocked: 'waiting', role: 'AGY', onStop() {} }));
  assert.match(blockedRunning, /data-composer-stop/, 'non-steerable running room keeps stop even when user typed draft');
  const idleState = renderToStaticMarkup(createElement(ComposerActionButton, { running: false, hasDraft: true, role: 'AGY', onStop() {} }));
  assert.match(idleState, /data-composer-send[^>]*data-send-mode="send"/);
  assert.match(idleState, /M15\.4 8\.2 Q 9\.6 13\.2 3\.8 19\.6/, 'normal send renders triangular shooting star');

  const { GuildHallHome } = await import('../src/components/GuildHallHome');
  const { ControlBar } = await import('../src/components/ControlBar');
  const { LeftCharacterMenu } = await import('../src/components/LeftCharacterMenu');
  assert.equal((sep.match(/data-separator-bud/g) ?? []).length, 2, 'day separator carries tiny flanking botanical buds');
  const hall = renderToStaticMarkup(createElement(GuildHallHome, { characters: INITIAL_CHARACTERS, rooms: [], working: {} }));
  assert.match(hall, /data-floral-sprig="AGY"/, 'guild hall nameplate carries a small corner wildflower sprig');
  for (const role of ['AGY', 'CODEX', 'CLAUDE'] as const) {
    const empty = renderToStaticMarkup(createElement(EmptyRoomState, { modelId: role, character: INITIAL_CHARACTERS[role] }));
    assert.match(empty, new RegExp(`data-floral-sprig="${role}"`), `${role} empty-room bookmark wears its matching floral sprig`);
  }
  const openBar = renderToStaticMarkup(createElement(ControlBar, {
    room: { id: 'c', modelId: 'AGY', roomName: 'R', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', repoPath: '/tmp', gitBranch: 'main', progressPercent: null, contextUsagePct: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [] } as unknown as TerminalRoom,
    character: { ...INITIAL_CHARACTERS.AGY, mpWeekly: { ...INITIAL_CHARACTERS.AGY.mpWeekly, current: 80 }, hp5h: { ...INITIAL_CHARACTERS.AGY.hp5h, current: 15 } },
    onCommand() {}, compact: { title: '/compact', onRun() {} }, terminal: { open: false, onToggle() {} }, shield: { onPermissions() {} },
  } as never));
  assert.match(openBar, /data-ribbon-bloom="hp-open"/, 'high weekly HP ribbon ends in an open five-petal blossom');
  assert.match(openBar, /data-ribbon-bloom="mp-bud"/, 'low 5h MP ribbon tucks into a closed bud');
  const fullBar = renderToStaticMarkup(createElement(ControlBar, {
    room: { id: 'c', modelId: 'AGY', roomName: 'R', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', repoPath: '/tmp', gitBranch: 'main', progressPercent: null, contextUsagePct: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [] } as unknown as TerminalRoom,
    character: { ...INITIAL_CHARACTERS.AGY, mpWeekly: { ...INITIAL_CHARACTERS.AGY.mpWeekly, current: 0 }, hp5h: { ...INITIAL_CHARACTERS.AGY.hp5h, current: 100 } },
    onCommand() {}, compact: { title: '/compact', onRun() {} }, terminal: { open: false, onToggle() {} }, shield: { onPermissions() {} },
  } as never));
  assert.match(fullBar, /data-ribbon-bloom="hp-bud"[^>]*style="left:0%"/, '0% HP bud sits at the very start of the bar');
  assert.match(fullBar, /data-ribbon-bloom="mp-open"[^>]*style="left:100%"/, '100% MP blossom reaches the very end of the bar');
  const sidebarChars = {
    ...INITIAL_CHARACTERS,
    AGY: { ...INITIAL_CHARACTERS.AGY, mpWeekly: { ...INITIAL_CHARACTERS.AGY.mpWeekly, current: 72 }, hp5h: { ...INITIAL_CHARACTERS.AGY.hp5h, current: 18 } },
  };
  const sidebar = renderToStaticMarkup(createElement(LeftCharacterMenu, {
    characters: sidebarChars, rooms: [], selectedRoomId: '', onSelectRoom() {}, onOpenNewRoomModal() {}, onOpenUsageModal() {}, onPokeCharacter() {},
  }));
  assert.match(sidebar, /data-ribbon-bloom="hp-open"/, 'desktop sidebar HP bar carries subtle open tip blossom when >20%');
  assert.match(sidebar, /data-ribbon-bloom="mp-bud"/, 'desktop sidebar MP bar carries subtle bud tip when <=20%');
});
