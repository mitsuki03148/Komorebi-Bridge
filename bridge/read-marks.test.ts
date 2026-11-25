import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { advanceReadMarks, isUnread, mergeReadMarks, planReadMarks, readStamp } from '../src/utils/attentionDiff'
import type { TerminalRoom } from '../src/types/guild'

const room = (id: string, ...replies: { id: string; createdAt?: string }[]) =>
  ({ id, logs: replies.map(reply => ({ ...reply, sender: 'agent', text: 'x', timestamp: '' })) }) as unknown as TerminalRoom

test('a room met for the first time starts as read; an empty room waits for its first reply', () => {
  const marks = advanceReadMarks({}, [room('a', { id: 'a1', createdAt: '2026-11-17T01:00:00Z' }), room('b')], [])
  assert.deepEqual(marks, { a: '2026-11-17T01:00:00Z', b: '' })
  assert.equal(isUnread(room('a', { id: 'a1', createdAt: '2026-11-17T01:00:00Z' }), marks), false)
  assert.equal(isUnread(room('b', { id: 'b1', createdAt: '2026-11-17T02:00:00Z' }), marks), true, 'the first reply of an empty room is unread')
})

test('a refresh does not bring old dots back, even when the entry id changed', () => {
  const marks = { a: '2026-11-17T01:00:00Z' }
  // Same reply, same time, but the history window was read again and gave it a new id.
  assert.equal(isUnread(room('a', { id: 'other-id', createdAt: '2026-11-17T01:00:00Z' }), marks), false)
  assert.equal(isUnread(room('a', { id: 'a2', createdAt: '2026-11-17T01:05:00Z' }), marks), true, 'a newer reply is unread')
})

test('every member of the open group counts as read, without opening each room; rooms outside the group keep their dot', () => {
  const marks = { a: '2026-11-17T01:00:00Z', b: '2026-11-17T01:00:00Z', c: '2026-11-17T01:00:00Z' }
  const rooms = ['a', 'b', 'c'].map(id => room(id, { id: `${id}2`, createdAt: '2026-11-17T01:05:00Z' }))
  const next = advanceReadMarks(marks, rooms, ['a', 'b'])
  assert.equal(next.a, '2026-11-17T01:05:00Z')
  assert.equal(next.b, '2026-11-17T01:05:00Z')
  assert.equal(isUnread(rooms[2], next), true)
  assert.equal(advanceReadMarks(next, rooms, ['a', 'b']), next, 'nothing to change returns the same object')
})

test('an entry without a time falls back to its id, and a room with no reply has no stamp', () => {
  assert.equal(readStamp(room('a', { id: 'a1' })), 'a1')
  assert.equal(readStamp(room('a')), undefined)
  assert.equal(isUnread(room('a', { id: 'a2' }), { a: 'a1' }), true)
  assert.equal(isUnread(room('a', { id: 'a1' }), { a: 'a1' }), false)
})

test('merging read marks keeps the later time per room, lets anything beat "nothing seen", and returns the same object when nothing changes', () => {
  const current = { a: '2026-11-17T10:00:00Z', b: '', c: 'entry-1' }
  const merged = mergeReadMarks(current, { a: '2026-11-17T09:00:00Z', b: '2026-11-17T08:00:00Z', c: 'entry-2', d: '2026-11-17T07:00:00Z' })
  assert.equal(merged.a, '2026-11-17T10:00:00Z', 'an older report never takes a room back')
  assert.equal(merged.b, '2026-11-17T08:00:00Z', 'nothing seen yet loses to a real time')
  assert.equal(merged.c, 'entry-2', 'two marks that are not times cannot be ordered: the incoming one wins')
  assert.equal(merged.d, '2026-11-17T07:00:00Z', 'a room not known yet is added')
  assert.equal(mergeReadMarks(merged, { a: '2026-11-17T10:00:00Z', b: '' }), merged)
  assert.equal(mergeReadMarks({ a: '2026-11-17T10:00:00Z' }, { a: '' }).a, '2026-11-17T10:00:00Z', 'an empty report never erases a read mark')
})

test('a device sharing its marks reports only what it read, adopts its own old marks once, and the other device agrees', () => {
  const reply = (id: string, at: string) => room(id, { id: `${id}-r`, createdAt: at })
  const rooms = [reply('a', '2026-11-17T12:00:00Z'), reply('b', '2026-11-17T12:00:00Z'), reply('c', '2026-11-17T12:00:00Z')]
  // The Bridge knows the Mac read all three up to 11:00; the phone's own old marks stop at 09:00 for a, and it never saw c.
  const bridge = { a: '2026-11-17T11:00:00Z', b: '2026-11-17T11:00:00Z', c: '2026-11-17T11:00:00Z' }
  const first = planReadMarks({ marks: bridge, rooms, viewedIds: ['a', 'b'], local: { a: '2026-11-17T09:00:00Z', z: '2026-11-17T08:00:00Z' }, adoptLocal: true })
  assert.deepEqual(first.diff, { a: '2026-11-17T12:00:00Z', b: '2026-11-17T12:00:00Z', z: '2026-11-17T08:00:00Z' }, 'the group members read now; an old local mark for another room is kept; c is left alone')
  assert.equal(isUnread(rooms[2], first.marks), true, 'c was not on screen, so its newer reply is still unread')
  const again = planReadMarks({ marks: first.marks, rooms, viewedIds: ['a', 'b'], local: {}, adoptLocal: false })
  assert.deepEqual(again.diff, {}, 'nothing more to report: no loop')
  // The other device (the phone) loads, gets the Bridge marks and shows exactly the same dots, with no browser marks of its own.
  const other = planReadMarks({ marks: first.marks, rooms, viewedIds: [], local: {}, adoptLocal: true })
  assert.deepEqual(other.diff, {})
  assert.deepEqual(rooms.filter(item => isUnread(item, other.marks)).map(item => item.id), ['c'])
})

test('a room the Bridge has never heard of starts as read, so a new device does not show a dot for every old reply', () => {
  const rooms = [room('a', { id: 'a1', createdAt: '2026-11-17T12:00:00Z' }), room('b')]
  const plan = planReadMarks({ marks: {}, rooms, viewedIds: [], local: {}, adoptLocal: true })
  assert.deepEqual(plan.diff, { a: '2026-11-17T12:00:00Z', b: '' })
  assert.equal(rooms.some(item => isUnread(item, plan.marks)), false)
})

test('a page in the background marks nothing as read, for this device or any other', async () => {
  const hook = await readFile(new URL('../src/utils/roomAttention.ts', import.meta.url), 'utf8')
  assert.match(hook, /const reading = pageVisible \? viewedIds : \[\]/, 'rooms count as read only while the page is visible')
  assert.match(hook, /planReadMarks\(\{ marks: shared\.marks, rooms, viewedIds: reading,/, 'the shared plan uses it')
  assert.match(hook, /advanceReadMarks\(marks, rooms, reading\)/, 'and so does the browser-only fallback')
  assert.match(hook, /if \(!shared\.ready\) \{ adopted\.current = false; return; \}/, 'nothing is decided before the Bridge has said what it holds')
  // With no room on screen the plan reports nothing, so another device keeps its dots.
  const rooms = [room('a', { id: 'a2', createdAt: '2026-11-17T12:00:00Z' })]
  assert.deepEqual(planReadMarks({ marks: { a: '2026-11-17T11:00:00Z' }, rooms, viewedIds: [], local: {}, adoptLocal: false }).diff, {})
})
