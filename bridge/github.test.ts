import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { GitHub } from './github';

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }
function fake(routes: (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? 'GET', headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: init?.body as string | undefined };
    calls.push(call);
    const reply = routes(call) ?? { status: 404, body: { message: 'Not Found' } };
    const status = reply.status ?? 200;
    return new Response(status === 304 ? null : JSON.stringify(reply.body ?? {}), { status, headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) } });
  };
  let tokens = 0;
  const github = new GitHub({ token: async () => { tokens++; return 'SECRET-TOKEN'; }, fetch: impl as typeof fetch });
  return { github, calls, tokens: () => tokens };
}

test('every request carries the token, the API version and an agent name, and the token is fetched once', async () => {
  const { github, calls, tokens } = fake(() => ({ body: { default_branch: 'main' } }));
  await github.call('repo', { repo: 'o/r' });
  await github.call('repo', { repo: 'o/r2' });
  assert.equal(tokens(), 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer SECRET-TOKEN');
  assert.match(calls[0].headers['X-GitHub-Api-Version'], /\d{4}-\d\d-\d\d/);
  assert.ok(calls[0].headers['User-Agent']);
});

test('the repo list merges pages, drops nothing the user can see, sorts by last push, and carries no token', async () => {
  const repo = (name: string, pushed: string, extra = {}) => ({ full_name: name, private: false, default_branch: 'main', pushed_at: pushed, description: null, archived: false, fork: false, open_issues_count: 1, owner: { login: name.split('/')[0] }, ...extra });
  const { github, calls } = fake(call => {
    if (call.url.includes('/user/repos') && /[?&]page=1(&|$)/.test(call.url)) return { body: Array.from({ length: 100 }, (_, i) => repo(`me/r${i}`, `2026-11-01T00:00:${String(i % 60).padStart(2, '0')}Z`)), headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } };
    if (call.url.includes('/user/repos') && /[?&]page=2(&|$)/.test(call.url)) return { body: [repo('org/new', '2026-11-14T00:00:00Z', { private: true })] };
    return undefined;
  });
  const result = await github.call('repos', {}) as { repos: { fullName: string; private: boolean }[] };
  assert.equal(result.repos.length, 101);
  assert.equal(result.repos[0].fullName, 'org/new', 'the most recently pushed first');
  assert.equal(result.repos[0].private, true);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /SECRET-TOKEN/);
});

test('branches come back with the default one marked and the commit each points at', async () => {
  const { github } = fake(call => call.url.endsWith('/repos/o/r') ? { body: { default_branch: 'main' } }
    : call.url.includes('/repos/o/r/branches') ? { body: [{ name: 'feat/x', commit: { sha: 'b'.repeat(40) } }, { name: 'main', commit: { sha: 'a'.repeat(40) } }] } : undefined);
  const result = await github.call('branches', { repo: 'o/r' }) as { branches: { name: string; sha: string; isDefault: boolean }[] };
  assert.deepEqual(result.branches.map(branch => [branch.name, branch.isDefault]), [['main', true], ['feat/x', false]], 'the default first');
  assert.equal(result.branches[0].sha, 'a'.repeat(40));
});

test('a folder lists its entries, folders first; a file is decoded; a binary file and a big file are not shown', async () => {
  const b64 = (text: string | Buffer) => Buffer.from(text).toString('base64');
  const { github } = fake(call => {
    if (call.url.includes('/contents/src?')) return { body: [{ name: 'b.ts', path: 'src/b.ts', type: 'file', size: 10, sha: 's1' }, { name: 'lib', path: 'src/lib', type: 'dir', size: 0, sha: 's2' }] };
    if (call.url.includes('/contents/a.md?')) return { body: { type: 'file', name: 'a.md', path: 'a.md', size: 9, sha: 'x', encoding: 'base64', content: b64('# 標題\n內容') } };
    if (call.url.includes('/contents/bin.png?')) return { body: { type: 'file', name: 'bin.png', path: 'bin.png', size: 4, sha: 'y', encoding: 'base64', content: b64(Buffer.from([0x89, 0x50, 0, 0x47])) } };
    if (call.url.includes('/contents/big.log?')) return { body: { type: 'file', name: 'big.log', path: 'big.log', size: 5_000_000, sha: 'z', encoding: 'none', content: '' } };
    return undefined;
  });
  const dir = await github.call('tree', { repo: 'o/r', ref: 'main', path: 'src' }) as { kind: string; entries: { name: string; type: string }[] };
  assert.equal(dir.kind, 'dir');
  assert.deepEqual(dir.entries.map(entry => entry.name), ['lib', 'b.ts']);
  const text = await github.call('file', { repo: 'o/r', ref: 'main', path: 'a.md' }) as { text: string; binary: boolean; tooLarge: boolean };
  assert.equal(text.text, '# 標題\n內容');
  assert.equal(text.binary, false);
  const bin = await github.call('file', { repo: 'o/r', ref: 'main', path: 'bin.png' }) as { text?: string; binary: boolean };
  assert.equal(bin.binary, true);
  assert.equal(bin.text, undefined);
  const big = await github.call('file', { repo: 'o/r', ref: 'main', path: 'big.log' }) as { tooLarge: boolean; text?: string };
  assert.equal(big.tooLarge, true);
  assert.equal(big.text, undefined);
});

