import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lstat, mkdir, readdir, readFile as readRaw, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Drive, type DriveEnv } from './drive';

/** A fake Drive for desktop: two accounts, a shared folder reached through a symlink, hidden folders that must stay hidden. */
async function sandbox(run: (env: DriveEnv, root: string, base: string) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-drive-')));
  const home = join(base, 'home'), workspace = join(base, 'ws');
  const root = join(home, 'Library/CloudStorage/GoogleDrive-me@example.com');
  const other = join(home, 'Library/CloudStorage/GoogleDrive-aaa@example.com');
  await mkdir(join(root, 'My Drive'), { recursive: true }); await mkdir(join(other, 'My Drive'), { recursive: true }); await mkdir(workspace);
  await mkdir(join(root, '.shortcut-targets-by-id/abc/Team'), { recursive: true });
  await symlink(join(root, '.shortcut-targets-by-id/abc/Team'), join(root, 'My Drive/Team'));
  await mkdir(join(root, '.Trash')); await mkdir(join(root, '.tmp'));
  await writeFile(join(root, '.Trash/gone.md'), 'x');
  const ids = new Map<string, string>();
  const io = {
    read: async (path: string, limit: number) => (await readRaw(path)).subarray(0, limit),
    write: async (path: string, data: Buffer) => { await writeFile(path, data); },
  };
  const revealed: string[] = [];
  const env: DriveEnv = { home, workspace, io, itemId: async path => ids.get(path), reveal: async path => { revealed.push(path); }, now: () => 1_000_000 };
  (env as DriveEnv & { ids: Map<string, string>; revealed: string[] }).ids = ids;
  (env as DriveEnv & { revealed: string[] }).revealed = revealed;
  try { await run(env, root, base); } finally { await rm(base, { recursive: true, force: true }); }
}
const A = 'me@example.com';

test('every mounted Drive account is found, and the one with a shared team folder comes first', () => sandbox(async env => {
  const drive = new Drive(env);
  const result = await drive.call('accounts', {}) as { accounts: { id: string }[] };
  assert.deepEqual(result.accounts.map(account => account.id), [A, 'aaa@example.com']);
}));

test('a folder lists its items, folders first, with type, size and time; hidden items and Drive internals are never shown', () => sandbox(async (env, root) => {
  await mkdir(join(root, 'My Drive/Docs'));
  await writeFile(join(root, 'My Drive/b.md'), '# hi'); await writeFile(join(root, 'My Drive/a.txt'), 'abc'); await writeFile(join(root, 'My Drive/x.gdoc'), '{}');
  await writeFile(join(root, 'My Drive/photo.jpg'), 'jpg'); await writeFile(join(root, 'My Drive/.hidden'), 'h');
  const drive = new Drive(env);
  const list = await drive.call('list', { account: A, path: 'My Drive' }) as { path: string; parent: string | null; entries: { name: string; type: string; size: number; textual?: boolean }[] };
  assert.deepEqual(list.entries.map(entry => [entry.name, entry.type]), [['Docs', 'dir'], ['Team', 'dir'], ['a.txt', 'file'], ['b.md', 'file'], ['photo.jpg', 'file'], ['x.gdoc', 'native']]);
  assert.equal(list.entries.find(entry => entry.name === 'b.md')?.textual, true);
  assert.equal(list.entries.find(entry => entry.name === 'photo.jpg')?.textual, false);
  assert.equal(list.parent, '');
  const top = await drive.call('list', { account: A, path: '' }) as { entries: { name: string }[]; parent: string | null };
  assert.deepEqual(top.entries.map(entry => entry.name), ['My Drive'], 'only My Drive at the top; .Trash, .tmp and the shortcut store stay out of sight');
  assert.equal(top.parent, null);
}));

