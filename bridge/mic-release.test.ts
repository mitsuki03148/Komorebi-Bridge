import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setAudioSession } from '../src/utils/audioSession'
import { releaseMic } from '../src/utils/micCapture'

const track = (log: string[], name: string, fails = false) => ({ stop: () => { log.push(`stop ${name}`); if (fails) throw new Error('boom') } })
const withSession = (fn: (session: { type: string }) => void) => {
  const session = { type: 'play-and-record' }
  Object.defineProperty(globalThis.navigator, 'audioSession', { value: session, configurable: true })
  try { fn(session) } finally { delete (globalThis.navigator as unknown as { audioSession?: unknown }).audioSession }
}

test('releasing the microphone stops every track, even when one fails, and gives the audio session back to other apps', () => {
  withSession(session => {
    const log: string[] = []
    releaseMic({ stream: { getTracks: () => [track(log, 'a', true), track(log, 'b')] as unknown as MediaStreamTrack[] } })
    assert.deepEqual(log, ['stop a', 'stop b'], 'the second track is stopped although the first threw')
    assert.equal(session.type, 'ambient', 'music can play again')
  })
})

test('a recorder that is still running is stopped quietly, and one that already stopped is left alone', () => {
  const log: string[] = []
  let stopped = 0
  const running = { state: 'recording', ondataavailable: () => {}, onstop: () => {}, stop: () => { stopped++ } }
  releaseMic({ recorder: running as never, stream: { getTracks: () => [track(log, 'a')] as unknown as MediaStreamTrack[] } })
  assert.equal(stopped, 1)
  assert.equal(running.onstop, null, 'its handlers do not run: no transcription is started by a release')
  assert.equal(running.ondataavailable, null)
  const done = { state: 'inactive', ondataavailable: () => {}, onstop: () => {}, stop: () => { throw new Error('must not stop twice') } }
  releaseMic({ recorder: done as never, stream: { getTracks: () => [] } })
  const broken = { state: 'recording', ondataavailable: null, onstop: null, stop: () => { throw new Error('InvalidStateError') } }
  releaseMic({ recorder: broken as never, stream: { getTracks: () => [track(log, 'c')] as unknown as MediaStreamTrack[] } })
  assert.ok(log.includes('stop c'), 'a recorder that cannot stop does not keep the tracks open')
})

test('releasing with nothing recorded, or a stream that cannot list tracks, never throws', () => {
  assert.doesNotThrow(() => releaseMic())
  assert.doesNotThrow(() => releaseMic({ stream: { getTracks: () => { throw new Error('gone') } } }))
})

test('the audio session is only touched where the browser has one, and only when it differs', () => {
  assert.doesNotThrow(() => setAudioSession('ambient'))
  withSession(session => {
    setAudioSession('ambient'); assert.equal(session.type, 'ambient')
    setAudioSession('play-and-record'); assert.equal(session.type, 'play-and-record')
  })
})

test('every way the voice button can end lets the microphone go: error, unmount, background, lost microphone and cancel', async () => {
  const button = await readFile(new URL('../src/components/VoiceButton.tsx', import.meta.url), 'utf8')
  assert.match(button, /if \(!mounted\.current\) \{ releaseMic\(\{ stream \}\); return; \}/, 'the screen was left while the permission prompt was open')
  assert.match(button, /catch \(error\) \{ releaseMic\(\{ stream \}\); onError\(/, 'the recorder cannot be created')
  assert.match(button, /try \{ recorder\.start\(\); \}\s*catch \(error\) \{ release\(\);/, 'the recorder cannot start')
  assert.match(button, /window\.addEventListener\('pagehide', leave\)/, 'the page goes away')
  assert.match(button, /document\.visibilityState === 'hidden' && media\.current\?\.recorder\.state === 'recording'\) finish\.current\(\)/, 'the page goes to the background')
  assert.match(button, /track\.addEventListener\('ended'/, 'the system takes the microphone away')
  assert.match(button, /else \{ release\(\); dispatch\(\{ type: 'cancel' \}\); \}/, 'cancel while the recorder is not running')
  assert.match(button, /catch \(error\) \{ setAudioSession\('ambient'\); onError\(/, 'permission refused')
})
