import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blobLink, commitLink, compareLink, issueLink, lineSelection, parsePatch, treeLink } from '../src/utils/githubLinks';

test('permalinks point at a commit, not a branch, and keep a line range', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(blobLink('o', 'r', sha, 'src/a b/c.ts'), `https://github.com/o/r/blob/${sha}/src/a%20b/c.ts`);
  assert.equal(blobLink('o', 'r', sha, 'a.ts', { start: 10, end: 10 }), `https://github.com/o/r/blob/${sha}/a.ts#L10`);
  assert.equal(blobLink('o', 'r', sha, 'a.ts', { start: 10, end: 20 }), `https://github.com/o/r/blob/${sha}/a.ts#L10-L20`);
  assert.equal(blobLink('o', 'r', sha, 'a.ts', { start: 20, end: 10 }), `https://github.com/o/r/blob/${sha}/a.ts#L10-L20`, 'a range picked backwards is put in order');
  assert.equal(treeLink('o', 'r', sha, 'docs'), `https://github.com/o/r/tree/${sha}/docs`);
  assert.equal(treeLink('o', 'r', sha, ''), `https://github.com/o/r/tree/${sha}`);
  assert.equal(commitLink('o', 'r', sha), `https://github.com/o/r/commit/${sha}`);
  assert.equal(compareLink('o', 'r', 'main', 'feat/x'), 'https://github.com/o/r/compare/main...feat/x');
  assert.equal(issueLink('o', 'r', 7), 'https://github.com/o/r/issues/7');
  assert.equal(issueLink('o', 'r', 7, 99), 'https://github.com/o/r/issues/7#issuecomment-99');
});

test('tapping line numbers picks one line, then extends it to a range, and tapping the same line again clears it', () => {
  assert.equal(lineSelection(undefined, 5), 'start');
  assert.deepEqual(lineSelection(undefined, 5, true), { start: 5, end: 5 });
  assert.deepEqual(lineSelection({ start: 5, end: 5 }, 9, true), { start: 5, end: 9 });
  assert.deepEqual(lineSelection({ start: 5, end: 9 }, 12, true), { start: 12, end: 12 }, 'a third tap starts again');
  assert.equal(lineSelection({ start: 5, end: 5 }, 5, true), undefined);
});

test('a patch becomes lines with their kind and both line numbers', () => {
  const patch = '@@ -1,3 +1,4 @@ function a()\n keep\n-old\n+new\n+added\n tail\n\\ No newline at end of file';
  const rows = parsePatch(patch);
  assert.deepEqual(rows.map(row => row.kind), ['hunk', 'context', 'del', 'add', 'add', 'context', 'note']);
  assert.deepEqual(rows[1], { kind: 'context', text: 'keep', oldLine: 1, newLine: 1 });
  assert.deepEqual(rows[2], { kind: 'del', text: 'old', oldLine: 2, newLine: undefined });
  assert.deepEqual(rows[3], { kind: 'add', text: 'new', oldLine: undefined, newLine: 2 });
  assert.deepEqual(rows[4], { kind: 'add', text: 'added', oldLine: undefined, newLine: 3 });
  assert.deepEqual(rows[5], { kind: 'context', text: 'tail', oldLine: 3, newLine: 4 });
  assert.equal(rows[0].text, '@@ -1,3 +1,4 @@ function a()');
  assert.deepEqual(parsePatch(''), []);
  assert.deepEqual(parsePatch(undefined), []);
  const two = parsePatch('@@ -1 +1 @@\n-a\n+b\n@@ -10 +10 @@\n x');
  assert.equal(two.at(-1)?.oldLine, 10);
  assert.equal(two.at(-1)?.newLine, 10);
});
