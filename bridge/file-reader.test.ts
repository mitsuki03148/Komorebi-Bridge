import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileReadLimit, readTextFile } from './file-reader';
import { fileLocation, linkFilePaths, readablePath } from '../src/utils/filePaths';
import { Markdown } from '../src/components/Markdown';
import { FileOpenContext } from '../src/utils/fileOpen';
import { FileViewer } from '../src/components/FileViewer';

async function sandbox(run: (root: string, outside: string) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-read-')));
  const root = join(base, 'root'), outside = join(base, 'outside');
  await mkdir(root); await mkdir(outside);
  try { await run(root, outside); } finally { await rm(base, { recursive: true, force: true }); }
}

test('a text file inside an allowed folder is read', () => sandbox(async root => {
  await mkdir(join(root, 'Review'));
  await writeFile(join(root, 'Review', 'HANDOFF.md'), '# 交接\n內容');
  const file = await readTextFile(join(root, 'Review', 'HANDOFF.md'), [root]);
  assert.equal(file.text, '# 交接\n內容');
  assert.equal(file.truncated, false);
  assert.equal(file.path, join(root, 'Review', 'HANDOFF.md'));
}));

test('only absolute paths to text-like files are read', () => sandbox(async root => {
  await writeFile(join(root, 'a.md'), 'x'); await writeFile(join(root, 'photo.png'), 'x'); await writeFile(join(root, 'secret'), 'x');
  await assert.rejects(readTextFile('a.md', [root]), /絕對路徑/);
  await assert.rejects(readTextFile(undefined, [root]), /絕對路徑/);
  await assert.rejects(readTextFile(join(root, 'photo.png'), [root]), /只可以開/);
  await assert.rejects(readTextFile(join(root, 'secret'), [root]), /只可以開/);
  await assert.rejects(readTextFile(join(root, 'missing.md'), [root]), /找不到/);
  await mkdir(join(root, 'dir.md'));
  await assert.rejects(readTextFile(join(root, 'dir.md'), [root]), /不是檔案/);
}));

test('a file outside the allowed folders is refused, including through ".." and through a symlink', () => sandbox(async (root, outside) => {
  await writeFile(join(outside, 'private.md'), 'secret');
  await assert.rejects(readTextFile(join(outside, 'private.md'), [root]), /範圍/);
  await assert.rejects(readTextFile(join(root, '..', 'outside', 'private.md'), [root]), /範圍/);
  await symlink(join(outside, 'private.md'), join(root, 'link.md'));
  await assert.rejects(readTextFile(join(root, 'link.md'), [root]), /範圍/);
  await symlink(outside, join(root, 'folder'));
  await assert.rejects(readTextFile(join(root, 'folder', 'private.md'), [root]), /範圍/);
}));

test('hidden folders and files are never read, even inside an allowed folder', () => sandbox(async root => {
  await mkdir(join(root, '.ssh')); await writeFile(join(root, '.ssh', 'notes.md'), 'x'); await writeFile(join(root, '.env.md'), 'x');
  await assert.rejects(readTextFile(join(root, '.ssh', 'notes.md'), [root]), /隱藏/);
  await assert.rejects(readTextFile(join(root, '.env.md'), [root]), /隱藏/);
}));

test('a very large file is cut at the limit and says so', () => sandbox(async root => {
  await writeFile(join(root, 'big.log'), 'a'.repeat(fileReadLimit + 500));
  const file = await readTextFile(join(root, 'big.log'), [root]);
  assert.equal(file.truncated, true);
  assert.equal(file.size, fileReadLimit + 500);
  assert.ok(file.text.length <= fileReadLimit + 4);
}));

