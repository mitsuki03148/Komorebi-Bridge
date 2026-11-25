import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { WebSocketServer } from 'ws';
import { changedTests, verifyGate } from '../scripts/verify-gate';
import { boundedJson } from '../scripts/task-context';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'komorebi-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'trial');
  await writeFile(join(root, 'example.txt'), 'base\n');
  git('add', 'example.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  return { root, git };
}

async function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/komorebi-room.ts', ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise<number | null>(resolve => child.on('close', resolve));
  return { code, stdout, stderr };
}

test('verify-gate reports base, dirty and untracked, and a failing check exits nonzero', async t => {
  const { root, git } = await fixture(t);
  const base = git('rev-parse', 'HEAD');
  await writeFile(join(root, 'example.txt'), 'changed\n');
  git('add', 'example.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'change');
  await writeFile(join(root, 'example.txt'), 'dirty\n'); await writeFile(join(root, 'untracked.txt'), 'new');
  const result = await verifyGate(root, base, 'printf lint-pass', 'printf test-fail; exit 7');
  assert.equal(result.base?.ahead, 1); assert.equal(result.base?.behind, 0);
  assert.match(result.status, /example\.txt/); assert.match(result.status, /untracked\.txt/);
  assert.match(result.diffStat, /example\.txt/); assert.equal(result.lint.status, 'PASS');
  assert.equal(result.test.status, 'FAIL'); assert.ok('exitCode' in result.test); assert.equal(result.test.exitCode, 7);
  const called = await cli(['verify-gate', '--repo', root, '--base', base, '--lint', 'printf lint-pass', '--test', 'printf test-fail; exit 7']);
  assert.equal(called.code, 1); assert.equal(JSON.parse(called.stdout).test.exitCode, 7);
  assert.notEqual((await cli(['verify-gate', '--repo', root, '--base', 'not-a-ref'])).code, 0);
});

test('verify-gate does not run missing checks and caps verbose output without hiding failure', async t => {
  const { root } = await fixture(t);
  const blank = await verifyGate(root); assert.equal(blank.lint.status, 'not run'); assert.equal(blank.test.status, 'not run');
  const result = await verifyGate(root, undefined, 'yes X | head -c 70000', 'printf failure; exit 9');
  assert.equal(result.lint.status, 'PASS'); assert.equal(result.lint.truncated, true); assert.ok('exitCode' in result.test); assert.equal(result.test.exitCode, 9);
  const json = boundedJson({ ...result, status: '字'.repeat(30000) });
  assert.ok(Buffer.byteLength(json + '\n') <= 16 * 1024);
  const parsed = JSON.parse(json); assert.equal(parsed.truncated, true); assert.equal(parsed.ok, false); assert.equal(parsed.test.exitCode, 9);
});

test('verify-gate reports files created by a caller-supplied check', async t => {
  const { root } = await fixture(t);
  const result = await verifyGate(root, undefined, undefined, 'printf new > check-created.txt');
  assert.equal(result.test.status, 'PASS');
  assert.match(result.status, /\?\? check-created\.txt/);
});

test('changed tests include direct changes and matching source tests; no matches are not run', async t => {
  const { root, git } = await fixture(t);
  await mkdir(join(root, 'bridge'));
  for (const name of ['a.ts', 'a.test.ts', 'a-extra.test.ts', 'ab.test.ts', 'other.test.ts']) await writeFile(join(root, 'bridge', name), '');
  git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'tests');
  await writeFile(join(root, 'bridge', 'a.ts'), 'changed');
  await writeFile(join(root, 'bridge', 'other.test.ts'), 'changed');
  assert.deepEqual(await changedTests(root, 'HEAD'), ['bridge/a-extra.test.ts', 'bridge/a.test.ts', 'bridge/other.test.ts']);
  git('checkout', '--', 'bridge/a.ts', 'bridge/other.test.ts');
  await writeFile(join(root, 'example.txt'), 'changed');
  const result = await verifyGate(root, undefined, undefined, undefined, true);
  assert.equal(result.test.status, 'not run'); assert.equal(result.ok, false); assert.deepEqual(result.selectedTests, []);
});

test('background gate writes a result, notifies its sender, and excludes overlapping runs', { timeout: 20_000 }, async t => {
  const { root } = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'komorebi-gate-results-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  let finishCheck!: () => void;
  const hold = join(directory, 'hold');
  execFileSync('mkfifo', [hold]);
  const notified = new Promise<any>(resolve => {
    server.on('connection', socket => {
      socket.send(JSON.stringify({ type: 'SNAPSHOT', rooms: [], characters: {}, workspaceRoot: root }));
      socket.on('message', data => {
        const event = JSON.parse(data.toString());
        if (event.type === 'BENCH') { socket.send(JSON.stringify({ type: 'BENCH_RESULT', requestId: event.requestId, ok: true, lines: ['sent'] })); resolve(event); }
      });
    });
    finishCheck = () => { void writeFile(hold, 'done'); };
  });
  const env = { KOMOREBI_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, KOMOREBI_GATE_DIR: directory };
  try {
    const args = ['verify-gate', '--repo', root, '--from', 'test-room', '--background', '--test', `read line < '${hold}'; printf 'tests 1\\npass 1\\n'`];
    const first = await cli(args, env); assert.equal(first.code, 0, first.stderr); assert.match(first.stdout, /唔好 poll/);
    const second = await cli(args, env); assert.notEqual(second.code, 0);
    finishCheck();
    const event = await notified;
    assert.equal(event.from, 'test-room'); assert.equal(event.to, 'test-room'); assert.equal(event.notify, true); assert.equal(event.source, 'verify-gate');
    const path = (await readdir(directory)).find(name => name.endsWith('.json'))!;
    const result = JSON.parse(await readFile(join(directory, path), 'utf8'));
    assert.equal(result.ok, true); assert.equal(result.test.status, 'PASS'); assert.match(event.body, /tests 1/); assert.match(event.body, /\.json/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('task-context --bench uses the existing show protocol and reports failures', async t => {
  const { root } = await fixture(t);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const seen: any[] = [];
  server.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'SNAPSHOT', rooms: [], characters: {}, workspaceRoot: root }));
    socket.on('message', data => {
      const event = JSON.parse(data.toString()); seen.push(event);
      if (event.type === 'BENCH') socket.send(JSON.stringify({ type: 'BENCH_RESULT', requestId: event.requestId, ok: event.id === 42, lines: [event.id === 42 ? 'ticket content' : 'not found'] }));
    });
  });
  try {
    const env = { KOMOREBI_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
    const result = await cli(['task-context', '--repo', root, '--bench', '42', '--from', 'test-room', '--grep', 'base'], env);
    assert.equal(result.code, 0, result.stderr); const value = JSON.parse(result.stdout);
    assert.deepEqual(value.bench.lines, ['ticket content']); assert.match(value.search.matches[0], /example\.txt:1:base/);
    assert.equal(seen[0].action, 'show'); assert.equal(seen[0].from, 'test-room'); assert.equal(seen[0].id, 42);
    assert.notEqual((await cli(['task-context', '--repo', root, '--bench', '99', '--from', 'test-room'], env)).code, 0);
    assert.notEqual((await cli(['task-context', '--repo', root, '--bench', '42'], env)).code, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
