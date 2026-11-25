import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { execFileSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import { ControlBar } from '../src/components/ControlBar'
import { GuildActionButton } from '../src/components/GuildActions'
import { GroupChatView } from '../src/components/GroupChat'
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace'
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData'
import type { TerminalRoom } from '../src/types/guild'
import { burstPetals, petalVectors } from '../src/utils/petals'
import { roleAccent } from '../src/utils/roleAccent'

const room = (extra = {}) => ({ id: 'a', modelId: 'CODEX', roomName: 'R5', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: 'low', selectedSubModel: 'GPT-6.1-Sol', contextUsagePct: 42,
  repoPath: '/tmp', gitBranch: 'main', progressPercent: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [], ...extra }) as unknown as TerminalRoom

const bar = (props = {}) => renderToStaticMarkup(createElement(ControlBar, {
  room: room(), character: INITIAL_CHARACTERS.CODEX, onCommand() {}, compact: { title: '/compact', onRun() {} }, terminal: { open: false, onToggle() {} },
  shield: { onPermissions() {}, autoMode: false, onMode() {} }, quota: { label: '×2', onClick() {} }, ...props,
}))

test('the control row is one soft capsule: model, effort and compact, a thin line, then terminal, permission and quota', async () => {
  const html = bar()
  assert.equal((html.match(/role="group"/g) ?? []).length, 1, 'one capsule all the way round, not two')
  assert.match(html, /aria-label="模型、推理力度、終端、權限同 CLI"/)
  const line = html.indexOf('data-divider')
  assert.ok(line > 0 && (html.match(/data-divider/g) ?? []).length === 1)
  assert.ok(html.indexOf('aria-label="壓縮對話"') < line, 'compact is before the line')
  assert.ok(html.indexOf('aria-label="顯示或收起終端"') > line && html.indexOf('aria-label="CLI 權限設定') > line && html.indexOf('aria-label="額度"') > line)
  // Spec change (瞳's liquid glass commit): the capsule's look moved from utility classes to `.guild-liquid-glass` in index.css.
  assert.match(html, /class="guild-liquid-glass[^"]*rounded-full/, 'a warm see-through capsule instead of outlined white pills')
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(css, /\.guild-liquid-glass\s*\{[^}]*backdrop-filter:\s*blur[^}]*\}/, 'the capsule is see-through glass')
  assert.match(css, /\.guild-liquid-glass\s*\{[^}]*box-shadow:/, 'and has its soft shadow')
  assert.doesNotMatch(html, /border border-\[#E2D6C5\]/, 'no outline on the buttons')
  assert.match(html, /data-context-ring="42"/, 'the compact control is a ring that shows how full the context is, on Mac and phone alike')
  assert.match(html, /已用 42%/, 'the exact share is in its tooltip')
  assert.doesNotMatch(html, />42%</, 'and no number takes room beside it')
  assert.match(bar({ mobile: true }), /data-context-ring="42"/)
})

test('an open terminal takes the role colour, a room without approval shows its pink shield, and quota is a quiet button', () => {
  const closed = bar()
  assert.doesNotMatch(closed, /aria-pressed="true"/)
  const open = bar({ terminal: { open: true, onToggle() {} } })
  assert.match(open, /aria-pressed="true"[^>]*style="color:#7A9580"/)
  assert.ok(roleAccent.CODEX.wash === '#F9FFF9')
  assert.match(bar({ shield: { autoMode: true, onMode() {}, onPermissions() {} } }), /style="color:#7A9580"/)
  assert.match(bar({ cli: createElement('span', { id: 'cli' }, 'CLI') }), /<span id="cli">CLI<\/span>/)
  assert.doesNotMatch(bar({ quota: undefined }), /aria-label="額度"/)
  assert.match(bar({ note: '設定範圍' }), /設定範圍/)
})

test('single rooms on phone and Mac and the group room all use the same control bar', async () => {
  const group = renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [{ roomId: 'a', modelId: 'CODEX', room: room() }], characters: INITIAL_CHARACTERS,
    onBack() {}, onSend() {}, onCommand() {}, onDecision() {}, onMenu() {} }))
  const mac = renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room: room(), character: INITIAL_CHARACTERS.CODEX, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {}, onSendPrompt() {}, onSubmitDraft() {},
    promptInput: '', setPromptInput() {}, sending: false, approving: false, onRunCompact() {}, onRedeemResetVoucher() {}, onToggleTerminal() {}, onShowTerminal() {}, terminalOpen: false, hasAttachment: false,
  } as never))
  for (const [name, html] of [['group', group], ['mac', mac]] as const) {
    assert.equal((html.match(/role="group"/g) ?? []).length, 1, `${name}: one capsule, the same everywhere`)
    assert.equal((html.match(/data-divider/g) ?? []).length, 1, `${name}: one thin line inside it`)
    assert.match(html, /aria-label="壓縮對話"/)
    assert.match(html, /aria-label="顯示或收起終端"/)
  }
  assert.doesNotMatch(mac, /aria-label="額度"/, 'no quota button while the reset-voucher count is unknown')
  const phone = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.ok(phone.includes('<ControlBar room={selectedRoom} character={selectedCharacter} mobile'))
})

