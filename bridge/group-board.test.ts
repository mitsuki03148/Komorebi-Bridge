import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupBoardDialog, GroupBoardMenuItem } from '../src/components/GroupBoardMenu';
import type { ClientEvent } from '../src/types/bridge';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { FileOpenContext } from '../src/utils/fileOpen';
import { readTextFile } from './file-reader';
import { Groups } from './groups';

const rooms = [
  { id: 'light', modelId: 'CODEX', roomName: '工房', sessionId: '12345678-1234-1234-1234-123456789abc' },
  { id: 'echo', modelId: 'CLAUDE', roomName: '測試房', sessionId: '22345678-1234-1234-1234-123456789abc' },
] as const;
const members = rooms.map(({ id, modelId }) => ({ modelId, roomId: id }));
const getRoom = (id: string) => rooms.find(room => room.id === id) as TerminalRoom | undefined;
const boardNote = (path: string) => `　告示版：${path}。開工前讀一次。檔案頂部嘅 Rev 有更新，就重讀。`;

async function withGroups(run: (groups: Groups, fixture: { dir: string; storage: string; seen: GroupChat[] }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-board-'));
  const storage = join(dir, 'groups.json');
  const seen: GroupChat[] = [];
  try { await run(new Groups(storage, group => seen.push(group), getRoom), { dir, storage, seen }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('GROUP_SET_BOARD rejects malformed values without persisting or publishing', () => withGroups(async (groups, { storage, seen }) => {
  const { id } = groups.create('群組', members);
  const saved = await readFile(storage, 'utf8');
  seen.length = 0;
  for (const path of [undefined, 3, '', 'relative.md', '~/Board.md', '/board\n.md', '/board\r.md', '/board\0.md',
    '/board\u2028.md', '/board\t.md', '/board\x1b.md', '/' + 'a'.repeat(1024)]) {
    assert.throws(() => groups.setBoard(id, path), /告示版路徑無效/);
  }
  assert.throws(() => groups.setBoard('missing', '/Board.md'), /找不到/);
  assert.throws(() => groups.setBoard(null, '/Board.md'), /群組無效/);
  assert.equal(groups.get(id)?.boardPath, undefined);
  assert.equal(await readFile(storage, 'utf8'), saved);
  assert.deepEqual(seen, []);
}));

test('setting, changing and clearing the board publishes and persists; the reader can open a path with spaces', () => withGroups(async (groups, { dir, storage, seen }) => {
  const { id, name } = groups.create('群組', members);
  const fullLength = '/' + 'a'.repeat(1023);
  const path = join(dir, '群組告示 Board.md');
  const reopen = () => new Groups(storage, () => {}, getRoom);
  seen.length = 0;
  for (const value of [fullLength, path]) {
    const event: Extract<ClientEvent, { type: 'GROUP_SET_BOARD' }> = { type: 'GROUP_SET_BOARD', groupId: id, path: value };
    assert.equal(groups.setBoard(event.groupId, event.path).boardPath, value);
    assert.equal(reopen().get(id)?.boardPath, value);
  }
  await assert.rejects(readTextFile(path, [dir]), /找不到這個檔案/);
  await writeFile(path, 'Rev 3\n# 告示');
  assert.equal((await readTextFile(path, [dir])).text, 'Rev 3\n# 告示');
  groups.setBoard(id, path); // The same path does not need another broadcast.
  assert.equal(groups.setBoard(id, null).boardPath, undefined);
  assert.equal(reopen().get(id)?.boardPath, undefined);
  assert.equal((await readFile(path, 'utf8')), 'Rev 3\n# 告示', 'clearing a reference never edits the file');
  assert.deepEqual(seen.map(group => [group.id, group.name, group.boardPath]), [[id, name, fullLength], [id, name, path], [id, name, undefined]]);
}));

function roster(groups: Groups, id: string, roomId: string = rooms[0].id) {
  const reservation = groups.reserveRoster(id, roomId)!;
  reservation.finish(false);
  return reservation.suffix;
}

test('legacy groups load unchanged and add the note to whichever member gets the roster', () => withGroups(async (_groups, { storage }) => {
  await writeFile(storage, JSON.stringify([{ id: 'legacy', name: '舊群組', createdAt: '', members }]));
  const groups = new Groups(storage, () => {}, getRoom);
  assert.deepEqual(groups.get('legacy')?.members, members);
  assert.equal(groups.get('legacy')?.boardPath, undefined);
  const original = rooms.map(room => roster(groups, 'legacy', room.id));
  assert.ok(original.every(suffix => !suffix.includes('告示版')));
  const path = '/Volumes/Komorebi/告示版 Playbook.md';
  groups.setBoard('legacy', path);
  rooms.forEach((room, i) => assert.equal(roster(groups, 'legacy', room.id), original[i] + boardNote(path)));
  groups.setBoard('legacy', null);
  rooms.forEach((room, i) => assert.equal(roster(groups, 'legacy', room.id), original[i]));
}));

test('disabling Board hides its path from snapshots and roster without changing saved state', () => withGroups(async (groups, { storage }) => {
  const { id } = groups.create('group', members);
  groups.setBoard(id, '/workspace/Board.md');
  const original = await readFile(storage, 'utf8');
  groups.boardEnabled = false;
  assert.equal(groups.visible(groups.get(id)!).boardPath, undefined);
  assert.equal(groups.visibleSnapshot()[0].boardPath, undefined);
  assert.doesNotMatch(roster(groups, id), /告示版/);
  assert.equal(await readFile(storage, 'utf8'), original);
  groups.rename(id, 'renamed');
  assert.equal(JSON.parse(await readFile(storage, 'utf8'))[0].boardPath, '/workspace/Board.md');
  groups.boardEnabled = true;
  assert.equal(groups.get(id)?.boardPath, '/workspace/Board.md');
}));

test('group menu and editor show the configured path; the editor keeps mobile placement and text size', () => {
  const path = '/Volumes/Komorebi/廣場 & 告示.md';
  const menu = (value?: string) => renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} },
    createElement(GroupBoardMenuItem, { path: value, onEdit() {}, onOpen() {} })));
  assert.match(menu(), /告示版…/);
  assert.doesNotMatch(menu(), /開啟告示版/);
  assert.match(menu(path), /廣場 &amp; 告示\.md[\s\S]*開啟告示版/);
  const editor = (value?: string) => renderToStaticMarkup(createElement(GroupBoardDialog, { name: '群組', path: value, boardRoot: '/workspace', onSave() {}, onCancel() {} }));
  const saved = editor(path);
  assert.match(saved, /items-start[^"\n]+pt-\[12dvh\][^"\n]+sm:items-center/);
  assert.match(saved, /<input[^>]*text-\[16px\][^>]*value="\/Volumes\/Komorebi\/廣場 &amp; 告示\.md"/);
  assert.match(saved, /清除[\s\S]*儲存/);
  assert.doesNotMatch(editor(), /清除/);
});
