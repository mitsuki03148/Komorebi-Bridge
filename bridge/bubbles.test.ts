import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DaySeparator, MessageBubble } from '../src/components/MessageBubble'
import { GroupChatView } from '../src/components/GroupChat'
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace'
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData'
import type { TerminalLogEntry, TerminalRoom } from '../src/types/guild'
import { benchWakeAsLine, bubbleRuns, dayLabel, isBenchDelivery, isBenchWakeNotice } from '../src/utils/bubbleRuns'
import { roleAccent } from '../src/utils/roleAccent'
import { zh } from '../src/i18n/zh'

const at = (h: number, m: number, s = 0, day = 12) => new Date(2026, 10, day, h, m, s).toISOString()
const entry = (id: string, sender: TerminalLogEntry['sender'], time: string, text = id): TerminalLogEntry => ({ id, sender, text, timestamp: time, createdAt: time })

test('a bubble is the same everywhere: agent left at 88% with a role-coloured edge and name, user right at 85%, 14px text, 11px label', () => {
  const agent = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('a', 'agent', at(10, 0), '你好'), modelId: 'CODEX', name: '光', header: true }))
  assert.match(agent, /<article[^>]*data-sender="agent"/)
  assert.match(agent, /mr-auto max-w-\[88%\]/)
  assert.match(agent, /border-l-\[3px\]/)
  assert.ok(agent.includes(`border-left-color:${roleAccent.CODEX.stripe}`))
  assert.ok(agent.includes(`color:${roleAccent.CODEX.name}`), 'the name is in the role colour')
  assert.match(agent, /rounded-2xl border p-3 text-sm /)
  assert.match(agent, /text-\[11px\]/)
  assert.match(agent, /shadow-\[0_1px_2px/, 'a soft shadow lifts it off the page')
  const user = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('u', 'user', at(10, 1), '問'), modelId: 'CODEX', name: '光', header: true }))
  assert.match(user, /ml-auto max-w-\[85%\]/)
  assert.match(user, />Me</)
  const toRoom = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('u', 'user', at(10, 1), '問'), modelId: 'CODEX', name: '光', addressee: '光 · R5', header: true }))
  assert.match(toRoom, /Me → 光 · R5/)
})

test('the three roles keep their own colour, each with a little rose in it', () => {
  const hex = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  assert.equal(new Set(Object.values(roleAccent).map(item => item.name)).size, 3)
  for (const item of Object.values(roleAccent)) {
    const [r, , b] = hex(item.name)
    assert.ok(r >= 0x6a || b >= 0x6a, 'never a harsh dark colour')
  }
  // 瞳 is the pinkest, 光 and 響 only lean towards it: red stays above green for 瞳 and the wash is warm for all.
  const [r, g] = hex(roleAccent.AGY.name)
  assert.ok(r > g + 0x30)
})

test('a message that continues a run shows no name or time, and a system message is a small centred pill', () => {
  const plain = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('a2', 'agent', at(10, 0, 30), '續'), modelId: 'CLAUDE', name: '響', header: false }))
  assert.doesNotMatch(plain, /響</)
  assert.doesNotMatch(plain, /tabular-nums/)
  assert.match(plain, /aria-label="複製這段對話"/, 'it can still be copied')
  const system = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('s', 'system', at(10, 5), '已離開房間 · CLI 已結束'), modelId: 'AGY', name: '瞳 · Xcode Testing 1' }))
  assert.match(system, /mx-auto/)
  assert.match(system, /rounded-full/)
  assert.doesNotMatch(system, /<article/)
  assert.match(renderToStaticMarkup(createElement(DaySeparator, { label: '今日' })), /role="separator"[^>]*aria-label="今日"/)
})

test('headers show once per run: same speaker within five minutes continues, a new speaker, a long gap, a system line or another room starts a new one', () => {
  const key = 'r1'
  const runs = bubbleRuns([
    { entry: entry('1', 'agent', at(10, 0)), key }, { entry: entry('2', 'agent', at(10, 1)), key }, { entry: entry('3', 'agent', at(10, 2)), key },
    { entry: entry('4', 'user', at(10, 3)), key }, { entry: entry('5', 'agent', at(10, 4)), key },
    { entry: entry('6', 'agent', at(10, 20)), key },
    { entry: entry('7', 'system', at(10, 21)), key }, { entry: entry('8', 'agent', at(10, 22)), key },
    { entry: entry('9', 'agent', at(10, 23)), key: 'r2' },
    { entry: { id: '10', sender: 'agent', text: 'x', timestamp: '—' }, key: 'r2' },
  ], new Date(2026, 10, 12, 12).getTime())
  assert.deepEqual(runs.map(item => item.header), [true, false, false, true, true, true, true, true, true, true])
})

