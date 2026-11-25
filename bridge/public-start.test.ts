import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import WebSocket from 'ws';
import { lockCheckout, lockWorkspace } from './workspace-lock';

test('public server starts in a temporary home, creates a room, and does not start private services', { timeout: 75_000 }, async (t) => {
  const original = dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'komorebi-public-start-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(project); mkdirSync(home); mkdirSync(bin);
  for (const name of ['bridge', 'src', 'scripts', 'public']) cpSync(join(original, name), join(project, name), { recursive: true });
  for (const name of ['server.ts', 'vite.config.ts', 'package.json', 'index.html']) cpSync(join(original, name), join(project, name));
  symlinkSync(realpathSync(join(original, 'node_modules')), join(project, 'node_modules'), 'dir');
  const vite = join(project, 'vite.config.ts');
  writeFileSync(vite, readFileSync(vite, 'utf8').replace('return {', "return {\n    cacheDir: './fixture-vite-cache',"));
  for (const cli of ['codex', 'claude', 'agy']) writeFileSync(join(bin, cli), '#!/bin/sh\nif [ "$1" = "--version" ] || [ "$1" = "--help" ] || [ "$1" = "-p" ] || [ "$1" = "models" ]; then exit 0; fi\nprintf "ready\\n"\nwhile IFS= read -r line; do :; done\n', { mode: 0o700 });
  writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nprintf "called\\n" >> "$KOMOREBI_TEST_TAILSCALE_MARKER"\nif [ "$1" = ip ]; then printf "100.100.1.2\\n"; else printf "{}\\n"; fi\n', { mode: 0o700 });
  const marker = join(root, 'keychain-called'), timerMarker = join(root, 'private-timer'), readMarker = join(root, 'private-read'), shim = join(root, 'isolation.mjs');
  const triggerFile = join(project, '.env.komorebi-file-triggers.json');
  writeFileSync(triggerFile, '{"synthetic":"unchanged"}');
  writeFileSync(shim, `import os from 'node:os'; import child from 'node:child_process'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\n` +
    `os.homedir=()=>process.env.KOMOREBI_TEST_HOME; const read=fs.readFileSync; fs.readFileSync=function(p,...args){if(/\\.komorebi-bench-experience-group$|\\.komorebi-persona-notices\\.json$|\\.env\\.komorebi-file-triggers\\.json$/.test(String(p)))fs.appendFileSync(process.env.KOMOREBI_TEST_READ_MARKER,'read\\n');return read.call(this,p,...args)}; const interval=globalThis.setInterval; globalThis.setInterval=(fn,...args)=>{if(/refreshInboxAlerts|triggerNeedsSetup/.test(String(fn)))fs.appendFileSync(process.env.KOMOREBI_TEST_TIMER_MARKER,'timer\\n');return interval(fn,...args)}; for(const n of ['execFileSync','spawnSync','execFile','spawn']) {const old=child[n]; child[n]=function(cmd,...args){if(cmd==='security'||String(cmd).endsWith('/security')){fs.appendFileSync(process.env.KOMOREBI_TEST_SECURITY_MARKER,n+'\\n');throw Error('isolated keychain');}if(String(cmd).includes('/Applications/Tailscale.app/'))cmd='/usr/bin/false';return old.call(this,cmd,...args)}; const custom=old[Symbol.for('nodejs.util.promisify.custom')]; if(custom) child[n][Symbol.for('nodejs.util.promisify.custom')]=function(cmd,...args){if(cmd==='security'||String(cmd).endsWith('/security')){fs.appendFileSync(process.env.KOMOREBI_TEST_SECURITY_MARKER,n+'\\n');return Promise.reject(Error('isolated keychain'))}if(String(cmd).includes('/Applications/Tailscale.app/'))cmd='/usr/bin/false';return custom.call(this,cmd,...args)};} syncBuiltinESMExports();\n`);
  const control = join(root, 'timer-control');
  execFileSync(process.execPath, ['--import', shim, '-e', 'setInterval(function refreshInboxAlerts(){}, 1000).unref()'],
    { env: { ...process.env, KOMOREBI_TEST_TIMER_MARKER: control, KOMOREBI_TEST_READ_MARKER: join(root, 'read-control') } });
  assert.equal(existsSync(control), true, 'instrumentation detects a matching timer');
  const reserve = createServer();
  await new Promise<void>((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', shim, '--import', 'tsx', join(project, 'server.ts')], {
    cwd: project, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, KOMOREBI_UI: 'dev', KOMOREBI_PORT: String(port),
      KOMOREBI_PAIRING_KEY: 'test-only-pairing-key-do-not-use', KOMOREBI_TEST_HOME: home, KOMOREBI_TEST_SECURITY_MARKER: marker, KOMOREBI_TEST_TIMER_MARKER: timerMarker, KOMOREBI_TEST_READ_MARKER: readMarker, KOMOREBI_TEST_TAILSCALE_MARKER: join(root, 'tailscale-default') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  let ws: WebSocket | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Bridge did not listen')), 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Bridge exited early: ${output}`)); });
      child.stdout.on('data', () => { if (output.includes('Komorebi · http://localhost:')) { clearTimeout(timer); resolve(); } });
    });
    const origin = `http://127.0.0.1:${port}`;
    assert.equal(existsSync(join(root, 'tailscale-default')), false, 'default loopback never invokes Tailscale');
    assert.doesNotMatch(output, /Tailscale ·/);
    assert.match(await (await fetch(origin)).text(), /<title>Komorebi Bridge<\/title>/);
    assert.equal((await (await fetch(`${origin}/manifest.webmanifest`)).json() as { name: string }).name, 'Komorebi Bridge');
    const events: any[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
    ws.on('message', data => events.push(JSON.parse(data.toString())));
    const waitFor = async (predicate: (event: any) => boolean) => {
      const existing = events.find(predicate); if (existing) return existing;
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { ws?.off('message', listen); reject(Error('No expected event')); }, 10_000);
        const listen = (data: WebSocket.RawData) => { const event = JSON.parse(data.toString()); if (predicate(event)) { clearTimeout(timer); ws?.off('message', listen); resolve(event); } };
        ws!.on('message', listen);
      });
    };
    const snapshot = await waitFor(event => event.type === 'SNAPSHOT');
    assert.equal(snapshot.workspaceRoot, join(home, 'Komorebi'));
    assert.equal(snapshot.inboxSupported, undefined);
    assert.equal(snapshot.groupBoardSupported, undefined);
    assert.equal(snapshot.fileTriggersSupported, undefined);
    const checkDuplicate = async (source: string, workspace: string, kind: 'Checkout' | 'Workspace') => {
      const keychain = join(root, `${kind}-keychain`), reads = join(root, `${kind}-reads`);
      const duplicate = spawn(process.execPath, ['--import', shim, '--import', 'tsx', join(source, 'server.ts')], {
        cwd: source, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, KOMOREBI_UI: 'dev', KOMOREBI_PORT: String(port === 1 ? 2 : port - 1),
          KOMOREBI_HOST: '0.0.0.0', KOMOREBI_WORKSPACE: workspace, KOMOREBI_PRIVATE_FEATURES: 'file-trigger',
          KOMOREBI_TEST_HOME: home, KOMOREBI_TEST_SECURITY_MARKER: keychain, KOMOREBI_TEST_TIMER_MARKER: join(root, `${kind}-timer`), KOMOREBI_TEST_READ_MARKER: reads },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let duplicateOutput = '';
      duplicate.stdout.on('data', chunk => { duplicateOutput += chunk; }); duplicate.stderr.on('data', chunk => { duplicateOutput += chunk; });
      const [code] = await once(duplicate, 'exit');
      assert.notEqual(code, 0);
      assert.match(duplicateOutput, new RegExp(`${kind} already in use.*PID ${child.pid}.*127\\.0\\.0\\.1:${port}`));
      assert.equal(existsSync(keychain), false, 'duplicate stops before Keychain');
      assert.equal(existsSync(reads), false, 'duplicate stops before private state');
    };
    const unusedWorkspace = join(home, 'other-workspace');
    await checkDuplicate(project, unusedWorkspace, 'Checkout');
    assert.equal(existsSync(unusedWorkspace), false, 'checkout conflict does not create the other workspace');

    const project2 = join(root, 'project-two'), home2 = join(root, 'home-two');
    mkdirSync(project2); mkdirSync(home2);
    for (const name of ['bridge', 'src', 'scripts', 'public']) cpSync(join(original, name), join(project2, name), { recursive: true });
    for (const name of ['server.ts', 'vite.config.ts', 'package.json', 'index.html']) cpSync(join(original, name), join(project2, name));
    symlinkSync(realpathSync(join(original, 'node_modules')), join(project2, 'node_modules'), 'dir');
    const vite2 = join(project2, 'vite.config.ts');
    writeFileSync(vite2, readFileSync(vite2, 'utf8').replace('return {', "return {\n    cacheDir: './fixture-vite-cache',"));
    await checkDuplicate(project2, join(home, 'Komorebi'), 'Workspace');
    const reserve2 = createServer();
    await new Promise<void>((resolve, reject) => { reserve2.once('error', reject); reserve2.listen(0, '127.0.0.1', resolve); });
    const port2 = (reserve2.address() as { port: number }).port;
    await new Promise<void>(resolve => reserve2.close(() => resolve()));
    const peer = spawn(process.execPath, ['--import', shim, '--import', 'tsx', join(project2, 'server.ts')], {
      cwd: project2, env: { HOME: home2, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, KOMOREBI_UI: 'dev', KOMOREBI_PORT: String(port2),
        KOMOREBI_HOST: '0.0.0.0', KOMOREBI_WORKSPACE: join(home2, 'workspace'), KOMOREBI_PAIRING_KEY: 'test-only-pairing-key-do-not-use', KOMOREBI_TEST_TAILSCALE_MARKER: join(root, 'tailscale-peer'),
        KOMOREBI_TEST_HOME: home2, KOMOREBI_TEST_SECURITY_MARKER: join(root, 'peer-keychain'), KOMOREBI_TEST_TIMER_MARKER: join(root, 'peer-timer'), KOMOREBI_TEST_READ_MARKER: join(root, 'peer-read') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let peerOutput = '';
    peer.stderr.on('data', chunk => { peerOutput += chunk; });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Second workspace did not listen')), 20_000);
        peer.once('exit', () => { clearTimeout(timer); reject(Error(`Second workspace exited: ${peerOutput}`)); });
        peer.stdout.on('data', chunk => { peerOutput += chunk; if (peerOutput.includes('Komorebi · http://localhost:')) { clearTimeout(timer); resolve(); } });
      });
      assert.equal((await fetch(`http://127.0.0.1:${port2}/`)).status, 200);
      assert.equal(existsSync(join(root, 'tailscale-peer')), true, 'wildcard host still invokes Tailscale');
      assert.match(peerOutput, new RegExp(`Tailscale · http://100\\.100\\.1\\.2:${port2}`));
      assert.equal((await fetch(origin)).status, 200, 'the original workspace is still serving');
    } finally {
      if (peer.exitCode === null) { const exited = once(peer, 'exit'); peer.kill('SIGTERM'); await exited; }
      writeFileSync(join(root, 'peer-output.log'), peerOutput);
    }
    ws.send(JSON.stringify({ type: 'INBOX', op: 'list', requestId: 'test-inbox' }));
    assert.equal((await waitFor(event => event.type === 'INBOX_RESULT' && event.requestId === 'test-inbox')).ok, false);
    ws.send(JSON.stringify({ type: 'FILE_TRIGGERS_GET', groupId: 'test' }));
    assert.match((await waitFor(event => event.type === 'ERROR')).message, /disabled/i);
    ws.send(JSON.stringify({ type: 'CREATE', modelId: 'CODEX', roomName: 'Fixture', repoPath: '', remote: false }));
    const room = await waitFor(event => event.type === 'ROOM' && event.room?.roomName === 'Fixture' && event.room.live);
    assert.equal(room.room.repoPath, realpathSync(join(home, 'Komorebi')));
    assert.equal(existsSync(marker), false, 'disabled file triggers do not access Keychain');
    assert.equal(existsSync(timerMarker), false, 'disabled Inbox and file triggers do not register their timers');
    assert.equal(existsSync(readMarker), false, 'disabled RSI, persona and trigger services do not read their state');
    assert.equal(readFileSync(triggerFile, 'utf8'), '{"synthetic":"unchanged"}');
    assert.equal(existsSync(join(home, 'Komorebi', '.komorebi-bench-experience.jsonl')), false);
    assert.equal(events.some(event => event.type === 'INBOX_ALERTS' || event.type === 'FILE_TRIGGERS_STATE'), false);
  } finally {
    ws?.close();
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    writeFileSync(join(root, 'bridge-output.log'), output);
  }
  const release = lockWorkspace(join(home, 'Komorebi'), '127.0.0.1', port);
  release();
  const releaseCheckout = lockCheckout(project, '127.0.0.1', port);
  releaseCheckout();
});

