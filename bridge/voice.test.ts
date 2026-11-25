import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GroupChatView } from '../src/components/GroupChat'
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace'
import { VoicePanel } from '../src/components/SettingsModals'
import { VoiceButton } from '../src/components/VoiceButton'
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData'
import type { ClientEvent, ServerEvent } from '../src/types/bridge'
import type { TerminalRoom } from '../src/types/guild'
import { appendDictation, clockText, createTranscriber, maxRecordSeconds, micProblem, pickRecordingType, voiceStep, type VoiceState } from '../src/utils/voice'

test('recording goes idle → recording → transcribing → idle, stops itself at the limit, and can be cancelled', () => {
  let state: VoiceState = { phase: 'idle' }
  state = voiceStep(state, { type: 'tick' })
  assert.deepEqual(state, { phase: 'idle' }, 'time passing does nothing when not recording')
  state = voiceStep(state, { type: 'start' })
  assert.deepEqual(state, { phase: 'recording', seconds: 0 })
  assert.deepEqual(voiceStep(state, { type: 'start' }), state, 'a second start changes nothing')
  state = voiceStep(voiceStep(state, { type: 'tick' }), { type: 'tick' })
  assert.deepEqual(state, { phase: 'recording', seconds: 2 })
  assert.deepEqual(voiceStep(state, { type: 'stop' }), { phase: 'transcribing' })
  assert.deepEqual(voiceStep({ phase: 'transcribing' }, { type: 'done' }), { phase: 'idle' })
  assert.deepEqual(voiceStep({ phase: 'idle' }, { type: 'done' }), { phase: 'idle' })
  assert.deepEqual(voiceStep({ phase: 'recording', seconds: 5 }, { type: 'cancel' }), { phase: 'idle' })
  assert.deepEqual(voiceStep({ phase: 'recording', seconds: maxRecordSeconds - 1 }, { type: 'tick' }), { phase: 'transcribing' }, 'at four minutes it ends by itself')
  assert.ok(maxRecordSeconds >= 180, 'long enough to speak a long task')
})

test('the recording format is Safari-first, with a clear reason when the microphone cannot be used', () => {
  assert.equal(pickRecordingType(type => type === 'audio/mp4'), 'audio/mp4')
  assert.equal(pickRecordingType(type => type.startsWith('audio/webm')), 'audio/webm;codecs=opus')
  assert.equal(pickRecordingType(() => false), undefined)
  assert.equal(pickRecordingType(() => { throw new Error('no') }), undefined)
  assert.equal(clockText(0), '0:00')
  assert.equal(clockText(65), '1:05')
  assert.equal(clockText(239.9), '3:59')
  assert.match(micProblem(undefined, false, true), /https/)
  assert.match(micProblem(undefined, true, false), /不支援/)
  assert.match(micProblem({ name: 'NotAllowedError' }, true, true), /權限/)
  assert.match(micProblem({ name: 'NotFoundError' }, true, true), /找不到/)
  assert.match(micProblem(new Error('x'), true, true), /開不到/)
})

test('dictated text is added to what is already typed, with one space between', () => {
  assert.equal(appendDictation('', '你好'), '你好')
  assert.equal(appendDictation('幫我', ' check 下 '), '幫我 check 下')
  assert.equal(appendDictation('幫我 ', 'check'), '幫我 check')
  assert.equal(appendDictation('第一行\n', '第二行'), '第一行\n第二行')
  assert.equal(appendDictation('已有', '   '), '已有')
})

