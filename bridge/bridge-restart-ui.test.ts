import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { SettingsModal, restartConfirmOptions } from '../src/components/SettingsModals';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { translate, type Lang } from '../src/i18n';

const settings = (more: Partial<Parameters<typeof SettingsModal>[0]> = {}) => renderToStaticMarkup(createElement(SettingsModal, {
  characters: INITIAL_CHARACTERS, soundEnabled: true, onSound() {}, phonePreview: false, onPhonePreview() {}, onClose() {}, ...more,
}));

test('restart confirmation explains disruption, active rooms and defaults to Cancel', () => {
  const opts = restartConfirmOptions((key, vars) => translate('zh', key, vars), 3);
  assert.match(opts.message, /10 至 20 秒/);
  assert.match(opts.message, /CLI session 會結束/);
  assert.match(opts.message, /原有 Session 續接/);
  assert.match(opts.message, /進行中的工作會中斷/);
  assert.match(opts.message, /3 個房間正在工作/);
  const html = renderToStaticMarkup(createElement(ConfirmDialog, { ...opts, open: true, onCancel() {}, onConfirm() {} }));
  assert.match(html, /data-confirm-cancel="true"[^>]*data-autofocus=""/);
  assert.match(html, /data-confirm-accept="true"/);
  assert.doesNotMatch(restartConfirmOptions((key, vars) => translate('zh', key, vars), 0).message, /房間正在工作/);
});

test('settings render 44px restart button only when supported, disabled whilst pending and timeout status', () => {
  assert.doesNotMatch(settings(), /data-bridge-restart/);
  const ready = settings({ restartSupported: true, onRestart() {} });
  assert.match(ready, /data-bridge-restart="true"/);
  assert.match(ready, /min-h-11/);
  assert.match(ready, /重啟 Bridge/);
  const pending = settings({ restartSupported: true, restartPending: true, onRestart() {} });
  assert.match(pending, /data-bridge-restart="true"[^>]*disabled/);
  assert.match(pending, /重啟中…/);
  const timeout = settings({ restartSupported: true, restartMessage: translate('zh', 'settings.restart.timeout') });
  assert.match(timeout, /role="status"[^>]*>尚未確認 Bridge 重啟完成/);
});

test('restart confirmation and timeout text is available in all three languages', () => {
  for (const lang of ['zh', 'en', 'ja'] as Lang[]) {
    const options = restartConfirmOptions((key, vars) => translate(lang, key, vars), 2);
    assert.ok(options.message.includes('2'));
    assert.ok(translate(lang, 'settings.restart.pending'));
    assert.ok(translate(lang, 'settings.restart.timeout'));
    assert.ok(translate(lang, 'settings.restart.success'));
  }
});

test('restart tracker only confirms a new server instance and expires after 90 seconds', async () => {
  const { beginRestartAttempt, restartTimeoutMs } = await import('../src/utils/bridgeRestart');
  let callback = () => {};
  let cleared = 0;
  let timedOut = 0;
  const clock = {
    set(fn: () => void, ms: number) {
      assert.equal(ms, 90_000);
      callback = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clear() { cleared++; },
  };
  assert.equal(restartTimeoutMs, 90_000);
  const attempt = beginRestartAttempt('old', () => { timedOut++; }, clock);
  assert.equal(attempt.observe(undefined), false);
  assert.equal(attempt.observe('old'), false);
  assert.equal(attempt.observe('new'), true);
  assert.equal(attempt.observe('newer'), false);
  callback();
  assert.equal(cleared, 1);
  assert.equal(timedOut, 0);
  const timed = beginRestartAttempt('old', () => { timedOut++; }, clock);
  callback();
  callback();
  assert.equal(timedOut, 1);
  assert.equal(timed.observe('new'), false);
});
