import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { ThemePanel } from '../src/components/SettingsModals';
import { GuildHallHome } from '../src/components/GuildHallHome';
import { EmptyRoomState } from '../src/components/EmptyRoomState';
import { MessageBubble } from '../src/components/MessageBubble';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { burstPetals } from '../src/utils/petals';
import { isNightHour, resolveTheme, setThemeMode, themeModes } from '../src/utils/theme';

test('theme schedule treats 18:00-05:59 as night and supports system/light/dark overrides', () => {
  assert.deepEqual(themeModes, ['auto', 'system', 'light', 'dark']);
  const atHour = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute, 0, 0);

  assert.equal(isNightHour(atHour(17, 59)), false);
  assert.equal(isNightHour(atHour(18, 0)), true);
  assert.equal(isNightHour(atHour(23, 30)), true);
  assert.equal(isNightHour(atHour(5, 59)), true);
  assert.equal(isNightHour(atHour(6, 0)), false);

  assert.equal(resolveTheme('auto', { date: atHour(18, 0) }), 'dark');
  assert.equal(resolveTheme('auto', { date: atHour(12, 0) }), 'light');
  assert.equal(resolveTheme('system', { systemDark: true }), 'dark');
  assert.equal(resolveTheme('system', { systemDark: false }), 'light');
  assert.equal(resolveTheme('light', { date: atHour(22, 0), systemDark: true }), 'light');
  assert.equal(resolveTheme('dark', { date: atHour(12, 0), systemDark: false }), 'dark');
});

test('ThemePanel renders four clean icon-only radio buttons with accessible labels', () => {
  const html = renderToStaticMarkup(createElement(ThemePanel));
  for (const mode of themeModes) {
    assert.match(html, new RegExp(`data-theme-mode="${mode}"`), `contains ${mode} icon button`);
  }
  assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
});

test('burstPetals switches from sakura petals in daylight to 4-point stars at night', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const created: Array<{ style: { cssText: string } }> = [];
  let isDark = false;

  g.window = { matchMedia: () => ({ matches: false }) };
  g.document = {
    documentElement: { classList: { contains: (cls: string) => cls === 'dark' && isDark } },
    createElement: () => {
      const el = { style: { cssText: '' }, setAttribute() {}, remove() {}, animate: () => ({}) };
      created.push(el);
      return el;
    },
    body: { appendChild() {} },
  };
  const host = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 32, height: 32 }) } as unknown as Element;

  try {
    isDark = false;
    burstPetals(host, { count: 2 });
    assert.equal(created.length, 2);
    assert.match(created[0].style.cssText, /border-radius:60% 0 60% 0/);
    assert.match(created[0].style.cssText, /#F2B8C2/);

    created.length = 0;
    isDark = true;
    burstPetals(host, { count: 2 });
    assert.equal(created.length, 2);
    assert.match(created[0].style.cssText, /clip-path:polygon\(/);
    assert.match(created[0].style.cssText, /#F7E3A3/);
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});

test('night guild background exists and both GuildHallHome and EmptyRoomState switch banners with depth scrims', () => {
  assert.equal(existsSync('public/avatars/guild-bg-night.webp'), true);
  setThemeMode('dark');
  try {
    const hall = renderToStaticMarkup(createElement(GuildHallHome, {
      characters: INITIAL_CHARACTERS,
      rooms: [],
      working: {},
    }));
    assert.match(hall, /guild-bg-night\.webp/);
    assert.match(hall, /guild-star-twinkle/);

    const empty = renderToStaticMarkup(createElement(EmptyRoomState, {
      modelId: 'AGY',
      character: INITIAL_CHARACTERS.AGY,
    }));
    assert.match(empty, /guild-bg-night\.webp/, 'mobile empty stage renders night background');
    assert.match(empty, /guild-star-twinkle/, 'mobile empty stage renders twinkling stars at night');
    assert.match(empty, /bg-gradient-to-b from-\[#FBF8F3\]\/74/, 'mobile empty stage has atmospheric depth scrim');
  } finally {
    setThemeMode('auto');
  }
});

test('dark mode selection cards use dark surfaces with bright role highlighter edges', () => {
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /\.dark \.guild-selection\s*\{[\s\S]*--selection-surface:\s*#2d1e31;[\s\S]*--selection-edge:\s*#f0a4b6;/);
  assert.match(css, /\.dark \.guild-selection\[data-cli='CODEX'\]\s*\{[\s\S]*--selection-surface:\s*#1b2c2a;[\s\S]*--selection-edge:\s*#9bd0a6;/);
  assert.match(css, /\.dark \.guild-selection\[data-cli='CLAUDE'\]\s*\{[\s\S]*--selection-surface:\s*#202542;[\s\S]*--selection-edge:\s*#aeb5f0;/);

  const userHtml = renderToStaticMarkup(createElement(MessageBubble, {
    entry: { id: 'u1', sender: 'user', text: 'hello night', timestamp: '16:42', createdAt: '2026-11-16T16:42:00Z' },
    modelId: 'AGY',
    name: '瞳',
  }));
  assert.match(userHtml, /dark:text-\[#F0EAE0\]/, 'user message text turns light in dark mode');
});