test('a recording is sent to the Bridge and its answer finds the waiting request; failures reach the person', async () => {
  const sent: ClientEvent[] = []
  const transcriber = createTranscriber(event => { sent.push(event); return true }, 50)
  const first = transcriber.request({ mime: 'audio/mp4', data: 'AAAA' }, 'yue')
  const second = transcriber.request({ mime: 'audio/mp4', data: 'BBBB' }, 'en')
  assert.equal(transcriber.pending, 2)
  const [a, b] = sent as Extract<ClientEvent, { type: 'TRANSCRIBE' }>[]
  assert.notEqual(a.requestId, b.requestId)
  assert.equal(a.language, 'yue')
  assert.equal(b.language, 'en')
  assert.equal(transcriber.receive({ type: 'NOTICE', message: 'x' } as ServerEvent), false)
  transcriber.receive({ type: 'TRANSCRIBE_RESULT', requestId: b.requestId, ok: true, text: 'English' })
  transcriber.receive({ type: 'TRANSCRIBE_RESULT', requestId: a.requestId, ok: false, message: 'Mac 未有語音模型' })
  assert.equal(await second, 'English')
  await assert.rejects(first, /語音模型/)
  assert.equal(transcriber.pending, 0)
  assert.equal(transcriber.receive({ type: 'TRANSCRIBE_RESULT', requestId: 'unknown', ok: true, text: '' }), true, 'a late answer is ignored quietly')
  const lost = createTranscriber(() => false)
  await assert.rejects(lost.request({ mime: 'audio/mp4', data: 'A' }, 'yue'), /未連到/)
  const slow = createTranscriber(() => true, 20)
  await assert.rejects(slow.request({ mime: 'audio/mp4', data: 'A' }, 'yue'), /逾時/)
  const dropped = createTranscriber(() => true)
  const waiting = dropped.request({ mime: 'audio/mp4', data: 'A' }, 'yue')
  dropped.fail('連線中斷')
  await assert.rejects(waiting, /連線中斷/)
  assert.equal(dropped.pending, 0)
})

test('the microphone button is there when the Mac can transcribe, and says why not when it cannot', () => {
  const transcriber = createTranscriber(() => true)
  const render = (supported: boolean) => renderToStaticMarkup(createElement(VoiceButton, { supported, transcriber, onText() {}, onError() {} }))
  const on = render(true)
  assert.match(on, /aria-label="錄音轉文字"/)
  assert.doesNotMatch(on, /disabled=""/)
  assert.match(on, /廣東話夾英文/)
  const off = render(false)
  assert.match(off, /disabled=""/)
  assert.match(off, /要在 Mac 安裝語音模型才能使用/)
  assert.match(renderToStaticMarkup(createElement(VoiceButton, { supported: true, transcriber, onText() {}, onError() {}, disabled: true })), /disabled=""/)
})

test('the language choice shows five compact icon buttons and defaults to Cantonese', () => {
  const html = renderToStaticMarkup(createElement(VoicePanel, { supported: true }))
  assert.match(html, /role="radiogroup"/)
  const labels = ['普通話（中文）', '廣東話', 'English', '日本語', '自動']
  for (const label of labels) assert.ok(html.includes(label), label)
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5)
  assert.match(html, /aria-checked="true"[^>]*aria-label="廣東話"/)
  assert.doesNotMatch(html, /廣東話輸出寫法|廣東話口語|書面語/)
  assert.match(renderToStaticMarkup(createElement(VoicePanel, { supported: false })), /Mac 未有語音模型/)
})

