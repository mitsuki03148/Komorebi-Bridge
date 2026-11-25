import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderSetting, listDirectories } from './folder-setting';
import { FolderPicker } from '../src/components/FolderPicker';

async function sandbox(run: (dir: string) => Promise<void>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-folder-')));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the default folder is the workspace until one is saved, and a saved one is used after a restart', () => sandbox(async dir => {
  const work = join(dir, 'work'); await mkdir(work);
  const setting = new FolderSetting(join(dir, 'settings.json'), dir);
  assert.equal(setting.get(), dir);
  assert.equal(await setting.set(work), work);
  assert.equal(setting.get(), work);
  assert.equal(new FolderSetting(join(dir, 'settings.json'), dir).get(), work);
}));

test('a folder that is not absolute, missing, or a file is refused and the old one stays', () => sandbox(async dir => {
  const setting = new FolderSetting(join(dir, 'settings.json'), dir);
  await writeFile(join(dir, 'file.txt'), 'x');
  await assert.rejects(setting.set('relative/path'), /絕對路徑/);
  await assert.rejects(setting.set(join(dir, 'nope')), /找不到/);
  await assert.rejects(setting.set(join(dir, 'file.txt')), /資料夾/);
  await assert.rejects(setting.set(''), /絕對路徑/);
  assert.equal(setting.get(), dir);
}));

test('a saved folder that has gone away falls back to the workspace, and a broken settings file is ignored', () => sandbox(async dir => {
  const work = join(dir, 'work'); await mkdir(work);
  const file = join(dir, 'settings.json');
  await new FolderSetting(file, dir).set(work);
  await rm(work, { recursive: true });
  assert.equal(new FolderSetting(file, dir).get(), dir);
  await writeFile(file, '{not json');
  assert.equal(new FolderSetting(file, dir).get(), dir);
}));

test('a symlinked folder is saved as its real path', () => sandbox(async dir => {
  const real = join(dir, 'real'); await mkdir(real);
  await symlink(real, join(dir, 'link'));
  assert.equal(await new FolderSetting(join(dir, 's.json'), dir).set(join(dir, 'link')), real);
}));

test('listing a folder gives its sub-folders only, sorted, without hidden ones, and the parent to go up to', () => sandbox(async dir => {
  for (const name of ['beta', 'Alpha', '.hidden', 'gamma']) await mkdir(join(dir, name));
  await writeFile(join(dir, 'file.txt'), 'x');
  const listing = await listDirectories(dir);
  assert.equal(listing.path, dir);
  assert.deepEqual(listing.dirs, ['Alpha', 'beta', 'gamma']);
  assert.equal(listing.parent, join(dir, '..').replace(/\/$/, '') || '/');
  assert.equal((await listDirectories('/')).parent, null, 'the top has nothing above it');
  await assert.rejects(listDirectories(join(dir, 'missing')), /找不到/);
  await assert.rejects(listDirectories('relative'), /絕對路徑/);
}));

test('the folder can be typed or browsed, on the phone as well', () => {
  const html = renderToStaticMarkup(createElement(FolderPicker, { value: '/Volumes/Komorebi', label: '工作資料夾', onChange: () => {}, onBrowse: () => {} }));
  assert.match(html, /<input[^>]*value="\/Volumes\/Komorebi"/);
  assert.match(html, /aria-label="瀏覽資料夾"/);
  assert.doesNotMatch(html, /data-folder-browser/, 'the browser stays closed until asked for');
});

test('the browser lists the sub-folders it was given and offers to go up and to use the folder', () => {
  const html = renderToStaticMarkup(createElement(FolderPicker, { value: '/a', label: '工作資料夾', onChange: () => {}, onBrowse: () => {},
    listing: { path: '/a/b', parent: '/a', dirs: ['x', 'y'] }, browsing: true }));
  assert.match(html, /\/a\/b/);
  assert.match(html, />x</);
  assert.match(html, />y</);
  assert.match(html, /上一層/);
  assert.match(html, /用這個資料夾/);
});

test('tapping a sub-folder only opens it; the folder is chosen with the "use this folder" button', () => {
  const html = renderToStaticMarkup(createElement(FolderPicker, { value: '/a', label: '工作資料夾', onChange: () => {}, onBrowse: () => {},
    listing: { path: '/a/b', parent: '/a', dirs: ['x'] }, browsing: true }));
  assert.doesNotMatch(html, /選擇資料夾 x/);
  assert.match(html, /用這個資料夾/);
});

test('browsing with a limit never goes above it, and a folder outside lists the limit itself', () => sandbox(async dir => {
  const root = join(dir, 'ws'); const child = join(root, 'repo'); const outside = join(dir, 'other');
  await mkdir(child, { recursive: true }); await mkdir(outside);
  const top = await listDirectories(root, false, root);
  assert.equal(top.parent, null, 'no "up" at the limit');
  assert.deepEqual(top.dirs, ['repo']);
  assert.equal((await listDirectories(child, false, root)).parent, root);
  assert.equal((await listDirectories(outside, false, root)).path, root, 'outside lists the limit');
  assert.equal((await listDirectories(dir, false, root)).path, root, 'the parent of the limit is outside too');
  assert.equal((await listDirectories(dir)).path, dir, 'without a limit nothing changes');
}));

test('a link under the limit that points elsewhere still opens, and keeps the path it was reached through', () => sandbox(async dir => {
  const root = join(dir, 'ws'); const elsewhere = join(dir, 'disk'); const inner = join(elsewhere, 'inner');
  await mkdir(root, { recursive: true }); await mkdir(inner, { recursive: true });
  await symlink(elsewhere, join(root, 'alias'));
  const opened = await listDirectories(join(root, 'alias'), false, root);
  assert.equal(opened.path, join(root, 'alias'), 'not jumped back to the limit');
  assert.deepEqual(opened.dirs, ['inner']);
  assert.equal(opened.parent, root, 'up goes back to the folder it sits in');
  const deeper = await listDirectories(join(root, 'alias', 'inner'), false, root);
  assert.equal(deeper.path, join(root, 'alias', 'inner'));
  assert.equal(deeper.parent, join(root, 'alias'));
}));
