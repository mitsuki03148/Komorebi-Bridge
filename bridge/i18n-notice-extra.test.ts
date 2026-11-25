import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateServerNoticeFor } from '../src/i18n/serverNotice';

test('file monitoring errors and stalled-room notifications follow the selected language', () => {
  const failure = '未能安全恢復監察，請檢查路徑。';
  assert.equal(translateServerNoticeFor('en', failure), 'Could not safely resume monitoring. Check the path.');
  assert.match(translateServerNoticeFor('ja', failure), /監視.*パス/);
  const stalled = '光 · R5 畫面長時間沒有變化，可能需要你處理';
  assert.match(translateServerNoticeFor('en', stalled), /^光 · R5 has not changed/);
  assert.match(translateServerNoticeFor('ja', stalled), /^光 · R5 の画面/);
  assert.equal(translateServerNoticeFor('en', 'unknown CLI text'), 'unknown CLI text');
});