test('a new day gets a date line, and the first message only if it is not from today', () => {
  const now = new Date(2026, 10, 12, 12).getTime()
  const key = 'r'
  const runs = bubbleRuns([
    { entry: entry('a', 'agent', at(23, 58, 0, 11)), key }, { entry: entry('b', 'agent', at(0, 2, 0, 12)), key }, { entry: entry('c', 'agent', at(9, 0, 0, 12)), key },
  ], now)
  assert.deepEqual(runs.map(item => item.day), ['昨日', '今日', undefined])
  assert.equal(bubbleRuns([{ entry: entry('t', 'agent', at(9, 0)), key }], now)[0].day, undefined)
  assert.equal(dayLabel(new Date(2026, 10, 1).getTime(), now), '11月1日')
  assert.equal(runs[1].header, true, 'a message after midnight starts a new run')
})

test('single rooms on phone and Mac and the group room all draw messages with the one shared bubble', async () => {
  const room = (extra = {}) => ({ id: 'a', modelId: 'CODEX', roomName: 'R5', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', repoPath: '/tmp', gitBranch: 'main', progressPercent: null, contextUsagePct: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [
    entry('1', 'user', at(10, 0), '問'), entry('2', 'agent', at(10, 1), '答一'), entry('3', 'agent', at(10, 2), '答二'), entry('4', 'system', at(10, 3), '已離開房間'),
  ], ...extra }) as unknown as TerminalRoom
  const group = renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [{ roomId: 'a', modelId: 'CODEX', room: room() }], characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onDecision() {}, onMenu() {} }))
  const mac = renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room: room(), character: INITIAL_CHARACTERS.CODEX, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {}, onSendPrompt() {}, onSubmitDraft() {},
    promptInput: '', setPromptInput() {}, sending: false, approving: false, onRunCompact() {}, onRedeemResetVoucher() {}, onToggleTerminal() {}, onShowTerminal() {}, terminalOpen: false, hasAttachment: false,
  } as never))
  for (const [name, html] of [['group', group], ['mac', mac]] as const) {
    assert.equal((html.match(/<article/g) ?? []).length, 3, `${name}: user and the two agent messages are bubbles`)
    assert.equal((html.match(/data-sender="agent"/g) ?? []).length, 2)
    assert.equal((html.match(/font-semibold" style="color:#7A9580"/g) ?? []).length, 1, `${name}: the second agent message continues the run, so the name shows once`)
    assert.match(html, /mx-auto flex w-fit/, `${name}: the system line is a pill`)
  }
  assert.match(group, /Me → 光/)
  assert.doesNotMatch(group, /Me → 光 · R5/, 'a character with one room in the group is not followed by the room name')
  const phone = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.ok(phone.includes('<MessageBubble entry={item.entry} modelId={selectedRoom.modelId}'), 'phone single room')
})

test('a group hides the workbench wake line and ticket deliveries, but not a real handoff from an agent', () => {
  const user = (text: string) => ({ sender: 'user', text } as TerminalLogEntry)
  // Spec change: the short wake line is the small sign that a room was handed work, so it is shown again (the Founder asked for it back).
  assert.equal(isBenchDelivery(user('[交接｜來自 工作台] 你的工作台有 1 張新工單：#699 #697 已完成：T6。內容會自動附上')), false, 'the short wake line is shown')
  assert.equal(isBenchDelivery(user('[交接｜來自 光] [工作台 #698] T6 Answer T7')), true)
  assert.equal(isBenchDelivery(user('[交接｜來自 工作台] 工單提示：#712「T7」仍未完成。請繼續做')), true, 'the stall reminder is between agents')
  assert.equal(isBenchDelivery(user('[交接｜來自 光] 請看一下 R5 結果')), false)
  assert.equal(isBenchWakeNotice(user('[交接｜來自 工作台] 工單提示：#712「T7」仍未完成。請繼續做')), true)
  assert.equal(isBenchWakeNotice(user('[交接｜來自 工作台] 你的工作台有 1 張新工單：#699')), false)
  assert.equal(isBenchDelivery(user('[工作台 #698] T6 Answer T7（內容較長，會自動附上）')), true, 'the bare ticket line is hidden too')
  assert.equal(isBenchDelivery(user('我想問 [工作台 #698] 係咩')), false)
  assert.equal(isBenchDelivery({ sender: 'agent', text: '你的工作台有 1 張新工單' } as TerminalLogEntry), false)
})

test('a message another agent handed over reads as that agent speaking, not as the user, and long ones are folded', () => {
  const short = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('h1', 'user', at(10, 0), '[交接｜來自 響 · CLI app] 請看一下 R5 的結果。'), modelId: 'CODEX', name: '光' }))
  assert.match(short, /data-sender="handoff"/)
  assert.match(short, /響 · CLI app → 光/)
  assert.match(short, /交接/)
  assert.match(short, /請看一下 R5 的結果。/)
  assert.doesNotMatch(short, /\[交接｜來自|Me/)
  assert.doesNotMatch(short, /<details/)
  const long = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('h2', 'user', at(10, 1), `[交接｜來自 瞳] ${'很長的內容。'.repeat(80)}`), modelId: 'CODEX', name: '光' }))
  assert.match(long, /<details/)
  assert.match(long, />展開</)
  // The user's own words, even ones that mention a handoff, stay the user's.
  const own = renderToStaticMarkup(createElement(MessageBubble, { entry: entry('u', 'user', at(10, 2), '請問 [交接｜來自 響] 是什麼'), modelId: 'CODEX', name: '光' }))
  assert.match(own, /data-sender="user"/)
})