test('issues are always searched as issues of that repo (so pull requests never fill a page); one issue comes with its comments', async () => {
  const issue = (number: number, extra = {}) => ({ number, title: `題 ${number}`, state: 'open', user: { login: 'u' }, labels: [{ name: 'bug', color: 'ff0000' }], comments: 2, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', body: 'x', ...extra });
  const { github, calls } = fake(call => {
    if (call.url.includes('/search/issues') && decodeURIComponent(call.url).includes('crash on save')) return { body: { total_count: 1, items: [issue(9)] } };
    if (call.url.includes('/search/issues')) return { body: { total_count: 3, items: [issue(1), issue(2, { pull_request: {} }), issue(3)] } };
    if (/\/repos\/o\/r\/issues\/5$/.test(call.url)) return { body: issue(5, { body: '**粗體**\n\n- 一' }) };
    if (call.url.includes('/repos/o/r/issues/5/comments')) return { body: [{ id: 77, user: { login: 'v' }, body: '回覆', created_at: '2026-11-03T00:00:00Z' }] };
    return undefined;
  });
  const list = await github.call('issues', { repo: 'o/r', state: 'open' }) as { issues: { number: number }[] };
  assert.deepEqual(list.issues.map(item => item.number), [1, 3], 'a pull request that slips into the results is dropped');
  const plain = decodeURIComponent(calls[0].url);
  assert.match(plain, /repo:o\/r is:issue state:open/);
  assert.doesNotMatch(plain, /\/repos\/o\/r\/issues\?/);
  const found = await github.call('issues', { repo: 'o/r', state: 'all', query: 'crash on save' }) as { issues: { number: number }[] };
  assert.deepEqual(found.issues.map(item => item.number), [9]);
  const search = calls.find(call => decodeURIComponent(call.url).includes('crash on save'))!;
  assert.match(decodeURIComponent(search.url), /repo:o\/r/);
  assert.match(decodeURIComponent(search.url), /is:issue/);
  const one = await github.call('issue', { repo: 'o/r', number: 5 }) as { issue: { body: string }; comments: { id: number; body: string }[] };
  assert.equal(one.issue.body, '**粗體**\n\n- 一');
  assert.deepEqual(one.comments.map(comment => [comment.id, comment.body]), [[77, '回覆']]);
});

test('a commit gives its message, stats and each file with its patch; a compare gives the same between two branches', async () => {
  const files = [{ filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1,2 @@\n-a\n+b\n+c' }, { filename: 'big.bin', status: 'added', additions: 0, deletions: 0 }];
  const { github } = fake(call => {
    if (/\/commits\/abc1234$/.test(call.url)) return { body: { sha: 'abc1234'.padEnd(40, '0'), commit: { message: '標題\n\n內文', author: { name: 'A', date: '2026-11-01T00:00:00Z' } }, author: { login: 'a' }, stats: { additions: 2, deletions: 1, total: 3 }, files, parents: [{ sha: 'p' }] } };
    if (call.url.includes('/compare/main...feat%2Fx')) return { body: { ahead_by: 2, behind_by: 0, total_commits: 2, files, commits: [{ sha: 'c1', commit: { message: 'one', author: { name: 'A', date: '2026-11-01T00:00:00Z' } } }] } };
    return undefined;
  });
  const commit = await github.call('commit', { repo: 'o/r', sha: 'abc1234' }) as { message: string; files: { filename: string; patch?: string }[]; stats: { total: number } };
  assert.equal(commit.message, '標題\n\n內文');
  assert.equal(commit.stats.total, 3);
  assert.equal(commit.files[1].patch, undefined, 'a file with no patch (too big) is still listed');
  const compare = await github.call('compare', { repo: 'o/r', base: 'main', head: 'feat/x' }) as { aheadBy: number; files: unknown[] };
  assert.equal(compare.aheadBy, 2);
  assert.equal(compare.files.length, 2);
});

test('only well-formed names reach GitHub: no traversal, no odd characters, no way to name another host', async () => {
  const { github, calls } = fake(() => ({ body: {} }));
  for (const [op, params] of [
    ['repo', { repo: '../x' }], ['repo', { repo: 'o' }], ['repo', { repo: 'o/r/extra' }], ['repo', { repo: 'o/r?x=1' }], ['repo', { repo: 'o/r#h' }],
    ['tree', { repo: 'o/r', ref: 'main', path: '../../etc' }], ['tree', { repo: 'o/r', ref: 'a b', path: '' }], ['tree', { repo: 'o/r', ref: '--upload-pack', path: '' }],
    ['file', { repo: 'o/r', ref: 'main', path: 'a/../b' }], ['commit', { repo: 'o/r', sha: 'not-a-sha' }], ['issue', { repo: 'o/r', number: -1 }], ['issue', { repo: 'o/r', number: 1.5 }],
    ['issues', { repo: 'o/r', state: 'bogus' }], ['nope', {}], ['comment', { repo: 'o/r', number: 1 }],
  ] as [string, Record<string, unknown>][]) await assert.rejects(github.call(op, params), Error, `${op} ${JSON.stringify(params)}`);
  assert.equal(calls.length, 0, 'nothing was sent');
});

test('an answer that has not changed comes from the cache (304), without being counted again', async () => {
  let hit = 0;
  const { github, calls } = fake(call => {
    hit++;
    if (call.headers['If-None-Match'] === '"v1"') return { status: 304 };
    return { body: { default_branch: 'main', full_name: 'o/r' }, headers: { etag: '"v1"' } };
  });
  await github.call('repo', { repo: 'o/r' });
  const again = await github.call('repo', { repo: 'o/r' }) as { defaultBranch: string };
  assert.equal(again.defaultBranch, 'main');
  assert.equal(calls[1].headers['If-None-Match'], '"v1"');
  assert.equal(hit, 2);
});

test('GitHub errors are told plainly: no access, rate limit, a login that has run out', async () => {
  const run = async (status: number, headers: Record<string, string> = {}) => {
    const { github } = fake(() => ({ status, body: { message: 'x' }, headers }));
    return github.call('repo', { repo: 'o/r' }).then(() => '', (error: Error) => error.message);
  };
  assert.match(await run(404), /找不到|冇權限/);
  assert.match(await run(401), /gh auth login/);
  assert.match(await run(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }), /額度/);
});

test('replying posts one comment on one issue, with a length limit, and nothing else is ever written', async () => {
  const { github, calls } = fake(call => call.method === 'POST' ? { status: 201, body: { id: 5, html_url: 'https://github.com/o/r/issues/3#issuecomment-5', created_at: '2026-11-15T00:00:00Z', user: { login: 'me' }, body: '好' } } : undefined);
  const done = await github.call('comment', { repo: 'o/r', number: 3, body: '  好  ' }) as { id: number; htmlUrl: string };
  assert.equal(done.id, 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/repos\/o\/r\/issues\/3\/comments$/);
  assert.deepEqual(JSON.parse(calls[0].body!), { body: '好' });
  await assert.rejects(github.call('comment', { repo: 'o/r', number: 3, body: '   ' }), /內容/);
  await assert.rejects(github.call('comment', { repo: 'o/r', number: 3, body: 'x'.repeat(20_001) }), /太長/);
  assert.equal(calls.length, 1, 'the refused ones never reached GitHub');
  const source = await readFile(new URL('./github.ts', import.meta.url), 'utf8');
  assert.equal([...source.matchAll(/this\.request\('(POST|PUT|PATCH|DELETE)'/g)].length, 1, 'one write call in the whole module');
  assert.equal([...source.matchAll(/this\.request\('POST'/g)].length, 1, 'and it is the comment');
  assert.doesNotMatch(source, /request\('(PUT|PATCH|DELETE)'/);
});

test('the server answers GH requests with the result or the reason, and never sends the token', async () => {
  const server = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /new GitHub\(/);
  assert.match(server, /event\?\.type === 'GH'[\s\S]{0,500}github\.call\(/);
  assert.match(server, /type: 'GH_RESULT'/);
});
