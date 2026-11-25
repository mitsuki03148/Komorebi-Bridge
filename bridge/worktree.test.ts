import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { Bench } from './bench';
import { benchRequest } from './bench-server';
import { diffWorktree, listWorktree, readWorktreeFile, resolveInside, splitDiff, worktreeCall } from './worktree';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });

async function repo() {
  const base = await mkdtemp(join(tmpdir(), 'worktree-'));
  const root = join(base, 'room');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(root, '.secret'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# hi\n');
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(join(root, '.env'), 'TOKEN=x\n');
  await writeFile(join(base, 'outside.txt'), 'private');
  git(root, 'init', '-q', '-b', 'main');
  git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'README.md', 'src');
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'first'], {
    stdio: 'pipe', env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
  });
  return { base, root };
}

test('paths stay inside the room folder: no .., no absolute, no hidden, no symlink out', async () => {
  const { base, root } = await repo();
  try {
    await symlink(join(base, 'outside.txt'), join(root, 'link.txt'));
    await symlink(base, join(root, 'up'));
    for (const bad of ['../outside.txt', 'src/../../outside.txt', '/etc/passwd', '.env', '.secret', 'src/./a.ts', 'a\0b']) {
      await assert.rejects(resolveInside(root, bad), /./, bad);
    }
    await assert.rejects(readWorktreeFile(root, 'link.txt'), /不在這間房/);
    await assert.rejects(listWorktree(root, 'up'), /不在這間房/);
    await assert.rejects(worktreeCall(root, 'write', {}), /不開放/);
    assert.equal((await resolveInside(root, 'src/a.ts')).rel, 'src/a.ts');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('listing hides dotfiles, node_modules and links that leave the folder', async () => {
  const { base, root } = await repo();
  try {
    await symlink(join(base, 'outside.txt'), join(root, 'link.txt'));
    const top = await listWorktree(root);
    assert.deepEqual(top.dirs, ['src']);
    assert.deepEqual(top.files.map(file => file.name), ['README.md']);
    assert.equal(top.files[0].kind, 'text');
    assert.deepEqual((await listWorktree(root, 'src')).files.map(file => file.name), ['a.ts']);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('reading gives text, an image as a data link, and refuses to print binary', async () => {
  const { base, root } = await repo();
  try {
    await writeFile(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, 'blob.bin'), Buffer.from([1, 2, 0, 3]));
    const text = await readWorktreeFile(root, 'src/a.ts');
    assert.equal(text.kind === 'text' && text.text.includes('export const a'), true);
    const image = await readWorktreeFile(root, 'shot.png');
    assert.equal(image.kind === 'image' && image.dataUrl.startsWith('data:image/png;base64,'), true);
    assert.equal((await readWorktreeFile(root, 'blob.bin')).kind, 'binary');
    await assert.rejects(readWorktreeFile(root, 'src'), /不是檔案/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('diff shows edits, deletions and new files, and the last commit', async () => {
  const { base, root } = await repo();
  try {
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n');
    await writeFile(join(root, 'notes.md'), 'new\nfile\n');
    await writeFile(join(root, '.hidden-new'), 'x');
    await rm(join(root, 'README.md'));
    const work = await diffWorktree(root, 'work');
    const byPath = Object.fromEntries(work.files.map(file => [file.path, file]));
    assert.equal(byPath['src/a.ts'].status, 'modified');
    assert.equal(byPath['src/a.ts'].add, 2);
    assert.equal(byPath['src/a.ts'].del, 1);
    assert.equal(byPath['README.md'].status, 'deleted');
    assert.equal(byPath['notes.md'].status, 'added');
    assert.equal(byPath['notes.md'].add, 2);
    assert.equal('.hidden-new' in byPath, false);
    assert.equal('.env' in byPath, false);
    const last = await diffWorktree(root, 'commit');
    assert.match(last.subject ?? '', /first/);
    assert.equal(last.files.some(file => file.path === 'src/a.ts' && file.status === 'added'), true);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a folder that is not a Git project says so, and a repo with no commit still lists new files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'worktree-'));
  try {
    await writeFile(join(base, 'x.txt'), 'x');
    assert.deepEqual(await worktreeCall(base, 'worktrees', {}), { entries: [] });
    await assert.rejects(diffWorktree(base, 'work'), /不是 Git/);
    git(base, 'init', '-q');
    const fresh = await diffWorktree(base, 'work');
    assert.deepEqual(fresh.files.map(file => file.path), ['x.txt']);
    assert.deepEqual((await diffWorktree(base, 'commit')).files, []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('worktrees lists the room first, then recent branches and detached checkouts, and suggests only an exact branch', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'feature space');
    const missing = join(base, 'missing');
    const detached = join(base, 'detached');
    const head = git(root, 'rev-parse', 'HEAD').toString().trim().slice(0, 7);
    git(root, 'worktree', 'add', '-q', '-b', 'feature/music', linked);
    git(root, 'worktree', 'add', '-q', '--detach', detached);
    git(root, 'worktree', 'add', '-q', '-b', 'old', missing);
    await rename(missing, join(base, 'moved-away'));
    git(linked, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'new checkout commit');
    const linkedHead = git(linked, 'rev-parse', 'HEAD').toString().trim().slice(0, 7);

    const result = await worktreeCall(root, 'worktrees', {}, 'feature/music');
    assert.ok('entries' in result);
    assert.deepEqual(result.entries.map(entry => [entry.branch, entry.head, entry.exists, entry.isRoom]), [
      ['main', head, true, true], ['feature/music', linkedHead, true, false], [null, head, true, false], ['old', head, false, false],
    ]);
    assert.equal(result.suggestedWorktree, result.entries[1].path);
    for (const branch of ['main', 'feature', 'old', head]) {
      const fallback = await worktreeCall(root, 'worktrees', {}, branch);
      assert.ok('entries' in fallback);
      assert.equal(fallback.suggestedWorktree, undefined);
    }
    const linkedRoom = await worktreeCall(join(linked, 'src'), 'worktrees', {}, 'feature/music');
    assert.ok('entries' in linkedRoom);
    assert.equal(linkedRoom.entries[0].branch, 'feature/music');
    assert.equal(linkedRoom.suggestedWorktree, undefined);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('list, read and both diff modes use the registered worktree, keeping the room folder as the default', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'linked');
    const alias = join(base, 'alias');
    git(root, 'worktree', 'add', '-q', '-b', 'feature', linked);
    await symlink(linked, alias);
    git(linked, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'feature commit');
    await writeFile(join(linked, 'src', 'a.ts'), 'linked edit\n');
    await writeFile(join(linked, 'linked.md'), 'linked file\n');
    await writeFile(join(root, 'main.md'), 'main file\n');

    const listing = await worktreeCall(root, 'list', { worktree: alias });
    assert.ok('dirs' in listing);
    assert.deepEqual(listing.files.map(file => file.name), ['linked.md', 'README.md']);
    const file = await worktreeCall(root, 'read', { worktree: linked, path: 'linked.md' });
    assert.ok('text' in file);
    assert.equal(file.text, 'linked file\n');
    const diff = await worktreeCall(root, 'diff', { worktree: linked });
    assert.ok('mode' in diff);
    assert.deepEqual(diff.files.map(file => file.path), ['src/a.ts', 'linked.md']);
    assert.match(diff.files[0].patch, /\+linked edit/);
    const main = await worktreeCall(root, 'diff', {});
    assert.ok('mode' in main);
    assert.deepEqual(main.files.map(file => file.path), ['main.md']);
    const commit = await worktreeCall(root, 'diff', { worktree: linked, mode: 'commit' });
    assert.ok('mode' in commit);
    assert.match(commit.subject ?? '', /feature commit/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('the automatic branch remains selectable when recent worktrees fill the picker', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'older feature');
    git(root, 'worktree', 'add', '-q', '-b', 'feature', linked);
    git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'recent');
    for (let index = 0; index < 60; index++) {
      git(root, 'worktree', 'add', '-q', '--no-checkout', '--detach', join(base, `recent-${index}`));
    }
    const regular = await worktreeCall(root, 'worktrees', {});
    const automatic = await worktreeCall(root, 'worktrees', {}, 'feature');
    assert.ok('entries' in regular && 'entries' in automatic);
    assert.equal(regular.entries.length, 60);
    assert.equal(regular.entries.some(entry => entry.branch === 'feature'), false);
    const search = await worktreeCall(root, 'worktrees', { query: 'OLDER feature' });
    assert.ok('entries' in search);
    assert.deepEqual(search.entries.map(entry => entry.branch), ['feature'], 'search filters before applying the cap');
    const selection = await worktreeCall(root, 'worktrees', { worktree: search.entries[0].path });
    assert.ok('entries' in selection);
    assert.ok(selection.entries.some(entry => entry.branch === 'feature'), 'reopening retains a saved choice outside the cap');
    const selected = await worktreeCall(root, 'read', { worktree: search.entries[0].path, path: 'README.md' });
    assert.ok('text' in selected && selected.text === '# hi\n', 'search results may be used by file operations');
    assert.equal(automatic.entries.length, 60);
    assert.equal(automatic.entries.at(-1)?.path, automatic.suggestedWorktree);
    assert.equal(automatic.entries.at(-1)?.branch, 'feature');
    const file = await worktreeCall(root, 'read', { worktree: automatic.suggestedWorktree, path: 'README.md' }, 'feature');
    assert.ok('text' in file);
    assert.equal(file.text, '# hi\n');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('full branch diff includes all branch commits and local work from the merge base', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'branch');
    const fork = git(root, 'rev-parse', '--short=7', 'HEAD').toString().trim();
    git(root, 'worktree', 'add', '-q', '-b', 'feature', linked);
    for (const [checkout, name] of [[linked, 'first.md'], [linked, 'second.md'], [root, 'main-only.md']]) {
      await writeFile(join(checkout, name), name + '\n');
      git(checkout, 'add', name);
      git(checkout, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', name);
    }
    await writeFile(join(linked, 'README.md'), '# working reader\n');
    await writeFile(join(linked, 'untracked.md'), 'new draft\n');
    const diff = await worktreeCall(root, 'diff', { worktree: linked, mode: 'branch' });
    assert.ok('mode' in diff);
    assert.equal(diff.mode, 'branch');
    assert.equal(diff.subject, `main · ${fork}`);
    assert.deepEqual(diff.files.map(file => file.path).sort(), ['README.md', 'first.md', 'second.md', 'untracked.md']);
    assert.match(diff.files.find(file => file.path === 'README.md')?.patch ?? '', /working reader/);
    assert.deepEqual((await diffWorktree(linked, 'work')).files.map(file => file.path).sort(), ['README.md', 'untracked.md']);
    assert.deepEqual((await diffWorktree(linked, 'commit')).files.map(file => file.path), ['second.md']);
    for (let index = 0; index < 8; index++) await writeFile(join(linked, `large-${index}.md`), 'x'.repeat(60_000));
    const large = await diffWorktree(linked, 'branch');
    assert.equal(large.truncated, true);
    assert.equal(large.files.length, 12, 'the patch budget preserves every file row');
    assert.ok(large.files.reduce((total, file) => total + file.patch.length, 0) <= 400_000);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('the local claim launcher follows the real checkout and remembers it when a ticket finishes or Bridge restarts', async () => {
  const { base, root } = await repo();
  const linked = join(base, 'My Music');
  const path = join(base, 'bench.json');
  const bench = new Bench(path);
  const owner = { id: 'worker', roomName: 'worker', modelId: 'CODEX', repoPath: root, gitBranch: 'main', logs: [] } as unknown as TerminalRoom;
  const other = { ...owner, id: 'lead', roomName: 'lead' };
  const group: GroupChat = { id: 'g', name: 'Group', createdAt: '', members: [owner, other].map(({ id, modelId }) => ({ roomId: id, modelId })) };
  const from = { sessionId: other.id, roomName: other.roomName, modelId: other.modelId };
  const to = { sessionId: owner.id, roomName: owner.roomName, modelId: owner.modelId };
  const deps = { bench, rooms: () => [owner, other], groups: () => [group], tool: 'komorebi-room', note() {}, notice() {} };
  const socket = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  try {
    await once(socket, 'listening');
    const port = (socket.address() as { port: number }).port;
    socket.on('connection', client => {
      client.send(JSON.stringify({ type: 'SNAPSHOT', rooms: [owner, other], groups: [group] }));
      client.on('message', async raw => {
        const event = JSON.parse(raw.toString());
        client.send(JSON.stringify(await benchRequest(deps, event)));
      });
    });
    git(root, 'worktree', 'add', '-q', '-b', 'feature/music', linked);
    const task = bench.send({ groupId: group.id, from, to, body: 'My Music 任務', ref: 'main' });
    bench.takeNew(owner.id);
    const claim = await promisify(execFile)(resolve('scripts/komorebi-room'), ['bench', 'claim', 'Music module', '--from', owner.id], {
      cwd: join(linked, 'src'), env: { ...process.env, KOMOREBI_URL: `http://127.0.0.1:${port}` }, timeout: 20_000,
    });
    assert.match(claim.stdout, /已認領/);
    const canonical = await realpath(linked);
    assert.deepEqual(bench.lastWorktree(owner.id), { path: canonical, title: 'My Music 任務' });
    assert.equal(bench.lastWorktree(other.id), undefined);

    const claimFrom = (claimCwd: string, scope: string) => benchRequest(deps, { action: 'claim', requestId: 'test', from: owner.id, scope, claimCwd });
    const outside = join(base, 'unrelated');
    await mkdir(outside);
    git(outside, 'init', '-q');
    const nested = join(linked, 'unrelated');
    await mkdir(nested);
    git(nested, 'init', '-q');
    for (const cwd of [outside, nested]) {
      assert.equal((await claimFrom(cwd, 'Other scope')).ok, true);
      assert.equal(bench.lastWorktree(owner.id)?.path, canonical);
    }
    bench.claim(group.id, from, 'Taken');
    assert.equal((await claimFrom(root, 'Taken')).ok, false);
    assert.equal(bench.lastWorktree(owner.id)?.path, canonical);

    bench.done(task.id, owner.id);
    bench.release(group.id, owner.id);
    const remembered = new Bench(path).lastWorktree(owner.id);
    const reopened = await worktreeCall(root, 'worktrees', {}, 'main', remembered);
    assert.ok('entries' in reopened);
    assert.equal(reopened.suggestedTitle, 'My Music 任務');
    assert.equal(reopened.suggestedWorktree, reopened.entries.find(entry => entry.branch === 'feature/music')?.path);
    await writeFile(join(linked, 'README.md'), 'task edit\n');
    const diff = await worktreeCall(root, 'diff', { worktree: reopened.suggestedWorktree });
    assert.ok('mode' in diff);
    assert.match(diff.files[0].patch, /\+task edit/);

    await rename(linked, join(base, 'old Music'));
    await symlink(outside, linked);
    const stale = await worktreeCall(root, 'worktrees', {}, 'main', remembered);
    assert.ok('entries' in stale);
    assert.equal(stale.suggestedWorktree, undefined);
    assert.equal(stale.suggestedTitle, undefined);
  } finally {
    for (const client of socket.clients) client.terminate();
    await new Promise<void>(resolve => socket.close(() => resolve()));
    await rm(base, { recursive: true, force: true });
  }
});

test('worktree selection refuses unregistered folders and stale registrations belonging to another repo', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'linked');
    const outside = join(base, 'other repo');
    await mkdir(outside);
    git(outside, 'init', '-q');
    git(root, 'worktree', 'add', '-q', '--detach', linked);
    await symlink(join(base, 'outside.txt'), join(linked, 'outside.txt'));
    await assert.rejects(worktreeCall(root, 'read', { worktree: linked, path: 'outside.txt' }), /不在這間房/);
    for (const op of ['list', 'read', 'diff']) {
      for (const worktree of [outside, join(linked, 'src'), 'linked', null]) {
        await assert.rejects(worktreeCall(root, op, { worktree }), /工作樹不屬於/);
      }
    }
    await rename(linked, join(base, 'old linked'));
    await symlink(outside, linked);
    await assert.rejects(worktreeCall(root, 'list', { worktree: linked }), /工作樹不屬於/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('a lead and reviewer without linked claims can follow the checkout explicitly assigned on a recent group ticket', async () => {
  const { base, root } = await repo();
  try {
    const linked = join(base, 'Music');
    git(root, 'worktree', 'add', '-q', '-b', 'feature/music', linked);
    const bench = new Bench();
    const lead = { id: 'lead', sessionId: 'lead-session', roomName: 'Lead', modelId: 'CODEX' } as const;
    const reviewer = { id: 'reviewer', sessionId: 'reviewer-session', roomName: 'Reviewer', modelId: 'CODEX' } as const;
    const member = { id: 'member', sessionId: 'member-session', roomName: 'Member', modelId: 'CODEX' } as const;
    const group: GroupChat = { id: 'g', name: 'Music', createdAt: '', orchestratorRoomId: lead.id,
      members: [lead, reviewer, member].map(room => ({ roomId: room.id, modelId: room.modelId })) };
    const assigned = bench.send({ groupId: group.id, from: lead, to: reviewer, repo: linked, ref: 'main', body: 'Music review' });
    bench.done(assigned.id, reviewer.sessionId);
    const cancelled = bench.send({ groupId: group.id, from: lead, to: reviewer, repo: join(base, 'Cancelled'), body: 'Cancelled work' });
    bench.cancel(cancelled.id, [lead.sessionId]);
    bench.send({ groupId: group.id, from: lead, to: reviewer, repo: base, body: 'Unregistered directory' });
    bench.send({ groupId: 'different-group', from: lead, to: reviewer, repo: linked, body: 'Unrelated group' });
    bench.send({ groupId: group.id, from: member, to: reviewer, repo: root, body: 'Ordinary member dispatch' });
    assert.deepEqual(bench.worktreeTickets(member, [group]), []);
    for (const room of [lead, reviewer]) {
      const tickets = bench.worktreeTickets(room, [group]);
      assert.equal(tickets.at(-1)?.title, 'Music review');
      assert.equal(tickets.some(ticket => /Cancelled|Unrelated/.test(ticket.title)), false);
      const result = await worktreeCall(root, 'worktrees', {}, 'main', { path: await realpath(root) }, tickets);
      assert.ok('entries' in result);
      assert.equal(result.suggestedTitle, 'Music review');
      assert.equal(await realpath(result.suggestedWorktree!), await realpath(linked));
      const claimed = await worktreeCall(root, 'worktrees', {}, 'main', { path: await realpath(linked), title: 'Actual claim' }, tickets);
      assert.ok('entries' in claimed);
      assert.equal(claimed.suggestedTitle, 'Actual claim');
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('splitDiff reads renames, counts lines and cuts a very long patch', () => {
  const rename = 'diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b\n';
  const [file] = splitDiff(rename);
  assert.deepEqual([file.path, file.status, file.add, file.del], ['new.ts', 'renamed', 1, 1]);
  const [long] = splitDiff(`diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+${'y'.repeat(70_000)}\n`);
  assert.equal(long.truncated, true);
  assert.equal(long.patch.length, 60_000);
  assert.equal(splitDiff('diff --git a/p.png b/p.png\nBinary files a/p.png and b/p.png differ\n')[0].binary, true);
});

test('the layer starts closed with only its edge tab, and never offers a write action', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { readFile } = await import('node:fs/promises');
  const { WorktreeLayer } = await import('../src/components/WorktreePanel');
  const html = renderToStaticMarkup(createElement(WorktreeLayer, { roomId: 'r1', call: (async () => ({})) as never }));
  assert.match(html, /data-no-swipe/);
  assert.doesNotMatch(html, /data-worktree/);
  const source = await readFile(new URL('../src/components/WorktreePanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'(?:write|delete|stage|revert|checkout)'/);
  assert.match(source, /<input type="search"/);
  assert.match(source, /open && searching &&/);
  assert.match(source, /'worktree.picker.follow'/);
  assert.match(source, /localStorage.setItem\(worktreeStorageKey\(active\), value\)/);
  assert.match(source, /useLoad<RepoWorktrees>\(call, 'worktrees', query \? \{ roomId, query \}/);
});
