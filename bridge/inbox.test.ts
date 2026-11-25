import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InboxPanel } from '../src/components/InboxPanel'
import { inboxKind, listInbox } from './inbox'
import { imageContentType, resolveReadable } from './file-reader'
import { fileLocation } from '../src/utils/filePaths'

async function inbox() {
  const base = await mkdtemp(join(tmpdir(), 'inbox-'))
  const root = join(base, 'Inbox')
  await mkdir(join(root, '奏', 'task-old'), { recursive: true })
  await mkdir(join(root, '奏', 'task-new'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await writeFile(join(root, '奏', 'task-new', 'HANDOFF.md'), '# done')
  await writeFile(join(root, '奏', 'task-new', 'a-shot.png'), 'x')
  await writeFile(join(root, '奏', 'task-new', 'clip.mov'), 'x')
  await writeFile(join(root, '奏', 'task-new', 'data.bin'), 'x')
  await writeFile(join(root, '奏', 'task-new', '.secret.md'), 'x')
  await utimes(join(root, '奏', 'task-old'), new Date('2026-01-01'), new Date('2026-01-01'))
  await utimes(join(root, '奏', 'task-new'), new Date('2026-11-19'), new Date('2026-11-19'))
  return { base, root }
}

test('the Inbox lists folders newest first, the handoff first among files, with the kind of each file, and no hidden entries', async () => {
  const { base, root } = await inbox()
  try {
    const top = await listInbox(root)
    assert.deepEqual(top.dirs.map(dir => dir.name), ['奏'])
    assert.equal(top.parent, null)
    const persona = await listInbox(root, join(top.root, '奏'))
    assert.deepEqual(persona.dirs.map(dir => dir.name), ['task-new', 'task-old'], 'newest first')
    assert.equal(persona.parent, top.root)
    const task = await listInbox(root, join(top.root, '奏', 'task-new'))
    assert.deepEqual(task.files.map(file => [file.name, file.kind]), [['HANDOFF.md', 'text'], ['a-shot.png', 'image'], ['clip.mov', 'video'], ['data.bin', 'other']])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('nothing outside the Inbox can be listed, also through a symlink or a relative path', async () => {
  const { base, root } = await inbox()
  try {
    await mkdir(join(base, 'outside'))
    await symlink(join(base, 'outside'), join(root, 'sneaky'))
    await assert.rejects(listInbox(root, base), /不在 Inbox 內/)
    await assert.rejects(listInbox(root, join(root, 'sneaky')), /不在 Inbox 內/)
    await assert.rejects(listInbox(root, '奏'), /絕對路徑/)
    assert.deepEqual((await listInbox(root)).dirs.map(dir => dir.name), ['奏'], 'the symlink out is not listed')
    assert.deepEqual(await listInbox(join(base, 'missing')), { root: join(base, 'missing'), path: join(base, 'missing'), parent: null, dirs: [], files: [] }, 'no Inbox yet is just empty')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('images can be opened through the media route, and a chat path to one becomes a button', async () => {
  assert.equal(inboxKind('x.PNG'), 'image')
  assert.equal(imageContentType('a.jpeg'), 'image/jpeg')
  const { base, root } = await inbox()
  try {
    const real = await resolveReadable(join(root, '奏', 'task-new', 'a-shot.png'), [root], 'media')
    assert.match(real, /a-shot\.png$/)
    await assert.rejects(resolveReadable(join(root, '奏', 'task-new', 'data.bin'), [root], 'media'), /影片或 .*圖片/)
  } finally { await rm(base, { recursive: true, force: true }) }
  assert.deepEqual(fileLocation('/Volumes/Komorebi/Inbox/奏/t/shot.png', true), { path: '/Volumes/Komorebi/Inbox/奏/t/shot.png' })
  assert.equal(fileLocation('/Volumes/Komorebi/Inbox/奏/t/shot.png', false), undefined, 'an old Bridge cannot serve it')
})

test('the Inbox panel renders a title and its states', () => {
  const html = renderToStaticMarkup(createElement(InboxPanel, { call: (() => new Promise(() => {})) as never, onOpen: () => {}, mediaSupported: true, onClose: () => {}, rooms: [], connected: true, onRoom: () => {} }))
  assert.match(html, /aria-label="Inbox"/)
  assert.match(html, /role="status"/, 'loading first')
})

test('pending view shows current approval and question but no decision controls; resolved items disappear', () => {
  const base = { call: (() => new Promise(() => {})) as never, onOpen: () => {}, mediaSupported: true, onClose: () => {}, connected: true, initialPending: true, onRoom: () => {}, alerts: { alerts: [], incomplete: false } };
  const rooms = [{ id: 'r', roomName: '測試房', pendingApproval: { id: 'a' }, pendingQuestion: { id: 'q' } }] as never;
  const html = renderToStaticMarkup(createElement(InboxPanel, { ...base, rooms }));
  assert.match(html, /等待審批/); assert.match(html, /等待回答/); assert.match(html, /測試房/);
  assert.doesNotMatch(html, /批准|拒絕|刪除/);
  const resolved = renderToStaticMarkup(createElement(InboxPanel, { ...base, rooms: [] }));
  assert.doesNotMatch(resolved, /等待審批|等待回答/); assert.match(resolved, /目前沒有待處理項目/);
  const unknown = renderToStaticMarkup(createElement(InboxPanel, { ...base, rooms: [], alerts: { alerts: [], incomplete: true } }));
  assert.match(unknown, /未能完整檢查/); assert.doesNotMatch(unknown, /目前沒有待處理項目/);
});
