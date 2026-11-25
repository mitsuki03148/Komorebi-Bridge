import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';
import { COMPOSER_MAX_PX, fitHeight } from '../src/utils/useAutosize';

test('the composer grows with its content up to about twice the old height, and then scrolls', () => {
  assert.deepEqual(fitHeight(36, 900), { height: 36, scrolls: false });
  assert.deepEqual(fitHeight(120, 900), { height: 120, scrolls: false });
  assert.deepEqual(fitHeight(600, 900), { height: COMPOSER_MAX_PX, scrolls: true });
  assert.ok(COMPOSER_MAX_PX >= 2 * 112, 'at least double the old 7rem maximum');
});

test('on a short screen, such as a phone with the keyboard open, it never takes more than a third of the height', () => {
  assert.deepEqual(fitHeight(600, 480), { height: 168, scrolls: true });
  assert.equal(fitHeight(600, 100).height, 48);
});

test('the composer is a rounded box with its buttons at the bottom, so it still looks right when tall', () => {
  const room = { id: 'r', modelId: 'CLAUDE', roomName: '測試', repoPath: '/tmp', gitBranch: 'main', selectedSubModel: 'Opus 5.5', effortLevel: null, contextUsagePct: null,
    progressPercent: null, status: 'idle', currentActionSummary: '', bubbleSnippet: '', updatedAt: '', remoteControl: {}, live: true, ready: true, logs: [] } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room, character: INITIAL_CHARACTERS.CLAUDE, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {},
    onSendPrompt() {}, onSubmitDraft() {}, attachmentPicker: null, attachmentPreview: null, hasAttachment: false,
    promptInput: '', setPromptInput() {}, onRunCompact() {}, terminal: null, terminalOpen: false, onToggleTerminal() {}, controls: null, onRedeemResetVoucher() {},
  }));
  assert.match(html, /<form[^>]*items-end[^>]*rounded-\[1\.75rem\]/);
  assert.doesNotMatch(html, /<textarea[^>]*max-h-/);
});
