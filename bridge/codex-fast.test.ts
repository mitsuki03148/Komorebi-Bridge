import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codexFastMode } from './terminal';
import { ControlBar } from '../src/components/ControlBar';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';

test('the Codex footer says whether Fast is on: the word after the effort, before the folder', () => {
  assert.equal(codexFastMode('› Ask Codex to do anything\n\n  GPT-6.1-Sol high Fast · /private/tmp/x'), true);
  assert.equal(codexFastMode('  GPT-6.1-Sol high · /private/tmp/x'), false);
  assert.equal(codexFastMode('  GPT-6.1 Terra xhigh Fast · ~/project'), true);
  assert.equal(codexFastMode('  GPT-6.1 Terra xhigh · ~/project'), false);
  assert.equal(codexFastMode('nothing like a footer'), undefined, 'no footer on screen: unknown, not off');
  assert.equal(codexFastMode('• Service tier set to priority\n  GPT-6.1-Sol high Fast · /x'), true);
  assert.equal(codexFastMode('Fast food · menu'), undefined, 'the word alone is not the footer');
});

const room = (extra = {}, modelId = 'CODEX') => ({ id: 'a', modelId, roomName: 'R5', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: 'high', selectedSubModel: 'GPT-6.1-Sol', contextUsagePct: 42,
  repoPath: '/tmp', gitBranch: 'main', progressPercent: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [], ...extra }) as unknown as TerminalRoom;
const bar = (r: TerminalRoom, sent: string[] = []) => renderToStaticMarkup(createElement(ControlBar, {
  room: r, character: INITIAL_CHARACTERS[r.modelId], onCommand: (_id: string, text: string) => { sent.push(text); }, compact: { title: '/compact', onRun() {} },
  terminal: { open: false, onToggle() {} }, shield: { onPermissions() {} },
} as never));

test('only a Codex room gets the speed button, between effort and compact, lit when Fast is on', () => {
  const off = bar(room({ fastMode: false }));
  assert.match(off, /aria-label="快速模式"[^>]*aria-pressed="false"/);
  assert.ok(off.indexOf('aria-label="快速模式"') > off.indexOf('推理力度') && off.indexOf('aria-label="快速模式"') < off.indexOf('aria-label="壓縮對話"'), 'between effort and compact');
  assert.match(off, /標準速度/);
  const on = bar(room({ fastMode: true }));
  assert.match(on, /aria-label="快速模式"[^>]*aria-pressed="true"/);
  assert.match(on, /Fast 已開/);
  assert.doesNotMatch(bar(room({}, 'CLAUDE')), /快速模式/);
  assert.doesNotMatch(bar(room({}, 'AGY')), /快速模式/);
});

test('the speed button is off while the room is not at its prompt, and while the state is unknown it still works as a toggle', () => {
  assert.match(bar(room({ fastMode: true, ready: false })), /<button[^>]*aria-label="快速模式"[^>]*\sdisabled=""/);
  const unknown = bar(room({}));
  assert.match(unknown, /aria-label="快速模式"/);
  assert.doesNotMatch(unknown, /<button[^>]*aria-label="快速模式"[^>]*\sdisabled=""/);
});

test('the Bridge reads Fast from the Codex screen into the room, and the button sends /fast', async () => {
  const rooms = await readFile(new URL('./rooms.ts', import.meta.url), 'utf8');
  assert.match(rooms, /room\.modelId === 'CODEX'\) this\.noteFast\(room, screen\)/);
  const bar = await readFile(new URL('../src/components/ControlBar.tsx', import.meta.url), 'utf8');
  assert.match(bar, /onCommand\(room\.id, '\/fast'\)/);
});

test('with Fast on, the model and the effort are still read from the footer (the word Fast sits between the effort and the dot)', async () => {
  const { activeModel } = await import('./terminal');
  assert.deepEqual(activeModel('CODEX', '› Ask Codex to do anything\n\n  GPT-6.1 Terra low Fast · /Volumes/Komorebi · Review'), { name: 'GPT-6.1 Terra', effort: 'low' });
  assert.deepEqual(activeModel('CODEX', '  GPT-6.1-Sol high Fast · /Volumes/Komorebi'), { name: 'GPT-6.1-Sol', effort: 'high' });
  assert.deepEqual(activeModel('CODEX', '  GPT-6.1-Sol xhigh · /Volumes/Komorebi'), { name: 'GPT-6.1-Sol', effort: 'xhigh' }, 'Fast off: as before');
  assert.deepEqual(activeModel('CODEX', '• Model changed to gpt-6.1-terra low for this session\n\n  GPT-6.1 Terra low Fast · /x'), { name: 'GPT-6.1 Terra', effort: 'low' });
  assert.equal(activeModel('CODEX', 'Fast food · menu').name, undefined, 'the word Fast alone is not a footer');
});
