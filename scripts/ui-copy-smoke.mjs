// Exercise the copy controls in Chrome without a live Bridge or its data.
// Run from the repo with: node scripts/ui-copy-smoke.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const app = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true,
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {
    loader: 'tsx',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    contents: `
      import { createRoot } from 'react-dom/client';
      import { RightRoomWorkspace } from './src/components/RightRoomWorkspace';
      import { TailscaleQrModal } from './src/components/SettingsModals';
      import { CopyTurnButton } from './src/components/CopyTurnButton';
      import { setLang, t } from './src/i18n';
      import { INITIAL_CHARACTERS } from './src/data/initialGuildData';

      const { surface, lang } = window.copyCase;
      setLang(lang);
      window.labels = Object.fromEntries([
        'workspace.path.copy', 'workspace.session.copy', 'workspace.copied',
        'settings.tailscale.copy', 'settings.tailscale.copied', 'copy.turn', 'copy.done', 'copy.error',
      ].map(key => [key, t(key)]));

      const room = {
        id: 'fixture', sessionId: 'synthetic-session-id', repoPath: '/tmp/full/fixture/path',
        modelId: 'CODEX', selectedSubModel: 'gpt-6.2-sol', effortLevel: 'medium', roomName: 'Fixture', gitBranch: 'main', status: 'idle',
        live: true, ready: true, logs: [], remoteControl: {},
      };
      createRoot(document.querySelector('main')).render(surface === 'settings'
        ? <TailscaleQrModal tailscaleUrl="http://synthetic.test/subpath/" onClose={() => {}} />
        : surface === 'message'
          ? <CopyTurnButton entry={{ text: 'Synthetic message', codeBlock: 'Synthetic code' }} />
          : <RightRoomWorkspace room={room} character={INITIAL_CHARACTERS.CODEX} promptInput="" />);
    `,
  },
});

const buttons = [
  { surface: 'workspace', label: 'workspace.path.copy', copied: 'workspace.copied', payload: '/tmp/full/fixture/path' },
  { surface: 'workspace', label: 'workspace.session.copy', copied: 'workspace.copied', payload: 'synthetic-session-id' },
  { surface: 'settings', label: 'settings.tailscale.copy', copied: 'settings.tailscale.copied', payload: 'http://synthetic.test/' },
  { surface: 'message', label: 'copy.turn', copied: 'copy.done', payload: 'Synthetic message\n\nSynthetic code' },
];
const scenarios = [
  { mode: 'missing', fallback: true, lang: 'zh' },
  { mode: 'reject', fallback: true, lang: 'en' },
  { mode: 'reject', fallback: false, lang: 'ja' },
  { mode: 'native', fallback: false, lang: 'zh' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => console.error('Fixture error:', error));
  await page.route('http://copy-fixture.test/', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="UTF-8"><main></main>',
  }));
  for (const { surface, label, copied, payload } of buttons) {
    for (const scenario of scenarios) {
      await page.goto('http://copy-fixture.test/');
      await page.evaluate(copyCase => {
        window.copyCase = copyCase;
        window.copyCalls = [];
        Object.defineProperty(navigator, 'clipboard', {
          value: copyCase.mode === 'missing' ? undefined : {
            async writeText(text) {
              window.copyCalls.push(['native', text]);
              if (copyCase.mode === 'reject') throw new Error('Clipboard access denied');
            },
          },
        });
        document.execCommand = command => {
          const field = document.activeElement;
          window.copyCalls.push([command, field.value, field.selectionStart, field.selectionEnd, field.readOnly]);
          return copyCase.fallback;
        };
      }, { ...scenario, surface });
      await page.addScriptTag({ content: app.outputFiles[0].text });
      const labels = await page.evaluate(() => window.labels);
      await page.getByRole('button', { name: labels[label], exact: true }).click();
      const confirmed = page.getByRole('button', { name: labels[copied], exact: true });
      if (scenario.mode === 'native' || scenario.fallback) {
        await confirmed.waitFor();
      } else {
        const notice = page.getByRole('status').filter({ hasText: labels['copy.error'] });
        await notice.waitFor();
        assert.equal(await notice.evaluate(el => el.classList.contains('sr-only')), false);
        assert.equal(await confirmed.count(), 0, 'failed copy must never be confirmed');
      }
      const calls = [];
      if (scenario.mode !== 'missing') calls.push(['native', payload]);
      if (scenario.mode !== 'native') calls.push(['copy', payload, 0, payload.length, true]);
      assert.deepEqual(await page.evaluate(() => window.copyCalls), calls);
      assert.equal(await page.locator('textarea[readonly]').count(), 0, 'remove the fallback textarea');
      console.log(`PASS ${label} / ${scenario.mode} / fallback=${scenario.fallback}`);
    }
  }
} finally {
  await browser.close();
}
