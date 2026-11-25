import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import App from '../src/App';
import { LiveTerminal, LiveTerminalControls } from '../src/components/LiveTerminal';
import { SlashCommandMenu } from '../src/components/SlashCommandMenu';
import { ComposerStopButton, GuildActionButton } from '../src/components/GuildActions';
import type { TerminalRoom } from '../src/types/guild';

test('the room terminal exposes directional controls and native selected styling without manual open', () => {
  const room = { id: 'menu', modelId: 'CODEX', screen: '1. First\n2. Second',
    screenStyles: [{ start: 9, end: 18, foreground: 'var(--terminal-bg)', background: 'var(--terminal-fg)' }],
    menu: { id: 'shown', title: '權限設定', confirm: true, numberKeys: ['1', '2'] } } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(LiveTerminal, { room, compact: true, onMenu() {} }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="向下"/);
  assert.match(html, /aria-label="2"/);
  assert.match(html, /background-color:var\(--terminal-fg\)[^>]*>2\. Second<\/span>/);
});

test('a room with a question card does not also open the terminal menu by itself', () => {
  const asking = { id: 'asking', modelId: 'CLAUDE', screen: '1. First\n2. Second', screenStyles: [],
    menu: { id: 'q', title: '答題', confirm: true, numberKeys: ['1', '2'] },
    pendingQuestion: { id: 'p', questions: [{ title: 'Pick one', options: ['First', 'Second'] }] } } as unknown as TerminalRoom;
  assert.equal(renderToStaticMarkup(createElement(LiveTerminal, { room: asking, compact: true, onMenu() {} })), '', 'the card is the only thing shown');
  // Opened by hand, the terminal is still there.
  assert.match(renderToStaticMarkup(createElement(LiveTerminal, { room: asking, compact: true, forceOpen: true, onMenu() {} })), /aria-label="2"/);
  // A menu with no question still opens by itself.
  const plain = { ...asking, pendingQuestion: undefined } as unknown as TerminalRoom;
  assert.match(renderToStaticMarkup(createElement(LiveTerminal, { room: plain, compact: true, onMenu() {} })), /aria-expanded="true"/);
});

test('Claude screen reader selected marker is highlighted in the terminal', () => {
  const room = { id: 'claude-menu', modelId: 'CLAUDE', screen: 'Select a model\n  (selected) 1. Opus\n  2. Sonnet',
    screenStyles: [], menu: { id: 'menu', title: '模型／推理力度', confirm: true } } as unknown as TerminalRoom;
  const html = renderToStaticMarkup(createElement(LiveTerminal, { room, compact: true, onMenu() {} }));
  assert.match(html, /background-color:var\(--terminal-accent\)[^>]*>  \(selected\) 1\. Opus<\/span>/);
  assert.doesNotMatch(html, /background-color:var\(--terminal-accent\)[^>]*>  2\. Sonnet/);
});

test('slash suggestions follow the selected CLI and leave arguments for direct entry', () => {
  const menu = (modelId: TerminalRoom['modelId'], draft: string) =>
    renderToStaticMarkup(createElement(SlashCommandMenu, { modelId, draft, onSelect() {} }));
  assert.match(menu('CODEX', '/'), /aria-label="CLI 指令選單"/);
  assert.match(menu('CODEX', '/'), />\/permissions</);
  assert.match(menu('CODEX', '/ap'), />\/app</);
  assert.doesNotMatch(menu('CLAUDE', '/'), />\/app</);
  assert.match(menu('CLAUDE', '/conf'), />\/config</);
  assert.equal(menu('CLAUDE', '/model sonnet'), '');
});

test('top rail is plain round icons and decorative window dots are absent', () => {
  const previousWindow = globalThis.window, previousLocation = globalThis.location;
  try {
    globalThis.window = { matchMedia: () => ({ matches: true }) } as unknown as Window & typeof globalThis;
    globalThis.location = { search: '' } as Location;
    const html = renderToStaticMarkup(createElement(App));
    assert.match(html, /<header class="relative z-40 /);
    assert.doesNotMatch(html, /aria-label="開啟房間選單"|aria-label="開啟音效|title="音效已開啟/, 'no flowers button and no sound button in the top rail');
    assert.match(html, /aria-label="已封存房間，0 間"/);
    assert.doesNotMatch(html, /×0/, 'archive and group buttons stay round icons without a count');
    assert.doesNotMatch(html, /Mac Tailscale 已就緒/);
    assert.doesNotMatch(html, /bg-\[#F28B82\]/);
  } finally { globalThis.window = previousWindow; globalThis.location = previousLocation; }
});

test('compact CLI control ends a room directly, keeps a menu only when there is a remote link to open, and resumes in one tap', () => {
  const room = { id: 'a', modelId: 'CODEX', live: true, repoPath: '/tmp', sessionId: 'session', resumable: true,
    remoteControl: { sessionUrl: '' } } as unknown as TerminalRoom;
  const props = { room, compact: true, onStart() {}, onClose() {}, onInterrupt() {}, onRemote() {} };
  const live = renderToStaticMarkup(createElement(LiveTerminalControls, props));
  // "End" is the only thing to offer, so it is one button, not a menu holding one button.
  assert.match(live, /aria-label="結束 CLI"[^>]*>結束</);
  assert.doesNotMatch(live, /aria-label="CLI 房間控制"|Codex Mac App/);
  const claude = renderToStaticMarkup(createElement(LiveTerminalControls, { ...props, room: { ...room, modelId: 'CLAUDE' } as TerminalRoom }));
  assert.match(claude, /aria-label="結束 CLI"/);
  // With a remote link to open, the controls stay behind one menu button.
  const linked = renderToStaticMarkup(createElement(LiveTerminalControls, { ...props, room: { ...room, modelId: 'CLAUDE', remoteControl: { sessionUrl: 'https://example.test/s' } } as unknown as TerminalRoom }));
  assert.match(linked, /aria-label="CLI 房間控制"/);
  assert.doesNotMatch(linked, /結束 CLI/);
  room.live = false;
  const stopped = renderToStaticMarkup(createElement(LiveTerminalControls, props));
  assert.match(stopped, /續接/);
  assert.doesNotMatch(stopped, /Codex Mac App/);
});

test('composer exposes labelled icon-only send and a distinct stop action', () => {
  const send = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true }));
  const stop = renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {} }));
  assert.match(send, /aria-label="發送"/);
  assert.doesNotMatch(send, />發送</);
  assert.match(stop, /aria-label="停止目前工作"/);
  assert.match(stop, /type="button"/);
});
