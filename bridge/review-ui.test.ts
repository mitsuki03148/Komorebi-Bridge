import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { WorkingIndicator, WorkingSpark } from '../src/components/WorkingIndicator';
import { RoleCard } from '../src/components/RoleCard';
import { ModelEffortPicker } from '../src/components/ModelEffortPicker';
import { AttachmentPicker } from '../src/components/AttachmentPicker';
import { ComposerStopButton, GuildActionButton } from '../src/components/GuildActions';
import { SettingsModal } from '../src/components/SettingsModals';
import { UsageCalibrationModal } from '../src/components/GuildModals';
import { diffAttention, formatElapsed, stallAfterMs, stepAwaiting, workState } from '../src/utils/roomAttention';
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { shortModelName, composerBlock, composerHint, formatClock, formatPct, formatReset, roomCapabilities, roomStatusLabel } from '../src/utils/roomUi';
import type { TerminalRoom } from '../src/types/guild';

const baseRoom = {
  id: 'r1', modelId: 'CLAUDE', roomName: 'Review', repoPath: '/tmp', gitBranch: 'main', selectedSubModel: 'Opus 5.5',
  effortLevel: null, contextUsagePct: null, progressPercent: null, status: 'idle', currentActionSummary: 'CLI 可以接收指令',
  bubbleSnippet: '', updatedAt: '2026-11-12T08:40:43.867Z', logs: [], remoteStatus: 'off', remoteControl: {},
  live: true, ready: true,
} as unknown as TerminalRoom;

test('composer state explains why a prompt cannot be sent and keeps approvals answerable', () => {
  assert.equal(composerBlock(baseRoom), undefined);
  assert.match(composerBlock({ ...baseRoom, live: false })!, /未啟動/);
  assert.match(composerBlock({ ...baseRoom, ready: false })!, /工作中/);
  const approval = { ...baseRoom, ready: false, pendingApproval: { id: 'a' } } as unknown as TerminalRoom;
  assert.equal(composerBlock(approval), undefined);
  assert.match(composerHint(approval)!, /數字/);
  assert.equal(roomCapabilities(approval).compact, false);
  assert.equal(roomCapabilities({ ...baseRoom, live: false }).settings, false);
  assert.equal(roomStatusLabel({ ...baseRoom, live: false }), '未啟動');
});

test('quota and time formatting never shows unknown as full or raw UTC', () => {
  assert.equal(formatPct(null), '—');
  assert.equal(formatPct(11.42), '11%');
  assert.doesNotMatch(formatClock('2026-11-12T08:40:43.867Z'), /T|Z/);
  assert.equal(INITIAL_CHARACTERS.CODEX.hp5h.current, null);
});

test('background rooms signal new approvals, finished work and unread replies only after the first snapshot', () => {
  const working = { ...baseRoom, id: 'bg', status: 'running', ready: false } as TerminalRoom;
  assert.deepEqual(diffAttention(null, [working], []).events, []);
  const first = diffAttention(null, [working], []).next;
  const done = { ...working, status: 'idle', ready: true, logs: [{ id: 'reply', sender: 'agent', text: 'ok\nRESULT — DONE', timestamp: '' }] } as TerminalRoom;
  const second = diffAttention(first, [done], []);
  assert.deepEqual(second.events.map(event => event.kind), ['done']);
  assert.deepEqual(second.newlyUnread, ['bg']);
  // A stop that ends on a plain message, not a report, is unread but not "finished".
  const paused = { ...done, logs: [{ id: 'p', sender: 'agent', text: '做咗一半，繼續嗎？', timestamp: '' }] } as TerminalRoom;
  assert.deepEqual(diffAttention(first, [paused], []).events, []);
  assert.deepEqual(diffAttention(first, [paused], []).newlyUnread, ['bg']);
  assert.deepEqual(diffAttention(first, [done], ['bg']).newlyUnread, []);
  const waiting = { ...done, status: 'waiting_approval', pendingApproval: { id: 'ap-1' } } as unknown as TerminalRoom;
  const third = diffAttention(second.next, [waiting], []);
  assert.deepEqual(third.events.map(event => event.kind), ['approval']);
  assert.deepEqual(diffAttention(third.next, [waiting], []).events, []);
  assert.equal(formatElapsed(undefined, 0), undefined);
  assert.equal(formatElapsed(0, 3 * 60_000), '3 分鐘');
});