test('petals fan upwards, stay small, differ a little each time and are quiet for people who ask for less motion', () => {
  const vectors = petalVectors(5, () => 0.5)
  assert.equal(vectors.length, 5)
  assert.ok(vectors.every(vector => vector.dy < 0), 'they rise')
  assert.ok(vectors.every(vector => vector.size >= 5 && vector.size <= 8), 'and stay small')
  assert.ok(vectors[0].dx < 0 && vectors[4].dx > 0, 'fanned left to right')
  assert.notDeepEqual(petalVectors(4, () => 0.1), petalVectors(4, () => 0.9))
  assert.doesNotThrow(() => burstPetals({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) } as never), 'no page to draw on is fine')
  const created: { style: { cssText: string }; animate?: unknown; remove: () => void }[] = []
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, window: g.window }
  g.document = { createElement: () => { const element = { style: { cssText: '' }, setAttribute() {}, remove() {}, animate: () => ({}) }; created.push(element as never); return element }, body: { appendChild() {} } }
  g.window = { matchMedia: () => ({ matches: true }) }
  try {
    burstPetals({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) } as never)
    assert.equal(created.length, 0, 'reduced motion: no petals')
    g.window = { matchMedia: () => ({ matches: false }) }
    burstPetals({ getBoundingClientRect: () => ({ left: 5, top: 5, width: 10, height: 10 }) } as never, { count: 3 })
    assert.equal(created.length, 3)
    assert.match(created[0].style.cssText, /position:fixed;left:10px;top:10px/)
    assert.match(created[0].style.cssText, /pointer-events:none/)
  } finally { g.document = saved.document; g.window = saved.window }
})

test('the send button reacts to a press (petals and a spring on the arrow), but a disabled one stays still', () => {
  // Isolate the JSX runtime instrumentation so it captures the event handler
  // during a real React render, without changing another test's JSX runtime.
  const probe = `
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const runtime = require('react/jsx-runtime');
    let onClick;
    for (const key of ['jsx', 'jsxs']) {
      const original = runtime[key];
      runtime[key] = (type, props, ...rest) => {
        if (type === 'button' && props['data-composer-send']) onClick = props.onClick;
        return original(type, props, ...rest);
      };
    }
    const { GuildActionButton } = require('./src/components/GuildActions.tsx');
    function press(disabled) {
      const animated = [], petals = [];
      global.document = { createElement: () => {
        const element = { style: { cssText: '' }, setAttribute() {}, remove() {}, animate: () => ({}) };
        petals.push(element); return element;
      }, body: { appendChild() {} } };
      global.window = { matchMedia: () => ({ matches: false }) };
      onClick = undefined;
      const html = renderToStaticMarkup(React.createElement(GuildActionButton, { kind: 'send', iconOnly: true, disabled }));
      if (typeof onClick !== 'function') throw Error('missing rendered send handler');
      const button = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 36, height: 36 }), querySelector: () => ({ animate: () => { animated.push('spring'); return {}; } }) };
      onClick({ currentTarget: button });
      return { animated, petals: petals.length, disabledAttribute: html.includes('disabled=""') };
    }
    console.log(JSON.stringify([press(false), press(true)]));
  `
  const [live, still] = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--eval', probe], { cwd: process.cwd(), encoding: 'utf8' }))
  assert.deepEqual(live, { animated: ['spring'], petals: 5, disabledAttribute: false })
  assert.deepEqual(still, { animated: [], petals: 0, disabledAttribute: true })
})

test('the reset-voucher potion is shown only while there is a voucher: zero, unknown and none are hidden, for every CLI', async () => {
  const { hasResetVouchers } = await import('../src/utils/roomUi')
  const character = (resetVouchers?: number | null) => ({ hp5h: { resetVouchers } })
  assert.equal(hasResetVouchers(character(2)), true)
  assert.equal(hasResetVouchers(character(1)), true)
  assert.equal(hasResetVouchers(character(0)), false, 'Codex reports 0: hidden')
  assert.equal(hasResetVouchers(character(null)), false)
  assert.equal(hasResetVouchers(character(undefined)), false)
  const { readFile } = await import('node:fs/promises')
  for (const file of ['../src/App.tsx', '../src/components/RightRoomWorkspace.tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /quota=\{!hasResetVouchers\(/, `${file} uses the shared rule`)
    assert.doesNotMatch(source, /resetVouchers == null \? undefined/, `${file} no longer shows a zero`)
  }
})
