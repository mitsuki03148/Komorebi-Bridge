import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PULL_THRESHOLD, pullCommits, pullDistance } from '../src/utils/pullRefresh.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the pull follows the finger, slows down, and stays under the cap', () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(0), 0);
  assert.ok(pullDistance(40) > 0 && pullDistance(40) < 40);
  assert.ok(pullDistance(100) > pullDistance(40));
  assert.ok(pullDistance(5_000) <= 96);
});

test('a short pull does not refresh and a long one does', () => {
  assert.equal(pullCommits(pullDistance(30)), false);
  assert.equal(pullCommits(pullDistance(250)), true);
  assert.ok(PULL_THRESHOLD > 0);
});

test('GitHub (issues and commits, not code) and Drive lists use the pull, and Safari cannot reload the page from it', () => {
  const gh = read('src/components/github/GitHubPanel.tsx');
  assert.match(gh, /usePullToRefresh\(refreshAll, tab !== 'code'\)/);
  assert.match(gh, /\[repo, state, submitted, refresh\]/);
  assert.match(gh, /\[repo, branch\.name, refresh\]/);
  assert.match(gh, /data-gh-body className="[^"]*overscroll-y-contain/);
  const drive = read('src/components/drive/DrivePanel.tsx');
  assert.match(drive, /usePullToRefresh\(refreshAll, view\.kind === 'list'\)/);
  assert.match(drive, /data-drive-body className="[^"]*overscroll-y-contain/);
});
