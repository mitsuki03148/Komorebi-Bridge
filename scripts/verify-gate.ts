// Summarize a checkout and run only the checks explicitly supplied by the caller.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const run = promisify(execFile);

async function check(cwd: string, command: string | undefined) {
  if (command === undefined) return { status: 'not run' as const };
  return new Promise<{ status: 'PASS' | 'FAIL'; exitCode: number | null; signal: string | null; tail: string; truncated: boolean }>(resolve => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', clipped = false, error = '';
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 32_768) { output = output.slice(-32_768); clipped = true; }
    };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', err => { error = err.message; });
    child.on('close', (code, signal) => {
      const lines = output.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
      const truncated = clipped || lines.length > 20;
      resolve({ status: code === 0 && !error ? 'PASS' : 'FAIL', exitCode: code, signal, tail: error || lines.slice(-20).join('\n'), truncated });
    });
  });
}

export async function changedTests(root: string, base: string) {
  const git = (args: string[]) => run('git', ['--no-optional-locks', '-C', root, ...args], { timeout: 5000, maxBuffer: 1024 * 1024 }).then(result => result.stdout);
  const [diff, untracked] = await Promise.all([
    git(['diff', '--name-only', '-z', base, '--']), git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const changed = [...new Set((diff + untracked).split('\0').filter(Boolean))];
  const tests = new Set<string>();
  for (const file of changed) {
    if (!file.endsWith('.ts')) continue;
    if (file.endsWith('.test.ts')) {
      if (await stat(join(root, file)).then(info => info.isFile(), () => false)) tests.add(file);
      continue;
    }
    const directory = dirname(file), stem = basename(file, '.ts');
    const entries = await readdir(join(root, directory)).catch(() => [] as string[]);
    for (const entry of entries) if (entry === `${stem}.test.ts` || (entry.startsWith(`${stem}-`) && entry.endsWith('.test.ts'))) tests.add(join(directory, entry));
  }
  return [...tests].sort();
}

export async function verifyGate(repo: string, base?: string, lint?: string, test?: string, testChanged = false) {
  const git = (args: string[]) => run('git', ['--no-optional-locks', '-C', repo, ...args], { timeout: 5000, maxBuffer: 1024 * 1024 }).then(result => result.stdout.trimEnd());
  const root = await git(['rev-parse', '--show-toplevel']);
  const baseSha = base === undefined ? undefined : await git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const selected = testChanged ? await changedTests(root, baseSha ?? 'HEAD') : undefined;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const lintResult = await check(root, lint);
  const testResult = await check(root, selected ? (selected.length ? `node --import tsx --test ${selected.map(quote).join(' ')}` : undefined) : test);
  // Checks can themselves change the checkout, so report the state after they finish.
  const [branch, head, status, diff] = await Promise.all([
    git(['branch', '--show-current']), git(['rev-parse', '--verify', 'HEAD']),
    git(['-c', 'core.fsmonitor=false', 'status', '--short', '--untracked-files=normal']),
    git(['diff', '--stat', 'HEAD', '--']),
  ]);
  let baseline;
  if (baseSha !== undefined) {
    const [ahead, behind] = (await git(['rev-list', '--left-right', '--count', `${baseSha}...${head}`])).split(/\s+/).map(Number);
    baseline = { requested: base, sha: baseSha, ahead: behind, behind: ahead };
  }
  return { root, branch: branch || null, head, ...(baseline ? { base: baseline } : {}), status: status || 'clean', diffStat: diff || '(none)', lint: lintResult, test: testResult,
    ...(selected ? { selectedTests: selected } : {}), ok: lintResult.status !== 'FAIL' && testResult.status !== 'FAIL' && (!selected || selected.length > 0) };
}
