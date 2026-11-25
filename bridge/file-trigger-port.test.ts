import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/** Launches a second real Bridge, isolated from the user's home, project and Keychain. */
test('port already in use stops second Bridge before trigger config or Keychain access', { timeout: 25_000 }, async () => {
  const original = dirname(dirname(fileURLToPath(import.meta.url)));
  const root = mkdtempSync(join(tmpdir(), 'komorebi-port-test-'));
  const project = join(root, 'project'), home = join(root, 'home'), workspace = join(root, 'workspace');
  mkdirSync(project); mkdirSync(home); mkdirSync(workspace);
  for (const name of ['bridge', 'src', 'scripts', 'public']) cpSync(join(original, name), join(project, name), { recursive: true });
  for (const name of ['server.ts', 'vite.config.ts', 'package.json', 'index.html']) cpSync(join(original, name), join(project, name));
  symlinkSync(realpathSync(join(original, 'node_modules')), join(project, 'node_modules'), 'dir');
  // Keep Vite's cache in this fixture even though package dependencies are shared read-only.
  const viteConfig = join(project, 'vite.config.ts');
  writeFileSync(viteConfig, readFileSync(viteConfig, 'utf8').replace('return {', "return {\n    cacheDir: './fixture-vite-cache',"));
  const groupId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const benchPath = join(workspace, '.komorebi-bench.json');
  const bench = JSON.stringify({ next: 2, tickets: [
    { id: 1, kind: 'task', status: 'new', groupId, createdAt: '2020-01-01T00:00:00.000Z',
      from: { modelId: 'CODEX' }, to: { modelId: 'AGY' } },
  ] });
  writeFileSync(benchPath, bench, { mode: 0o600 });
  writeFileSync(join(workspace, '.komorebi-bench-experience-group'), groupId, { mode: 0o600 });
  const config = join(project, '.env.komorebi-file-triggers.json');
  const marker = join(root, 'security-called');
  const initial = '{"invalid":"unchanged fixture"}\n'; writeFileSync(config, initial);
  const shim = join(root, 'isolation.mjs');
  writeFileSync(shim, `import os from 'node:os'; import child from 'node:child_process'; import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\n` +
    `os.homedir = () => process.env.KOMOREBI_TEST_HOME;\n` +
    `for (const name of ['execFileSync','spawnSync','execFile','spawn']) { const original=child[name]; child[name]=function(command,...args){ if(String(command).endsWith('/security') || command==='security'){fs.appendFileSync(process.env.KOMOREBI_TEST_SECURITY_MARKER, name+'\\n'); throw new Error('Keychain blocked by isolated test');} if(String(command).toLowerCase().includes('tailscale')) command='/usr/bin/false'; return original.call(this,command,...args); }; }\n` +
    `syncBuiltinESMExports();\n`);
  const occupier = createServer();
  await new Promise<void>((resolve, reject) => { occupier.once('error', reject); occupier.listen(0, '0.0.0.0', () => resolve()); });
  try {
    const port = (occupier.address() as { port: number }).port;
    const child = spawn(process.execPath, ['--import', shim, '--import', 'tsx', join(project, 'server.ts')], {
      cwd: project, env: { ...process.env, KOMOREBI_UI: 'dev', KOMOREBI_PORT: String(port), KOMOREBI_WORKSPACE: workspace,
        KOMOREBI_PAIRING_KEY: 'test-only-pairing-key-do-not-use', KOMOREBI_PRIVATE_FEATURES: 'rsi,file-trigger', KOMOREBI_TEST_HOME: home, KOMOREBI_TEST_SECURITY_MARKER: marker },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('second Bridge timed out')); }, 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    writeFileSync(join(root, 'bridge-output.log'), output);
    assert.equal(code, 1, output);
    assert.match(output, /address already in use|EADDRINUSE/i);
    assert.equal(readFileSync(config, 'utf8'), initial);
    assert.equal(existsSync(marker), false, 'second Bridge must not access Keychain before acquiring its port');
    assert.equal(readFileSync(benchPath, 'utf8'), bench, 'second Bridge must not expire work before acquiring its port');
    assert.equal(existsSync(join(workspace, '.komorebi-bench-experience.jsonl')), false);
  } finally { await new Promise<void>(resolve => occupier.close(() => resolve())); }
});
