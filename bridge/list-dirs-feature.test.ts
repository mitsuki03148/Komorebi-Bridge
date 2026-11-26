import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

for (const feature of ['', 'board', 'file-trigger']) {
  test(`LIST_DIRS file access with private features: ${feature || 'none'}`, { timeout: 40_000 }, async (t) => {
    const original = dirname(dirname(fileURLToPath(import.meta.url)));
    const root = mkdtempSync(join(tmpdir(), 'komorebi-list-dirs-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const project = join(root, 'project'), home = join(root, 'home'), workspace = join(root, 'workspace'), outside = join(root, 'outside');
    for (const path of [project, home, workspace, outside]) mkdirSync(path);
    writeFileSync(join(outside, 'board.md'), 'fixture');
    mkdirSync(join(workspace, 'folder'));
    for (const name of ['bridge', 'src', 'scripts', 'public']) cpSync(join(original, name), join(project, name), { recursive: true });
    for (const name of ['server.ts', 'vite.config.ts', 'package.json', 'index.html']) cpSync(join(original, name), join(project, name));
    symlinkSync(realpathSync(join(original, 'node_modules')), join(project, 'node_modules'), 'dir');
    const dist = join(project, 'dist'); mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<html><title>Komorebi Bridge</title></html>'); writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"Komorebi Bridge"}');
    const shim = join(root, 'isolation.mjs');
    writeFileSync(shim, `import os from 'node:os'; import child from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>process.env.HOME; for(const n of ['execFileSync','spawnSync','execFile','spawn']) {const old=child[n]; child[n]=function(cmd,...args){if(cmd==='security'||String(cmd).endsWith('/security'))throw Error('isolated keychain'); if(String(cmd).includes('/Applications/Tailscale.app/'))cmd='/usr/bin/false'; return old.call(this,cmd,...args)}} syncBuiltinESMExports();`);
    const reserve = createServer();
    await new Promise<void>((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>(resolve => reserve.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', shim, '--import', 'tsx', join(project, 'server.ts')], {
      cwd: project, env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', KOMOREBI_PORT: String(port), KOMOREBI_WORKSPACE: workspace,
        KOMOREBI_PAIRING_KEY: 'test-only-pairing-key-do-not-use', KOMOREBI_PRIVATE_FEATURES: feature }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    let ws: WebSocket | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Bridge did not listen: ${output}`)), 20_000);
        child.once('exit', () => { clearTimeout(timer); reject(Error(`Bridge exited: ${output}`)); });
        child.stdout.on('data', () => { if (output.includes('Komorebi · http://localhost:')) { clearTimeout(timer); resolve(); } });
      });
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
      await once(ws, 'open');
      const request = async (payload: object) => {
        const response = new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('No LIST_DIRS response')), 10_000);
          const listener = (data: WebSocket.RawData) => { const event = JSON.parse(data.toString()); if (event.type === 'DIRS' || event.type === 'ERROR') { clearTimeout(timer); ws!.off('message', listener); resolve(event); } };
          ws!.on('message', listener);
        });
        ws!.send(JSON.stringify(payload)); return response;
      };
      const fileResult = await request({ type: 'LIST_DIRS', files: true, path: outside });
      if (feature) {
        assert.equal(fileResult.type, 'DIRS');
        assert.equal(fileResult.path, realpathSync(outside));
        assert.ok(fileResult.files.includes('board.md'));
      } else { assert.equal(fileResult.type, 'ERROR'); assert.match(fileResult.message, /disabled/i); }
      const folders = await request({ type: 'LIST_DIRS', files: false, path: workspace });
      assert.equal(folders.type, 'DIRS');
      assert.ok(folders.dirs.includes('folder'));
    } finally {
      ws?.close();
      if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
      writeFileSync(join(root, 'bridge-output.log'), output);
    }
  });
}
