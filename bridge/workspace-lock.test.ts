import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { assertLoopbackPortFree, lockWorkspace } from './workspace-lock';

test('a second process cannot write the same workspace; another workspace and a stale owner can start', t => {
  const root = mkdtempSync(join(tmpdir(), 'komorebi-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const one = join(root, 'one'), two = join(root, 'two'); mkdirSync(one); mkdirSync(two);
  const release = lockWorkspace(one, '127.0.0.1', 1234);
  try {
    const other = lockWorkspace(two, '0.0.0.0', 1234); other();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import {lockWorkspace} from './bridge/workspace-lock.ts'; try { lockWorkspace(process.argv[1], '0.0.0.0', 1235); process.exitCode=2 } catch(e) { console.error(e.message); process.exitCode=3 }", one], { encoding: 'utf8' });
    assert.equal(child.status, 3);
    assert.match(child.stderr, new RegExp(`PID ${process.pid}, 127\\.0\\.0\\.1:1234`));
  } finally { release(); }
  // An unlocked file with old PID metadata is a stale record, not a held lock.
  writeFileSync(join(one, '.komorebi-bridge.lock'), JSON.stringify({ kind: 'komorebi-workspace-lock-v1', pid: 999999, host: '127.0.0.1', port: 9999 }));
  const next = lockWorkspace(one, '127.0.0.1', 1234);
  assert.equal(JSON.parse(readFileSync(join(one, '.komorebi-bridge.lock'), 'utf8')).pid, process.pid);
  next();
});

test('an unexpected or symlinked lock file is never overwritten', t => {
  const root = mkdtempSync(join(tmpdir(), 'komorebi-lock-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, '.komorebi-bridge.lock');
  writeFileSync(path, 'not our state');
  assert.throws(() => lockWorkspace(root, '127.0.0.1', 1234));
  assert.equal(readFileSync(path, 'utf8'), 'not our state');
  const other = join(root, 'other'); mkdirSync(other);
  symlinkSync(path, join(other, '.komorebi-bridge.lock'));
  assert.throws(() => lockWorkspace(other, '127.0.0.1', 1234));
  assert.equal(readFileSync(path, 'utf8'), 'not our state');
});

test('the operating system releases a workspace after the owner is killed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'komorebi-lock-killed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import {lockWorkspace} from './bridge/workspace-lock.ts'; lockWorkspace(process.argv[1], '127.0.0.1', 1234); console.log('held'); process.stdin.resume()", root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const [chunk] = await once(child.stdout, 'data');
    assert.match(String(chunk), /held/);
    assert.throws(() => lockWorkspace(root, '127.0.0.1', 1235), /Workspace already in use/);
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
  const release = lockWorkspace(root, '127.0.0.1', 1235);
  release();
});

test('an occupied wildcard listener is found before a loopback listener starts', async () => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  try { await assert.rejects(assertLoopbackPortFree((server.address() as { port: number }).port), /EADDRINUSE/); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
