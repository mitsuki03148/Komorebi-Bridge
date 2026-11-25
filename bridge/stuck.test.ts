import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TerminalRoom } from '../src/types/guild'
import { PushNotifier, PushStore, pushPayload, type PushSubscription } from './push'
import { maxLogBytes, noteStuckScreen, tailLines } from './stuck-log'

const phone: PushSubscription = { endpoint: 'https://web.push.apple.com/phone', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }
const room = (extra: Partial<TerminalRoom> = {}) => ({ id: 'r1', modelId: 'AGY', roomName: 'Xcode Testing 1', sessionId: 's1', live: true, ready: false, status: 'running', screen: 'Run xcodebuild?\n  Allow once\n  Deny', screenId: 'a', logs: [], ...extra }) as TerminalRoom

async function fixture(options: { foreground?: boolean; stillMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-stuck-'))
  const store = new PushStore(join(dir, 'push.json'))
  store.add(phone)
  let clock = 1_000_000
  const sent: { payload: Record<string, string>; options: Record<string, unknown> }[] = []
  const stuck: string[] = []
  const notifier = new PushNotifier(store, {
    subject: () => 'https://mac.example.ts.net', foreground: () => Boolean(options.foreground), characterName: () => '瞳', now: () => clock, stillMs: options.stillMs ?? 60_000,
    sender: async (_subscription, payload, sendOptions) => { sent.push({ payload: JSON.parse(payload), options: sendOptions }) },
    onStuck: item => { stuck.push(item.id) },
  })
  return { notifier, sent, stuck, advance: (ms: number) => { clock += ms }, close: () => rm(dir, { recursive: true, force: true }) }
}

test('a screen that stands still away from its prompt is called out once, after the wait, with a high-priority push', async () => {
  const t = await fixture()
  try {
    assert.deepEqual(await t.notifier.tick([room()]), [], 'the first look only starts the clock')
    t.advance(59_000)
    assert.deepEqual(await t.notifier.tick([room()]), [])
    t.advance(2_000)
    const called = await t.notifier.tick([room()])
    assert.deepEqual(called.map(item => item.id), ['r1'])
    assert.equal(t.sent.length, 1)
    assert.equal(t.sent[0].payload.kind, 'attention')
    assert.equal(t.sent[0].payload.body, '瞳 · Xcode Testing 1 畫面長時間沒有變化，可能需要你處理')
    assert.equal(t.sent[0].options.urgency, 'high')
    assert.deepEqual(t.stuck, ['r1'], 'the frozen screen is handed over to be kept')
    t.advance(120_000)
    assert.deepEqual(await t.notifier.tick([room()]), [], 'once per stretch, however long it lasts')
    assert.equal(t.sent.length, 1)
  } finally { await t.close() }
})

test('a moving screen, a prompt, an approval, a menu or a room that is not working is never called out', async () => {
  const t = await fixture()
  try {
    const states: Partial<TerminalRoom>[] = [{ ready: true }, { pendingApproval: {} as never }, { menu: { id: 'm', title: 't', confirm: false } }, { status: 'idle' }, { live: false }, { screen: '' }]
    for (const state of states) {
      await t.notifier.tick([room(state)])
      t.advance(90_000)
      assert.deepEqual(await t.notifier.tick([room(state)]), [], JSON.stringify(state))
    }
    // A working CLI moves its screen: every change starts the wait again.
    for (let i = 0; i < 6; i++) { await t.notifier.tick([room({ screenId: `frame-${i}` })]); t.advance(30_000) }
    assert.deepEqual(await t.notifier.tick([room({ screenId: 'frame-last' })]), [])
    assert.equal(t.sent.length, 0)
  } finally { await t.close() }
})

test('after a change the room can be called out again, and a device that is looking at the app is not pushed to', async () => {
  const t = await fixture()
  try {
    await t.notifier.tick([room()]); t.advance(61_000)
    assert.equal((await t.notifier.tick([room()])).length, 1)
    await t.notifier.tick([room({ screenId: 'b' })])
    t.advance(61_000)
    assert.equal((await t.notifier.tick([room({ screenId: 'b' })])).length, 1, 'a new stretch of stillness is a new call-out')
    assert.equal(t.sent.length, 2)
    // A room that goes away is forgotten.
    await t.notifier.tick([])
    await t.notifier.tick([room({ screenId: 'c' })])
    t.advance(61_000)
    assert.equal((await t.notifier.tick([room({ screenId: 'c' })])).length, 1)
  } finally { await t.close() }
  const seen = await fixture({ foreground: true })
  try {
    await seen.notifier.tick([room()]); seen.advance(61_000)
    assert.equal((await seen.notifier.tick([room()])).length, 1, 'the open page is told through the Bridge instead')
    assert.equal(seen.sent.length, 0)
  } finally { await seen.close() }
})

test('the call-out has its own wording and tag, and a failing keep-log never stops the push', async () => {
  const payload = pushPayload('attention', '瞳', 'Xcode Testing 1', true, 'r1')
  assert.equal(payload.kind, 'attention')
  assert.equal(payload.tag, 'komorebi-r1-attention')
  assert.match(pushPayload('attention', '瞳', 'Xcode', false).body, /^瞳 畫面長時間沒有變化/)
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-stuck-'))
  try {
    const store = new PushStore(join(dir, 'push.json')); store.add(phone)
    const sent: string[] = []
    const notifier = new PushNotifier(store, { subject: () => 'https://x', foreground: () => false, characterName: () => '瞳', now: () => 5, stillMs: 0,
      sender: async (_s, body) => { sent.push(body) }, onStuck: () => { throw new Error('disk full') } })
    await notifier.tick([room()])
    assert.equal((await notifier.tick([room()])).length, 1)
    assert.equal(sent.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('the frozen screen is kept in a private log: the last lines, with who and when, and the log never grows without limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-stuck-'))
  try {
    const path = join(dir, 'logs', 'stuck.log')
    const screen = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    assert.equal(noteStuckScreen({ id: 'r1', modelId: 'AGY', roomName: 'Xcode Testing 1', sessionId: 'sess-1', screen }, path, new Date('2026-11-13T02:00:00Z')), true)
    const text = await readFile(path, 'utf8')
    assert.match(text, /===== 2026-11-13T02:00:00\.000Z · AGY · Xcode Testing 1 · sess-1/)
    assert.ok(text.includes('line 99') && text.includes(`line ${100 - tailLines}`) && !text.includes(`line ${99 - tailLines}\n`), 'only the last lines')
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await writeFile(path, 'x'.repeat(maxLogBytes + 10))
    noteStuckScreen({ id: 'r2', modelId: 'CODEX', roomName: 'R5', screen: 'again' }, path)
    assert.ok((await readFile(path, 'utf8')).length < 1000, 'a fresh log after the big one is kept aside')
    assert.equal((await stat(`${path}.1`)).size, maxLogBytes + 10)
    assert.equal(noteStuckScreen({ id: 'r3', modelId: 'AGY', roomName: 'x', screen: 's' }, join(dir, 'logs', 'stuck.log', 'impossible')), false, 'never throws')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('by default the push calls a still room out after fifteen minutes, not one', async () => {
  const { stillCallOutMs } = await import('./push');
  assert.equal(stillCallOutMs, 15 * 60_000);
});

test('a workbench draft that survives redraws alerts once after three minutes even at a ready prompt', async () => {
  const t = await fixture({ stillMs: 900_000 })
  try {
    const draft = room({ modelId: 'CODEX', ready: true, status: 'idle', screen: '› [工作台 #1584｜完成通知]\n  body\n  GPT-6 medium · repo' })
    await t.notifier.tick([draft])
    t.advance(179_999)
    assert.equal((await t.notifier.tick([{ ...draft, screenId: 'b' }])).length, 0)
    t.advance(1)
    assert.equal((await t.notifier.tick([draft])).length, 1)
    assert.match(t.sent[0].payload.body, /工單仍留在輸入框/)
    t.advance(180_000)
    assert.equal((await t.notifier.tick([draft])).length, 0)
    await t.notifier.tick([{ ...draft, screen: '› Ask Codex to do anything\n  GPT-6 medium · repo' }])
    assert.equal((await t.notifier.tick([draft])).length, 0)
  } finally { await t.close() }
})

test('a long wrapped AGY ticket and a Claude confirmation have specific diagnoses', async () => {
  const { roomBlocker } = await import('./room-blocker')
  const divider = '─'.repeat(40)
  const screen = [divider, '> [交接｜來自 工作台] 工單提示：#1340', ...Array(16).fill('  continued'), divider, ''].join('\n')
  assert.equal(roomBlocker(room({ screen })), 'draft')
  assert.equal(roomBlocker(room({ modelId: 'CLAUDE', screen: 'y. Submit answers\nn. Cancel\nEnter y/n:' })), 'answers')
})
