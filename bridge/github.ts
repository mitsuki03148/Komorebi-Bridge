// A read-only window onto GitHub for the app's GitHub panel, plus one write: a reply on an issue.
// The Bridge asks GitHub with the token `gh` already holds; the token never leaves this process. The app can only name an operation
// and its (checked) parameters, never a URL, so the Bridge is not a general GitHub proxy.
import { execFile } from 'node:child_process';

export interface GitHubDeps { token: () => Promise<string>; fetch?: typeof fetch }

const API = 'https://api.github.com';
const filePageLimit = 400_000;
export const commentLimit = 20_000;

const part = /^[A-Za-z0-9._-]{1,100}$/;
const fail = (message: string): never => { throw new Error(message); };
const asObject = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function repoOf(value: unknown) {
  const [owner, name, extra] = typeof value === 'string' ? value.split('/') : [];
  if (extra !== undefined || !owner || !name || !part.test(owner) || !part.test(name) || owner.startsWith('.') || name.startsWith('.')) fail('repo 名稱無效。');
  return { owner, name, slug: `${owner}/${name}` };
}
function refOf(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 250 || value.startsWith('-') || value.startsWith('/') || value.includes('..') || /[\s~^:?*[\\\u0000-\u001f]/.test(value)) fail('branch 名稱無效。');
  return value as string;
}
function pathOf(value: unknown) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u001f\\]/.test(value)) fail('路徑無效。');
  const segments = (value as string).split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) fail('路徑無效。');
  return segments.map(encodeURIComponent).join('/');
}
const shaOf = (value: unknown) => (typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value) ? value : fail('commit 編號無效。'));
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 10_000_000 ? value : fail('編號無效。'));
const pageOf = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50 ? value : 1);
const queryOf = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

const mapUser = (user: unknown) => (asObject(user).login as string | undefined) ?? '';
const mapLabels = (labels: unknown) => (Array.isArray(labels) ? labels.map(label => ({ name: String(asObject(label).name ?? ''), color: String(asObject(label).color ?? '') })) : []);
const mapIssue = (raw: Record<string, unknown>) => ({
  number: raw.number as number, title: String(raw.title ?? ''), state: String(raw.state ?? ''), author: mapUser(raw.user), labels: mapLabels(raw.labels),
  comments: Number(raw.comments ?? 0), createdAt: String(raw.created_at ?? ''), updatedAt: String(raw.updated_at ?? ''), body: String(raw.body ?? ''),
});
const mapFile = (raw: Record<string, unknown>) => ({
  filename: String(raw.filename ?? ''), status: String(raw.status ?? ''), additions: Number(raw.additions ?? 0), deletions: Number(raw.deletions ?? 0),
  previous: raw.previous_filename ? String(raw.previous_filename) : undefined, patch: typeof raw.patch === 'string' ? raw.patch : undefined,
});
const mapCommitBrief = (raw: Record<string, unknown>) => {
  const commit = asObject(raw.commit), author = asObject(commit.author);
  return { sha: String(raw.sha ?? ''), message: String(commit.message ?? ''), author: String(asObject(raw.author).login ?? author.name ?? ''), date: String(author.date ?? '') };
};

export class GitHub {
  private token?: string;
  private readonly cache = new Map<string, { etag: string; data: unknown }>();
  private readonly doFetch: typeof fetch;

