import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ReadMarkStore, readMarkLimits } from './read-mark-store'

const dir = () => mkdtempSync(join(tmpdir(), 'komorebi-read-marks-'))

test('the Bridge keeps the later mark per room, reports only what changed, and survives a restart', t => {
  const root = dir(), path = join(root, 'marks.json')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new ReadMarkStore(path)
  assert.deepEqual(store.apply({ a: '2026-11-17T10:00:00Z', b: '' }), { a: '2026-11-17T10:00:00Z', b: '' })
  assert.deepEqual(store.apply({ a: '2026-11-17T09:00:00Z' }), {}, 'an older report changes nothing')
  assert.deepEqual(store.apply({ a: '2026-11-17T11:00:00Z', b: '2026-11-17T08:00:00Z' }), { a: '2026-11-17T11:00:00Z', b: '2026-11-17T08:00:00Z' })
  assert.deepEqual(new ReadMarkStore(path).all(), { a: '2026-11-17T11:00:00Z', b: '2026-11-17T08:00:00Z' }, 'a restart remembers')
  assert.deepEqual(readdirSync(root), ['marks.json'], 'no temporary file is left')
  assert.equal(statLike(path), 0o600, 'only the owner can read it')
})

test('a bad, oversized or hostile message is ignored, never an error and never stored', () => {
  const store = new ReadMarkStore()
  for (const junk of [null, 'x', 7, [], [['a', 'b']]]) assert.deepEqual(store.apply(junk), {})
  assert.deepEqual(store.apply({ a: 5, ['x'.repeat(readMarkLimits.id + 1)]: 'time', b: 'y'.repeat(readMarkLimits.stamp + 1), '': 't', ok: '2026-11-17T10:00:00Z' }), { ok: '2026-11-17T10:00:00Z' })
  const many = Object.fromEntries(Array.from({ length: readMarkLimits.perMessage + 50 }, (_, index) => [`room-${index}`, '2026-11-17T10:00:00Z']))
  assert.equal(Object.keys(store.apply(many)).length, readMarkLimits.perMessage, 'one message adds at most the per-message limit')
  assert.equal(store.size, readMarkLimits.perMessage + 1)
})

test('the file cannot grow without end, and rooms that no longer exist can be forgotten', () => {
  const store = new ReadMarkStore()
  for (let batch = 0; batch < 12; batch++) store.apply(Object.fromEntries(Array.from({ length: readMarkLimits.perMessage }, (_, index) => [`r-${batch}-${index}`, '2026-11-17T10:00:00Z'])))
  assert.ok(store.size <= readMarkLimits.total)
  assert.deepEqual(store.apply({ 'r-0-0': '2026-11-17T11:00:00Z' }), { 'r-0-0': '2026-11-17T11:00:00Z' }, 'a room already known can still move forward at the cap')
  store.prune(new Set(['r-0-0', 'r-0-1']))
  assert.deepEqual(Object.keys(store.all()).sort(), ['r-0-0', 'r-0-1'])
})

test('a damaged or missing file starts empty and does not stop the Bridge', t => {
  const root = dir(), path = join(root, 'marks.json')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(new ReadMarkStore(path).all(), {})
  writeFileSync(path, '{ not json')
  const store = new ReadMarkStore(path)
  assert.deepEqual(store.all(), {})
  assert.deepEqual(store.apply({ a: 't' }), { a: 't' })
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).a, 't', 'and writes a good one on the first change')
  writeFileSync(path, JSON.stringify({ a: '2026-11-17T10:00:00Z', bad: 3, '': 'x' }))
  assert.deepEqual(new ReadMarkStore(path).all(), { a: '2026-11-17T10:00:00Z' }, 'bad entries in a good file are dropped')
})

function statLike(path: string) { return statSync(path).mode & 0o777 }
