import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import type { ClientEvent, LaunchModes, ServerEvent } from '../src/types/bridge'
import type { TerminalRoom } from '../src/types/guild'
import { followSuccessor } from './successors'
import { findRoom, listLines, listRooms, nativeTestRoom, readNativeTestRooms, sendHandoff, writeNativeTestRooms } from './handoff'

const room = (extra: Partial<TerminalRoom> & { id: string; modelId: TerminalRoom['modelId']; roomName: string }) =>
  ({ live: true, ready: true, steerable: true, sessionId: `${extra.id}-session`, resumable: true, ...extra }) as TerminalRoom

const modes = (rooms: Record<string, boolean> = {}): LaunchModes => ({ defaults: { AGY: false, CODEX: false, CLAUDE: false }, rooms })

interface Fake { logEntries?: unknown[]; url: string; received: ClientEvent[]; emit: (event: ServerEvent) => void; setRoom: (r: TerminalRoom) => void; workspace: string; close: () => Promise<void>; onInput?: (event: Extract<ClientEvent, { type: 'INPUT' }>) => ServerEvent | undefined }

async function fakeBridge(rooms: TerminalRoom[], launch: LaunchModes, extra: Record<string, unknown> = {}): Promise<Fake> {
  const workspace = await mkdtemp(join(tmpdir(), 'komorebi-handoff-'))
  const server = new WebSocketServer({ port: 0 })
  await new Promise(resolve => server.once('listening', resolve))
  const state = new Map(rooms.map(item => [item.id, item]))
  const received: ClientEvent[] = []
  const sockets = new Set<import('ws').WebSocket>()
  const emit = (event: ServerEvent) => sockets.forEach(socket => socket.send(JSON.stringify(event)))
  const fake: Fake = {
    url: `http://localhost:${(server.address() as { port: number }).port}`, received, emit, workspace,
    setRoom: item => { state.set(item.id, item); emit({ type: 'ROOM', room: item }) },
    close: async () => { sockets.forEach(socket => socket.terminate()); await new Promise(resolve => server.close(resolve)); await rm(workspace, { recursive: true, force: true }) },
  }
  server.on('connection', socket => {
    sockets.add(socket)
    socket.send(JSON.stringify({ type: 'SNAPSHOT', rooms: [...state.values()], characters: {}, tailscaleUrl: null, archivedKeys: [], renameSupported: true, workspaceRoot: workspace, launchModesSupported: true, launchModes: launch, ...extra }))
    socket.on('message', data => {
      const event: ClientEvent = JSON.parse(data.toString())
      received.push(event)
      if (event.type === 'HANDOFF_LOG') socket.send(JSON.stringify({ type: 'HANDOFF_LOG_RESULT', requestId: event.requestId, entries: fake.logEntries ?? [] }))
      if (event.type === 'START') {
        const target = state.get(event.roomId)!
        setTimeout(() => fake.setRoom({ ...target, live: true, ready: true }), 20)
      }
      if (event.type === 'INPUT') {
        const reply = fake.onInput?.(event) ?? { type: 'ACTION_RESULT', requestId: event.requestId!, ok: true, message: 'ok' } as ServerEvent
        socket.send(JSON.stringify(reply))
      }
    })
  })
  return fake
}

const inputs = (fake: Fake) => fake.received.filter(event => event.type === 'INPUT') as Extract<ClientEvent, { type: 'INPUT' }>[]

test('rooms are found by id, session, name, or a unique part of a name', () => {
  const rooms = [room({ id: 'r1', modelId: 'AGY', roomName: 'Hitomi Native' }), room({ id: 'r2', modelId: 'CLAUDE', roomName: 'Hibiki Dev' }), room({ id: 'r3', modelId: 'CLAUDE', roomName: 'Hibiki Review' })]
  assert.equal((findRoom(rooms, 'r2') as { room: TerminalRoom }).room.id, 'r2')
  assert.equal((findRoom(rooms, 'R1-SESSION') as { room: TerminalRoom }).room.id, 'r1')
  assert.equal((findRoom(rooms, 'hibiki dev') as { room: TerminalRoom }).room.id, 'r2')
  assert.equal((findRoom(rooms, 'native') as { room: TerminalRoom }).room.id, 'r1')
  assert.match((findRoom(rooms, 'hibiki') as { error: string }).error, /多間房/)
  assert.match((findRoom(rooms, 'nope') as { error: string }).error, /找不到/)
  const lines = listLines(rooms, modes({ r1: true }), ['r1'])
  assert.match(lines[0], /AGY.*免審批.*\[native-test 1\] Hitomi Native/)
  assert.match(lines[1], /CLAUDE.*逐項審批/)
})