test('default build mode serves only built assets and reloads them from disk', { timeout: 40_000 }, async (t) => {
  const original = dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'komorebi-ui-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), home = join(root, 'home');
  mkdirSync(project); mkdirSync(home);
  for (const name of ['bridge', 'src', 'scripts', 'public']) cpSync(join(original, name), join(project, name), { recursive: true });
  for (const name of ['server.ts', 'vite.config.ts', 'package.json', 'index.html']) cpSync(join(original, name), join(project, name));
  symlinkSync(realpathSync(join(original, 'node_modules')), join(project, 'node_modules'), 'dir');
  const reserve = createServer();
  await new Promise<void>((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const start = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(project, 'server.ts')], {
      cwd: project, env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', KOMOREBI_PORT: String(port),
        KOMOREBI_PAIRING_KEY: 'test-only-pairing-key-do-not-use', KOMOREBI_DISPLAY_NAME: 'Fixture Guild' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { value: '' };
    child.stdout.on('data', chunk => { output.value += chunk; });
    child.stderr.on('data', chunk => { output.value += chunk; });
    return { child, output };
  };
  const missing = start();
  const [missingCode] = await once(missing.child, 'exit');
  assert.notEqual(missingCode, 0);
  assert.match(missing.output.value, /npm run build/);
  assert.equal(existsSync(join(home, 'Komorebi')), false, 'missing build fails before creating state');

  const dist = join(project, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html><head><title>Komorebi Bridge</title></head><body>first</body></html>');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"Komorebi Bridge"}');
  writeFileSync(join(dist, 'assets', 'fixture.js'), 'first asset');
  writeFileSync(join(dist, 'sw.js'), 'worker');
  symlinkSync(join(project, 'server.ts'), join(dist, 'leak.txt'));
  const { child, output } = start();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Bridge did not listen')), 20_000);
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Bridge exited: ${output.value}`)); });
      child.stdout.on('data', () => { if (output.value.includes('Komorebi · http://localhost:')) { clearTimeout(timer); resolve(); } });
    });
    const origin = `http://127.0.0.1:${port}`;
    const first = await fetch(origin);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.match(await first.text(), /<title>Fixture Guild<\/title>.*first/);
    assert.equal((await (await fetch(`${origin}/manifest.webmanifest`)).json() as { name: string }).name, 'Fixture Guild');
    assert.equal(await (await fetch(`${origin}/assets/fixture.js`)).text(), 'first asset');
    assert.equal(await (await fetch(`${origin}/sw.js`)).text(), 'worker');
    for (const path of ['/server.ts', '/.env.komorebi-local', '/Review/secret', '/leak.txt', '/@fs/etc/passwd']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
    assert.match(await (await fetch(`${origin}/room/fixture`, { headers: { accept: 'text/html' } })).text(), /first/);
    assert.match(await (await fetch(`${origin}/some/route`, { headers: { accept: 'text/html' } })).text(), /first/);
    writeFileSync(join(dist, 'index.html'), '<html><head><title>Komorebi Bridge</title></head><body>second</body></html>');
    writeFileSync(join(dist, 'assets', 'fixture.js'), 'second asset');
    assert.match(await (await fetch(origin)).text(), /second/);
    assert.equal(await (await fetch(`${origin}/assets/fixture.js`)).text(), 'second asset');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    writeFileSync(join(root, 'bridge-output.log'), output.value);
  }
});
