// Contents
// Check the generated map — Exercise refresh, stale checks and marker boundaries in a Git fixture.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from './test-temp';

// Check the generated map
// The fixture tracks only the files that should appear in the inventory.
test('source map detects stale sections, regenerates and preserves text outside its markers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'source-map-'));
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'bridge'));
  await mkdir(join(dir, 'scripts'));
  const source = join(dir, 'src', 'feature.ts');
  await writeFile(source, '// Contents\n// First section\n\n// First section\n// Original description.\nexport const a = 1;\n');
  await writeFile(join(dir, 'bridge', 'new.ts'), 'export const b = 2;\n');
  await writeFile(join(dir, 'bridge', 'ignored.test.ts'), '// Contents\n// Not product code\n');
  await writeFile(join(dir, 'scripts', 'example.sh'), '#!/bin/sh\necho hello\n');
  await writeFile(join(dir, 'src', 'untracked.ts'), '// Contents\n// Not tracked\n');
  const map = join(dir, 'SOURCE-MAP.md');
  const prefix = '# Manual\n\nKeep this text.\n<!-- source-map:start -->';
  const suffix = '<!-- source-map:end -->\n\nKeep the ending.\n';
  await writeFile(map, `${prefix}\nold generated content\n${suffix}`);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', 'src/feature.ts', 'bridge/new.ts', 'bridge/ignored.test.ts', 'scripts/example.sh']);
  const script = fileURLToPath(new URL('../scripts/source-map.ts', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), script, ...args], { cwd: dir, encoding: 'utf8' });

  const firstCheck = run('--check');
  assert.equal(firstCheck.status, 1);
  assert.match(firstCheck.stderr, /請跑 npm run source-map/);
  assert.equal(run().status, 0);
  const generated = await readFile(map, 'utf8');
  assert.ok(generated.startsWith(prefix) && generated.endsWith(suffix));
  assert.match(generated, /First section — Original description\./);
  assert.match(generated, /### 未整理\n\n- `bridge\/new\.ts`/);
  assert.match(generated, /- `scripts\/example\.sh`/);
  assert.doesNotMatch(generated, /ignored\.test|untracked\.ts/);
  assert.equal(run('--check').status, 0);

  await writeFile(source, '// Contents\n// Changed — New description.\n\nexport const a = 1;\n');
  const stale = run('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /請跑 npm run source-map/);
  assert.equal(await readFile(map, 'utf8'), generated, 'check never writes');
  assert.equal(run().status, 0);
  assert.equal(run('--check').status, 0);
  const refreshed = await readFile(map, 'utf8');
  assert.ok(refreshed.startsWith(prefix) && refreshed.endsWith(suffix));
  assert.match(refreshed, /Changed — New description\./);
  assert.doesNotMatch(refreshed, /Original description/);
});

test('source map refuses malformed markers without changing the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'source-map-markers-'));
  const map = join(dir, 'SOURCE-MAP.md');
  const original = '<!-- source-map:start -->\nno end\n';
  await writeFile(map, original);
  execFileSync('git', ['init', '-q', dir]);
  const script = fileURLToPath(new URL('../scripts/source-map.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), script], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /必須有一組正確的 source-map 標記/);
  assert.equal(await readFile(map, 'utf8'), original);
});
