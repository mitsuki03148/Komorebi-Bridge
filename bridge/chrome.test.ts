import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GroupChatView } from '../src/components/GroupChat'
import { MessageBubble } from '../src/components/MessageBubble'
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData'
import type { TerminalLogEntry, TerminalRoom } from '../src/types/guild'
import { bubbleRuns } from '../src/utils/bubbleRuns'
import { roleAccent } from '../src/utils/roleAccent'

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 12, h, m, s).toISOString()
const entry = (id: string, sender: TerminalLogEntry['sender'], time: string, text = id): TerminalLogEntry => ({ id, sender, text, timestamp: time, createdAt: time })

test('the same system line repeated in a stretch becomes one line with a count, per room, and is never merged across messages', () => {
  const left = '已離開房間 · CLI 已結束'
  const runs = bubbleRuns([
    { entry: entry('s1', 'system', at(10, 0), left), key: 'r1' }, { entry: entry('s2', 'system', at(10, 1), left), key: 'r1' },
    { entry: entry('s3', 'system', at(10, 2), left), key: 'r2' }, { entry: entry('s4', 'system', at(10, 3), left), key: 'r1' },
    { entry: entry('s5', 'system', at(10, 4), '已啟動'), key: 'r1' },
    { entry: entry('a', 'agent', at(10, 5)), key: 'r1' },
    { entry: entry('s6', 'system', at(10, 6), left), key: 'r1' },
  ], new Date(2026, 10, 12, 12).getTime())
  assert.deepEqual(runs.map(item => [item.entry.id, item.count]), [['s4', 3], ['s3', undefined], ['s5', undefined], ['a', undefined], ['s6', undefined]])
  assert.equal(runs[0].entry.timestamp, at(10, 3), 'the line shows when it last happened')
  const none = bubbleRuns([{ entry: entry('x', 'user', at(9, 0)), key: 'r' }, { entry: entry('y', 'user', at(9, 0)), key: 'r' }])
  assert.equal(none.length, 2)
})

test('a system line is a small quiet capsule and shows its count', () => {
  const html = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('s', 'system', at(10, 0), '已離開房間'), modelId: 'AGY', name: '瞳 · Xcode', count: 6 }))
  assert.match(html, /已離開房間 ×6/)
  assert.match(html, /rounded-full bg-white\/40 px-2\.5 py-0\.5 text-\[10px\]/)
  assert.doesNotMatch(html, /border-\[#E8DCD2\]/, 'no outline')
  assert.doesNotMatch(renderToStaticMarkup(createElement(MessageBubble, { entry: entry('s', 'system', at(10, 0), '已離開房間'), modelId: 'AGY', name: '瞳' })), /×/)
})

test('the group header shows who it is talking to as a chip in that role\'s colour, and the hint is a small capsule', () => {
  const room = { id: 'a', modelId: 'CLAUDE', roomName: 'R5', live: true, ready: false, status: 'running', currentActionSummary: 'CLI 處理中', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', logs: [] } as unknown as TerminalRoom
  const render = (working: boolean) => renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [{ roomId: 'a', modelId: 'CLAUDE', room }], recipientId: 'a', characters: INITIAL_CHARACTERS,
    workingState: working ? () => ({ elapsed: '0:05' }) : undefined, onBack() {}, onSend() {}, onDecision() {}, onMenu() {} }))
  const html = render(true)
  assert.ok(html.includes(`color:${roleAccent.CLAUDE.name}`))
  assert.ok(html.includes(`background-color:${roleAccent.CLAUDE.wash}E0`))
  assert.match(html, /guild-flower-spin/, 'flower spins gently while it works')
  assert.doesNotMatch(render(false).replace(/<svg[\s\S]*?<\/svg>/g, ''), /guild-flower-spin/)
  assert.match(html, /<header[^>]*border-\[#E6DCD0\]\/60 bg-\[#FBF8F3\]\/62 backdrop-blur-md/, 'the group header is frosted glass: the picture and the bubbles show softly through it (on purpose)')
})

test('the top bar, role cards, room tabs and the group sidebar let the picture through, and active cards take their role colour', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  // Spec change (瞳's A1+B2 frosted canopy & bottom dock redesign): seamless frosted top canopy on phone, soft gradient header on Mac.
  assert.match(source, /<header className="relative z-40[^"]*bg-\[#FBF8F3\]\/74/)
  assert.match(source, /px-3 pt-1\.5 pb-1\.5 grid grid-cols-3/)
  assert.match(source, /px-3 py-1 flex items-center gap-1\.5 shrink-0/)
  assert.match(source, /\[&_aside\]:bg-white\/35/)
  assert.ok(source.includes('[&_.guild-selection[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--selection-surface)_70%,transparent)]'), 'the active role card keeps its own colour, softened')
  assert.ok(source.includes('[&_.guild-selection[aria-current=true]]:bg-[color-mix(in_srgb,var(--selection-surface)_70%,transparent)]'), 'and so does the active room tab')
  assert.doesNotMatch(source, /bg-\[#F7F2E9\] border-b border-\[#E6DCD0\] grid grid-cols-3/, 'no solid band left')
})