test('the microphone sits on the right before the unified primary action button (stop while running empty, send when idle, steer when drafting mid-turn), in the phone, Mac and group message boxes alike', async () => {
  const idleRoom = { id: 'a', modelId: 'CODEX', roomName: 'R5', live: true, ready: true, status: 'idle', remoteControl: {}, effortLevel: null, selectedSubModel: 'x', repoPath: '/tmp', gitBranch: 'main', progressPercent: null, contextUsagePct: null, currentActionSummary: '', bubbleSnippet: '', updatedAt: '', logs: [] } as unknown as TerminalRoom
  const runningRoom = { ...idleRoom, ready: false, steerable: true, status: 'working' } as unknown as TerminalRoom
  const mic = createElement('button', { id: 'mic' }, 'mic')
  const groupRunning = renderToStaticMarkup(createElement(GroupChatView, { name: '群', members: [{ roomId: 'a', modelId: 'CODEX', room: runningRoom }], characters: INITIAL_CHARACTERS, onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
    attachmentPicker: () => createElement('i', { id: 'clip' }), voiceButton: () => mic, onInterrupt() {} }))
  const macRunning = renderToStaticMarkup(createElement(RightRoomWorkspace, { room: runningRoom, character: INITIAL_CHARACTERS.CODEX, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {}, onSendPrompt() {}, onSubmitDraft() {},
    promptInput: '', setPromptInput() {}, sending: false, approving: false, onRunCompact() {}, onRedeemResetVoucher() {}, onToggleTerminal() {}, onShowTerminal() {}, terminalOpen: false, hasAttachment: false,
    attachmentPicker: createElement('i', { id: 'clip' }), voiceButton: mic } as never))
  for (const [name, html] of [['group', groupRunning], ['mac', macRunning]] as const) {
    const at = (needle: string) => html.indexOf(needle)
    assert.ok(at('id="clip"') >= 0 && at('id="clip"') < at('<textarea'), `${name}: the paperclip stays on the left`)
    assert.ok(at('<textarea') < at('id="mic"') && at('id="mic"') < at('data-composer-stop'), `${name}: then the box, the microphone, and stop while running without draft`)
    assert.doesNotMatch(html, /data-composer-send/, `${name}: no separate disabled send disc beside stop`)
  }
  const macSteer = renderToStaticMarkup(createElement(RightRoomWorkspace, { room: runningRoom, character: INITIAL_CHARACTERS.CODEX, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {}, onSendPrompt() {}, onSubmitDraft() {},
    promptInput: '補充一句', setPromptInput() {}, sending: false, approving: false, onRunCompact() {}, onRedeemResetVoucher() {}, onToggleTerminal() {}, onShowTerminal() {}, terminalOpen: false, hasAttachment: false,
    attachmentPicker: createElement('i', { id: 'clip' }), voiceButton: mic } as never))
  assert.ok(macSteer.indexOf('id="mic"') < macSteer.indexOf('data-composer-send'), 'mac steer: microphone is right before steer send')
  assert.match(macSteer, /data-send-mode="steer"/, 'running with draft switches primary button to steer shooting star')
  assert.doesNotMatch(macSteer, /data-composer-stop/, 'no duplicate stop beside steer')
  const phone = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.ok(phone.includes("                {voiceControl()}\n                <ComposerActionButton"), 'phone: the microphone is right before the unified action button')
  assert.doesNotMatch(phone, /\{attachmentControl\('button'\)\}\n\s*\{voiceControl\(\)\}/, 'and not beside the paperclip')
  assert.ok(phone.includes('transcriber.fail()') && phone.includes('TRANSCRIBE_RESULT'), 'answers are routed back and a dropped connection ends the wait')
})

test('saved old language choices stay readable and old Cantonese style is ignored', async () => {
  const { readVoiceLanguage, writeVoiceLanguage, createTranscriber } = await import('../src/utils/voice')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>([['komorebi-voice-style', 'colloquial']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } })
  try {
    assert.equal(readVoiceLanguage(), 'yue')
    for (const language of ['yue', 'auto', 'en', 'zh', 'ja'] as const) {
      writeVoiceLanguage(language)
      assert.equal(readVoiceLanguage(), language)
    }
    const sent: ClientEvent[] = []
    const transcriber = createTranscriber(event => { sent.push(event); return true }, 100)
    const pending = transcriber.request({ mime: 'audio/mp4', data: 'AAAA' }, 'yue')
    assert.equal(Object.hasOwn(sent[0], 'style'), false)
    assert.equal(values.get('komorebi-voice-style'), 'colloquial', 'legacy value is ignored rather than rewritten')
    transcriber.fail()
    await assert.rejects(pending)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