test('the shared team folder is reached through its symlink, and its real location may hide in .shortcut-targets-by-id, but nothing else hidden opens', () => sandbox(async (env, root) => {
  await writeFile(join(root, '.shortcut-targets-by-id/abc/Team/notes.md'), '共用筆記');
  const drive = new Drive(env);
  const list = await drive.call('list', { account: A, path: 'My Drive/Team' }) as { entries: { name: string }[] };
  assert.deepEqual(list.entries.map(entry => entry.name), ['notes.md']);
  const file = await drive.call('read', { account: A, path: 'My Drive/Team/notes.md' }) as { text: string };
  assert.equal(file.text, '共用筆記');
  for (const path of ['.Trash', '.Trash/gone.md', '.tmp', 'My Drive/../.Trash', '../x', 'My Drive/.hidden', '/etc', 'My Drive//a', 'My Drive/a\u0000b'])
    await assert.rejects(drive.call('list', { account: A, path }), Error, path);
  await symlink(join(root, '.Trash'), join(root, 'My Drive/sneaky'));
  await assert.rejects(drive.call('list', { account: A, path: 'My Drive/sneaky' }), /不開放|範圍/, 'a link into a hidden Drive folder is refused');
  await symlink(join(root, '..'), join(root, 'My Drive/outside'));
  await assert.rejects(drive.call('list', { account: A, path: 'My Drive/outside' }), /範圍/, 'a link out of the account is refused');
  await assert.rejects(drive.call('list', { account: 'nobody@example.com', path: 'My Drive' }), /帳戶/);
  await assert.rejects(drive.call('list', { account: '../x', path: 'My Drive' }), Error);
}));

test('a text file is read, with its time and size for the edit check; a big one is cut; a binary one is refused', () => sandbox(async (env, root) => {
  await writeFile(join(root, 'My Drive/a.md'), '# 標題\n內容');
  await writeFile(join(root, 'My Drive/big.txt'), 'a'.repeat(400_500));
  await writeFile(join(root, 'My Drive/bin.json'), Buffer.from([0x7b, 0, 0x7d]));
  await writeFile(join(root, 'My Drive/pic.png'), 'png');
  const drive = new Drive(env);
  const small = await drive.call('read', { account: A, path: 'My Drive/a.md' }) as { text: string; truncated: boolean; editable: boolean; mtimeMs: number; size: number };
  assert.equal(small.text, '# 標題\n內容');
  assert.equal(small.editable, true);
  assert.equal(small.size, Buffer.byteLength('# 標題\n內容'));
  assert.equal(typeof small.mtimeMs, 'number');
  const big = await drive.call('read', { account: A, path: 'My Drive/big.txt' }) as { truncated: boolean; editable: boolean; text: string };
  assert.equal(big.truncated, true);
  assert.equal(big.editable, false, 'a cut file is never edited');
  assert.ok(big.text.length <= 400_000);
  await assert.rejects(drive.call('read', { account: A, path: 'My Drive/bin.json' }), /二進位/);
  await assert.rejects(drive.call('read', { account: A, path: 'My Drive/pic.png' }), /文字檔/);
  await assert.rejects(drive.call('read', { account: A, path: 'My Drive' }), /不是檔案/);
}));

