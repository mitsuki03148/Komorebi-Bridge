import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilePicker } from '../src/components/FilePicker';
import { GroupChatView } from '../src/components/GroupChat';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';
import { FileOpenContext } from '../src/utils/fileOpen';
import { listDirectories } from './folder-setting';

test('file browsing lists supported text files without exposing hidden directories or names', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'komorebi-board-listing-'));
  try {
    const dir = await realpath(temp);
    await Promise.all(['Docs.md', '.hidden'].map(name => mkdir(join(dir, name))));
    await Promise.all(['Readme.md', 'Notes.MARKDOWN', 'Road map.txt', '.private.md', 'no.log', 'no.json', 'photo.png'].map(name => writeFile(join(dir, name), '')));
    await symlink(join(dir, '.hidden'), join(dir, 'Visible alias'));
    await symlink(join(dir, 'Docs.md'), join(dir, 'Public alias'));
    assert.deepEqual(await listDirectories(dir, true), {
      path: dir, parent: join(dir, '..'), dirs: ['Docs.md', 'Public alias'], files: ['Notes.MARKDOWN', 'Readme.md', 'Road map.txt'],
    });
    await assert.rejects(listDirectories(join(dir, 'Visible alias'), true), /隱藏/);
    await assert.rejects(listDirectories(join(dir, '.hidden'), true), /隱藏/);
    await assert.rejects(listDirectories('Docs.md', true), /絕對路徑/);
    assert.deepEqual((await listDirectories(dir)).dirs, ['Docs.md', 'Public alias', 'Visible alias'], 'ordinary folder picker retains its behavior');
    assert.equal((await listDirectories(dir)).files, undefined);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('the file listing has a 500-entry total and stable order before the cap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-board-limit-'));
  const filename = (index: number) => `B-${String(index).padStart(3, '0')}.md`;
  try {
    await mkdir(join(dir, 'A-folder'));
    await Promise.all(Array.from({ length: 505 }, (_, i) => writeFile(join(dir, filename(504 - i)), '')));
    const listing = await listDirectories(dir, true);
    assert.deepEqual(listing.dirs, ['A-folder']);
    assert.equal(listing.dirs.length + listing.files!.length, 500);
    assert.equal(listing.files?.[0], filename(0));
    assert.equal(listing.files?.at(-1), filename(498));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the group popover replaces all-member session IDs with the board filename and actions', () => {
  const room = { id: 'light', roomName: '工房', modelId: 'CODEX', logs: [], sessionId: 'full-session-identifier' } as unknown as TerminalRoom;
  const path = '/Volumes/Komorebi/Plan Files/Board.md';
  const html = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(GroupChatView, {
    name: '工房群', members: [{ roomId: room.id, modelId: room.modelId, room }], characters: INITIAL_CHARACTERS,
    boardPath: path, onChooseBoard() {}, onBack() {}, onSend() {}, onDecision() {}, onMenu() {},
  })));
  assert.doesNotMatch(html, /所有成員 Session ID|full-session-identifier/);
  assert.match(html, /data-group-popover[\s\S]*data-group-board-row[\s\S]*title="\/Volumes\/Komorebi\/Plan Files\/Board.md">Board.md<\/div>[\s\S]*開啟告示版[\s\S]*選擇告示版檔案/);
  const list = renderToStaticMarkup(createElement(FilePicker, {
    root: '/Volumes/Komorebi', listing: { path: '/Volumes/Komorebi/Plan Files', parent: '/Volumes/Komorebi', dirs: ['Next'], files: ['Board.md'] }, onBrowse() {}, onChoose() {},
  }));
  assert.match(list, /<button[^>]*min-h-9[^>]*>[\s\S]*?Next<\/span>/);
  assert.match(list, /<button[^>]*min-h-9[^>]*>[\s\S]*?Board.md<\/span>/);
});
