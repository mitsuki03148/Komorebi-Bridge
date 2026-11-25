import type { LineRange } from './githubLinks';

/** Where a GitHub link points, as far as the app's GitHub panel can show it. `rest` is a ref and a path written together (see resolveRefPath). */
export type GhTarget =
  | { kind: 'repo'; repo: string }
  | { kind: 'issues'; repo: string }
  | { kind: 'issue'; repo: string; number: number; commentId?: number; pull?: boolean }
  | { kind: 'commit'; repo: string; sha: string }
  | { kind: 'blob'; repo: string; rest: string; lines?: LineRange }
  | { kind: 'tree'; repo: string; rest: string }
  | { kind: 'commits'; repo: string; rest: string }
  | { kind: 'compare'; repo: string; base: string; head: string };

const part = /^[A-Za-z0-9._-]{1,100}$/;
// First path segments that are GitHub's own pages, not a user or an organisation.
const reserved = new Set(['settings', 'orgs', 'users', 'marketplace', 'notifications', 'explore', 'topics', 'search', 'issues', 'pulls', 'sponsors', 'login', 'logout', 'features', 'new', 'about', 'pricing', 'enterprise', 'apps', 'codespaces', 'organizations', 'sessions', 'join', 'security', 'collections', 'trending', 'dashboard', 'contact', 'site', 'readme']);
const isSha = (value: string) => /^[0-9a-f]{7,40}$/i.test(value);

/** Understands a github.com link, and gives undefined for anything else (another host, an unsupported page, not a link at all). */
export function parseGitHubUrl(href: string | undefined): GhTarget | undefined {
  let url: URL;
  try { url = new URL(href ?? ''); } catch { return undefined; }
  if (url.protocol !== 'https:' || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')) return undefined;
  let segments: string[];
  try { segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return undefined; }
  const [owner, name, kind, ...rest] = segments;
  if (!owner || !name || reserved.has(owner.toLowerCase()) || !part.test(owner) || !part.test(name) || owner.startsWith('.') || name.startsWith('.')) return undefined;
  const repo = `${owner}/${name}`;
  const hash = url.hash.slice(1);
  if (!kind) return { kind: 'repo', repo };
  if (kind === 'issues' && !rest.length) return { kind: 'issues', repo };
  if ((kind === 'issues' || kind === 'pull') && /^\d+$/.test(rest[0] ?? '')) {
    const comment = /^issuecomment-(\d+)$/.exec(hash);
    return { kind: 'issue', repo, number: Number(rest[0]), ...(comment ? { commentId: Number(comment[1]) } : {}), ...(kind === 'pull' ? { pull: true } : {}) };
  }
  if (kind === 'commit' && rest.length === 1 && isSha(rest[0])) return { kind: 'commit', repo, sha: rest[0] };
  if ((kind === 'blob' || kind === 'tree' || kind === 'commits') && rest.length) {
    const joined = rest.join('/');
    if (kind === 'blob') {
      const lines = /^L(\d+)(?:-L(\d+))?$/.exec(hash);
      return { kind: 'blob', repo, rest: joined, ...(lines ? { lines: { start: Number(lines[1]), end: Number(lines[2] ?? lines[1]) } } : {}) };
    }
    return { kind, repo, rest: joined };
  }
  if (kind === 'compare' && rest.length) {
    const [base, head] = rest.join('/').split('...');
    if (base && head) return { kind: 'compare', repo, base, head };
  }
  return undefined;
}

/**
 * A ref and a path are written together in a link (`feat/x/src/a.ts`), so which part is the branch has to come from the branches the repo has:
 * the longest one that fits wins. A commit id needs no list; an unknown name (a tag) is taken as the first segment.
 */
export function resolveRefPath(rest: string, branches: string[]): { ref: string; path: string } {
  const matches = branches.filter(name => rest === name || rest.startsWith(`${name}/`)).sort((a, b) => b.length - a.length);
  const first = rest.split('/')[0];
  const ref = isSha(first) ? first : matches[0] ?? first;
  return { ref, path: rest.slice(ref.length).replace(/^\//, '') };
}