test('a handoff to a room that is free and runs without approval is sent with its source', async () => {
  const fake = await fakeBridge([room({ id: 'a', modelId: 'CODEX', roomName: 'Hikari' })], modes({ a: true }))
  try {
    const outcome = await sendHandoff({ url: fake.url, query: 'Hikari', text: '請 review\n第二行', from: 'Hibiki' })
    assert.equal(outcome.code, 0, outcome.lines.join('\n'))
    assert.equal(inputs(fake).length, 1)
    assert.equal(inputs(fake)[0].roomId, 'a')
    assert.equal(inputs(fake)[0].text, '[交接｜來自 Hibiki] 請 review\n第二行')
    assert.equal(fake.received.some(event => event.type === 'SET_ROOM_MODE' || event.type === 'SET_DEFAULT_MODE' || event.type === 'VIEW_ROOM'), false, 'never changes modes or claims to be viewing')
  } finally { await fake.close() }
})

test('a room that asks for approval, or already waits for one, is not sent to unless told to', async () => {
  const fake = await fakeBridge([
    room({ id: 'ask', modelId: 'CLAUDE', roomName: 'Ask room' }),
    room({ id: 'wait', modelId: 'CLAUDE', roomName: 'Waiting room', pendingApproval: {} as never }),
  ], modes({ ask: false, wait: true }))
  try {
    const asked = await sendHandoff({ url: fake.url, query: 'Ask room', text: 'hi' })
    assert.equal(asked.code, 3)
    assert.match(asked.lines[0], /^STOP：.*逐項審批.*粉盾/)
    const waiting = await sendHandoff({ url: fake.url, query: 'Waiting room', text: 'hi' })
    assert.equal(waiting.code, 3)
    assert.match(waiting.lines[0], /等待審批/)
    assert.equal(inputs(fake).length, 0)
    const forced = await sendHandoff({ url: fake.url, query: 'Ask room', text: 'hi', allowAsk: true })
    assert.equal(forced.code, 0)
    assert.equal(inputs(fake).length, 1)
  } finally { await fake.close() }
})

test('a closed room is resumed first; a working room is steered; one that cannot be steered is waited for', async () => {
  const fake = await fakeBridge([
    room({ id: 'closed', modelId: 'CLAUDE', roomName: 'Closed', live: false, ready: false }),
    room({ id: 'busy', modelId: 'CODEX', roomName: 'Busy', ready: false, steerable: true }),
    room({ id: 'stuck', modelId: 'AGY', roomName: 'Stuck', ready: false, steerable: false }),
  ], modes({ closed: true, busy: true, stuck: true }))
  try {
    const opened = await sendHandoff({ url: fake.url, query: 'Closed', text: 'one' })
    assert.equal(opened.code, 0, opened.lines.join('\n'))
    const order = fake.received.filter(event => event.type === 'START' || event.type === 'INPUT').map(event => event.type)
    assert.deepEqual(order, ['START', 'INPUT'])

    const steered = await sendHandoff({ url: fake.url, query: 'Busy', text: 'two' })
    assert.equal(steered.code, 0)
    assert.match(steered.lines.at(-1)!, /steer／排隊/)

    setTimeout(() => fake.setRoom(room({ id: 'stuck', modelId: 'AGY', roomName: 'Stuck', ready: true })), 80)
    const before = inputs(fake).length
    const waited = await sendHandoff({ url: fake.url, query: 'Stuck', text: 'three', waitSeconds: 5 })
    assert.equal(waited.code, 0, waited.lines.join('\n'))
    assert.equal(inputs(fake).length, before + 1)

    const never = await fakeBridge([room({ id: 'x', modelId: 'AGY', roomName: 'Never', ready: false, steerable: false })], modes({ x: true }))
    try {
      const timedOut = await sendHandoff({ url: never.url, query: 'Never', text: 'hi', waitSeconds: 1 })
      assert.equal(timedOut.code, 1)
      assert.equal(inputs(never).length, 0)
    } finally { await never.close() }
  } finally { await fake.close() }
})