test('a link is built from the Drive id: files, folders and each kind of Google document', () => sandbox(async (env, root) => {
  await mkdir(join(root, 'My Drive/Docs')); await writeFile(join(root, 'My Drive/a.md'), 'x'); await writeFile(join(root, 'My Drive/s.gsheet'), '{}'); await writeFile(join(root, 'My Drive/d.gdoc'), '{}'); await writeFile(join(root, 'My Drive/p.gslides'), '{}');
  const ids = (env as DriveEnv & { ids: Map<string, string> }).ids;
  ids.set(join(root, 'My Drive/Docs'), 'FOLDER1'); ids.set(join(root, 'My Drive/a.md'), 'FILE1'); ids.set(join(root, 'My Drive/s.gsheet'), 'SHEET1'); ids.set(join(root, 'My Drive/d.gdoc'), 'DOC1'); ids.set(join(root, 'My Drive/p.gslides'), 'SLIDE1');
  const drive = new Drive(env);
  const link = async (path: string) => (await drive.call('link', { account: A, path }) as { url: string; localPath: string }).url;
  assert.equal(await link('My Drive/Docs'), 'https://drive.google.com/drive/folders/FOLDER1');
  assert.equal(await link('My Drive/a.md'), 'https://drive.google.com/file/d/FILE1/view');
  assert.equal(await link('My Drive/d.gdoc'), 'https://docs.google.com/document/d/DOC1/edit');
  assert.equal(await link('My Drive/s.gsheet'), 'https://docs.google.com/spreadsheets/d/SHEET1/edit');
  assert.equal(await link('My Drive/p.gslides'), 'https://docs.google.com/presentation/d/SLIDE1/edit');
  await writeFile(join(root, 'My Drive/noid.md'), 'x');
  await assert.rejects(drive.call('link', { account: A, path: 'My Drive/noid.md' }), /連結/, 'no id yet (not synced): says so');
  const local = await drive.call('link', { account: A, path: 'My Drive/a.md' }) as { localPath: string };
  assert.equal(local.localPath, join(root, 'My Drive/a.md'));
}));

test('saving a text file keeps a backup of what was there, refuses when it changed meanwhile, and never creates or resizes beyond the limit', () => sandbox(async (env, root, base) => {
  const file = join(root, 'My Drive/a.md');
  await writeFile(file, '舊內容');
  const drive = new Drive(env);
  const first = await drive.call('read', { account: A, path: 'My Drive/a.md' }) as { mtimeMs: number; size: number };
  const saved = await drive.call('write', { account: A, path: 'My Drive/a.md', text: '新內容', base: { mtimeMs: first.mtimeMs, size: first.size } }) as { mtimeMs: number; size: number };
  assert.equal(await readRaw(file, 'utf8'), '新內容');
  assert.equal(saved.size, Buffer.byteLength('新內容'));
  const backups = join(base, 'ws/.komorebi-drive-backups');
  const kept = (await readdir(backups, { recursive: true })).filter(name => String(name).endsWith('.bak'));
  assert.equal(kept.length, 1);
  assert.equal(await readRaw(join(backups, String(kept[0])), 'utf8'), '舊內容');
  // Someone else changes the file after it was read: the save is refused and the file is left alone.
  await writeFile(file, '別人改過');
  await utimes(file, new Date(2030, 0, 1), new Date(2030, 0, 1));
  await assert.rejects(drive.call('write', { account: A, path: 'My Drive/a.md', text: '我的', base: { mtimeMs: saved.mtimeMs, size: saved.size } }), /已被更改/);
  assert.equal(await readRaw(file, 'utf8'), '別人改過');
  const now = await stat(file);
  await assert.rejects(drive.call('write', { account: A, path: 'My Drive/new.md', text: 'x', base: { mtimeMs: 1, size: 1 } }), /找不到/, 'saving never creates a file');
  await assert.rejects(drive.call('write', { account: A, path: 'My Drive/a.md', text: 'x'.repeat(400_001), base: { mtimeMs: now.mtimeMs, size: now.size } }), /太大/);
  await writeFile(join(root, 'My Drive/pic.png'), 'png');
  const png = await stat(join(root, 'My Drive/pic.png'));
  await assert.rejects(drive.call('write', { account: A, path: 'My Drive/pic.png', text: 'x', base: { mtimeMs: png.mtimeMs, size: png.size } }), /文字檔/);
}));

test('only the newest 20 backups of a file are kept', () => sandbox(async (env, root, base) => {
  const file = join(root, 'My Drive/a.md');
  await writeFile(file, 'v0');
  let tick = 1_000_000;
  const drive = new Drive({ ...env, now: () => (tick += 1000) });
  let state = await drive.call('read', { account: A, path: 'My Drive/a.md' }) as { mtimeMs: number; size: number };
  for (let i = 1; i <= 25; i++) state = await drive.call('write', { account: A, path: 'My Drive/a.md', text: `v${i}`, base: { mtimeMs: state.mtimeMs, size: state.size } }) as typeof state;
  const kept = (await readdir(join(base, 'ws/.komorebi-drive-backups'), { recursive: true })).filter(name => String(name).endsWith('.bak'));
  assert.equal(kept.length, 20);
}));

