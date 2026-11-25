import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

class FakeContext {
  state = 'suspended'; currentTime = 0; destination = {}; resumes = 0; suspends = 0
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve() }
  createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} } }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
}

test('the chimes do not hold the audio session: ambient mix, asleep between chimes and in the background, awake for the next one', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const contexts: FakeContext[] = []
  const session = { type: 'auto' }
  const listeners: Record<string, () => void> = {}
  const document = { visibilityState: 'visible', addEventListener: (name: string, handler: () => void) => { listeners[name] = handler } }
  Object.assign(globalThis, { window: { AudioContext: class extends FakeContext { constructor() { super(); contexts.push(this) } } }, document })
  Object.defineProperty(globalThis.navigator, 'audioSession', { value: session, configurable: true })
  try {
    const { playGuildChime, suspendGuildAudio, unlockGuildAudio } = await import('../src/utils/soundPlayer')
    unlockGuildAudio(true)
    assert.equal(session.type, 'ambient', 'chimes mix with other apps\' music')
    assert.equal(contexts.length, 1)
    assert.equal(contexts[0].state, 'running', 'unlocked by the tap')
    mock.timers.tick(1500)
    assert.equal(contexts[0].state, 'suspended', 'a tap that played nothing does not leave the context running')
    playGuildChime('approve')
    assert.equal(contexts[0].state, 'running', 'the chime wakes it')
    assert.equal(contexts.length, 1, 'one shared context, never a second')
    mock.timers.tick(1499)
    assert.equal(contexts[0].state, 'running', 'still ringing')
    mock.timers.tick(1)
    assert.equal(contexts[0].state, 'suspended', 'asleep again once the chime is over')
    const before = contexts[0].suspends
    playGuildChime('poke'); playGuildChime('poke')
    mock.timers.tick(1500)
    assert.equal(contexts[0].suspends, before + 1, 'two chimes close together share one sleep')
    playGuildChime('approve')
    document.visibilityState = 'hidden'; listeners.visibilitychange?.()
    assert.equal(contexts[0].state, 'suspended', 'going to the background puts it to sleep at once')
    suspendGuildAudio()
    assert.doesNotThrow(() => suspendGuildAudio(), 'suspending twice is harmless')
    playGuildChime('approve', false)
    assert.equal(contexts[0].state, 'suspended', 'sound turned off: nothing wakes')
  } finally {
    delete (globalThis as { window?: unknown }).window; delete (globalThis as { document?: unknown }).document
    delete (globalThis.navigator as unknown as { audioSession?: unknown }).audioSession
    mock.timers.reset()
  }
})
