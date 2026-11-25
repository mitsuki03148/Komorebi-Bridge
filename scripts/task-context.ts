import { isUtf8 } from 'node:buffer';
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const maxFiles = 8;
const maxFileBytes = 256 * 1024;
const maxSliceChars = 4000;
const entryLimit = 24;
const changedFileLimit = 16;
const docs = ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md', 'README.md', 'HANDOFF_FOR_CODEX.md', 'package.json'];

type Slice = { path: string; from: number; to: number };
type Git = (args: string[]) => Promise<string>;

function parseSlice(value: string): Slice {
  const input = value.replace(/^(?:\.\/)+/, '');
  const match = /^([^:\x00-\x1f]+)(?::(\d+)-(\d+))?$/.exec(input);
  if (!match || match[0] !== input) throw new Error('用相對路徑或 file:起行-尾行。');
  const [, path, first = '1', last = '24'] = match;
  const from = Number(first);
  const to = Number(last);
  if (isAbsolute(path) || path.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules')) {
    throw new Error('請用工作樹內的可見相對路徑。');
  }
  if (!Number.isSafeInteger(to) || from < 1 || to < from || to - from >= 80) {
    throw new Error('行號須由 1 開始計，每段最多 80 行。');
  }
  return { path, from, to };
}

function preview(slice: Slice, content: string) {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const { path, from, to } = slice;
  const totalLines = lines.length;
  if (from > totalLines) return { path, totalLines, error: '起行超過檔案長度。' };
  const last = Math.min(to, totalLines);
  const excerpt: string[] = [];
  let remaining = maxSliceChars;
  for (let number = from; number <= last; number++) {
    const line = `${number}: ${lines[number - 1]}`;
    const cost = line.length + Number(excerpt.length > 0);
    if (cost > remaining) break;
    excerpt.push(line);
    remaining -= cost;
  }
  const shownTo = excerpt.length ? from + excerpt.length - 1 : null;
  return { path, from, to, shownTo, totalLines, truncated: shownTo !== last, eof: shownTo === totalLines, text: excerpt.join('\n') };
}

async function readSlice(root: string, requested: string) {
  let slice: Slice;
  try { slice = parseSlice(requested); }
  catch (error) { return { path: requested, error: (error as Error).message }; }

  const { path } = slice;
  const target = join(root, path);
  try {
    if (await realpath(target) !== target) return { path, error: '略過連結。' };
    const handle = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (stat.isDirectory()) return { path, error: '這是目錄。' };
      if (!stat.isFile()) return { path, error: '這不是普通檔案。' };
      if (stat.size > maxFileBytes) return { path, bytes: stat.size, error: '檔案超過 256 KiB 預覽上限。' };
      const data = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await handle.read(data, 0, data.length, 0);
      if (bytesRead !== stat.size) return { path, error: '檔案大小在讀取時有變，請再試。' };
      const bytes = data.subarray(0, bytesRead);
      if (bytes.includes(0) || !isUtf8(bytes)) return { path, bytes: bytesRead, error: '檔案存在，但並非 UTF-8 純文字。' };
      return preview(slice, new TextDecoder().decode(bytes));
    } finally { await handle.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { path, error: '檔案不存在。' };
    if (code === 'EACCES' || code === 'EPERM') return { path, error: '沒有讀取權限。' };
    if (code === 'EISDIR') return { path, error: '這是目錄。' };
    return { path, error: '檔案讀不到。' };
  }
}

async function checkoutStatus(git: Git) {
  try {
    const output = await git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal', '--no-ahead-behind', '--no-renames', '--ignore-submodules=none']);
    const records = output.split('\0');
    const firstChange = records.findIndex(row => row !== '' && !row.startsWith('# '));
    const headers = firstChange < 0 ? records : records.slice(0, firstChange);
    const field = (key: string) => headers.find(row => row.startsWith(key))?.slice(key.length);
    const oid = field('# branch.oid ');
    const name = field('# branch.head ');
    return { head: oid && oid !== '(initial)' ? oid : null, branch: name && name !== '(detached)' ? name : null, dirty: firstChange >= 0 };
  } catch {
    return { head: null, branch: null, dirty: null, statusError: 'Git 狀態讀不到或已逾時。' };
  }
}

