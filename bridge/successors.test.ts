import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Successors } from './successors';

test('a takeover is saved, cleared, and never allowed to loop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-successors-'));
  try {
    const path = join(dir, 's.json');
    const successors = new Successors(path);
    successors.set('old', 'new');
    assert.deepEqual(new Successors(path).snapshot(), { old: 'new' }, 'it survives a restart');
    assert.throws(() => successors.set('new', 'old'), /繞返轉頭/);
    assert.throws(() => successors.set('x', 'x'), /自己/);
    successors.set('new', 'newer');
    assert.throws(() => successors.set('newer', 'old'), /繞返轉頭/, 'a longer loop is caught too');
    assert.equal(successors.set('old', null), true);
    assert.equal(successors.set('old', null), false, 'clearing what is not there changes nothing');
    successors.forget('newer');
    assert.deepEqual(successors.snapshot(), {}, 'links to a room that is gone are dropped');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