test('native tests go only to the rooms the Founder designated, first free one first', async () => {
  const rooms = [
    room({ id: 'test', modelId: 'AGY', roomName: 'Hitomi Native' }),
    room({ id: 'spare', modelId: 'AGY', roomName: 'Hitomi Spare' }),
    room({ id: 'other', modelId: 'AGY', roomName: 'Hitomi Other' }),
    room({ id: 'codex', modelId: 'CODEX', roomName: 'Hikari' }),
  ]
  const fake = await fakeBridge(rooms, modes({ test: true, spare: true, other: true, codex: true }))
  const settle = () => new Promise(resolve => setTimeout(resolve, 30))
  try {
    const send = (query: string) => sendHandoff({ url: fake.url, query, text: 'run the UI tests', nativeTest: true })
    assert.match((await send('native-test')).lines[0], /未指定/)
    writeNativeTestRooms(fake.workspace, ['test', 'spare'])
    assert.deepEqual(readNativeTestRooms(fake.workspace), ['test', 'spare'])
    assert.match((await send('Hitomi Other')).lines[0], /不是 Founder 指定/)
    assert.match((await send('Hikari')).lines[0], /不是 Founder 指定/, 'any CLI may be designated, but this one is not')
    assert.equal(inputs(fake).length, 0)

    // "native-test" takes the first designated room that is free.
    assert.equal((await send('native-test')).code, 0)
    assert.equal(inputs(fake).at(-1)!.roomId, 'test')
    fake.setRoom({ ...rooms[0], ready: false })
    await settle()
    assert.match((await send('Hitomi Native')).lines[0], /請勿插入進行中/)
    assert.equal(inputs(fake).length, 1)
    assert.equal((await send('native-test')).code, 0)
    assert.equal(inputs(fake).at(-1)!.roomId, 'spare')

    // Every designated room in use: stop rather than interrupt a test.
    fake.setRoom({ ...rooms[1], ready: false })
    await settle()
    const none = await send('native-test')
    assert.equal(none.code, 3)
    assert.match(none.lines[0], /全部都正在使用中/)
    assert.equal(inputs(fake).length, 2)

    // A closed designated room is free (it gets resumed); other handoffs to a busy room are not limited.
    fake.setRoom({ ...rooms[0], live: false, ready: false })
    await settle()
    assert.equal((await send('native-test')).code, 0)
    assert.equal(fake.received.some(event => event.type === 'START' && event.roomId === 'test'), true)
    assert.equal((await sendHandoff({ url: fake.url, query: 'Hitomi Spare', text: 'a question' })).code, 0)
  } finally { await fake.close() }
})

test('the Founder can see, set (in order of preference) and clear the native-test rooms; a room of any CLI can be chosen', async () => {
  const fake = await fakeBridge([
    room({ id: 'one', modelId: 'AGY', roomName: 'Xcode Testing', sessionId: 'sess-one' }),
    room({ id: 'two', modelId: 'AGY', roomName: 'Xcode Testing', sessionId: 'sess-two' }),
    room({ id: 'c', modelId: 'CLAUDE', roomName: 'Hibiki' }),
  ], modes())
  try {
    assert.match((await nativeTestRoom(fake.url, 'show')).lines[0], /未指定/)
    assert.equal((await nativeTestRoom(fake.url, 'set', ['Hibiki'])).code, 0, 'a Claude room may be named too')
    assert.equal((await nativeTestRoom(fake.url, 'clear')).code, 0)
    assert.equal((await nativeTestRoom(fake.url, 'set', ['Xcode Testing'])).code, 2, 'a repeated name is ambiguous: use the session id')
    assert.equal((await nativeTestRoom(fake.url, 'set', ['sess-two', 'sess-one', 'sess-two'])).code, 0)
    assert.deepEqual(readNativeTestRooms(fake.workspace), ['sess-two', 'sess-one'])
    assert.match((await nativeTestRoom(fake.url, 'show')).lines[0], /^1\. Xcode Testing（sess-two）/)
    const listed = (await listRooms(fake.url)).lines
    assert.equal(listed.some(line => line.includes('[native-test 1]') && line.includes('sess-two')), true)
    assert.equal(listed.some(line => line.includes('[native-test 2]') && line.includes('sess-one')), true)
    await nativeTestRoom(fake.url, 'clear')
    assert.deepEqual(readNativeTestRooms(fake.workspace), [])
  } finally { await fake.close() }
})

