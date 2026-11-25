import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, open, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import { reconcileInboxAlerts, scanInboxAlerts } from './inbox-alerts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-inbox-alert-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const task = join(root, '奏', 'task'); await mkdir(task, { recursive: true });
  return { root, task };
}
async function writeAllocated(path: string, bytes: number) {
  const file = await open(path, 'w');
  try {
    const block = Buffer.alloc(1024 * 1024, 0x65);
    for (let written = 0; written < bytes;) {
      const result = await file.write(block, 0, Math.min(block.length, bytes - written));
      if (result.bytesWritten === 0) throw new Error('file write made no progress');
      written += result.bytesWritten;
    }
  } finally { await file.close(); }
}
test('a 2 GiB sparse file with little allocated data is not an oversize alert', async (t) => {
  const { root, task } = await fixture(t);
  const file = join(task, 'sparse.bin');
  await writeFile(file, 'evidence');
  await truncate(file, 2 * 1024 ** 3);
  const stats = await lstat(file);
  assert.ok(stats.blocks * 512 < 100 * 1024 ** 2, 'fixture must be sparse');
  assert.deepEqual(await scanInboxAlerts(root), { alerts: [], incomplete: false });
});
test('only non-media bytes trigger size; derived directories trigger regardless of size', async (t) => {
  const { root, task } = await fixture(t);
  await writeAllocated(join(task, 'photo.jpg'), 100 * 1024 ** 2 + 4096);
  assert.ok((await lstat(join(task, 'photo.jpg'))).blocks * 512 > 100 * 1024 ** 2);
  assert.deepEqual(await scanInboxAlerts(root), { alerts: [], incomplete: false });
  await mkdir(join(task, '.git')); let found = await scanInboxAlerts(root);
  assert.equal(found.alerts[0].derived, true);
  await writeFile(join(task, 'data.bin'), 'data');
  found = await scanInboxAlerts(root); assert.equal(found.alerts[0].bytes, (await lstat(join(task, 'data.bin'))).blocks * 512);
});
test('xcresult is evidence: only its non-media size can trigger an alert', async (t) => {
  const { root, task } = await fixture(t);
  const bundle = join(task, 'Tests.xcresult');
  await mkdir(bundle);
  const result = join(bundle, 'result.data');
  await writeFile(result, 'small evidence');
  assert.deepEqual(await scanInboxAlerts(root), { alerts: [], incomplete: false });
  await writeAllocated(result, 100 * 1024 ** 2 + 4096);
  const allocated = (await lstat(result)).blocks * 512;
  assert.ok(allocated > 100 * 1024 ** 2);
  const found = await scanInboxAlerts(root);
  assert.equal(found.incomplete, false);
  assert.equal(found.alerts.length, 1);
  assert.equal(found.alerts[0].bytes, allocated);
  assert.deepEqual(found.alerts[0].largest, { name: 'Tests.xcresult', bytes: allocated });
  assert.equal(found.alerts[0].derived, false);
});
test('DerivedData still triggers an alert regardless of size', async (t) => {
  const { root, task } = await fixture(t);
  await mkdir(join(task, 'DerivedData'));
  const found = await scanInboxAlerts(root);
  assert.equal(found.alerts.length, 1);
  assert.equal(found.alerts[0].derived, true);
  assert.equal(found.alerts[0].bytes, 0);
});
test('symlinks are never followed, and exceeding scan limits is unknown', async (t) => {
  const { root, task } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'komorebi-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(outside, 'node_modules')); await symlink(outside, join(task, 'link'));
  assert.deepEqual(await scanInboxAlerts(root), { alerts: [], incomplete: false });
  await mkdir(join(task, 'nested'));
  assert.equal((await scanInboxAlerts(root, { maxDepth: 0 })).incomplete, true);
});

test('exact threshold is not an alert; resolving a large file removes its alert', async (t) => {
  const { root, task } = await fixture(t);
  const file = join(task, 'data.bin');
  await writeAllocated(file, 100 * 1024 ** 2);
  assert.equal((await lstat(file)).blocks * 512, 100 * 1024 ** 2);
  assert.equal((await scanInboxAlerts(root)).alerts.length, 0);
  const handle = await open(file, 'a');
  try { await handle.write(Buffer.alloc(4096, 0x65)); } finally { await handle.close(); }
  assert.ok((await lstat(file)).blocks * 512 > 100 * 1024 ** 2);
  assert.equal((await scanInboxAlerts(root)).alerts.length, 1);
  await truncate(file, 0);
  assert.deepEqual(await scanInboxAlerts(root), { alerts: [], incomplete: false });
});

