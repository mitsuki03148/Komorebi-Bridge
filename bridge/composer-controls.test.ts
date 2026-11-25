import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerStopButton, GuildActionButton } from '../src/components/GuildActions'
import { GroupChatView } from '../src/components/GroupChat'
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData'
import type { TerminalRoom } from '../src/types/guild'
import { boxHeight } from '../src/utils/useAutosize'
import { zh } from '../src/i18n/zh'
import { translate } from '../src/i18n'

test('an empty message box stays one line however long its hint is; typed text still makes it grow, up to the limit', () => {
  assert.deepEqual(boxHeight('', 120, 800), { scrolls: false }, 'a hint that wraps onto two lines does not stretch the box')
  assert.equal(boxHeight('一行', 40, 800).height, 40)
  assert.equal(boxHeight('很長\n很長\n很長', 150, 800).height, 150)
  assert.deepEqual(boxHeight('極長'.repeat(200), 900, 800), { height: 224, scrolls: true })
})

test('send and stop are soft and borderless: a rose-tea disc with a plane, and a rose disc with a rounded square', () => {
  const send = renderToStaticMarkup(createElement(GuildActionButton, { kind: 'send', iconOnly: true }))
  assert.match(send, /rounded-full bg-gradient-to-br from-\[#D88B96\] to-\[#C2707D\]/)
  assert.match(send, /shadow-\[0_4px_10px_-4px/, 'a gentle shadow instead of an outline')
  assert.doesNotMatch(send, /\bborder\b|ring-/, 'no outline')
  assert.match(send, /<svg[^>]*viewBox="0 0 24 24"[^>]*fill="currentColor"/, 'the plane is drawn in the button')
  assert.match(send, /guild-action__icon/, 'the arrow the press springs')
  assert.match(send, /disabled:from-\[#E9DADB\]/, 'it fades when it cannot send')
  const stop = renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {} }))
  assert.match(stop, /bg-\[#FDECEF\]/)
  assert.match(stop, /<rect[^>]*rx="2\.2"/)
  assert.doesNotMatch(stop, /\bborder\b|ring-|guild-stop/, 'no outline and none of the old ring styles')
  assert.match(renderToStaticMarkup(createElement(ComposerStopButton, { onStop() {}, disabled: true })), /disabled=""/)
  // The approve button keeps its own look.
  assert.match(renderToStaticMarkup(createElement(GuildActionButton, { kind: 'approve' })), /guild-action--approve/)
})

test('the hint in the message box is short and small enough to stay on one line, in all three layouts', async () => {
  const room = { id: 'a', modelId: 'CODEX', roomName: 'ExampleApp R5 New', live: true, ready: true, status: 'idle', remoteControl: {}, logs: [] } as unknown as TerminalRoom
  const group = renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [{ roomId: 'a', modelId: 'CODEX', room }], recipientId: 'a', characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onDecision() {}, onMenu() {} }))
  const hint = /placeholder="([^"]*)"/.exec(group)![1]
  assert.equal(hint, '與光對話…', 'the room name is in the header chip already, so it is left out of the hint')
  assert.match(group, /placeholder:text-\[13px\]/)
  const phone = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.ok(phone.includes("placeholder={t('composer.placeholder', { name: selectedCharacter.characterName })}"))
  assert.equal(zh['composer.placeholder'], '與{name}對話，或打 / 指令…')
  assert.equal(translate('zh', 'composer.placeholder', { name: '光' }), '與光對話，或打 / 指令…')
  assert.ok(phone.includes('placeholder:text-[13px]'))
  const mac = await readFile(new URL('../src/components/RightRoomWorkspace.tsx', import.meta.url), 'utf8')
  assert.ok(mac.includes('placeholder:text-[13px]'))
})