test('problems come back as a failure the sender can report, never a hang', async () => {
  const fake = await fakeBridge([room({ id: 'a', modelId: 'CLAUDE', roomName: 'Hibiki' })], modes({ a: true }))
  try {
    assert.equal((await sendHandoff({ url: fake.url, query: 'nobody', text: 'hi' })).code, 2)
    fake.onInput = event => ({ type: 'ACTION_RESULT', requestId: event.requestId!, ok: false, message: 'CLI 未就緒。' })
    const refused = await sendHandoff({ url: fake.url, query: 'Hibiki', text: 'hi' })
    assert.equal(refused.code, 1)
    assert.match(refused.lines.join('\n'), /CLI 未就緒/)
    assert.match(refused.lines.join('\n'), /未送達：訊息冇入對方房/, 'the failure now also says plainly that nothing arrived')
  } finally { await fake.close() }
  const gone = await sendHandoff({ url: 'http://localhost:9', query: 'x', text: 'hi' })
  assert.equal(gone.code, 1)
})

test('reading a room shows its latest messages, what it waits for and, if asked, the end of its screen, without sending anything', async () => {
  const { readLines, readRoom } = await import('./handoff')
  const logs = Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, timestamp: `10:0${index}`, sender: index % 2 ? 'user' : 'agent', text: `訊息 ${index}` })) as TerminalRoom['logs']
  const target = room({ id: 'codex-r5', modelId: 'CODEX', roomName: 'R5', logs, screen: 'Working…\n\n› Ask Codex\n  GPT-6.1 · ~/proj',
    pendingQuestion: { id: 'q', questions: [{ title: '揀一個', options: ['A', 'B'] }] } })
  const lines = readLines(target, { messages: 3 })
  assert.match(lines[0], /^光 · R5 · 閒 · Session codex-r5-session$/)
  assert.ok(lines.includes('等待回答：揀一個（A / B）'))
  assert.deepEqual(lines.filter(line => line.startsWith('[')), ['[10:07 輸入] 訊息 7', '[10:08 光] 訊息 8', '[10:09 輸入] 訊息 9'])
  assert.ok(!lines.some(line => line.includes('終端尾部')), 'the screen only when asked')
  assert.ok(readLines(target, { messages: 1, screen: true }).includes('› Ask Codex'))
  const long = readLines(room({ id: 'a', modelId: 'CLAUDE', roomName: 'x', logs: [{ id: 'l', timestamp: '1', sender: 'agent', text: 'z'.repeat(5000) }] as TerminalRoom['logs'] }), { chars: 300 })
  assert.match(long.at(-1)!, /…（已截斷，全文 5000 字）$/)
  assert.ok(long.at(-1)!.length < 400)
  // Through the Bridge: found by name, and unknown rooms are reported; the bridge receives no message.
  const bridge = await fakeBridge([target], modes())
  try {
    const found = await readRoom(bridge.url, 'R5', { messages: 2 })
    assert.equal(found.code, 0)
    assert.ok(found.lines.some(line => line.includes('訊息 9')))
    assert.equal((await readRoom(bridge.url, '冇呢間')).code, 2)
    assert.equal(bridge.received.some(event => event.type === 'INPUT'), false)
  } finally { await bridge.close() }
})

const lead = (id: string, name: string) => room({ id, modelId: 'CODEX', roomName: name })
const team = (leadRoomId: string | undefined, ...ids: string[]) => ({ id: 'g1', name: '群組', createdAt: '', members: ids.map(roomId => ({ modelId: 'CODEX' as const, roomId })), ...(leadRoomId ? { orchestratorRoomId: leadRoomId } : {}) })

