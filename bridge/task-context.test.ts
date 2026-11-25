import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { taskContext } from '../scripts/task-context';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-context-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo');
  await mkdir(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const save = (message: string) => {
    git('add', '-A');
    git('-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'trial');
  return { dir, root, git, save };
}

test('task context uses the caller checkout, batches slices and limits file access', async t => {
  const { dir, root, save } = await fixture(t);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'README.md'), 'first\nsecond\nthird');
  const head = save('base');
  await writeFile(join(root, 'src', 'local.txt'), 'uncommitted');
  await writeFile(join(dir, 'external.txt'), 'outside');
  await symlink(join(dir, 'external.txt'), join(root, 'link.txt'));
  const result = await taskContext(join(root, 'src'), ['./README.md:2-2', 'src/local.txt', 'link.txt', 'missing']);
  assert.equal(result.branch, 'trial');
  assert.equal(result.head, head);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.startFiles, ['README.md']);
  assert.deepEqual(result.files[0], { path: 'README.md', from: 2, to: 2, shownTo: 2, totalLines: 3, truncated: false, eof: false, text: '2: second' });
  assert.ok('text' in result.files[1]);
  assert.equal(result.files[1].text, '1: uncommitted');
  assert.match(result.files[2].error!, /略過連結/);
  assert.match(result.files[3].error!, /不存在/);
  assert.equal(result.entries.includes('link.txt'), false);
  await assert.rejects(taskContext(root, Array(9).fill('README.md')));
});

test('preview returns complete lines and distinguishes clipping from reaching the end of the file', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'long.txt'), `lead\r\n${'字'.repeat(4000)}\r\nend\r\n`);
  await writeFile(join(root, 'short.txt'), 'short\nend\n');
  const { files } = await taskContext(root, ['long.txt:1-3', 'long.txt:2-2', 'short.txt:1-3', 'short.txt:3-3']);
  assert.deepEqual(files[0], { path: 'long.txt', from: 1, to: 3, shownTo: 1, totalLines: 3, truncated: true, eof: false, text: '1: lead' });
  assert.deepEqual(files[1], { path: 'long.txt', from: 2, to: 2, shownTo: null, totalLines: 3, truncated: true, eof: false, text: '' });
  assert.deepEqual(files[2], { path: 'short.txt', from: 1, to: 3, shownTo: 2, totalLines: 2, truncated: false, eof: true, text: '1: short\n2: end' });
  assert.deepEqual(files[3], { path: 'short.txt', totalLines: 2, error: '起行超過檔案長度。' });
});

test('invalid paths and ranges, binary assets and directories get individual errors', async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'asset.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff]));
  const { files } = await taskContext(root, ['../external.txt', 'asset.webp:1-81', 'asset.webp', 'src']);
  assert.match(files[0].error!, /可見相對路徑/);
  assert.match(files[1].error!, /最多 80 行/);
  assert.deepEqual(files[2], { path: 'asset.webp', bytes: 6, error: '檔案存在，但並非 UTF-8 純文字。' });
  assert.match(files[3].error!, /這是目錄/);
});

test('a ref is compared with the real HEAD and lists its changed files separately from checkout dirtiness', async t => {
  const { root, git, save } = await fixture(t);
  await writeFile(join(root, 'README.md'), 'committed');
  const first = save('root commit');
  const paths = Array.from({ length: 30 }, (_, i) => `file-${String(i).padStart(2, '0')}.txt`);
  for (const path of [...paths].reverse()) await writeFile(join(root, path), 'sample');
  const second = save('more files');
  git('switch', '-q', '--detach', 'HEAD');
  const context = await taskContext(root, [], first.slice(0, 12));
  assert.equal(context.head, second);
  assert.equal(context.branch, null);
  assert.equal(context.dirty, false);
  assert.deepEqual(context.ref, { requested: first.slice(0, 12), commit: first, matchesHead: false, changedFiles: ['README.md'], moreChangedFiles: false });
  await writeFile(join(root, 'CLAUDE.md'), 'untracked');
  await writeFile(join(root, 'package.json'), '{}');
  const dirty = await taskContext(root, ['CLAUDE.md'], 'HEAD');
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.ref?.matchesHead, true);
  assert.deepEqual(dirty.ref?.changedFiles, paths.slice(0, 16));
  assert.equal(dirty.ref?.moreChangedFiles, true);
  assert.deepEqual(dirty.startFiles, ['CLAUDE.md', 'README.md', 'package.json']);
  assert.deepEqual(dirty.entries, ['CLAUDE.md', 'README.md', ...paths.slice(0, 22)]);
  assert.equal(dirty.moreEntries, true);
  assert.ok('text' in dirty.files[0]);
  assert.equal(dirty.files[0].text, '1: untracked');
  const invalid = await taskContext(root, [], '--help');
  assert.equal(invalid.ref?.matchesHead, null);
  assert.match(invalid.ref?.error ?? '', /無法將指定 ref/);
});