test('moving puts an item into another folder of the same account; it never overwrites, never moves a folder into itself, never leaves the account', () => sandbox(async (env, root) => {
  await mkdir(join(root, 'My Drive/A')); await mkdir(join(root, 'My Drive/B')); await mkdir(join(root, 'My Drive/A/inner'));
  await writeFile(join(root, 'My Drive/A/f.md'), 'f'); await writeFile(join(root, 'My Drive/B/f.md'), 'other');
  const drive = new Drive(env);
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/A/f.md', to: 'My Drive/B' }), /已有同名/);
  assert.equal(await readRaw(join(root, 'My Drive/B/f.md'), 'utf8'), 'other');
  assert.equal(await readRaw(join(root, 'My Drive/A/f.md'), 'utf8'), 'f');
  await writeFile(join(root, 'My Drive/A/g.md'), 'g');
  const moved = await drive.call('move', { account: A, from: 'My Drive/A/g.md', to: 'My Drive/B' }) as { path: string };
  assert.equal(moved.path, 'My Drive/B/g.md');
  assert.equal(await readRaw(join(root, 'My Drive/B/g.md'), 'utf8'), 'g');
  await assert.rejects(lstat(join(root, 'My Drive/A/g.md')));
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/A', to: 'My Drive/A/inner' }), /自己/);
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive', to: 'My Drive/B' }), /根/);
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/Team', to: 'My Drive/B' }), /捷徑/, 'a shared-folder shortcut is not moved');
  assert.ok(await lstat(join(root, 'My Drive/Team')), 'and it is still there');
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/B/f.md', to: 'My Drive/B/g.md' }), /資料夾/);
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/B/f.md', to: 'My Drive/missing' }), /找不到|資料夾/);
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/B/f.md', to: '.Trash' }), Error);
  await mkdir(join(root, '..', 'elsewhere'), { recursive: true });
}));