test('absolute paths to readable files are found in a message, in or out of backticks, and never inside a code block', () => {
  assert.equal(readablePath('/Volumes/Komorebi/codex/worktree/x/Review/R1/HANDOFF.md'), true);
  assert.equal(readablePath('/Volumes/Komorebi/ExampleApp Repo/R5/Review/HANDOFF.md'), true, 'inside backticks a space is part of the path');
  assert.equal(linkFilePaths('看 /Users/me/Documents/a b.md'), '看 /Users/me/Documents/a b.md', 'bare text with a space stays plain');
  assert.equal(readablePath('/etc/passwd'), false);
  assert.equal(readablePath('/Volumes/K/a.png'), false);
  assert.equal(readablePath('Review/R1/HANDOFF.md'), false, 'a relative path cannot be opened');
  assert.equal(linkFilePaths('看 /Volumes/K/r/HANDOFF.md。'), '看 `/Volumes/K/r/HANDOFF.md`。');
  assert.equal(linkFilePaths('證據（/Volumes/K/raw/a.log），已核'), '證據（`/Volumes/K/raw/a.log`），已核');
  assert.equal(linkFilePaths('已經 `/Volumes/K/a.md` 係'), '已經 `/Volumes/K/a.md` 係', 'already code');
  assert.equal(linkFilePaths('```\ncat /Volumes/K/a.md\n```\n/Volumes/K/b.md'), '```\ncat /Volumes/K/a.md\n```\n`/Volumes/K/b.md`');
  assert.equal(linkFilePaths('網址 https://github.com/x/y/blob/s/Review/HANDOFF.md'), '網址 https://github.com/x/y/blob/s/Review/HANDOFF.md', 'a web link is left to the browser');
});

test('a readable path in a message becomes a button when a reader is available, and stays plain code otherwise', () => {
  const text = '完整記錄：/Volumes/K/r/HANDOFF.md，另 `/Users/me/x.log`';
  const withReader = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text })));
  assert.match(withReader, /<button[^>]*data-open-file="\/Volumes\/K\/r\/HANDOFF\.md"/);
  assert.match(withReader, /<button[^>]*data-open-file="\/Users\/me\/x\.log"/);
  assert.match(withReader, />HANDOFF\.md</, 'the button shows the file name');
  const without = renderToStaticMarkup(createElement(Markdown, { text }));
  assert.doesNotMatch(without, /data-open-file/);
  const fenced = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text: '```\n/Volumes/K/a.md\n```' })));
  assert.doesNotMatch(fenced, /data-open-file/);
});

test('the reader shows a Markdown file as a page, a log as plain text, and loading, errors and cut files plainly', () => {
  const md = renderToStaticMarkup(createElement(FileViewer, { path: '/Volumes/K/r/HANDOFF.md', file: { text: '# 標題\n\n| 項 | 值 |\n| - | - |\n| a | b |', truncated: false, size: 20 }, onClose() {} }));
  assert.match(md, /role="dialog"/);
  assert.match(md, /HANDOFF\.md/);
  assert.match(md, /<h3[^>]*>標題</);
  assert.match(md, /<table/);
  const log = renderToStaticMarkup(createElement(FileViewer, { path: '/Volumes/K/raw/a.log', file: { text: '# not a heading', truncated: true, size: 999999 }, onClose() {} }));
  assert.match(log, /<pre[^>]*>[^<]*# not a heading/);
  assert.doesNotMatch(log, /<h3 class="mt-3/, "a log is not rendered as Markdown");
  assert.match(log, /只顯示前/);
  assert.match(renderToStaticMarkup(createElement(FileViewer, { path: '/a.md', onClose() {} })), /讀取中/);
  assert.match(renderToStaticMarkup(createElement(FileViewer, { path: '/a.md', error: '找不到這個檔案。', onClose() {} })), /找不到這個檔案/);
});

test('the server answers READ_FILE from the workspace and Documents only, and the app wires the reader', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /READ_FILE[\s\S]{0,500}readTextFile\([\s\S]{0,120}workspace/);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<FileOpenContext\.Provider/);
  assert.match(app, /<FileViewer /);
  assert.match(app, /type: 'READ_FILE'/);
  assert.match(app, /event\.type === 'FILE'/);
});

test('"show in Finder" is offered on a computer only, and the server checks the path the same way before opening it', async () => {
  const props = { path: '/Volumes/K/a.md', file: { text: 'x', truncated: false, size: 1 }, onClose() {} };
  assert.match(renderToStaticMarkup(createElement(FileViewer, { ...props, onReveal() {} })), /aria-label="在 Finder 顯示"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(FileViewer, props)), /Finder/);
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /REVEAL_FILE[\s\S]{0,300}resolveReadable\([\s\S]{0,120}execFile\('open', \['-R', real\]/);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onReveal=\{streetMobileView \? undefined/);
  const { resolveReadable } = await import('./file-reader');
  await assert.rejects(resolveReadable('/etc/hosts.md', ['/Volumes/Komorebi']), /找不到|範圍/);
  await assert.rejects(resolveReadable('relative.md', ['/Volumes/Komorebi']), /絕對路徑/);
});

