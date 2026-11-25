import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileTriggerBanner } from '../src/components/FileTriggerBanner';
import type { FileTriggerItem } from '../src/types/bridge';

const offline: FileTriggerItem = {
  id: 'watch-1', path: '/tmp/watched.md', kind: 'file', enabled: true,
  status: 'offline', offlineToken: 'token-1',
};
const render = (stale: boolean, item?: FileTriggerItem) => renderToStaticMarkup(createElement(FileTriggerBanner, {
  stale, offline: item, onReview: () => {}, onResume: () => {},
}));

test('file trigger banner presents offline recovery with a full-width 44px action', () => {
  const html = render(false, offline);
  assert.match(html, /重新啟用/);
  assert.match(html, /min-h-11 w-full/);
});

test('stale takes priority over offline and offers review instead of resume', () => {
  const html = render(true, offline);
  assert.match(html, /查看並確認/);
  assert.doesNotMatch(html, /重新啟用/);
});

test('file trigger banner is absent when there is no condition to resolve', () => {
  assert.equal(render(false), '');
});
