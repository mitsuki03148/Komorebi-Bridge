import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGitHubUrl, resolveRefPath } from '../src/utils/githubUrl';
import { GitHubOpenContext } from '../src/utils/githubOpen';
import { Markdown } from '../src/components/Markdown';
import { GitHubPanel } from '../src/components/github/GitHubPanel';

const sha = '0123456789abcdef0123456789abcdef01234567';

test('GitHub links of every kind the app can show are understood, and nothing else is', () => {
  assert.deepEqual(parseGitHubUrl(`https://github.com/o/r/commit/${sha}`), { kind: 'commit', repo: 'o/r', sha });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/commit/abc1234'), { kind: 'commit', repo: 'o/r', sha: 'abc1234' });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/issues/7'), { kind: 'issue', repo: 'o/r', number: 7 });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/issues/7#issuecomment-99'), { kind: 'issue', repo: 'o/r', number: 7, commentId: 99 });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/pull/12'), { kind: 'issue', repo: 'o/r', number: 12, pull: true }, 'a pull request opens as its conversation');
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/issues'), { kind: 'issues', repo: 'o/r' });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r'), { kind: 'repo', repo: 'o/r' });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/'), { kind: 'repo', repo: 'o/r' });
  assert.deepEqual(parseGitHubUrl(`https://github.com/o/r/blob/${sha}/src/a%20b.ts#L10-L20`), { kind: 'blob', repo: 'o/r', rest: `${sha}/src/a b.ts`, lines: { start: 10, end: 20 } });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/blob/main/README.md#L5'), { kind: 'blob', repo: 'o/r', rest: 'main/README.md', lines: { start: 5, end: 5 } });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/tree/main/docs'), { kind: 'tree', repo: 'o/r', rest: 'main/docs' });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/commits/feat/x'), { kind: 'commits', repo: 'o/r', rest: 'feat/x' });
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/compare/main...feat/x'), { kind: 'compare', repo: 'o/r', base: 'main', head: 'feat/x' });
  assert.deepEqual(parseGitHubUrl('https://www.github.com/o/r/issues/1'), { kind: 'issue', repo: 'o/r', number: 1 });
  for (const other of ['https://example.com/o/r/issues/1', 'https://github.com.evil.com/o/r/issues/1', 'http://github.com/o/r/issues/1', 'https://github.com/o', 'https://github.com/', 'https://github.com/o/r/actions',
    'https://github.com/settings/profile', 'https://github.com/o/r/issues/abc', 'https://github.com/o/r/commit/zzz', 'https://github.com/../r/issues/1', 'javascript:alert(1)', 'mailto:a@b.c', 'not a url'])
    assert.equal(parseGitHubUrl(other), undefined, other);
});

test('a ref and path written together are split using the branches the repo has, longest name first; a commit id needs no list', () => {
  const branches = ['main', 'feat', 'feat/x'];
  assert.deepEqual(resolveRefPath('main/src/a.ts', branches), { ref: 'main', path: 'src/a.ts' });
  assert.deepEqual(resolveRefPath('feat/x/src/a.ts', branches), { ref: 'feat/x', path: 'src/a.ts' }, 'the longer branch wins over its prefix');
  assert.deepEqual(resolveRefPath('feat/other.ts', branches), { ref: 'feat', path: 'other.ts' });
  assert.deepEqual(resolveRefPath('main', branches), { ref: 'main', path: '' });
  assert.deepEqual(resolveRefPath(`${sha}/docs/a.md`, branches), { ref: sha, path: 'docs/a.md' });
  assert.deepEqual(resolveRefPath('v1.2/lib/b.ts', branches), { ref: 'v1.2', path: 'lib/b.ts' }, 'an unknown name (a tag) is taken as the first segment');
});

test('a link in a message opens inside the app when the app can show it, and still opens in the browser otherwise', () => {
  const text = `看 [5033fa9](https://github.com/o/r/commit/${sha}) 同 https://github.com/o/r/issues/7 同 [外部](https://example.com/x)`;
  const inside = renderToStaticMarkup(createElement(GitHubOpenContext.Provider, { value: () => {} }, createElement(Markdown, { text })));
  assert.match(inside, new RegExp(`<a[^>]*href="https://github\\.com/o/r/commit/${sha}"[^>]*data-github-target="commit"`));
  assert.match(inside, /data-github-target="issue"/);
  assert.match(inside, /<a[^>]*href="https:\/\/example\.com\/x"[^>]*target="_blank"/, 'an outside link still opens outside');
  assert.doesNotMatch(inside.match(/<a[^>]*example\.com[^>]*>/)?.[0] ?? '', /data-github-target/);
  const plain = renderToStaticMarkup(createElement(Markdown, { text }));
  assert.doesNotMatch(plain, /data-github-target/);
  assert.match(plain, /<a[^>]*href="https:\/\/github\.com\/o\/r\/issues\/7"[^>]*target="_blank"/);
});

test('the panel opens straight at the thing a link pointed to', () => {
  const open = (target: object) => renderToStaticMarkup(createElement(GitHubPanel, { call: (() => new Promise(() => {})) as never, onClose() {}, target: target as never }));
  const issue = open({ kind: 'issue', repo: 'o/r', number: 7 });
  assert.match(issue, /aria-selected="true"[^>]*>.*議題/);
  assert.match(issue, /issues#?7|議題<\/button>[\s\S]*讀取中/, 'the issue itself is loading, not the list');
  assert.doesNotMatch(issue, /搜尋 o\/r 嘅 issues/, 'the issue list is not what is shown');
  const commit = open({ kind: 'commit', repo: 'o/r', sha });
  assert.match(commit, /aria-selected="true"[^>]*>.*提交紀錄/);
  assert.match(commit, /提交紀錄<\/button>[\s\S]*讀取中/);
  const file = open({ kind: 'blob', repo: 'o/r', rest: `${sha}/src/a.ts`, lines: { start: 3, end: 4 } });
  assert.match(file, /aria-selected="true"[^>]*>.*程式碼/);
  assert.match(file, />o\/r</);
});

test('the app lets a link anywhere open the panel at its target, and hands a changed target a fresh panel', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<GitHubOpenContext\.Provider/);
  assert.match(app, /<GitHubPanel key=\{JSON\.stringify\(ghTarget\)\}/);
});