test('eight slices of eighty lines work, and output is capped in UTF-8 bytes', async t => {
  const { root } = await fixture(t);
  const { boundedJson } = await import('../scripts/task-context');
  await writeFile(join(root, 'many.txt'), Array.from({ length: 80 }, (_, i) => `${i + 1} ${'字'.repeat(80)}`).join('\n'));
  const result = await taskContext(root, Array(8).fill('many.txt:1-80'));
  assert.equal(result.files.length, 8);
  assert.ok('to' in result.files[0]);
  assert.equal(result.files[0].to, 80);
  const output = boundedJson(result);
  assert.ok(Buffer.byteLength(output + '\n') <= 16 * 1024);
  assert.equal(JSON.parse(output).truncated, true);
});

test('grep accepts repeated patterns, excludes hidden, node_modules, links and large files, and caps matches', async t => {
  const { root, dir } = await fixture(t);
  const { searchWorktree } = await import('../scripts/task-context');
  await mkdir(join(root, 'node_modules')); await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'visible.txt'), 'alpha target\nbeta target\n');
  await writeFile(join(root, '.hidden', 'secret.txt'), 'alpha target');
  await writeFile(join(root, 'node_modules', 'secret.txt'), 'alpha target');
  await writeFile(join(root, 'oversize.txt'), 'alpha target' + 'x'.repeat(256 * 1024));
  await writeFile(join(dir, 'outside.txt'), 'alpha target');
  await symlink(join(dir, 'outside.txt'), join(root, 'outside-link'));
  const result = await searchWorktree(root, ['alpha', 'beta']);
  assert.deepEqual(result?.matches, ['visible.txt:1:alpha target', 'visible.txt:2:beta target']);
  await writeFile(join(root, 'visible.txt'), Array.from({ length: 60 }, () => 'alpha target').join('\n'));
  const limited = await searchWorktree(root, ['alpha']);
  assert.equal(limited?.matches.length, 50); assert.equal(limited?.truncated, true);
  await assert.rejects(searchWorktree(root, ['[']));
});

test('CLI falls back to git without rg and isolates grep errors from checkout data', async t => {
  const { root, dir, save } = await fixture(t);
  await mkdir(join(root, 'node_modules')); await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'tracked.txt'), 'alpha tracked\n');
  await writeFile(join(root, '.hidden', 'secret.txt'), 'alpha hidden\n');
  await writeFile(join(root, 'node_modules', 'secret.txt'), 'alpha dependency\n');
  await writeFile(join(root, 'large.txt'), 'alpha ' + 'x'.repeat(256 * 1024));
  await writeFile(join(dir, 'outside.txt'), 'alpha outside');
  await symlink(join(dir, 'outside.txt'), join(root, 'linked.txt'));
  save('base');
  await writeFile(join(root, 'untracked.txt'), 'alpha untracked\n');
  const cli = join(process.cwd(), 'scripts/komorebi-room.ts');
  const invoke = (pattern: string) => JSON.parse(execFileSync(process.execPath,
    ['--import', 'tsx', cli, 'task-context', '--repo', root, '--grep', pattern],
    { cwd: process.cwd(), env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }));
  const found = invoke('alpha');
  assert.equal(found.branch, 'trial');
  assert.deepEqual(found.search.matches.sort(), ['tracked.txt:1:alpha tracked', 'untracked.txt:1:alpha untracked']);
  await writeFile(join(root, 'untracked.txt'), Array.from({ length: 60 }, () => 'alpha target').join('\n'));
  const limited = invoke('alpha');
  assert.equal(limited.search.matches.length, 50);
  assert.equal(limited.search.truncated, true);
  const failed = invoke('[');
  assert.equal(failed.branch, 'trial');
  assert.ok(failed.head);
  assert.ok(failed.search.error);
});