test('@orchestrator reaches the sender\'s group\'s current lead, and a room that was taken over is replaced by its successor', async () => {
  const worker = room({ id: 'w', modelId: 'CLAUDE', roomName: 'Worker' })
  const oldLead = lead('old', 'R5 統籌'), newLead = lead('new', 'R5 統籌')
  const fake = await fakeBridge([worker, oldLead, newLead], modes({ w: true, old: true, new: true }), { groups: [team('new', 'w', 'new')], successors: { 'old-session': 'new-session' } })
  try {
    const viaAlias = await sendHandoff({ url: fake.url, query: '@orchestrator', text: '回報', from: 'Worker' })
    assert.equal(viaAlias.code, 0, viaAlias.lines.join(' '))
    assert.deepEqual(inputs(fake).map(event => event.roomId), ['new'])
    assert.match(viaAlias.lines.join(' '), /R5 統籌/)
    // The old room's session id is still what an old message points at: it goes to the room that took over.
    const viaOld = await sendHandoff({ url: fake.url, query: 'old-session', text: '舊路徑', from: 'Worker' })
    assert.equal(viaOld.code, 0, viaOld.lines.join(' '))
    assert.deepEqual(inputs(fake).map(event => event.roomId), ['new', 'new'])
    assert.match(viaOld.lines[0], /已由「R5 統籌」接手/)
    // Without --from there is no group to look in, and the lead itself has nobody to report to.
    assert.match((await sendHandoff({ url: fake.url, query: '@orchestrator', text: 'x' })).lines.join(' '), /--from/)
    assert.match((await sendHandoff({ url: fake.url, query: '@orchestrator', text: 'x', from: 'new' })).lines.join(' '), /你自己就係現任總指揮 ♛/)
  } finally { await fake.close() }
  const none = await fakeBridge([worker, newLead], modes({ w: true, new: true }), { groups: [team(undefined, 'w', 'new')] })
  try { assert.match((await sendHandoff({ url: none.url, query: '@orchestrator', text: 'x', from: 'Worker' })).lines.join(' '), /未有現任總指揮 ♛/) } finally { await none.close() }
})

test('a message that does not arrive says so, and points at the current lead of the room\'s group', async () => {
  const worker = room({ id: 'w', modelId: 'CLAUDE', roomName: 'Worker' })
  const stale = room({ id: 'stale', modelId: 'CODEX', roomName: '舊統籌', live: false, ready: false })
  const current = lead('cur', '新統籌')
  const fake = await fakeBridge([worker, stale, current], modes({ w: true, stale: true, cur: true }), { groups: [team('cur', 'w', 'stale', 'cur')] })
  fake.onInput = event => ({ type: 'ACTION_RESULT', requestId: event.requestId!, ok: false, message: 'CLI 未就緒' }) as ServerEvent
  try {
    const failed = await sendHandoff({ url: fake.url, query: 'stale-session', text: '回報', from: 'Worker', waitSeconds: 2 })
    assert.equal(failed.code, 1)
    const text = failed.lines.join('\n')
    assert.match(text, /未送達：訊息冇入對方房/)
    assert.match(text, /現任總指揮 ♛ 係「新統籌」/)
    assert.match(text, /send @orchestrator --from Worker/)
  } finally { await fake.close() }
})

test('followSuccessor stops at a loop or after a few steps', () => {
  assert.deepEqual(followSuccessor({ a: 'b', b: 'c' }, 'a'), { key: 'c', via: ['b', 'c'] })
  assert.deepEqual(followSuccessor({ a: 'b', b: 'a' }, 'a'), { key: 'b', via: ['b'] })
  assert.deepEqual(followSuccessor({}, 'a'), { key: 'a', via: [] })
})

test('every send tells the Bridge how it ended, and `log` reads that back', async () => {
  const { handoffLog } = await import('./handoff')
  const target = room({ id: 'a', modelId: 'CODEX', roomName: 'Hikari' })
  const fake = await fakeBridge([target], modes({ a: true }))
  const reports: Extract<ClientEvent, { type: 'HANDOFF_REPORT' }>[] = []
  try {
    const sent = await sendHandoff({ url: fake.url, query: 'Hikari', text: '請 review', from: 'Hibiki' })
    assert.equal(sent.code, 0)
    const missing = await sendHandoff({ url: fake.url, query: 'nobody', text: 'x', from: 'Hibiki' })
    assert.equal(missing.code, 2)
    // The report is sent as the command ends, so give the fake Bridge a moment to take in the second one.
    for (let wait = 0; wait < 50 && fake.received.filter(event => event.type === 'HANDOFF_REPORT').length < 2; wait++) await new Promise(resolve => setTimeout(resolve, 20))
    reports.push(...(fake.received.filter(event => event.type === 'HANDOFF_REPORT') as typeof reports))
    assert.deepEqual(reports.map(report => [report.code, report.from]), [[0, 'Hibiki'], [2, 'Hibiki']])
    assert.match(reports[0].to!, /Hikari/)
    assert.ok(!JSON.stringify(reports).includes('請 review'), 'the message itself is not reported')
    // The reading side prints each entry on a line, newest last.
    fake.logEntries = [{ at: '2026-11-14T12:00:00.000Z', from: 'Hibiki', to: 'CODEX · R5', code: 1, ms: 2500, note: '未送達：訊息冇入對方房' }]
    const shown = await handoffLog(fake.url, { failedOnly: true })
    assert.equal(shown.code, 0)
    assert.match(shown.lines[0], /2026-11-14 12:00:00 失敗 Hibiki → CODEX · R5（2\.5s）：未送達/)
  } finally { await fake.close() }
})

