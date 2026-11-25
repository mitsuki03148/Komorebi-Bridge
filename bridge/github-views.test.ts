import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommitDetail, CommitRows, CompareDetail, DiffView, DirRows, FileDetail, IssueDetail, IssueRows, ago } from '../src/components/github/views';

const noop = () => {};
const NOW = Date.parse('2026-11-15T12:00:00Z');
const issue = { number: 12, title: '儲存會當機', state: 'open', author: 'alice', labels: [{ name: 'bug', color: 'd73a4a' }], comments: 2, createdAt: '2026-11-14T12:00:00Z', updatedAt: '2026-11-15T11:00:00Z', body: '**重現**\n\n- 步驟一\n- 步驟二\n\n| a | b |\n| - | - |\n| 1 | 2 |' };

test('the issue list shows state, title, number, author, age, comment count and labels', () => {
  const html = renderToStaticMarkup(createElement(IssueRows, { issues: [issue, { ...issue, number: 13, state: 'closed', title: '舊問題', comments: 0 }], onOpen: noop, now: NOW }));
  assert.match(html, /data-issue-row="12"/);
  assert.match(html, /儲存會當機/);
  assert.match(html, /#12/);
  assert.match(html, /1 小時前/);
  assert.match(html, /data-issue-state="open"[^>]*>開啟/);
  assert.match(html, /data-issue-state="closed"[^>]*>已關閉/);
  assert.match(html, />bug</);
  assert.match(renderToStaticMarkup(createElement(IssueRows, { issues: [], onOpen: noop })), /沒有符合/);
});

test('an issue is shown as a page in the chat theme: Markdown body, each comment with its own link, a reply box, and the issue link to copy', () => {
  const html = renderToStaticMarkup(createElement(IssueDetail, { owner: 'o', repo: 'r', issue, comments: [{ id: 99, author: 'v', body: '我都撞到 `npm test`', createdAt: '2026-11-15T10:00:00Z' }], draft: '', onDraft: noop, onSend: noop, onBack: noop, now: NOW }));
  assert.match(html, /<strong[^>]*>重現</);
  assert.match(html, /<li[^>]*>[^<]*步驟一/);
  assert.match(html, /<table/);
  assert.match(html, /data-comment="99"/);
  assert.match(html, /<code[^>]*>npm test</);
  assert.match(html, /data-copy-link="https:\/\/github\.com\/o\/r\/issues\/12"/);
  assert.match(html, /data-copy-link="https:\/\/github\.com\/o\/r\/issues\/12#issuecomment-99"/);
  assert.match(html, /<form data-reply/);
  assert.match(html, /<textarea/);
  assert.match(html, /disabled=""[^>]*>[^<]*(?:<svg[^>]*>.*?<\/svg>)?送出留言|送出留言/);
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/issues\/12"/);
});

test('the reply button is off while the box is empty or a reply is being sent, and an error is shown', () => {
  const view = (extra: object) => renderToStaticMarkup(createElement(IssueDetail, { owner: 'o', repo: 'r', issue, comments: [], draft: '好', onDraft: noop, onSend: noop, onBack: noop, ...extra }));
  assert.doesNotMatch(view({}), /<button type="submit" disabled/);
  assert.match(view({ draft: '  ' }), /<button type="submit" disabled/);
  assert.match(view({ sending: true }), /<button type="submit" disabled[^>]*>.*送出中/);
  assert.match(view({ error: '留言太長' }), /role="alert"[^>]*>留言太長/);
});

test('a diff shows each file with its counts and every line coloured by kind with both line numbers; a file with no patch says why', () => {
  const html = renderToStaticMarkup(createElement(DiffView, { files: [
    { filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n ctx\n-old\n+new' },
    { filename: 'img.png', status: 'added', additions: 0, deletions: 0 },
    { filename: 'huge.sql', status: 'modified', additions: 900, deletions: 3 },
  ] }));
  assert.match(html, /data-diff-file="a\.ts"/);
  assert.match(html, /\+1<\/span><span[^>]*>−1/);
  assert.match(html, /data-diff="add"/);
  assert.match(html, /data-diff="del"/);
  assert.match(html, /data-diff="hunk"/);
  assert.match(html, /bg-\[#E6F4E8\]/);
  assert.match(html, /沒有文字改動/);
  assert.match(html, /Diff 太大/);
});

test('a commit shows its message split into title and body, its stats, its files, and a link to copy', () => {
  const sha = 'a'.repeat(40);
  const html = renderToStaticMarkup(createElement(CommitDetail, { owner: 'o', repo: 'r', onBack: noop,
    commit: { sha, message: '修正儲存\n\n詳細：**原因**係競態', author: 'a', date: '2026-11-15T11:00:00Z', stats: { additions: 5, deletions: 2, total: 7 }, files: [{ filename: 'a.ts', status: 'modified', additions: 5, deletions: 2, patch: '@@ -1 +1 @@\n-a\n+b' }], parents: [] } }));
  assert.match(html, /<h4[^>]*>修正儲存</);
  assert.match(html, /<strong[^>]*>原因</);
  assert.match(html, new RegExp(`data-copy-link="https://github\\.com/o/r/commit/${sha}"`));
  assert.match(html, /1 個檔案/);
  const rows = renderToStaticMarkup(createElement(CommitRows, { commits: [{ sha, message: '修正儲存\n\n內文', author: 'a', date: '2026-11-15T11:00:00Z' }], onOpen: noop, now: NOW }));
  assert.match(rows, /data-commit-row="aaaaaaa"/);
  assert.doesNotMatch(rows, /內文/);
});

test('a comparison says how far apart two branches are and gives a link to it', () => {
  const html = renderToStaticMarkup(createElement(CompareDetail, { owner: 'o', repo: 'r', base: 'main', head: 'feat/x', aheadBy: 2, behindBy: 1, files: [], commits: [], onOpenCommit: noop }));
  assert.match(html, /領先 2、落後 1/);
  assert.match(html, /data-copy-link="https:\/\/github\.com\/o\/r\/compare\/main\.\.\.feat\/x"/);
});

test('a folder lists its entries; a file at a commit gives a permalink at that commit, with the picked line range in it', () => {
  const dir = renderToStaticMarkup(createElement(DirRows, { entries: [{ name: 'lib', path: 'src/lib', type: 'dir', size: 0 }, { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 2048 }], onOpen: noop }));
  assert.match(dir, /data-entry="dir"/);
  assert.match(dir, /2 KB/);
  const sha = 'b'.repeat(40);
  const file = { kind: 'file' as const, name: 'a.ts', path: 'src/a.ts', size: 20, sha: 'x', text: 'one\ntwo\nthree', binary: false, tooLarge: false };
  const plain = renderToStaticMarkup(createElement(FileDetail, { owner: 'o', repo: 'r', sha, file, onLines: noop }));
  assert.match(plain, new RegExp(`data-copy-link="https://github\\.com/o/r/blob/${sha}/src/a\\.ts"`));
  assert.match(plain, /複製永久連結/);
  assert.match(plain, /data-line="3"/);
  const picked = renderToStaticMarkup(createElement(FileDetail, { owner: 'o', repo: 'r', sha, file, lines: { start: 2, end: 3 }, onLines: noop }));
  assert.match(picked, new RegExp(`blob/${sha}/src/a\\.ts#L2-L3`));
  assert.match(picked, /複製行連結/);
  assert.match(picked, /data-line="2" data-selected="true"/);
  assert.doesNotMatch(picked, /data-line="1" data-selected/);
});

test('a Markdown file is shown as a page with a switch to the raw text; binary and too-large files say so', () => {
  const sha = 'c'.repeat(40);
  const md = { kind: 'file' as const, name: 'README.md', path: 'README.md', size: 20, sha: 'x', text: '# 標題\n\n- 一', binary: false, tooLarge: false };
  const html = renderToStaticMarkup(createElement(FileDetail, { owner: 'o', repo: 'r', sha, file: md, onLines: noop }));
  assert.match(html, /<h3[^>]*>標題</);
  assert.match(html, />原文</);
  assert.match(renderToStaticMarkup(createElement(FileDetail, { owner: 'o', repo: 'r', sha, file: { ...md, path: 'a.png', binary: true, text: undefined }, onLines: noop })), /二進位/);
  assert.match(renderToStaticMarkup(createElement(FileDetail, { owner: 'o', repo: 'r', sha, file: { ...md, path: 'big.log', tooLarge: true, text: undefined, size: 5_000_000 }, onLines: noop })), /檔案太大/);
});

test('ages read in minutes, hours, days, then a date', () => {
  assert.equal(ago('2026-11-15T11:30:00Z', NOW), '30 分鐘前');
  assert.equal(ago('2026-11-15T07:00:00Z', NOW), '5 小時前');
  assert.equal(ago('2026-11-12T12:00:00Z', NOW), '3 天前');
  assert.equal(ago('2026-08-01T12:00:00Z', NOW), '2026-08-01');
});

test('the GitHub panel opens with the repo list ready to search, three tabs, and nothing sent until a repo is picked', async () => {
  const { GitHubPanel } = await import('../src/components/github/GitHubPanel');
  const { SearchPicker } = await import('../src/components/github/SearchPicker');
  const html = renderToStaticMarkup(createElement(GitHubPanel, { call: (() => new Promise(() => {})) as never, onClose: noop }));
  assert.match(html, /role="dialog"[^>]*aria-label="GitHub"/);
  assert.match(html, /data-picker-list/, 'the repo list is open at once when there is no repo yet');
  assert.match(html, /aria-label="搜尋 repo"/, 'with a search box');
  assert.match(html, /&lt;repo&gt;/, 'the button reads <repo> while nothing is picked');
  assert.match(html, /&lt;branch&gt;/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>.*議題/);
  assert.match(html, />程式碼</);
  assert.match(html, />提交紀錄</);
  assert.match(html, /請先選擇 repo/);
  const picker = renderToStaticMarkup(createElement(SearchPicker, { value: 'o/a', placeholder: '揀 repo', onPick: noop, initiallyOpen: true,
    items: [{ key: 'o/a', label: 'o/a', sub: '第一個' }, { key: 'org/b', label: 'org/b', sub: '組織 repo' }] }));
  assert.match(picker, /data-pick="o\/a"/);
  assert.match(picker, /data-pick="org\/b"/);
  assert.match(picker, /組織 repo/);
  assert.match(picker, /aria-selected="true"/);
});

test('the app has a GitHub button in the top rail and hands the panel a client that is told when the connection drops', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /aria-label="GitHub"/);
  assert.match(app, /new GhClient\(/);
  assert.match(app, /event\.type === 'GH_RESULT'/);
  assert.match(app, /ghRef\.current\.rejectAll|ghRef\.current\?\.rejectAll/);
  assert.match(app, /<GitHubPanel key=\{JSON\.stringify\(ghTarget\)\} call=\{ghRef\.current\.call\}/);
});

test('the panel remembers the repo, the tab and the branch of each repo on this device', async () => {
  const { ghPrefs, ghKeys } = await import('../src/utils/ghPrefs');
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  assert.equal(ghPrefs.get(ghKeys.repo, storage), undefined);
  ghPrefs.set(ghKeys.repo, 'o/r', storage);
  ghPrefs.set(ghKeys.tab, 'code', storage);
  ghPrefs.set(ghKeys.branch('o/r'), 'feat/x', storage);
  assert.equal(ghPrefs.get(ghKeys.repo, storage), 'o/r');
  assert.equal(ghPrefs.get(ghKeys.tab, storage), 'code');
  assert.equal(ghPrefs.get(ghKeys.branch('o/r'), storage), 'feat/x');
  assert.equal(ghPrefs.get(ghKeys.branch('o/other'), storage), undefined, 'a branch belongs to its repo');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(ghPrefs.get(ghKeys.repo, broken), undefined, 'a blocked store is not an error');
  assert.doesNotThrow(() => ghPrefs.set(ghKeys.repo, 'x', broken));
  const { readFile } = await import('node:fs/promises');
  const panel = await readFile(new URL('../src/components/github/GitHubPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /store\.get\(ghKeys\.repo\)/, 'the panel opens at the repo used last time');
  assert.match(panel, /store\.set\(ghKeys\.repo, key\)/);
});

test('every text box in the GitHub panel is 16px on a phone (a smaller one makes iPhone zoom in on it), and its text is written Chinese', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../src/components/github/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.tsx'));
  for (const name of files) {
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const tag of source.match(/<(?:input|textarea)\b[\s\S]*?\/>/g) ?? []) {
      if (/type="(?:checkbox|radio)"/.test(tag)) continue;
      assert.match(tag, /\btext-base\b/, `${name}: ${tag.slice(0, 80)}`);
      assert.doesNotMatch(tag.replace(/sm:text-(?:xs|sm)/g, ''), /\btext-(?:xs|sm|\[1[0-5]px\])\b/, `${name}: a text box with small text`);
    }
    const shown = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(shown, /[冇嘅唔喺咗呢哋啲嚟畀]/, `${name} has Cantonese in it`);
  }
  for (const file of ['../../../bridge/github.ts', '../../utils/ghClient.ts']) {
    const source = (await readFile(new URL(file, dir), 'utf8')).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /[冇嘅唔喺咗呢哋啲嚟畀]/, `${file} has Cantonese in it`);
  }
});