test('a handoff is its own speaker, so the user\'s next message still shows its name', () => {
  const items = bubbleRuns([
    { entry: entry('u1', 'user', at(10, 0), '請光看一下'), key: 'r' },
    { entry: entry('h', 'user', at(10, 1), '[交接｜來自 響] 看一下'), key: 'r' },
    { entry: entry('h2', 'user', at(10, 1, 30), '[交接｜來自 瞳] 也看一下'), key: 'r' },
    { entry: entry('u2', 'user', at(10, 2), '謝謝'), key: 'r' },
  ], new Date(2026, 10, 12, 12).getTime())
  assert.deepEqual(items.map(item => item.header), [true, true, true, true])
})

test('each member of a group in the side list is marked with its room id, so a right click or long press can open that room\'s menu (rename)', async () => {
  const { GroupRoomSidebar } = await import('../src/components/GroupRoomSidebar')
  const { readFile } = await import('node:fs/promises')
  const rooms = ['a', 'b'].map(id => ({ id, roomName: `房 ${id}`, modelId: 'CODEX', live: true, ready: true, logs: [] })) as unknown as TerminalRoom[]
  const group = { id: 'g', name: '群', members: rooms.map(item => ({ modelId: item.modelId, roomId: item.id })) } as never
  const html = renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [group], rooms, characters: INITIAL_CHARACTERS, selectedGroupId: 'g', onSelectGroup() {}, onSelectRoom() {} }))
  assert.equal(html.match(/data-room-id="[ab]"/g)?.length, 2)
  // The app routes that gesture, on the group list, to the same room menu the room list uses.
  const app = await readFile('src/App.tsx', 'utf8')
  assert.match(app, /\{\.\.\.groupActions\} className="contents [^"]*\[&_aside\]:bg-white\/35[^"]*" style=\{\{[^}]*\}\}><div \{\.\.\.roomActions\} className="contents"><GroupRoomSidebar/)
})