test('list ends with the allowance each character has left, and `quota` shows it alone; 響 and 瞳 get a warning below the dispatch floor', async () => {
  const { quotaLines, quotaStatus, dispatchFloor } = await import('./handoff')
  const character = (hp: number | null, mp: number | null) => ({ mpWeekly: { current: hp }, hp5h: { current: mp } }) as never
  const characters = { AGY: character(89.6, 70.02), CODEX: character(2, 100), CLAUDE: character(60, 9.4) }
  const lines = quotaLines(characters)
  assert.deepEqual(dispatchFloor, { mp: 10, hp: 5 })
  assert.match(lines[0], /HP＝週，MP＝5 小時/)
  assert.match(lines.find(line => line.includes('瞳'))!, /HP 90%  MP 70%$/, 'enough left: no warning')
  assert.doesNotMatch(lines.find(line => line.includes('光'))!, /⚠/, '光 is not under the rule, whatever it has left')
  assert.match(lines.find(line => line.includes('響'))!, /HP 60%  MP 9%  ⚠ 唔派工/, 'MP under 10%')
  assert.match(quotaLines({ AGY: character(4.4, 100) }).join('\n'), /HP 4%  MP 100%  ⚠ 唔派工/, 'HP under 5%')
  assert.doesNotMatch(quotaLines({ AGY: character(4.9, 100) }).join('\n'), /⚠/, 'the line is judged on the whole percent the card shows (4.9 reads as 5)')
  assert.doesNotMatch(quotaLines({ AGY: character(5, 10) }).join('\n'), /⚠/, 'exactly at the line is fine')
  assert.match(quotaLines({ CLAUDE: character(null, 50) }).join('\n'), /額度未知/)
  assert.deepEqual(quotaLines({}), [])
  const fake = await fakeBridge([room({ id: 'a', modelId: 'CODEX', roomName: 'Hikari' })], modes(), { characters })
  try {
    const listed = await listRooms(fake.url)
    assert.equal(listed.lines.at(-5), '', 'a blank line, then the allowance')
    assert.match(listed.lines.slice(-4).join('\n'), /瞳  HP 90%[\s\S]*響  HP 60%  MP 9%  ⚠/)
    const alone = await quotaStatus(fake.url)
    assert.equal(alone.code, 0)
    assert.equal(alone.lines.length, 4)
  } finally { await fake.close() }
})

test('a group\'s own native-test rooms are the members holding that role, whatever their CLI, found from a sender inside the group only', async () => {
  const { groupNativeTestRooms } = await import('./handoff')
  const mk = (id: string, modelId: string, roomName: string) => ({ id, modelId, roomName, sessionId: `${id}-s` }) as any
  const rooms = new Map([['l', mk('l', 'CLAUDE', 'Lead')], ['t', mk('t', 'AGY', 'Tester')], ['x', mk('x', 'AGY', 'Other')], ['c', mk('c', 'CODEX', 'Coder')]])
  const groups = [
    { id: 'g', name: 'G', createdAt: '', members: [{ modelId: 'CLAUDE', roomId: 'l' }, { modelId: 'AGY', roomId: 't', role: { key: 'native-test' } }, { modelId: 'CODEX', roomId: 'c', role: { key: 'native-test' } }] },
    { id: 'h', name: 'H', createdAt: '', members: [{ modelId: 'AGY', roomId: 'x', role: { key: 'native-test' } }] },
  ] as any
  assert.deepEqual(groupNativeTestRooms(rooms, groups, 'Lead').map(room => room.id), ['t', 'c'], 'any CLI, only this group')
  assert.deepEqual(groupNativeTestRooms(rooms, groups, undefined), [], 'no sender, no group')
})
