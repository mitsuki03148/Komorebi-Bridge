import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { followThreshold, nearBottom, ownMessageJump } from '../src/utils/scrollFollow'

test('a reader within a screen\'s worth of the bottom still follows the newest message', () => {
  const box = (fromBottom: number) => ({ scrollHeight: 2000, clientHeight: 600, scrollTop: 2000 - 600 - fromBottom })
  assert.equal(followThreshold, 200)
  assert.equal(nearBottom(box(0)), true)
  assert.equal(nearBottom(box(150)), true, 'a tall new message or a card above the message box no longer loses the reader')
  assert.equal(nearBottom(box(199)), true)
  assert.equal(nearBottom(box(200)), false)
  assert.equal(nearBottom(box(900)), false, 'someone reading far up is not pulled down')
})

test('the user\'s own new message takes them to the bottom, and nobody else\'s does', () => {
  assert.equal(ownMessageJump('a', { id: 'b', sender: 'user' }), true)
  assert.equal(ownMessageJump('a', { id: 'b', sender: 'agent' }), false)
  assert.equal(ownMessageJump('a', { id: 'b', sender: 'system' }), false)
  assert.equal(ownMessageJump('b', { id: 'b', sender: 'user' }), false, 'the same message is not a new one')
  assert.equal(ownMessageJump('a', undefined), false)
})

test('all three conversation boxes use the shared following rules and stay at the bottom when their content grows', async () => {
  for (const file of ['src/utils/useConversationScroll.ts', 'src/components/GroupChat.tsx']) {
    const source = await readFile(file, 'utf8')
    assert.match(source, /nearBottom\(/, file)
    assert.match(source, /ownMessageJump\(/, file)
    assert.match(source, /useStayAtBottom\(/, file)
    assert.doesNotMatch(source, /< 80;/, `${file} must not keep the old 80px rule`)
  }
  for (const file of ['src/components/RightRoomWorkspace.tsx', 'src/App.tsx']) {
    assert.match(await readFile(file, 'utf8'), /useConversationScroll\([^\n]*logs\.at\(-1\)\)/, file)
  }
})
