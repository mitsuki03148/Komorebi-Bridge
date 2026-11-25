import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The Bridge once failed to start ("Cannot access 'shuttingDown' before initialization"). scheduleRecovery queues a microtask as soon
// as the group closer exists, and that microtask runs at the next top-level await, long before the shutdown code at the bottom of the file.
// So what the microtask reads must be declared above the point where scheduleRecovery can first queue it.
test('what the recovery microtask reads is declared before the group closer exists', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  const declared = server.indexOf('let shuttingDown = false;');
  const closerExists = server.indexOf('groupCloser = new GroupCloser(');
  const used = server.indexOf('if (shuttingDown) return;');
  const laterAwait = server.slice(closerExists).search(/^(?:const [^=\n]+= )?await /m);
  assert.ok(declared > 0 && closerExists > 0 && used > 0);
  assert.ok(laterAwait > 0, 'a top-level await follows, which is when the microtask runs');
  assert.ok(declared < closerExists, 'shuttingDown is declared above the point where the microtask can first be queued');
  assert.ok(declared < used);
  assert.equal([...server.matchAll(/let shuttingDown\b/g)].length, 1, 'declared once');
});