test('the working indicator is a gentle status with the character colour and elapsed time', () => {
  const html = renderToStaticMarkup(createElement(WorkingIndicator, { modelId: 'AGY', name: '瞳', elapsed: '2 分鐘' }));
  assert.match(html, /role="status"/);
  assert.match(html, /data-cli="AGY"/);
  assert.match(html, /瞳 工作中 · 2 分鐘/);
  assert.match(html, /guild-working__petal/);
});

test('a working room with an unchanged screen is shown as possibly stuck, with a way to open the terminal', () => {
  const attention = { workingSince: { r1: 0 }, quietSince: () => 0 };
  assert.equal(workState('r1', attention, stallAfterMs - 1_000)?.stalled, undefined, 'ten minutes of stillness is the point, not before');
  assert.equal(stallAfterMs, 10 * 60_000, 'the page hint comes after ten minutes; the push waits fifteen');
  assert.equal(workState('r1', attention, stallAfterMs)?.stalled, '10 分鐘');
  assert.equal(workState('other', attention, stallAfterMs), undefined);
  const html = renderToStaticMarkup(createElement(WorkingIndicator, { modelId: 'CODEX', name: '光', stalled: '4 分鐘', onShowTerminal() {} }));
  assert.match(html, /光 4 分鐘沒有更新，可能卡住/);
  assert.match(html, /aria-label="收起這個提示"[^>]*>/, 'the stuck card has a small close mark');
  assert.match(html, /guild-working__close/);
  assert.match(html, />看終端</);
  assert.doesNotMatch(html, /guild-working__petal/);
  assert.match(renderToStaticMarkup(createElement(WorkingSpark, {})), /aria-label="工作中"/);
  assert.match(renderToStaticMarkup(createElement(WorkingSpark, { stalled: true })), /aria-label="可能卡住"/);
});

test('settings combine sound and phone preview, with no working folder (it is picked per new room) and no notifications or no-op sync button', () => {
  const html = renderToStaticMarkup(createElement(SettingsModal, {
    characters: INITIAL_CHARACTERS, soundEnabled: true, onSound() {},
    phonePreview: false, onPhonePreview() {}, onClose() {},
  }));
  assert.doesNotMatch(html, /預設工作資料夾/);
  assert.doesNotMatch(html, /本機 Session 資料夾/);
  assert.match(html, /風鈴音效/);
  assert.doesNotMatch(html, /通知/);
  assert.match(html, /iPhone 畫面預覽/);
  assert.doesNotMatch(html, /更新工作階段清單/);
});

test('the Mac room shows the approval command and every CLI option, without the current model on history', () => {
  const room = {
    ...baseRoom, ready: false, status: 'waiting_approval',
    logs: [{ id: 'l1', sender: 'agent', text: 'old reply', timestamp: '08:00' }],
    pendingApproval: {
      id: 'a', title: 'CLI 等待一次性授權', reason: '請核對終端原文。', commandOrFile: 'Permission Required: Create file\nnotes.md',
      type: 'shell_command', riskLevel: 'normal', diffLines: [], requestedAt: '',
      additionalChoices: [{ id: 'option-2', key: '2', label: 'Yes, allow all edits during this session (shift+tab)' }],
    },
  } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room, character: INITIAL_CHARACTERS.CLAUDE,
    worktreeCall: async () => { throw new Error('The closed panel should not request worktree data'); },
    onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {},
    onSendPrompt() {}, onSubmitDraft() {}, attachmentPicker: null, attachmentPreview: null, hasAttachment: false,
    promptInput: '', setPromptInput() {}, onRunCompact() {}, terminal: null,
    terminalOpen: false, onToggleTerminal() {}, controls: null, onRedeemResetVoucher() {},
  }));
  assert.match(html, /Permission Required: Create file/);
  assert.match(html, /2\. Yes, allow all edits during this session/);
  assert.match(html, /打選項數字/);
  assert.doesNotMatch(html, /Opus 5\.5\)/);
  assert.match(html, /待審批/);
  assert.match(html, /複製完整 Session ID|ID<\/span> 等待綁定/);
  assert.match(html, /複製工作目錄/);
  assert.equal([...html.matchAll(/title="查看改動與檔案"/g)].length, 1);
  assert.match(html, /data-no-swipe="true" aria-label="查看改動與檔案"/);
  assert.doesNotMatch(html, /立即同步本地資料夾/);
  assert.doesNotMatch(html, /Tailscale 街外手機直連/);
});

