import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { lockAxis, swipePreview, swipeSpec } from '../src/utils/groupSwipe';

const ids = ['a', 'b', 'c', 'd'];

test('a swipe is horizontal only when it clearly goes sideways, and decides nothing before it has moved a little', () => {
  assert.equal(lockAxis(3, 2), undefined);
  assert.equal(lockAxis(40, 8), 'x');
  assert.equal(lockAxis(-40, 8), 'x');
  assert.equal(lockAxis(10, 30), 'y');
  assert.equal(lockAxis(30, 30), 'y', 'a diagonal belongs to scrolling');
});

test('swiping left goes to the next group and right to the previous one; a short pull only shows a faint preview', () => {
  assert.equal(swipePreview(ids, 'b', -10), undefined, 'too small to show anything');
  assert.deepEqual(swipePreview(ids, 'b', -(swipeSpec.show + 1)), { targetId: 'c', committed: false, direction: 'next' });
  assert.deepEqual(swipePreview(ids, 'b', -swipeSpec.step), { targetId: 'c', committed: true, direction: 'next' });
  assert.deepEqual(swipePreview(ids, 'b', swipeSpec.step), { targetId: 'a', committed: true, direction: 'previous' });
});

test('a longer swipe steps on to the group after that, and the list is a loop', () => {
  assert.equal(swipePreview(ids, 'a', -swipeSpec.step * 2)?.targetId, 'c');
  assert.equal(swipePreview(ids, 'a', swipeSpec.step)?.targetId, 'd', 'before the first group comes the last');
  assert.equal(swipePreview(ids, 'd', -swipeSpec.step)?.targetId, 'a', 'after the last group comes the first');
  assert.equal(swipePreview(ids, 'b', -swipeSpec.step * 3)?.targetId, 'a', 'three steps from b round the loop');
  assert.equal(swipePreview(ids, 'b', -swipeSpec.step * 40)?.targetId, 'a', 'a very long pull stops one short of coming back to b');
  assert.equal(swipePreview(ids, 'a', swipeSpec.step * 40)?.targetId, 'b');
  assert.equal(swipePreview(['x', 'y'], 'x', -swipeSpec.step)?.targetId, 'y');
  assert.equal(swipePreview(['x', 'y'], 'x', swipeSpec.step * 5)?.targetId, 'y', 'with two groups both ways go to the other one');
  assert.equal(swipePreview(['only'], 'only', -swipeSpec.step), undefined);
  assert.equal(swipePreview(ids, 'gone', -swipeSpec.step), undefined);
});

test('pulling back under the line takes the target away again, so letting go does nothing', () => {
  assert.equal(swipePreview(ids, 'b', -swipeSpec.step)?.committed, true);
  assert.equal(swipePreview(ids, 'b', -(swipeSpec.step - 1))?.committed, false);
  assert.equal(swipePreview(ids, 'b', -5), undefined);
});

test('the phone group view uses the swipe, and only lets go-to-switch happen on release', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /useGroupSwipe\(/);
  assert.match(app, /enabled: streetMobileView/);
  assert.match(app, /\{\.\.\.groupSwipe\.handlers\}/);
  assert.match(app, /<GroupSwipeHint /);
  const hook = await readFile(new URL('../src/utils/useGroupSwipe.ts', import.meta.url), 'utf8');
  assert.match(hook, /onTouchEnd[\s\S]{0,400}committed/, 'the switch happens in touchend');
  assert.doesNotMatch(hook.split('onTouchMove')[1]?.split('onTouchEnd')[0] ?? '', /onSwitch/, 'moving the finger never switches');
});

test('the right edge keeps room for the pull-out tab, wider than the left system-gesture edge', () => {
  assert.ok(swipeSpec.rightEdge >= 28 && swipeSpec.rightEdge > swipeSpec.edge);
});