test('a member of a group that is working shows the same twinkle as elsewhere, amber when it may be stuck', async () => {
  const { GroupRoomSidebar } = await import('../src/components/GroupRoomSidebar')
  const rooms = ['a', 'b', 'c'].map(id => ({ id, roomName: `房 ${id}`, modelId: 'CODEX', live: true, ready: true, logs: [] })) as unknown as TerminalRoom[]
  const group = { id: 'g', name: '群', members: rooms.map(item => ({ modelId: item.modelId, roomId: item.id })) } as never
  const html = renderToStaticMarkup(createElement(GroupRoomSidebar, { groups: [group], rooms, characters: INITIAL_CHARACTERS, selectedGroupId: 'g', onSelectGroup() {}, onSelectRoom() {}, working: { a: 'working', b: 'stalled' } }))
  assert.equal(html.match(/data-working-spark="working"/g)?.length, 1)
  assert.equal(html.match(/data-working-spark="stalled"/g)?.length, 1)
  assert.equal(html.match(/guild-spark--stalled/g)?.length, 1)
  assert.equal(html.match(/data-working-spark/g)?.length, 2, 'the idle member has none')
})

test('the working twinkle on a group member has no box behind it', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile('src/components/GroupRoomSidebar.tsx', 'utf8')
  const twinkle = source.split('\n').find(line => line.includes('data-working-spark'))!
  assert.doesNotMatch(twinkle, /\bbg-|rounded|ring|shadow-\[0_0_0_1px|border|\bp-0\.5\b/)
})

test('the group header is one line: a single ⋯ menu holds add member and details, and the side list titles are larger and bold', async () => {
  const { readFile } = await import('node:fs/promises')
  const chat = await readFile('src/components/GroupChat.tsx', 'utf8')
  const header = chat.slice(chat.indexOf('<header className="relative z-30'), chat.indexOf('</header>'))
  assert.equal(zh['group.options'], '群組選項')
  assert.equal(zh['group.invite.title'], '加入成員')
  assert.equal(zh['group.details'], '房間詳情')
  const start = header.indexOf("aria-label={t('group.options')}")
  assert.ok(start >= 0)
  const options = header.slice(start, header.indexOf('</summary>', start))
  assert.match(options, /<MoreHorizontal /)
  assert.doesNotMatch(options, />[^<]*(?:加成員|詳情)[^<]*</, 'no words on the button')
  assert.equal((header.match(/data-group-popover(?!\s+data-waiting-list)/g) ?? []).length, 1, 'add member and details share one menu (the small "waiting for you" entry is a separate, temporary one)')
  assert.doesNotMatch(header, /協作群組 · /, 'no subtitle under the name')
  assert.match(header, /aria-label=\{t\('group\.invite\.title'\)\}/)
  assert.match(header, /aria-label=\{t\('group\.details'\)\}/)
  assert.match(header, /px-3 py-1\.5/)
  assert.match(header, /className="flex h-9 w-9 shrink-0/, 'a shorter back button')
  const side = await readFile('src/components/GroupRoomSidebar.tsx', 'utf8')
  assert.equal(side.match(/text-\[13px\] font-extrabold/g)?.length, 2, '群組 and 房間 titles')
})

test('the three-flower icon stays a small flat icon in the characters\' colours, and the top rail no longer uses it', async () => {
  const { readFile } = await import('node:fs/promises')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { PetalMenuIcon } = await import('../src/components/PetalMenuIcon')
  const icon = renderToStaticMarkup(createElement(PetalMenuIcon))
  // Three flowers (five petals and a centre each), one in each character's colour.
  assert.equal(icon.match(/data-flower=/g)?.length, 3)
  assert.equal(icon.match(/<ellipse /g)?.length, 15)
  assert.equal(icon.match(/<circle /g)?.length, 3)
  for (const role of ['AGY', 'CODEX', 'CLAUDE'] as const) assert.ok(icon.includes(`data-flower="${roleAccent[role].name}"`), role)
  assert.match(icon, /data-icon="flowers"/)
  // The top rail no longer carries the flowers button: new rooms open from a character card instead.
  const app = await readFile('src/App.tsx', 'utf8')
  assert.doesNotMatch(app, /PetalMenuIcon|開啟房間選單/)
  assert.match(app, /<header className="relative z-40 [^"]*\bpy-1\b/, 'the top bar sits closer to the top')
  assert.match(renderToStaticMarkup(createElement(PetalMenuIcon)), /viewBox="0 5 24 14"/, 'a small, flat icon')
})