async function describeRef(git: Git, requested: string) {
  const commit = await git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${requested}^{commit}`])
    .then(out => out.trim()).catch(() => null);
  if (!commit) return { requested, commit: null, error: '無法將指定 ref 解析成本機 commit。' };
  try {
    const changes = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', '--root', '--diff-merges=first-parent', commit, '--']);
    const paths = changes.split('\0').filter(Boolean);
    return { requested, commit, changedFiles: paths.slice(0, changedFileLimit), moreChangedFiles: paths.length > changedFileLimit };
  } catch {
    return { requested, commit, error: '讀不到指定 commit 的改動檔案清單。' };
  }
}

export async function taskContext(cwd: string, files: string[], ref?: string) {
  if (files.length > maxFiles) throw new Error('每次最多選 8 個檔案片段。');
  const git: Git = args => run('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout: 2000, maxBuffer: 1024 * 1024 })
    .then(({ stdout }) => stdout);
  const top = await git(['rev-parse', '--show-toplevel']).catch(() => {
    throw new Error('目前目錄讀不到 Git 工作樹。可用 --repo 指定工單的 checkout。');
  });
  const root = await realpath(top.replace(/\n$/, ''));
  const [status, revision, dir, excerpts] = await Promise.all([
    checkoutStatus(git),
    ref === undefined ? undefined : describeRef(git, ref),
    readdir(root, { withFileTypes: true }),
    Promise.all(files.map(file => readSlice(root, file))),
  ]);
  const visible = dir.filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules' && (entry.isDirectory() || entry.isFile()));
  const entries = visible.map(entry => entry.name + (entry.isDirectory() ? '/' : '')).sort();
  const startFiles = docs.filter(name => visible.some(entry => entry.isFile() && entry.name === name));
  return {
    root,
    ...status,
    ...(revision ? { ref: { ...revision, matchesHead: status.head && revision.commit ? status.head === revision.commit : null } } : {}),
    startFiles,
    entries: entries.slice(0, entryLimit),
    moreEntries: entries.length > entryLimit,
    ...(excerpts.length ? { fileSource: 'worktree' } : {}),
    files: excerpts,
  };
}

/** Search visible worktree files without following links or reading files above 256 KiB. */
export async function searchWorktree(root: string, patterns: string[]): Promise<{ matches: string[]; truncated: boolean } | undefined> {
  if (patterns.length > 8 || patterns.some(pattern => !pattern || pattern.length > 500)) throw new Error('最多輸入 8 個非空搜尋式，每個最多 500 字。');
  if (!patterns.length) return undefined;
  const args = ['--no-config', '--line-number', '--no-heading', '--color', 'never', '--max-filesize', '256K', '--max-columns', '500', '--max-columns-preview', '--glob', '!node_modules/**', ...patterns.flatMap(pattern => ['-e', pattern]), '.'];
  try { return await new Promise<{ matches: string[]; truncated: boolean }>((resolve, reject) => {
    const child = spawn('rg', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const matches: string[] = []; let pending = ''; let error = ''; let truncated = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('搜尋逾時。')); }, 5000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) {
        if (matches.length === 50) { truncated = true; child.kill(); break; }
        matches.push(line.replace(/^\.\//, ''));
      }
    });
    child.stderr.on('data', (chunk: string) => { error += chunk.slice(0, Math.max(0, 1000 - error.length)); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (!truncated && code !== 0 && code !== 1) return reject(new Error(error.trim() || '搜尋失敗（需要安裝 rg）。'));
      if (!truncated && pending && matches.length < 50) matches.push(pending.replace(/^\.\//, ''));
      resolve({ matches, truncated });
    });
  }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return searchWithGit(root, patterns);
  }
}

// Git has no max-filesize switch. Select regular files first so it never searches large files.
async function searchWithGit(checkout: string, patterns: string[]) {
  // Compare file paths against the resolved root: a root under a symlinked folder (for example /var on macOS) would reject every file.
  const root = await realpath(checkout);
  const deadline = Date.now() + 5000;
  const git = async (args: string[], maxBuffer = 8 * 1024 * 1024) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error('搜尋逾時。');
    return run('git', ['--no-optional-locks', '-C', root, ...args], { timeout, maxBuffer });
  };
  const listing = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const paths = [...new Set(listing.stdout.split('\0').filter(Boolean))].filter(path =>
    path.split('/').every(part => part && !part.startsWith('.') && part !== 'node_modules'));
  const matches: string[] = [];
  for (let index = 0; index < paths.length; index += 100) {
    const candidates = await Promise.all(paths.slice(index, index + 100).map(async path => {
      const target = join(root, path);
      try {
        const stat = await lstat(target);
        return stat.isFile() && stat.size <= maxFileBytes && await realpath(target) === target ? path : null;
      } catch { return null; }
    }));
    const files = candidates.filter((path): path is string => path !== null);
    if (!files.length) continue;
    const args = ['-c', 'color.grep=false', 'grep', '-n', '-I', '-E', '-z', '--untracked', '--max-count=51',
      ...patterns.flatMap(pattern => ['-e', pattern]), '--', ...files.map(path => `:(literal)${path}`)];
    let output: string;
    try { output = (await git(args, 16 * 1024 * 1024)).stdout; }
    catch (error) {
      if ((error as { code?: number }).code === 1) continue;
      throw error;
    }
    let offset = 0;
    while (offset < output.length) {
      const first = output.indexOf('\0', offset), second = output.indexOf('\0', first + 1);
      const end = output.indexOf('\n', second + 1);
      if (first < 0 || second < 0 || end < 0) throw new Error('Git 搜尋結果格式不正確。');
      if (matches.length === 50) return { matches, truncated: true };
      const text = output.slice(second + 1, end);
      matches.push(`${output.slice(offset, first)}:${output.slice(first + 1, second)}:${text.length > 500 ? text.slice(0, 500) + '…' : text}`);
      offset = end + 1;
    }
  }
  return { matches, truncated: false };
}

/** Keep JSON valid and its UTF-8 output within the limit, even for long Unicode text. */
export function boundedJson(value: unknown, limit = 16 * 1024) {
  const json = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(json + '\n') <= limit) return json;
  const record = value as Record<string, unknown>;
  const essential = { truncated: true, ...(typeof record.ok === 'boolean' ? { ok: record.ok, lint: record.lint, test: record.test } : {}),
    ...(record.bench ? { bench: { code: (record.bench as { code: number }).code } } : {}) };
  // Keep the check results even when a very large dirty-file list consumes the output budget.
  if ('lint' in essential) {
    for (const key of ['lint', 'test'] as const) {
      const check = essential[key] as { status?: string; exitCode?: number | null; signal?: string | null };
      essential[key] = { status: check.status, exitCode: check.exitCode, signal: check.signal };
    }
  }
  let low = 0, high = json.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = JSON.stringify({ ...essential, text: json.slice(0, mid) });
    if (Buffer.byteLength(candidate + '\n') <= limit) low = mid; else high = mid - 1;
  }
  return JSON.stringify({ ...essential, text: json.slice(0, low) });
}
