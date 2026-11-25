import assert from 'node:assert/strict';
import test from 'node:test';
import { fixTerms } from './terms';

test('mis-heard tool names go back to their real spelling', () => {
  assert.equal(fixTerms('我想用 Cloud Cut 開一個新嘅 room，再用 Jail Scale 連返手機'), '我想用 Claude Code 開一個新嘅 room，再用 Tailscale 連返手機');
  assert.equal(fixTerms('push 去 Github，開個 Pill Request'), 'push 去 GitHub，開個 pull request');
  assert.equal(fixTerms('用 Claud code 做'), '用 Claude Code 做');
});

test('ordinary words are left alone', () => {
  assert.equal(fixTerms('the cloud is big, a tail and a scale'), 'the cloud is big, a tail and a scale');
  assert.equal(fixTerms('我哋 deploy 到 staging'), '我哋 deploy 到 staging');
});

test('more mishearings seen in mixed Cantonese are put back', () => {
  assert.equal(fixTerms('Talescale 練唔到，Wisper 轉錄，開 poll request'), 'Tailscale 練唔到，Whisper 轉錄，開 pull request');
  assert.equal(fixTerms('跑 smooth test，光喺 WebTree 做嘢'), '跑 smoke test，光喺 worktree 做嘢');
});
