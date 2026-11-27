import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const oid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const gateFile = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z-[0-9a-f-]{36}\.json$/;

type GateResult = { head: string; verdict: 'PASS' | 'FAIL'; count?: string; dirty: boolean };

export type CheckoutCompletion = {
  repo?: string;
  head?: string;
  branch?: string;
  pushed?: boolean;
  changed?: number;
  gate?: GateResult;
};

async function git(repo: string, ...args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['--no-optional-locks', '-C', repo, ...args], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file:git:http:https:ssh', GIT_NO_LAZY_FETCH: '1' },
    });
    return stdout.replace(/\n$/, '');
  } catch { return undefined; }
}

/** A subdirectory or a missing checkout must not borrow the surrounding repository's state. */
async function checkoutRoot(repo: string | undefined) {
  if (!repo || !isAbsolute(repo)) return;
  const path = await realpath(repo).catch(() => undefined);
  if (path && await git(path, 'rev-parse', '--show-toplevel') === path) return path;
}

async function pushedAtOrigin(repo: string, head: string, branch: string) {
  if (!await git(repo, 'remote', 'get-url', 'origin')) return;
  const refs = await git(repo, 'ls-remote', '--refs', 'origin', branch);
  if (refs !== undefined) return refs.split('\n').includes(`${head}\t${branch}`);
}

function changedFiles(status: string | undefined) {
  if (status === undefined) return;
  let count = 0;
  const entries = status.split('\0');
  for (let index = 0; entries[index]; index++) {
    count++;
    // Porcelain v1 emits a second path for a rename or copy.
    if (/[RC]/.test(entries[index].slice(0, 2))) index++;
  }
  return count;
}

async function readGate(path: string, repo: string): Promise<GateResult | undefined> {
  // Keep even user-supplied gate paths to small regular files with the worker's filename format.
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 128 * 1024) return;
      const buffer = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stat.size) return;
      const result = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (result?.root !== repo || typeof result.head !== 'string' || !oid.test(result.head) || typeof result.ok !== 'boolean') return;
      const tail = typeof result.test?.tail === 'string' ? result.test.tail : '';
      const total = /^(?:ℹ\s*)?tests[ \t]+(\d+)\s*$/im.exec(tail)?.[1];
      const pass = /^(?:ℹ\s*)?pass[ \t]+(\d+)\s*$/im.exec(tail)?.[1];
      return {
        head: result.head, verdict: result.ok ? 'PASS' : 'FAIL',
        ...(pass && total && Number(pass) <= Number(total) ? { count: `${pass}/${total}` } : {}),
        dirty: typeof result.status === 'string' && result.status !== 'clean',
      };
    } finally { await file.close(); }
  } catch { return undefined; }
}

async function lastGate(repo: string, paths: string[], directory: string) {
  const stored = await readdir(directory).catch(() => [] as string[]);
  const candidates = [...new Set([...paths, ...stored.map(file => join(directory, file))])]
    .filter(path => isAbsolute(path) && gateFile.test(basename(path)))
    .sort((a, b) => basename(b).localeCompare(basename(a)));
  for (const path of candidates) {
    const result = await readGate(path, repo);
    if (result) return result;
  }
}

export async function captureCheckout(path: string | undefined, gatePaths: string[], gateDir: string): Promise<CheckoutCompletion> {
  const repo = await checkoutRoot(path);
  if (!repo) return {};
  const [head, ref, status, gate] = await Promise.all([
    git(repo, 'rev-parse', '--verify', 'HEAD'),
    git(repo, 'symbolic-ref', '--quiet', 'HEAD'),
    git(repo, '-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
    lastGate(repo, gatePaths, gateDir),
  ]);
  const branch = ref?.startsWith('refs/heads/') ? ref : undefined;
  const pushed = head && branch ? await pushedAtOrigin(repo, head, branch) : undefined;
  return { repo, head, branch, changed: changedFiles(status), pushed, gate };
}

export async function checkoutNow(checkout: CheckoutCompletion | undefined) {
  const repo = await checkoutRoot(checkout?.repo);
  if (!repo || !checkout?.head || !oid.test(checkout.head)) return ['SHA UNKNOWN', '分支 UNKNOWN'];

  const { head, branch } = checkout;
  // An unresolved object prints nothing with --disambiguate; a command failure stays distinguishable.
  const [object, refs] = await Promise.all([
    git(repo, 'rev-parse', '--disambiguate=' + head),
    branch?.startsWith('refs/heads/') ? git(repo, 'for-each-ref', '--format=%(refname)%09%(objectname)', '--', branch) : undefined,
  ]);
  const tip = refs?.split('\n').find(line => line.startsWith(`${branch}\t`))?.split('\t')[1];
  return [
    object === undefined ? 'SHA UNKNOWN' : object.split('\n').includes(head) ? 'SHA 存在' : 'SHA 唔存在',
    refs === undefined ? '分支 UNKNOWN' : tip === head ? '分支一致' : tip ? '分支 SHA 已變' : '分支唔存在',
  ];
}
