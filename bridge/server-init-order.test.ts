import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

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

test('a rejected push observation keeps broadcasting and logs each reason once', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  const declaration = server.match(/^const loggedPushObservationFailures = .*;$/m)?.[0];
  const start = server.indexOf('function broadcast(');
  assert.ok(declaration && start >= 0);
  const code = transformSync(`${declaration}\n${server.slice(start, server.indexOf('\nconst archiveGroups', start))}\nbroadcast;`, { loader: 'ts' }).code;
  const sent: unknown[] = [];
  const logs: unknown[][] = [];
  let reason = 'EACCES';
  let observations = 0;
  const broadcast = runInNewContext(code, {
    clients: [{}],
    send: (_client: unknown, event: unknown) => sent.push(event),
    pushNotifier: { observe: async () => { observations++; throw Object.assign(new Error('private details'), { code: reason }); } },
    scheduleRecovery() {}, groupViews: undefined, syncGroupWatches() {},
    console: { error: (...args: unknown[]) => logs.push(args) },
  });
  const event = { type: 'SYNC_UPDATE', room: { id: 'fixture', live: false } };
  broadcast(event);
  broadcast(event);
  await Promise.resolve();
  reason = 'EIO';
  broadcast(event);
  await Promise.resolve();
  assert.equal(observations, 3);
  assert.deepEqual(sent, [event, event, event]);
  assert.deepEqual(logs, [['未能處理房間推送通知', 'EACCES'], ['未能處理房間推送通知', 'EIO']]);
});