test('a working Mac room shows the petal indicator with elapsed time', () => {
  const room = { ...baseRoom, ready: false, status: 'running' } as TerminalRoom;
  const html = renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room, character: INITIAL_CHARACTERS.CLAUDE, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {},
    onSendPrompt() {}, onSubmitDraft() {}, attachmentPicker: null, attachmentPreview: null, hasAttachment: false,
    promptInput: '', setPromptInput() {}, onRunCompact() {}, terminal: null, workingElapsed: '剛才開始',
    terminalOpen: false, onToggleTerminal() {}, controls: null, onRedeemResetVoucher() {},
  }));
  assert.match(html, /響 工作中 · 剛才開始/);
  assert.match(html, /工作中 · 剛才開始<\/span>/);
});

test('a sent prompt keeps the bloom until a reply, even when the CLI working text is not recognised', () => {
  const idle = { ...baseRoom, id: 'agy', modelId: 'AGY', ready: true, status: 'idle', logs: [] } as unknown as TerminalRoom;
  const start = { agy: { at: 0, lastAgent: undefined, sawBusy: false } };
  // The CLI still looks idle (unrecognised working text): keep waiting.
  assert.equal(stepAwaiting(start, [idle], 60_000), start);
  const attention = { workingSince: {}, quietSince: () => 60_000 };
  assert.equal(workState('agy', attention, 60_000, 0, idle)?.elapsed, '1 分鐘');
  // A reply ends it.
  const replied = { ...idle, logs: [{ id: 'a1', sender: 'agent', text: 'done', timestamp: '' }] } as unknown as TerminalRoom;
  assert.deepEqual(stepAwaiting(start, [replied], 61_000), {});
  // Busy then back at the prompt for a while also ends it.
  const busy = stepAwaiting(start, [{ ...idle, ready: false, status: 'running' } as TerminalRoom], 1_000);
  const back = stepAwaiting(busy, [idle], 2_000);
  assert.ok(back.agy?.readyAt);
  assert.deepEqual(stepAwaiting(back, [idle], 30_000), {});
  // Stopped CLI ends it; approvals hide the bloom without ending the wait.
  assert.deepEqual(stepAwaiting(start, [{ ...idle, live: false } as TerminalRoom], 1_000), {});
  assert.equal(workState('agy', attention, 60_000, 0, { ...idle, pendingApproval: { id: 'x' } } as unknown as TerminalRoom), undefined);
});

test('reset times read as a clock time plus how long is left, and unknown stays explicit', () => {
  const now = new Date(2026, 10, 12, 10, 0).getTime();
  assert.equal(formatReset(null, now), '');
  assert.match(formatReset(new Date(2026, 10, 12, 11, 59).getTime(), now), /^11:59 · 約 1 小時 59 分後$/);
  assert.match(formatReset(new Date(2026, 10, 14, 8, 30).getTime(), now), /^11\/14 08:30 · 約 1 日 22 小時後$/);
  assert.match(formatReset(now - 1000, now), /即將重置/);
});