test('every save and move is written to a log with what was done and to which path', () => sandbox(async (env, root, base) => {
  await writeFile(join(root, 'My Drive/a.md'), 'a'); await mkdir(join(root, 'My Drive/B'));
  const drive = new Drive(env);
  const state = await drive.call('read', { account: A, path: 'My Drive/a.md' }) as { mtimeMs: number; size: number };
  await drive.call('write', { account: A, path: 'My Drive/a.md', text: 'b', base: { mtimeMs: state.mtimeMs, size: state.size } });
  await drive.call('move', { account: A, from: 'My Drive/a.md', to: 'My Drive/B' });
  const lines = (await readRaw(join(base, 'ws/.komorebi-drive-log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => line.op), ['write', 'move']);
  assert.equal(lines[1].to, 'My Drive/B/a.md');
  assert.doesNotMatch(JSON.stringify(lines), /"text"/, 'the content is not logged');
}));

test('the local path of an item can be copied even before Drive has given it an id', () => sandbox(async (env, root) => {
  await writeFile(join(root, 'My Drive/new.md'), 'x');
  const drive = new Drive(env);
  assert.deepEqual(await drive.call('path', { account: A, path: 'My Drive/new.md' }), { localPath: join(root, 'My Drive/new.md') });
  await assert.rejects(drive.call('path', { account: A, path: '.Trash/gone.md' }), Error);
}));

test('Finder is asked to show the real path of an item, and only for an item inside the account', () => sandbox(async (env, root) => {
  await writeFile(join(root, 'My Drive/a.md'), 'a');
  const drive = new Drive(env);
  await drive.call('reveal', { account: A, path: 'My Drive/a.md' });
  assert.deepEqual((env as DriveEnv & { revealed: string[] }).revealed, [join(root, 'My Drive/a.md')]);
  await assert.rejects(drive.call('reveal', { account: A, path: '.Trash/gone.md' }), Error);
}));

test('unknown operations are refused, and the server hands Drive requests to this module and answers with the result or the reason', async () => {
  await sandbox(async env => { await assert.rejects(new Drive(env).call('delete', { account: A, path: 'My Drive/a.md' }), /不支援/); });
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /new Drive\(/);
  assert.match(server, /event\?\.type === 'DRIVE'[\s\S]{0,500}drive\.call\(/);
  assert.match(server, /type: 'DRIVE_RESULT'/);
  const source = await readFile(new URL('./drive.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(unlink|rm|rmdir|trash)\b\s*\(/, 'nothing in the module deletes');
});

test('two moves of different items with the same name into one folder: one wins, the other is refused, and nothing is lost', () => sandbox(async (env, root) => {
  await mkdir(join(root, 'My Drive/One')); await mkdir(join(root, 'My Drive/Two')); await mkdir(join(root, 'My Drive/Dest'));
  await writeFile(join(root, 'My Drive/One/note.md'), 'from one'); await writeFile(join(root, 'My Drive/Two/note.md'), 'from two');
  const drive = new Drive(env);
  const results = await Promise.allSettled([
    drive.call('move', { account: A, from: 'My Drive/One/note.md', to: 'My Drive/Dest' }),
    drive.call('move', { account: A, from: 'My Drive/Two/note.md', to: 'My Drive/Dest' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  const stayed = (await Promise.all(['One', 'Two'].map(dir => readdir(join(root, 'My Drive', dir))))).flat();
  assert.equal(stayed.length, 1, 'the refused item is still where it was');
  assert.equal((await readdir(join(root, 'My Drive/Dest'))).length, 1);
}));

test('a move uses the system call that refuses to replace when the io offers it', () => sandbox(async (env, root) => {
  await mkdir(join(root, 'My Drive/Dest')); await writeFile(join(root, 'My Drive/a.md'), 'a');
  const seen: string[] = [];
  const drive = new Drive({ ...env, io: { ...env.io!, move: async (source, target) => { seen.push(`${source}>${target}`); return 'exists'; } } });
  await assert.rejects(drive.call('move', { account: A, from: 'My Drive/a.md', to: 'My Drive/Dest' }), /同名/);
  assert.equal(seen.length, 1);
  assert.equal(await readFile(join(root, 'My Drive/a.md'), 'utf8'), 'a', 'the source is untouched');
}));

test('two saves on the same base: one wins and the other is told the file changed', () => sandbox(async (env, root) => {
  await writeFile(join(root, 'My Drive/n.md'), 'start');
  const drive = new Drive(env);
  const opened = await drive.call('read', { account: A, path: 'My Drive/n.md' }) as { mtimeMs: number; size: number };
  const base = { mtimeMs: opened.mtimeMs, size: opened.size };
  const results = await Promise.allSettled([
    drive.call('write', { account: A, path: 'My Drive/n.md', text: 'first edit', base }),
    drive.call('write', { account: A, path: 'My Drive/n.md', text: 'second edit', base }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(await readFile(join(root, 'My Drive/n.md'), 'utf8'), winner === 0 ? 'first edit' : 'second edit');
}));

test('a save that wrote only part of the text is not reported as saved', () => sandbox(async (env, root) => {
  await writeFile(join(root, 'My Drive/n.md'), 'start');
  const drive = new Drive({ ...env, io: { ...env.io!, write: async (path, data) => { await writeFile(path, data.subarray(0, 3)); } } });
  const opened = await drive.call('read', { account: A, path: 'My Drive/n.md' }) as { mtimeMs: number; size: number };
  await assert.rejects(drive.call('write', { account: A, path: 'My Drive/n.md', text: 'a longer text', base: { mtimeMs: opened.mtimeMs, size: opened.size } }), /一部分/);
}));