test('each CLI\'s bubble wash is visibly tinted in its own colour: 光 green, 響 blue-violet, 瞳 rose (not a near-neutral grey)', async () => {
  const { roleAccent } = await import('../src/utils/roleAccent')
  const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  const dominant = (hex: string) => { const [r, g, b] = channels(hex); return { r, g, b } }
  const codex = dominant(roleAccent.CODEX.wash), claude = dominant(roleAccent.CLAUDE.wash), agy = dominant(roleAccent.AGY.wash)
  assert.ok(codex.g > codex.r && codex.g > codex.b, '光: green is the strongest channel')
  assert.ok(codex.g - Math.min(codex.r, codex.b) >= 6, '光: tinted as much as the others, not near-neutral')
  assert.ok(claude.b > claude.r && claude.b > claude.g, '響: blue strongest')
  assert.ok(agy.r > agy.g && agy.r > agy.b, '瞳: red strongest')
})

test('the workbench wake message is shown as one small line without the command inside it', () => {
  const wake = { id: 'w1', sender: 'user', text: '[交接｜來自 工作台] 你的工作台有 1 張新工單：#101 Demo iPhone: apply independent #100 harness diagnosis and retest two REDs。內容會自動附上；如未見到：/Users/x/scripts/komorebi-room bench mine --from 12345678' } as TerminalLogEntry
  const line = benchWakeAsLine(wake)
  assert.equal(line.sender, 'system')
  assert.equal(line.id, 'w1', 'the same entry, so it keeps its place')
  assert.equal(line.text, '工作台：新工單 #101 Demo iPhone: apply independent #100 harness diagnosis and retest two REDs')
  assert.doesNotMatch(line.text, /komorebi-room|bench mine/)
  const long = benchWakeAsLine({ ...wake, text: `[交接｜來自 工作台] 你的工作台有 3 張新工單：${'#1 很長的標題；'.repeat(30)}。內容會自動附上` } as TerminalLogEntry)
  assert.ok(long.text.length < 110 && long.text.endsWith('…'))
  const real = { id: 'r1', sender: 'user', text: '[交接｜來自 光] 請看一下 R5 結果' } as TerminalLogEntry
  assert.equal(benchWakeAsLine(real), real, 'a real handoff is left alone')
  assert.equal(benchWakeAsLine({ id: 'a1', sender: 'agent', text: '你的工作台有 1 張新工單：#1' } as TerminalLogEntry).sender, 'agent')
})

test('AGY system echo under an answer is hidden, and an answer that was only an echo disappears', async () => {
  const { transcriptText, isConversationEntry } = await import('../src/utils/transcriptText')
  const echo = 'user\nThe following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n<SYSTEM_MESSAGE>\n[Message] sender=x/task-2686 content=Task id "x" finished with result:\nCommand exited with code 0.\n</SYSTEM_MESSAGE>'
  assert.equal(transcriptText('AGY', 'agent', `已核實。\n${echo}`), '已核實。')
  assert.equal(isConversationEntry('AGY', 'agent', transcriptText('AGY', 'agent', echo)), false)
  assert.equal(transcriptText('CLAUDE', 'agent', `已核實。\n${echo}`), `已核實。\n${echo}`)
})

test('the file-trigger notice is shown as a quest card in every language, and an ordinary message is not', async () => {
  const { parseFileQuest } = await import('../src/utils/questNotice')
  const { fileNoticeText } = await import('./file-trigger-delivery')
  const { setLang } = await import('../src/i18n')
  const text = fileNoticeText({ events: [{ path: '/Volumes/Komorebi/Prompt/ExampleApp.md', kind: 'change', observedAt: '2026-11-19T06:13:20.216Z' }, { path: '/a/b.md', kind: 'add', observedAt: '2026-11-19T06:14:00Z' }], confirmationHint: '先看 Board' } as never)
  const quest = parseFileQuest(text)!
  assert.equal(quest.events.length, 2)
  assert.deepEqual(quest.events.map(event => event.kind), ['change', 'add'])
  assert.equal(quest.events[0].path, '/Volumes/Komorebi/Prompt/ExampleApp.md')
  assert.equal(quest.hint, '先看 Board')
  assert.equal(parseFileQuest('你好，請看一下檔案'), undefined)
  const entry = { id: 'q', sender: 'user', text, timestamp: '6:13:25 AM' } as TerminalLogEntry
  const words = { zh: ['新任務', '檔案觸發', '修改'], en: ['New Quest', 'File Trigger', 'Modified'], ja: ['新規クエスト', 'ファイル検知', '更新'] } as const
  try {
    for (const lang of ['zh', 'en', 'ja'] as const) {
      setLang(lang)
      const html = renderToStaticMarkup(createElement(MessageBubble, { entry, modelId: 'CODEX', name: '光' }))
      assert.match(html, /data-sender="quest"/)
      for (const word of words[lang]) assert.ok(html.includes(word), `${lang}: ${word}`)
      assert.ok(html.includes('ExampleApp.md'))
      assert.equal(html.includes('Bridge 系統通知'), false, 'the agent-facing text is not shown')
    }
  } finally { setLang('zh') }
  assert.doesNotMatch(renderToStaticMarkup(createElement(MessageBubble, { entry: { ...entry, text: '你好' }, modelId: 'CODEX', name: '光' })), /data-sender="quest"/)
})

