import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clockLabel, todayAxis, todayPoints } from '../src/components/GuildModals'
import { DailyUsageStore, dayOf } from './usage-history'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

test('readings are kept for today in one file, survive a restart, and flat stretches still get a point every half hour', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-usage-'))
  try {
    const file = join(dir, 'usage.json')
    let now = at(12, 9)
    const store = new DailyUsageStore(file, () => now)
    assert.equal(store.record('CLAUDE', 9, 85, true), true)
    now = at(12, 9, 10)
    assert.equal(store.record('CLAUDE', 9, 85, false), false, 'unchanged and recent: nothing new to draw')
    now = at(12, 9, 40)
    assert.equal(store.record('CLAUDE', 9, 85, false), true, 'unchanged for half an hour: a flat point')
    now = at(12, 9, 41)
    assert.equal(store.record('CLAUDE', 9, 80, true), true)
    store.record('CODEX', 17, 100, true)
    assert.deepEqual(store.series('CLAUDE').map(point => point.mp), [85, 85, 80])
    assert.equal(((await stat(file)).mode & 0o777).toString(8), '600')

    const restarted = new DailyUsageStore(file, () => now)
    assert.deepEqual(restarted.series('CLAUDE').map(point => point.mp), [85, 85, 80])
    assert.equal(restarted.series('CODEX').length, 1)
    assert.equal(restarted.series('AGY').length, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('at 00:00 the same file starts again from empty, and an old day is never shown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-usage-'))
  try {
    const file = join(dir, 'usage.json')
    let now = at(12, 23, 58)
    const store = new DailyUsageStore(file, () => now)
    store.record('CLAUDE', 9, 50, true)
    assert.equal(store.series('CLAUDE').length, 1)
    now = at(13, 0, 1)
    assert.deepEqual(store.series('CLAUDE'), [], 'a new day shows nothing until its first reading')
    store.record('CLAUDE', 9, 49, false)
    assert.deepEqual(store.series('CLAUDE').map(point => point.mp), [49], 'the new day starts afresh')
    assert.deepEqual(await readdir(dir), ['usage.json'], 'one file, overwritten, never a pile of them')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).day, dayOf(at(13, 0, 1)))
    // A file left from yesterday is ignored when the Bridge starts.
    await writeFile(file, JSON.stringify({ day: dayOf(at(11, 12)), points: { CLAUDE: [{ at: at(11, 12), hp: 1, mp: 1 }] } }))
    assert.deepEqual(new DailyUsageStore(file, () => at(12, 8)).series('CLAUDE'), [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a file that cannot be read is left alone and the chart still works from memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-usage-'))
  const originalError = console.error
  try {
    const file = join(dir, 'usage.json')
    await writeFile(file, '{ broken')
    console.error = () => {}
    const store = new DailyUsageStore(file, () => at(12, 9))
    store.record('CLAUDE', 9, 85, true)
    assert.equal(store.series('CLAUDE').length, 1)
    assert.equal(await readFile(file, 'utf8'), '{ broken')
  } finally { console.error = originalError; await rm(dir, { recursive: true, force: true }) }
})

test('the Bridge draws today only: a reading is added to the character, and a restart brings the day back', async () => {
  const { Rooms } = await import('./rooms')
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-usage-'))
  try {
    const file = join(dir, '.komorebi-usage-today.json')
    let now = at(12, 10)
    const rooms = new Rooms(dir, () => {}, undefined, undefined, new DailyUsageStore(file, () => now)) as any
    rooms.applyUsage('CLAUDE', { fiveHour: 85, weekly: 91 })
    now = at(12, 11)
    rooms.applyUsage('CLAUDE', { fiveHour: 80, weekly: 90 })
    const history = rooms.characters.CLAUDE.usageHistory
    assert.deepEqual(history.map((point: { at: number }) => point.at), [at(12, 10), at(12, 11)])
    assert.equal(history[1].hp, 90, 'hp is the weekly quota and mp the 5h one, as before')
    assert.equal(history[1].mp, 80)
    const restarted = new Rooms(dir, () => {}, undefined, undefined, new DailyUsageStore(file, () => now)) as any
    assert.equal(restarted.characters.CLAUDE.usageHistory.length, 2)
    now = at(13, 0, 5)
    const nextDay = new Rooms(dir, () => {}, undefined, undefined, new DailyUsageStore(file, () => now)) as any
    assert.equal(nextDay.characters.CLAUDE.usageHistory.length, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('the chart axis is the local day from 00:00 to 24:00 and leaves out other days', () => {
  const noon = at(12, 12)
  const { start, ticks } = todayAxis(noon)
  assert.equal(start, at(12, 0))
  assert.deepEqual(ticks, [0, 6, 12, 18, 24].map(hour => at(12, hour)))
  assert.deepEqual(ticks.map(tick => clockLabel(tick, start)), ['00:00', '06:00', '12:00', '18:00', '24:00'])
  assert.equal(clockLabel(at(12, 9, 5), start, true), '09:05:00')
  const history = [{ time: '', at: at(11, 23, 59), hp: 1, mp: 1 }, { time: '', at: at(12, 0), hp: 2, mp: 2 }, { time: '', at: at(12, 15), hp: 3, mp: 3 }, { time: '', hp: 4, mp: 4 }, { time: '', at: at(13, 0, 1), hp: 5, mp: 5 }]
  assert.deepEqual(todayPoints(history, start).map(point => point.hp), [2, 3])
})