test('the roster Bridge adds to a first prompt is split off the Founder\'s words', async () => {
  const { splitBridgeNote, noteLines, startsWithBridgeNote, groupRosterPrefix } = await import('../src/utils/bridgeNote');
  const note = ' ===== 我哋而家係協作狀態，之後交接調配時可以用 CLI 聯絡。唔需要特別回應呢部分。 瞳：A (1)　光：B (2)　總指揮：B';
  const split = splitBridgeNote('回答你嘅問題：暫時唔方便' + note);
  assert.equal(split.main, '回答你嘅問題：暫時唔方便');
  assert.ok(split.note.startsWith('我哋而家係協作狀態'));
  assert.ok(noteLines(split.note).length >= 3);
  assert.deepEqual(splitBridgeNote('冇附加'), { main: '冇附加', note: '' });
  assert.equal(splitBridgeNote('即係 ===== 呢間係單人房，冇其他成員。').main, '即係');
  const short = ' ===== ' + groupRosterPrefix + '@review 響 · Fixture（123）';
  assert.deepEqual(splitBridgeNote('先核對' + short), { main: '先核對', note: short.trimStart().slice(6) });
  assert.ok(startsWithBridgeNote(note));
  assert.ok(startsWithBridgeNote(short));
  assert.ok(startsWithBridgeNote(' ===== 呢間係單人房，冇其他成員。'));
  assert.equal(startsWithBridgeNote(' 其他句子' + short), false);
  assert.deepEqual(splitBridgeNote('我寫了 ===== 這是分隔符'), { main: '我寫了 ===== 這是分隔符', note: '' });
});

test('a path written as a Markdown link, or with :line on the end, opens in the reader without the line', () => {
  const handoff = '/Volumes/Komorebi/Inbox/律/task/first-download/HANDOFF.md';
  for (const destination of [handoff, `<${handoff}>`]) {
    const source = `完成。[正式 HANDOFF](${destination})`;
    assert.equal(linkFilePaths(source), source);
    const markup = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text: source })));
    assert.ok(markup.includes(`data-open-file="${handoff}"`));
    assert.match(markup, />正式 HANDOFF</);
  }
  const link = '[Handoff](</Volumes/Komorebi/ExampleApp Repo/R5/Review/HANDOFF.md:716>)';
  const withReader = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text: `Evidence：${link}；完整讀` })));
  assert.match(withReader, /<button[^>]*data-open-file="\/Volumes\/Komorebi\/ExampleApp Repo\/R5\/Review\/HANDOFF\.md"/, 'the path with spaces, without :716');
  assert.match(withReader, />Handoff</, 'the button keeps the link text');
  // Without a reader the label stays plain text, as before.
  const without = renderToStaticMarkup(createElement(Markdown, { text: link }));
  assert.doesNotMatch(without, /data-open-file|<a /);
  assert.match(without, /Handoff/);
  // Web links are unchanged, and a path that is not a readable file is not made a button.
  const web = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text: '[site](https://example.com) [pic](</Volumes/K/a.png>) [x](javascript:alert(1))' })));
  assert.match(web, /<a href="https:\/\/example\.com"/);
  assert.doesNotMatch(web, /data-open-file/);
  assert.doesNotMatch(web, /href="javascript/);
  // A code span with a line number.
  const code = renderToStaticMarkup(createElement(FileOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text: '`/Volumes/K/r/HANDOFF.md:716` 同 `/Volumes/K/r/a.log:3:9`' })));
  assert.match(code, /data-open-file="\/Volumes\/K\/r\/HANDOFF\.md"/);
  assert.match(code, /data-open-file="\/Volumes\/K\/r\/a\.log"/);
  assert.deepEqual(fileLocation('/Volumes/K/a.md:12:3'), { path: '/Volumes/K/a.md', line: 12 });
  assert.deepEqual(fileLocation('/Volumes/K/a.md'), { path: '/Volumes/K/a.md' });
  assert.equal(fileLocation('/Volumes/K/a.png:1'), undefined);
  assert.equal(fileLocation('/Volumes/K/a.md:x'), undefined);
});