test('a notice Claude Code wrapped in pasted_content (the closing tag carries the id too) is unwrapped, so the workbench line hides it', async () => {
  const { transcriptText } = await import('../src/utils/transcriptText')
  const inner = '[交接｜來自 R5 Orchestrator] [工作台 #1025｜光 · R5 Orchestrator → 你｜通知]\n標題：換房後請讀原單\n（只係通知：唔使回覆，唔使 bench done，讀過就自動結案。）'
  const wrapped = `<pasted_content id="fc27">\n${inner}\n</pasted_content id="fc27">`
  const shown = transcriptText('CLAUDE', 'user', wrapped)
  assert.equal(shown, inner)
  assert.equal(isBenchDelivery({ sender: 'user', text: shown } as TerminalLogEntry), true, 'it is then the same as any workbench ticket and is hidden')
  assert.equal(transcriptText('CLAUDE', 'user', `<pasted_content id="a">\nplain\n</pasted_content>`), 'plain', 'the plain closing tag still works')
})

test('an AGY update_steps entry renders as an inline girly floral checklist card in every language', async () => {
  const { setLang } = await import('../src/i18n')
  const entry = {
    id: 'sess-s1',
    sender: 'agent',
    text: '進度 1/3',
    timestamp: '07:45',
    steps: [
      { title: 'Read transcript', status: 'done' },
      { title: 'Draw checklist card', status: 'in_progress' },
      { title: 'Run tests', status: 'pending' },
    ],
  } as TerminalLogEntry
  const words = {
    zh: ['小手帳進度', '進行中'],
    en: ['Checklist', 'In progress'],
    ja: ['チェックリスト', '進行中'],
  } as const
  try {
    for (const lang of ['zh', 'en', 'ja'] as const) {
      setLang(lang)
      const html = renderToStaticMarkup(createElement(MessageBubble, { entry, modelId: 'AGY', name: '瞳' }))
      assert.match(html, /data-sender="steps"/)
      assert.match(html, /data-steps-card="active"/)
      assert.match(html, /data-steps-progress="1\/3"/)
      assert.match(html, /data-steps-bar="33"/)
      assert.match(html, /data-floral-sprig="AGY"/)
      assert.match(html, /data-ribbon-bloom="hp-open"/)
      assert.match(html, /data-step-status="done"/)
      assert.match(html, /data-step-status="in_progress"/)
      assert.match(html, /data-step-status="pending"/)
      for (const word of words[lang]) assert.ok(html.includes(word), `${lang}: ${word}`)
      assert.ok(html.includes('Draw checklist card'))
    }
    setLang('zh')
    const allDoneHtml = renderToStaticMarkup(createElement(MessageBubble, {
      entry: { ...entry, steps: [{ title: 'A', status: 'done' }, { title: 'B', status: 'skipped' }] },
      modelId: 'AGY',
      name: '瞳',
    }))
    assert.match(allDoneHtml, /data-steps-card="done"/)
    assert.ok(allDoneHtml.includes('全部完成'))
  } finally { setLang('zh') }
  assert.doesNotMatch(renderToStaticMarkup(createElement(MessageBubble, { entry: { ...entry, steps: undefined }, modelId: 'AGY', name: '瞳' })), /data-sender="steps"/)
})
