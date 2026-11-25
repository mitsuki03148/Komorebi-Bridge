import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLang } from '../src/i18n';
import { WorkingIndicator, WorkingSpark } from '../src/components/WorkingIndicator';
import type { TerminalRoom } from '../src/types/guild';
import { roomStatusLabel } from '../src/utils/roomUi';
import { backgroundTasks } from './terminal';

// Footers and completion lines captured from the real CLIs (Codex from recorded screens, Claude 2.1.329 and AGY probed on 2026-11-20).
const codex = (line: string) => ['• Ran git diff --name-only', '  └ 2b3f9eb7 refs/heads/main', line, '› Ask Codex to do anything', '  GPT-6.2-Sol high · /tmp'].join('\n');
const claude = ['tool: Bash (sleep 50 && echo finished)', 'Running in the background (↓ to manage)', 'claude: started', 'Baked for 1s · done 1:24 PM · 1 shell still running', 'bypass permissions on  ·  1 shell  ·  ↓ to manage', '$'].join('\n');
const agy = ['● Running (sleep 50 && echo finished) (ctrl+o to expand)', '  started', '────────', '>', '────────', '  ● [13:25:17] sleep 50 && echo finished running', '────────', '? for shortcuts                       Gemini 4 Hydrogen · medium · 1 task(s) · /tasks'].join('\n');

test('background tasks are read from each CLI\'s own footer, and only from it', () => {
  assert.equal(backgroundTasks('CODEX', codex('◦ Working (18m 01s • esc to interrupt) · 2 background terminals running · /ps to view · /stop to close')), 2);
  assert.equal(backgroundTasks('CODEX', codex('• Waiting for background terminal (15m 13s • esc to interrupt) · 1 background terminal running · /ps to view · /stop to…')), 1);
  assert.equal(backgroundTasks('CODEX', codex('• Working (1m 32s • esc to interrupt)')), 0);
  assert.equal(backgroundTasks('CLAUDE', claude), 1);
  assert.equal(backgroundTasks('CLAUDE', claude.replace('1 shell  ·', '3 shells  ·').replace('1 shell still', '3 shells still')), 3);
  assert.equal(backgroundTasks('CLAUDE', ['$', 'manual mode on'].join('\n')), 0);
  assert.equal(backgroundTasks('AGY', agy), 1);
  assert.equal(backgroundTasks('AGY', agy.replace('1 task(s) · /tasks', '3 task(s) · /tasks')), 3);
  assert.equal(backgroundTasks('AGY', agy.replace(' · 1 task(s) · /tasks', '')), 0);
  // A sentence that only mentions one is not the footer.
  assert.equal(backgroundTasks('CODEX', codex('• I will check whether 1 background terminal running is left')), 0);
  assert.equal(backgroundTasks('CLAUDE', 'claude: the log said 1 shell ran\n$'), 0);
  assert.equal(backgroundTasks('AGY', '> why does it say 1 task(s) in the footer\n>'), 0);
  // Old text far above the footer does not count.
  assert.equal(backgroundTasks('CODEX', [codex('• Working (1m • esc to interrupt) · 1 background terminal running · /ps to view'), ...Array(20).fill('x')].join('\n')), 0);
});

const room = (extra: Partial<TerminalRoom>) => ({ id: 'r', modelId: 'CODEX', roomName: 'R', live: true, ready: false, status: 'running', ...extra }) as TerminalRoom;

test('the working label becomes "background task running" in each language, and only while a task runs', () => {
  const labels: Record<string, [string, string, string, string]> = {
    zh: ['工作中', '背景任務進行中', '可接收', '可接收 · 背景任務進行中'],
    en: ['Working', 'Background task running', 'Ready', 'Ready · background task running'],
    ja: ['作業中', 'バックグラウンドタスク実行中', '受付可能', '受付可能 · バックグラウンドタスク実行中'],
  };
  try {
    for (const [lang, [working, background, ready, readyBackground]] of Object.entries(labels)) {
      setLang(lang as 'zh');
      assert.equal(roomStatusLabel(room({})), working, lang);
      assert.equal(roomStatusLabel(room({ backgroundTasks: 2 })), background, lang);
      assert.equal(roomStatusLabel(room({ ready: true })), ready, lang);
      assert.equal(roomStatusLabel(room({ ready: true, backgroundTasks: 1 })), readyBackground, lang);
      // An approval or a menu still comes first, and a closed room is not "running" anything.
      assert.notEqual(roomStatusLabel(room({ backgroundTasks: 1, menu: { id: 'm', title: 't', confirm: true } })), background, lang);
      assert.notEqual(roomStatusLabel(room({ backgroundTasks: 1, live: false })), background, lang);
      const card = renderToStaticMarkup(createElement(WorkingIndicator, { modelId: 'CODEX', name: '光', elapsed: '12 分鐘', background: true }));
      assert.ok(card.toLowerCase().includes(background.toLowerCase()) && !card.includes(`光 ${working}`), `${lang}: ${card}`);
      assert.ok(renderToStaticMarkup(createElement(WorkingIndicator, { modelId: 'CODEX', name: '光', elapsed: '12 分鐘' })).toLowerCase().includes(working.toLowerCase()), lang);
      assert.match(renderToStaticMarkup(createElement(WorkingSpark, { background: true })), new RegExp(`aria-label="${background}"`), lang);
    }
  } finally { setLang('zh'); }
});

test('the Bridge keeps the count on the room as the screen changes', async () => {
  const { Rooms } = await import('./rooms');
  const rooms = new Rooms(process.cwd(), () => {});
  const r = room({ modelId: 'CLAUDE', screen: '' });
  const lines = (text: string) => ({ modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => text.split('\n')[n] ?? '' }) } } });
  const live: any = { singleNoted: true, process: { write() {} }, terminal: lines(claude), queued: 0, dirty: true };
  (rooms as any).refresh(r, live);
  assert.equal(r.backgroundTasks, 1);
  live.terminal = lines(['claude: done', 'manual mode on', '$'].join('\n')); live.dirty = true;
  (rooms as any).refresh(r, live);
  assert.equal(r.backgroundTasks, undefined, 'it goes away when the footer no longer shows one');
});