test('model names read the same short way for all three CLIs', () => {
  assert.equal(shortModelName('CLAUDE', 'claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(shortModelName('CLAUDE', 'claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.equal(shortModelName('CLAUDE', 'Claude Haiku 5.5'), 'Haiku 5.5');
  assert.equal(shortModelName('CLAUDE', 'sonnet'), 'Sonnet');
  assert.equal(shortModelName('CODEX', 'gpt-6.1-terra'), 'GPT-6.1 Terra');
  assert.equal(shortModelName('CODEX', 'gpt-6-sol'), 'GPT-6 Sol');
  assert.equal(shortModelName('AGY', 'Gemini 3.8 Flash (Low)'), 'Gemini 3.8 Flash');
  assert.equal(shortModelName('AGY', '—'), '');
});

test('the pickers show the model and the effort without a "last time" prefix, for each CLI', () => {
  const cases = [['CLAUDE', 'claude-sonnet-5-5', 'high', 'Sonnet 5.5'], ['CODEX', 'gpt-6.1-terra', 'medium', '6.1 Terra'], ['AGY', 'Gemini 3.8 Flash', 'low', 'Gemini 3.8 Flash']] as const;
  for (const [modelId, model, effort, label] of cases) {
    const room = { ...baseRoom, modelId, selectedSubModel: model, effortLevel: effort, effortSource: 'session', live: false } as unknown as TerminalRoom;
    const html = (kind: 'model' | 'effort') => renderToStaticMarkup(createElement(ModelEffortPicker, { room, character: INITIAL_CHARACTERS[modelId], kind, onSend() {}, mobile: true }));
    assert.match(html('model'), new RegExp(`>${label}<`));
    assert.match(html('effort'), new RegExp(`>${effort}<`));
    assert.doesNotMatch(html('effort'), /上次 /);
  }
});

test('the phone role card shows both quotas, HP in red and MP in blue', () => {
  const character = { ...INITIAL_CHARACTERS.AGY, mpWeekly: { ...INITIAL_CHARACTERS.AGY.mpWeekly, current: 11.4 }, hp5h: { ...INITIAL_CHARACTERS.AGY.hp5h, current: 98.6 } };
  const html = renderToStaticMarkup(createElement(RoleCard, { character, modelId: 'AGY', active: true, waiting: false, onSelect() {} }));
  assert.match(html, />HP 11%</);
  assert.match(html, />MP 99%</);
  assert.match(html, /aria-label="[^"]*HP 11%，MP 99%"/);
  const unknown = renderToStaticMarkup(createElement(RoleCard, { character: INITIAL_CHARACTERS.CODEX, modelId: 'CODEX', active: false, waiting: false, onSelect() {} }));
  assert.match(unknown, />HP —</);
});

test('the paperclip has no outer ring and send and stop are a matched pair', () => {
  const clip = renderToStaticMarkup(createElement(AttachmentPicker, { files: [], size: 'original', onSize() {}, onChange() {}, onError() {}, supported: true }));
  assert.doesNotMatch(clip, /border-\[#E2D6C5\]/);
  assert.match(clip, /<input[^>]*multiple/, 'several images can be picked at once');
  assert.doesNotMatch(clip, /bg-white/);
  const send = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true }));
  const stop = renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {} }));
  assert.match(send, /data-composer-send/);
  assert.match(stop, /data-composer-stop/);
  for (const button of [send, stop, clip]) assert.match(button, /h-9 w-9/, 'the three icons are the same size');
  assert.match(stop, /aria-label="停止目前工作"/);
});

test('the preview shows every chosen image with its own remove button and one resolution choice', () => {
  const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' }), new File(['c'], 'c.heic', { type: 'image/heic' })];
  const html = renderToStaticMarkup(createElement(AttachmentPicker, { files, size: 'medium', onSize() {}, onChange() {}, onError() {}, supported: true, mode: 'preview' }));
  for (const n of [1, 2, 3]) assert.match(html, new RegExp(`aria-label="移除圖片 ${n}"`));
  assert.equal((html.match(/<select/g) ?? []).length, 1);
  // A HEIC photo cannot be sent as it is, so the original-quality choice is off.
  assert.match(html, /<option value="original" disabled/);
  assert.equal(renderToStaticMarkup(createElement(AttachmentPicker, { files: [], size: 'original', onSize() {}, onChange() {}, onError() {}, supported: true, mode: 'preview' })), '');
});

