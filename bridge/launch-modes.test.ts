import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ServerEvent } from '../src/types/bridge'
import { roomAutoMode } from '../src/utils/launchMode'
import { LaunchModeStore } from './launch-modes'

const temp = () => mkdtemp(join(tmpdir(), 'komorebi-modes-'))

test('a room keeps its own mode, otherwise follows its CLI default, and it survives a restart', async () => {
  const root = await temp()
  try {
    const file = join(root, 'modes.json')
    const store = new LaunchModeStore(file)
    assert.equal(store.resolve('CLAUDE', ['a']), false)
    store.setDefault('CLAUDE', true)
    assert.equal(store.resolve('CLAUDE', ['a']), true)
    assert.equal(store.resolve('CODEX', ['a']), false)
    store.setRoom(['a'], false)
    assert.equal(store.resolve('CLAUDE', ['a']), false, 'an explicit choice beats the default')
    assert.equal(store.resolve('CLAUDE', ['x', 'a']), false, 'any of the room keys can match')
    store.setDefault('CLAUDE', false)
    store.setRoom(['b'], true)
    store.copy('b', 'session-claude-1')
    const again = new LaunchModeStore(file)
    assert.equal(again.resolve('CLAUDE', ['b']), true)
    assert.equal(again.resolve('CLAUDE', ['session-claude-1']), true)
    assert.equal(again.resolve('CLAUDE', ['a']), false)
    assert.equal(again.resolve('CLAUDE', ['unknown']), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an unreadable settings file is never overwritten and every room falls back to asking', async () => {
  const root = await temp()
  const originalError = console.error
  try {
    const file = join(root, 'modes.json')
    await writeFile(file, '{ not json')
    console.error = () => {}
    const store = new LaunchModeStore(file)
    assert.equal(store.resolve('CODEX', ['a']), false)
    assert.throws(() => store.setDefault('CODEX', true))
    assert.equal(await readFile(file, 'utf8'), '{ not json')
  } finally { console.error = originalError; await rm(root, { recursive: true, force: true }) }
})

test('the UI reads the running mode first, then the saved choice, then the default', () => {
  const modes = { defaults: { AGY: false, CODEX: false, CLAUDE: true }, rooms: { 'session-claude-s1': false, r2: true } }
  const room = (extra: object) => ({ id: 'r1', modelId: 'CLAUDE', ...extra }) as never
  assert.equal(roomAutoMode(room({}), modes), true)
  assert.equal(roomAutoMode(room({ sessionId: 's1' }), modes), false)
  assert.equal(roomAutoMode(room({ id: 'r2', modelId: 'CODEX' }), modes), true)
  assert.equal(roomAutoMode(room({ live: true, autoMode: false }), modes), false)
  assert.equal(roomAutoMode(room({}), null), false)
})

test('rooms start with the default mode, remember an explicit choice, and keep it when reopened', async () => {
  const { Rooms } = await import('./rooms')
  const root = await temp()
  const originalPath = process.env.PATH
  const events: ServerEvent[] = []
  let rooms = new Rooms(root, event => events.push(event))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nwhile IFS= read -r line; do :; done\n')
    await chmod(join(bin, 'claude'), 0o700)
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    const create = (name: string, fullAccess?: boolean) =>
      rooms.handle({ type: 'CREATE', modelId: 'CLAUDE', roomName: name, repoPath: '', remote: false, fullAccess }, () => {})
    const flags = (name: string) => rooms.snapshot().find(room => room.roomName === name)!.remoteControl.autoLaunchedFlag

    await create('plain')
    assert.match(flags('plain'), /--permission-mode default/)

    await rooms.handle({ type: 'SET_DEFAULT_MODE', modelId: 'CLAUDE', auto: true }, () => {})
    assert.equal(events.some(event => event.type === 'LAUNCH_MODES' && event.launchModes.defaults.CLAUDE), true)
    await create('by default')
    assert.match(flags('by default'), /--permission-mode bypassPermissions/)
    await create('explicit off', false)
    assert.match(flags('explicit off'), /--permission-mode default/)

    const explicit = rooms.snapshot().find(room => room.roomName === 'explicit off')!
    const defaulted = rooms.snapshot().find(room => room.roomName === 'by default')!
    assert.equal(explicit.autoMode, false)
    assert.equal(defaulted.autoMode, true)
    assert.equal(rooms.launchModes().rooms[explicit.id], false)

    // Changing a running room's mode reopens its CLI on the same session with the new mode.
    const sessionId = '00000021-0021-4021-8021-000000000021'
    Object.assign(defaulted, { sessionId, resumable: true })
    assert.equal(defaulted.live, true)
    await rooms.handle({ type: 'SET_ROOM_MODE', roomId: defaulted.id, auto: false }, () => {})
    const reopened = rooms.snapshot().find(room => room.id === defaulted.id)!
    assert.equal(reopened.live, true)
    assert.equal(reopened.autoMode, false)
    assert.match(reopened.remoteControl.autoLaunchedFlag, new RegExp(`--permission-mode default .*--resume ${sessionId}`))
    assert.equal(rooms.launchModes().rooms[defaulted.id], false)

    // Setting a mode on a room that is not running only records it.
    await rooms.handle({ type: 'SET_ROOM_MODE', roomId: explicit.id, auto: true }, () => {})
    assert.equal(rooms.launchModes().rooms[explicit.id], true)
    await assert.rejects(rooms.handle({ type: 'SET_ROOM_MODE', roomId: explicit.id, auto: 'yes' as never }, () => {}))
    await assert.rejects(rooms.handle({ type: 'SET_DEFAULT_MODE', modelId: 'NOPE' as never, auto: true }, () => {}))

    // A new Bridge process reads the same choices back.
    await rooms.close()
    rooms = new Rooms(root, event => events.push(event))
    assert.equal(rooms.launchModes().defaults.CLAUDE, true)
    assert.equal(rooms.launchModes().rooms[explicit.id], true)
  } finally {
    process.env.PATH = originalPath
    await rooms.close()
    await rm(root, { recursive: true, force: true })
  }
})