  constructor(private readonly deps: GitHubDeps) { this.doFetch = deps.fetch ?? fetch; }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ data: unknown; link?: string }> {
    this.token ??= await this.deps.token();
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'komorebi-bridge' };
    const cached = method === 'GET' ? this.cache.get(path) : undefined;
    if (cached) headers['If-None-Match'] = cached.etag;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.doFetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 304 && cached) return { data: cached.data, link: undefined };
    if (!response.ok) {
      if (response.status === 401) { this.token = undefined; return fail('GitHub 登入失效，請在 Mac 執行 gh auth login。'); }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        const minutes = Math.max(1, Math.ceil((Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now()) / 60_000));
        return fail(`額度用完，約 ${minutes} 分鐘後再試。`);
      }
      if (response.status === 404) return fail('找不到，或沒有權限。');
      if (response.status === 403) return fail('沒有權限。');
      const message = asObject(await response.json().catch(() => ({}))).message;
      return fail(`GitHub 回覆 ${response.status}${typeof message === 'string' ? `：${message}` : ''}`);
    }
    const data: unknown = await response.json();
    const etag = response.headers.get('etag');
    if (method === 'GET' && etag) { if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!); this.cache.set(path, { etag, data }); }
    return { data, link: response.headers.get('link') ?? undefined };
  }

  private async pages(path: string, max: number) {
    const all: unknown[] = [];
    for (let page = 1; page <= max; page++) {
      const { data, link } = await this.request('GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}`);
      if (Array.isArray(data)) all.push(...data);
      if (!link || !/rel="next"/.test(link)) break;
    }
    return all as Record<string, unknown>[];
  }

  /** Run one named operation with its parameters. Anything not named here, or with a parameter that does not check out, is refused before GitHub is asked. */
  async call(op: string, raw: unknown): Promise<unknown> {
    const params = asObject(raw);
    switch (op) {
      case 'repos': {
        const items = await this.pages('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', 5);
        const repos = items.map(item => ({ fullName: String(item.full_name), private: item.private === true, defaultBranch: String(item.default_branch ?? 'main'), pushedAt: String(item.pushed_at ?? ''),
          description: typeof item.description === 'string' ? item.description : '', archived: item.archived === true, fork: item.fork === true, openIssues: Number(item.open_issues_count ?? 0) }));
        repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
        return { repos };
      }
      case 'repo': {
        const repo = repoOf(params.repo);
        const { data } = await this.request('GET', `/repos/${repo.slug}`);
        const info = asObject(data);
        return { fullName: String(info.full_name ?? repo.slug), defaultBranch: String(info.default_branch ?? 'main'), private: info.private === true };
      }
      case 'branches': {
        const repo = repoOf(params.repo);
        const info = asObject((await this.request('GET', `/repos/${repo.slug}`)).data);
        const defaultBranch = String(info.default_branch ?? 'main');
        const items = await this.pages(`/repos/${repo.slug}/branches?per_page=100`, 5);
        const branches = items.map(item => ({ name: String(item.name), sha: String(asObject(item.commit).sha ?? ''), isDefault: item.name === defaultBranch }));
        branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
        return { branches, defaultBranch };
      }
      case 'tree': case 'file': {
        const repo = repoOf(params.repo), ref = refOf(params.ref), path = pathOf(params.path);
        const { data } = await this.request('GET', `/repos/${repo.slug}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(data)) {
          const entries = data.map(item => asObject(item)).map(item => ({ name: String(item.name), path: String(item.path), type: String(item.type), size: Number(item.size ?? 0) }));
          entries.sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name));
          return { kind: 'dir', entries };
        }
        const file = asObject(data);
        const size = Number(file.size ?? 0);
        const base = { kind: 'file', name: String(file.name ?? ''), path: String(file.path ?? ''), size, sha: String(file.sha ?? '') };
        if (op === 'tree' && file.type !== 'file') return { ...base, kind: 'other' };
        if (size > filePageLimit || file.encoding !== 'base64') return { ...base, binary: false, tooLarge: true };
        const bytes = Buffer.from(String(file.content ?? ''), 'base64');
        if (bytes.includes(0)) return { ...base, binary: true, tooLarge: false };
        return { ...base, binary: false, tooLarge: false, text: bytes.toString('utf8') };
      }
      case 'commits': {
        const repo = repoOf(params.repo), ref = refOf(params.ref), path = pathOf(params.path), page = pageOf(params.page);
        const { data } = await this.request('GET', `/repos/${repo.slug}/commits?sha=${encodeURIComponent(ref)}&per_page=30&page=${page}${path ? `&path=${encodeURIComponent(path.split('/').map(decodeURIComponent).join('/'))}` : ''}`);
        return { commits: (Array.isArray(data) ? data : []).map(item => mapCommitBrief(asObject(item))), page };
      }
      case 'commit': {
        const repo = repoOf(params.repo), sha = shaOf(params.sha);
        const raw = asObject((await this.request('GET', `/repos/${repo.slug}/commits/${sha}`)).data);
        const stats = asObject(raw.stats);
        return { ...mapCommitBrief(raw), stats: { additions: Number(stats.additions ?? 0), deletions: Number(stats.deletions ?? 0), total: Number(stats.total ?? 0) },
          files: (Array.isArray(raw.files) ? raw.files : []).map(file => mapFile(asObject(file))), parents: (Array.isArray(raw.parents) ? raw.parents : []).map(parent => String(asObject(parent).sha ?? '')) };
      }
      case 'compare': {
        const repo = repoOf(params.repo), base = refOf(params.base), head = refOf(params.head);
        const raw = asObject((await this.request('GET', `/repos/${repo.slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`)).data);
        return { aheadBy: Number(raw.ahead_by ?? 0), behindBy: Number(raw.behind_by ?? 0), totalCommits: Number(raw.total_commits ?? 0),
          files: (Array.isArray(raw.files) ? raw.files : []).map(file => mapFile(asObject(file))), commits: (Array.isArray(raw.commits) ? raw.commits : []).map(item => mapCommitBrief(asObject(item))) };
      }
      case 'issues': {
        const repo = repoOf(params.repo), page = pageOf(params.page), query = queryOf(params.query);
        const state = params.state === undefined ? 'open' : params.state;
        if (state !== 'open' && state !== 'closed' && state !== 'all') fail('狀態無效。');
        // Always through search with is:issue: the plain list API mixes in pull requests, so a page can be all of them and look empty.
        const q = `repo:${repo.slug} is:issue ${state === 'all' ? '' : `state:${state}`} ${query}`.replace(/\s+/g, ' ').trim();
        const { data } = await this.request('GET', `/search/issues?q=${encodeURIComponent(q)}&sort=updated&per_page=30&page=${page}`);
        const issues = (Array.isArray(asObject(data).items) ? asObject(data).items as unknown[] : []).map(item => asObject(item)).filter(item => !item.pull_request).map(mapIssue);
        return { issues, page, total: Number(asObject(data).total_count ?? issues.length) };
      }
      case 'issue': {
        const repo = repoOf(params.repo), number = numberOf(params.number);
        const issue = mapIssue(asObject((await this.request('GET', `/repos/${repo.slug}/issues/${number}`)).data));
        const comments = (await this.pages(`/repos/${repo.slug}/issues/${number}/comments?per_page=100`, 3))
          .map(item => ({ id: item.id as number, author: mapUser(item.user), body: String(item.body ?? ''), createdAt: String(item.created_at ?? '') }));
        return { issue, comments };
      }
      case 'searchCode': {
        const repo = repoOf(params.repo), query = queryOf(params.query);
        if (!query) fail('請輸入搜尋字詞。');
        const { data } = await this.request('GET', `/search/code?q=${encodeURIComponent(`${query} repo:${repo.slug}`)}&per_page=30`);
        return { items: (Array.isArray(asObject(data).items) ? asObject(data).items as unknown[] : []).map(item => ({ name: String(asObject(item).name), path: String(asObject(item).path) })) };
      }
      case 'comment': {
        const repo = repoOf(params.repo), number = numberOf(params.number);
        const body = typeof params.body === 'string' ? params.body.trim() : '';
        if (!body) fail('留言內容不可空白。');
        if (body.length > commentLimit) fail(`留言太長（上限 ${commentLimit} 字）。`);
        const { data } = await this.request('POST', `/repos/${repo.slug}/issues/${number}/comments`, { body });
        const made = asObject(data);
        return { id: made.id as number, htmlUrl: String(made.html_url ?? ''), createdAt: String(made.created_at ?? ''), author: mapUser(made.user), body: String(made.body ?? body) };
      }
      default: return fail('不支援的 GitHub 操作。');
    }
  }
}

/** The token `gh` holds for this Mac. */
export const ghToken = () => new Promise<string>((resolve, reject) => {
  const env = { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` };
  execFile('gh', ['auth', 'token'], { env, timeout: 10_000 }, (error, stdout) => {
    const token = stdout.trim();
    if (error || !token) reject(new Error('讀不到 GitHub 登入。請在 Mac 執行 gh auth login。'));
    else resolve(token);
  });
});