test('phone photos and media count toward largest folder but not the threshold', async (t) => {
  const { root, task } = await fixture(t);
  await mkdir(join(task, 'photos')); await writeAllocated(join(task, 'photos', 'phone.HEIC'), 100 * 1024 ** 2 + 4096);
  assert.ok((await lstat(join(task, 'photos', 'phone.HEIC'))).blocks * 512 > 100 * 1024 ** 2);
  await mkdir(join(task, 'node_modules'));
  const { alerts } = await scanInboxAlerts(root);
  assert.equal(alerts[0].bytes, 0);
  assert.deepEqual(alerts[0].largest, { name: 'photos', bytes: (await lstat(join(task, 'photos', 'phone.HEIC'))).blocks * 512 });
});

test('a missing or symlinked Inbox is unknown rather than empty', async (t) => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'komorebi-root-link-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const link = join(outside, 'Inbox'); await symlink(root, link);
  assert.equal((await scanInboxAlerts(link)).incomplete, true);
  assert.equal((await scanInboxAlerts(join(outside, 'missing'))).incomplete, true);
});

test('partial scans retain earlier items; a later complete scan removes resolved items', () => {
  const row = { path: '/inbox/a/t', persona: 'a', task: 't', bytes: 123, derived: true, incomplete: false };
  const initial = reconcileInboxAlerts(undefined, { alerts: [row], incomplete: false }, false, 100);
  assert.equal(initial.fresh, false); assert.equal(initial.data.alerts[0].firstSeenAt, undefined);
  const partial = reconcileInboxAlerts(initial.data, { alerts: [], incomplete: true }, true, 200);
  assert.equal(partial.data.alerts.length, 1); assert.equal(partial.data.alerts[0].incomplete, true);
  const cleared = reconcileInboxAlerts(partial.data, { alerts: [], incomplete: false }, true, 300);
  assert.deepEqual(cleared.data.alerts, []);
  const fresh = reconcileInboxAlerts(cleared.data, { alerts: [row], incomplete: false }, true, 400);
  assert.equal(fresh.fresh, true); assert.equal(fresh.data.alerts[0].firstSeenAt, 400);
});

test('one timed-out task does not mark another complete task incomplete or retain its cleared alert', async (t) => {
  const { root, task } = await fixture(t);
  for (let i = 0; i < 100; i++) await writeFile(join(task, `${i}.txt`), 'x');
  const other = join(root, '奏', 'z-other'); await mkdir(other);
  await mkdir(join(other, 'DerivedData'));
  let ticks = 0;
  const scan = await scanInboxAlerts(root, { now: () => ticks++, taskMaxMs: 5, maxMs: 30_000 });
  assert.equal(scan.incomplete, true);
  assert.equal(scan.alerts.find(a => a.path === task)?.incomplete, true);
  assert.equal(scan.alerts.find(a => a.path === other)?.incomplete, false);
  const previous = { alerts: [
    { path: task, persona: '奏', task: 'task', bytes: 10 * 1024 ** 2, derived: true, incomplete: false },
    { path: other, persona: '奏', task: 'z-other', bytes: 42, derived: true, incomplete: false },
  ], incomplete: false };
  const result = reconcileInboxAlerts(previous, scan, true).data;
  assert.equal(result.alerts.find(a => a.path === task)?.bytes, 10 * 1024 ** 2);
  assert.equal(result.alerts.find(a => a.path === task)?.derived, true);
  assert.equal(result.alerts.find(a => a.path === other)?.incomplete, false);
  const discovered = reconcileInboxAlerts(previous, { alerts: [{ ...scan.alerts[0], bytes: 20 * 1024 ** 2, derived: true, incomplete: true }], incomplete: true, checkedPaths: [other] }, true).data;
  assert.equal(discovered.alerts[0].bytes, 20 * 1024 ** 2);
  assert.equal(discovered.alerts[0].derived, true);
  const cleared = reconcileInboxAlerts(previous, { alerts: scan.alerts.filter(a => a.path !== other), incomplete: true, checkedPaths: [other] }, true).data;
  assert.equal(cleared.alerts.some(a => a.path === other), false);
});

test('over 10,000 entries complete within default scan budgets', async (t) => {
  const { root, task } = await fixture(t);
  for (let start = 0; start < 10_016; start += 128) {
    await Promise.all(Array.from({ length: Math.min(128, 10_016 - start) }, (_, i) => writeFile(join(task, `${start + i}.txt`), 'x')));
  }
  const scan = await scanInboxAlerts(root);
  assert.deepEqual(scan, { alerts: [], incomplete: false });
});