test('the quota window is one tidy block per CLI: name, trend chip, both quotas on the right, one reset line each', () => {
  const html = renderToStaticMarkup(createElement(UsageCalibrationModal, { isOpen: true, characters: INITIAL_CHARACTERS, onClose() {} }));
  assert.doesNotMatch(html, /查配額|Reset ×|開啟 Reset|Banked|Settings → Usage|用 \/usage|\/status/);
  assert.equal((html.match(/額度趨勢/g) ?? []).length, 3);
  assert.equal((html.match(/MP 5h <span/g) ?? []).length, 3, 'the quota numbers sit beside each name');
  assert.equal((html.match(/HP 每週 <span/g) ?? []).length, 3);
  assert.equal((html.match(/<p>MP 5h　/g) ?? []).length, 3, 'each reset time is one left-aligned line');
  assert.equal((html.match(/<p>HP 每週　/g) ?? []).length, 3);
  assert.equal((html.match(/whitespace-nowrap">[^<]* · (?:AGY|Codex|Claude)</g) ?? []).length, 3, 'names never wrap onto two lines');
});

test('the control bar shows Codex models without "GPT-": 6.1 Sol, 6.1 Terra, 6 Astra; other CLIs and the menu keep their names', async () => {
  const { barModelName } = await import('../src/utils/roomUi');
  assert.equal(barModelName('CODEX', 'GPT-6.1-Sol'), '6.1 Sol');
  assert.equal(barModelName('CODEX', 'GPT-6.1 Terra'), '6.1 Terra');
  assert.equal(barModelName('CODEX', 'GPT-6 Astra'), '6 Astra');
  assert.equal(barModelName('CODEX', 'GPT-6.1'), '6.1');
  assert.equal(barModelName('CODEX', 'o3'), 'o3');
  assert.equal(barModelName('CODEX', ''), '');
  assert.equal(barModelName('CLAUDE', 'Opus 5.5'), 'Opus 5.5');
  assert.equal(barModelName('AGY', 'Gemini 4 Hydrogen'), 'Gemini 4 Hydrogen');
  const room = { ...baseRoom, modelId: 'CODEX', selectedSubModel: 'GPT-6.1-Sol', effortLevel: 'xhigh', effortSource: 'live', live: true } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(ModelEffortPicker, { room, character: INITIAL_CHARACTERS.CODEX, kind: 'model', onSend() {}, mobile: true }));
  assert.match(html, />6\.1 Sol</);
  assert.match(html, /title="GPT-6\.1-Sol"/, 'the full name stays as the tooltip');
});

test('the model and effort menu is drawn on the page, above a tall composer, and still closes on an outside tap', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/components/ModelEffortPicker.tsx', import.meta.url), 'utf8');
  // Inside the control bar the menu sat in a lower layer than a composer that grew tall with a long message.
  assert.match(source, /createPortal\(<div ref=\{menuRef\} role="menu"/);
  assert.match(source, /document\.body\)/);
  assert.match(source, /z-\[80\]/);
  assert.match(source, /!menuRef\.current\?\.contains\(event\.target as Node\)/);
  assert.doesNotMatch(source, /fixed left-3 max-w/, 'the old in-bar placement is gone');
});

test('a typed answer field is 16px on a phone (iOS zooms in on a smaller one), and a question gets one notification, not two', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
  const card = await read('../src/components/QuestionCard.tsx');
  assert.match(card, /<input type="text"[\s\S]*?className="[^"]*\btext-base sm:text-sm\b/);
  const group = await read('../src/components/GroupChat.tsx');
  assert.match(group, /<input type="search"[\s\S]*?className="[^"]*\btext-base sm:text-sm\b/);
  const app = await read('../src/App.tsx');
  // The question already has its bubble (questionAlerts); only finished work also needs a toast.
  assert.match(app, /if \(!watching && kind === 'done'\) showToast\(message, 15_000, room\.id\);/);
});
