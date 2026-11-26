import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

// Exercise the file-level teardown in its own test process.
test('cleans created temporary folders while retaining existing files and requested evidence', t => {
  const root = mkdtempSync(join(tmpdir(), 'komorebi-temp-helper-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidence = join(root, 'evidence');
  mkdirSync(evidence);
  const sentinel = join(root, 'existing.txt');
  writeFileSync(sentinel, 'keep');
  const script = join(root, 'child.mjs');
  const helper = pathToFileURL(join(process.cwd(), 'bridge/test-temp.ts')).href;
  writeFileSync(script, `import { test } from 'node:test';\nimport { mkdtemp, mkdtempSync } from ${JSON.stringify(helper)};\nimport { join } from 'node:path';\ntest('make fixtures', async () => { await mkdtemp(join(process.env.KOMOREBI_TEST_TEMP_ROOT, 'async-')); mkdtempSync(join(process.env.KOMOREBI_TEST_TEMP_ROOT, 'sync-')); mkdtempSync(join(process.env.RSI_TIDY_EVIDENCE, 'rsi-tidy-')); if (process.env.KOMOREBI_TEST_TEMP_FAIL) throw new Error('intentional fixture failure'); });\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, KOMOREBI_TEST_TEMP_ROOT: root, RSI_TIDY_EVIDENCE: evidence };
  delete env.NODE_TEST_CONTEXT;
  delete env.KOMOREBI_TEST_TEMP_FAIL;
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', script], {
    cwd: process.cwd(), encoding: 'utf8', env,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
  const names = readdirSync(root);
  assert.equal(names.some(name => name.startsWith('async-') || name.startsWith('sync-')), false);
  assert.equal(readdirSync(evidence).filter(name => name.startsWith('rsi-tidy-')).length, 1, run.stdout + run.stderr);
  assert.equal(existsSync(evidence), true);
  const failed = spawnSync(process.execPath, ['--import', 'tsx', '--test', script], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...env, KOMOREBI_TEST_TEMP_FAIL: '1' },
  });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stdout + failed.stderr, /intentional fixture failure/);
  assert.equal(readdirSync(root).some(name => name.startsWith('async-') || name.startsWith('sync-')), false);
  assert.equal(readdirSync(evidence).filter(name => name.startsWith('rsi-tidy-')).length, 2);
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
});
