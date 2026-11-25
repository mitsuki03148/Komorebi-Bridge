import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveTerminal } from '../src/components/LiveTerminal'
import type { TerminalRoom } from '../src/types/guild'
import { leastScroll, menuHint, placement, scrollAfterUpdate, selectionLabel, wasAtEnd } from '../src/utils/terminalScroll'

const base = { opening: false, newMenu: false, menuOpen: true, atEnd: false, current: 40, viewport: 100, scrollHeight: 600 }

test('a menu is lined up once when it opens, and again only when a different menu appears', () => {
  const highlight = { top: 300, bottom: 316 }
  assert.equal(scrollAfterUpdate({ ...base, opening: true, highlight }), 216, 'the highlighted row is brought into view with the least movement')
  assert.equal(scrollAfterUpdate({ ...base, newMenu: true, highlight }), 216)
  assert.equal(scrollAfterUpdate({ ...base, opening: true, highlight: { top: 50, bottom: 66 } }), 40, 'a row already in view does not move the panel')
  assert.equal(scrollAfterUpdate({ ...base, newMenu: true, menuOpen: false, current: 10 }), 600, 'a menu closing returns to the end of the screen')
})

test('stepping through a menu with the arrow keys never moves the panel, however far the highlight goes', () => {
  let scrollTop = 40
  for (let row = 0; row < 30; row++) {
    const top = 20 + row * 16
    scrollTop = scrollAfterUpdate({ ...base, current: scrollTop, scrollHeight: 600 + row, highlight: { top, bottom: top + 16 } })
    assert.equal(scrollTop, 40, `step ${row}: the content stays where it is`)
  }
  // The highlight has left the view, which is told to the person rather than followed.
  assert.equal(placement(20 + 29 * 16, 20 + 30 * 16, scrollTop, 100), 'below')
  assert.equal(placement(0, 16, 40, 100), 'above')
  assert.equal(placement(60, 76, 40, 100), 'visible')
  assert.equal(placement(130, 146, 40, 100), 'visible', 'a row cut by the bottom edge still counts as in view')
  assert.equal(placement(30, 46, 40, 100), 'visible', 'and so does one cut by the top edge')
  assert.equal(placement(140, 156, 40, 100), 'below', 'a row just past the edge is out of view')
  // Only when asked does it jump, by the least amount.
  assert.equal(leastScroll(20 + 29 * 16, 20 + 30 * 16, 40, 100), 20 + 30 * 16 - 100)
  assert.equal(leastScroll(0, 16, 40, 100), 0)
  assert.equal(leastScroll(60, 76, 40, 100), 40)
})

test('without a menu the panel follows new output only while it was already at the end', () => {
  assert.equal(scrollAfterUpdate({ ...base, menuOpen: false, atEnd: true, scrollHeight: 640 }), 640)
  assert.equal(scrollAfterUpdate({ ...base, menuOpen: false, atEnd: false, scrollHeight: 640 }), 40, 'someone reading further up is left alone')
  assert.equal(wasAtEnd(600, 500, 100), true)
  assert.equal(wasAtEnd(600, 400, 100), false)
  assert.equal(wasAtEnd(600, 480, 100), true, 'within a few pixels of the end counts')
})

test('the terminal panel only offers a jump to the highlighted option when there is a menu to jump to', () => {
  const room = (extra = {}) => ({ id: 'a', modelId: 'CODEX', roomName: 'a', live: true, ready: false, screen: '› 選項一\n  選項二', screenId: '1', ...extra }) as unknown as TerminalRoom
  const plain = renderToStaticMarkup(createElement(LiveTerminal, { room: room({ menu: { id: 'm', title: '選單', confirm: true } }), onMenu() {} }))
  assert.match(plain, /aria-label="CLI 即時畫面"/)
  assert.doesNotMatch(plain, /按一下跳過去/, 'nothing is offered while the highlight is in view')
  assert.match(plain, /aria-label="向上"/)
  assert.match(plain, /aria-label="向下"/)
})

test('what is picked is told in words, so it can be read even when its row is out of view', () => {
  assert.equal(selectionLabel('› 2. Yes, and don’t ask again for this command'), '2. Yes, and don’t ask again for this command')
  assert.equal(selectionLabel('  ▸   gpt-6.1-sol   (current)  '), 'gpt-6.1-sol (current)')
  assert.equal(selectionLabel('❯ Opus 5.5'), 'Opus 5.5')
  assert.equal(selectionLabel('› ' + 'x'.repeat(100)).length, 60)
  assert.ok(selectionLabel('› ' + 'x'.repeat(100)).endsWith('…'))
  assert.equal(selectionLabel('   '), '')
  assert.equal(menuHint(['up', 'down', 'enter', 'escape']), '↑↓ 移動 · 確認 · Esc 取消')
  assert.equal(menuHint(['up', 'down', 'left', 'right', 'escape']), '↑↓ 移動 · ←→ · Esc 取消')
  assert.equal(menuHint([]), '')
})

test('an open menu shows how to work it and a line saying what is picked; no menu, no such lines', () => {
  const room = (extra = {}) => ({ id: 'a', modelId: 'CODEX', roomName: 'a', live: true, ready: false, screen: '› 選項一\n  選項二', screenId: '1', ...extra }) as unknown as TerminalRoom
  const withMenu = renderToStaticMarkup(createElement(LiveTerminal, { room: room({ menu: { id: 'm', title: '選單', confirm: true } }), onMenu() {} }))
  assert.match(withMenu, /↑↓ 移動 · 確認 · Esc 取消/)
  assert.match(withMenu, /aria-live="polite"[^>]*>用下面的按鍵選擇項目</, 'before anything is read from the screen the line still says what to do')
  const forced = renderToStaticMarkup(createElement(LiveTerminal, { room: room(), forceOpen: true, onMenu() {} }))
  assert.doesNotMatch(forced, /選中：|用下面的按鍵選擇項目/)
  assert.match(forced, /max-h-\[24dvh\]/, 'one height for every layout')
  assert.doesNotMatch(withMenu, /max-h-\[18dvh\]|max-h-\[25dvh\]/)
})
