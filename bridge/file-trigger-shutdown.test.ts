import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopFileTriggerObservers } from './file-trigger-shutdown';

test('invalid anchor stops every watcher, remount observer and delayed attempt', () => {
  const closed: string[] = []; const marked: string[] = [];
  const watches = new Map([['one', { close: () => closed.push('one') }], ['two', { close: () => closed.push('two') }]]);
  const returns = new Map([['one', () => closed.push('return')]]);
  const timers = new Map([['group', setTimeout(() => { throw Error('retry should be stopped'); }, 60_000)]]);
  stopFileTriggerObservers({ watches, returns, timers, onStopped: id => marked.push(id) });
  assert.deepEqual(closed.sort(), ['one', 'return', 'two']);
  assert.deepEqual(marked.sort(), ['one', 'two']);
  assert.equal(watches.size, 0); assert.equal(returns.size, 0); assert.equal(timers.size, 0);
});
