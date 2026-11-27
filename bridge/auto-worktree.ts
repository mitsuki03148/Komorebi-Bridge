// Bridge-owned worktree reservations and creation; this module never removes a worktree.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const bridgeWorktreeLimit = 6;

/** Do not create on the system disk if the external volume is not mounted. */
export function assertMountedVolume(volume: string) {
  try { if (statSync(volume).dev !== statSync(dirname(volume)).dev) return; } catch { /* Missing volume also fails closed. */ }
  throw new Error('Komorebi SSD 未掛載，已停止建立 worktree。');
}

export type BridgeCheckout = {
  ticketId: number;
  repo: string;
  path: string;
  branch: string;
  ref: string;
  state: 'reserved' | 'created' | 'failed';
  createdAt: string;
  error?: string;
};

export type CleanupFacts = { finished: boolean; oldEnough: boolean; clean: boolean; pushedOrMerged: boolean; running: boolean; protected: boolean; verified: boolean };
export type CleanupReason = 'unfinished' | 'tooRecent' | 'dirty' | 'unpushed' | 'running' | 'protected' | 'unverified';
export function cleanupReasons(facts: CleanupFacts): CleanupReason[] {
  const reasons: CleanupReason[] = [];
  if (!facts.finished) reasons.push('unfinished');
  if (!facts.oldEnough) reasons.push('tooRecent');
  if (!facts.clean) reasons.push('dirty');
  if (!facts.pushedOrMerged) reasons.push('unpushed');
  if (facts.running) reasons.push('running');
  if (facts.protected) reasons.push('protected');
  if (!facts.verified) reasons.push('unverified');
  return reasons;
}

export type WorktreeUsage = { ticketId: number; path: string; branch: string; bytes?: number; oversized: boolean; candidate: boolean; reasons: CleanupReason[] };
export type WorktreeCapacity = { used: number; limit: number; remaining: number };

/** A preliminary, read-only assessment; removal must repeat every check at confirmation time. */
export async function inspectWorktrees(entries: BridgeCheckout[], factsFor: (entry: BridgeCheckout) => Pick<CleanupFacts, 'finished' | 'oldEnough' | 'running' | 'protected' | 'verified'>): Promise<WorktreeUsage[]> {
  return Promise.all(entries.map(async entry => {
    const facts: CleanupFacts = { ...factsFor(entry), clean: false, pushedOrMerged: false };
    let bytes: number | undefined;
    const git = (args: string[]) => run('git', ['-C', entry.path, ...args], { timeout: 10_000, maxBuffer: 1_000_000 });
    try {
      if (entry.state !== 'created' || lstatSync(entry.path).isSymbolicLink() || realpathSync(entry.path) !== entry.path) throw new Error('invalid checkout');
      const root = (await git(['rev-parse', '--show-toplevel'])).stdout.trim();
      const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
      if (realpathSync(root) !== entry.path || branch !== entry.branch) throw new Error('checkout changed');
      facts.clean = !(await git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout.trim();
      try {
        const upstream = (await git(['rev-parse', '--symbolic-full-name', '@{upstream}'])).stdout.trim();
        if (!upstream.startsWith('refs/remotes/')) throw new Error('upstream is not remote');
        const count = (await git(['rev-list', '--count', '@{upstream}..HEAD'])).stdout.trim();
        facts.pushedOrMerged = /^\d+$/.test(count) && Number(count) === 0;
      }
      catch {
        try { await git(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/HEAD']); facts.pushedOrMerged = true; }
        catch { facts.pushedOrMerged = false; }
      }
      const usage = (await run('du', ['-sk', entry.path], { timeout: 30_000, maxBuffer: 1024 })).stdout;
      const kib = Number(usage.match(/^\d+/)?.[0]);
      if (!Number.isSafeInteger(kib) || kib < 0) throw new Error('invalid size');
      bytes = kib * 1024;
    } catch { facts.verified = false; }
    const reasons = cleanupReasons(facts);
    return { ticketId: entry.ticketId, path: entry.path, branch: entry.branch, ...(bytes === undefined ? {} : { bytes }),
      oversized: bytes !== undefined && bytes > 5 * 1024 ** 3, candidate: reasons.length === 0, reasons };
  }));
}

/** Persist reservations before git runs so an interrupted creation cannot silently disappear. */
export class BridgeWorktrees {
  private entries: BridgeCheckout[] = [];
  private readable = true;
  private existed = false;

  constructor(private readonly registry: string, private readonly base: string) {
    this.load();
  }

  private load() {
    try {
      const data: unknown = JSON.parse(readFileSync(this.registry, 'utf8'));
      if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' ||
        !Number.isSafeInteger(row.ticketId) || row.ticketId < 1 || typeof row.repo !== 'string' ||
        typeof row.path !== 'string' || typeof row.branch !== 'string' || typeof row.ref !== 'string' ||
        !['reserved', 'created', 'failed'].includes(row.state) || typeof row.createdAt !== 'string') ||
        new Set(data.map(row => row.ticketId)).size !== data.length) throw new Error('invalid worktree registry');
      this.entries = data;
      this.existed = true;
      this.readable = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || this.existed) this.readable = false;
    }
  }

  snapshot() { this.load(); return structuredClone(this.entries); }
  isReadable() { return this.readable; }

  private usedSlots() {
    return this.entries.filter(entry => entry.state === 'reserved' || existsSync(entry.path)).length;
  }

  /** A read-only snapshot. Creation still checks capacity under its lock. */
  capacity(): WorktreeCapacity | undefined {
    this.load();
    if (!this.readable) return undefined;
    const used = this.usedSlots();
    return { used, limit: bridgeWorktreeLimit, remaining: Math.max(0, bridgeWorktreeLimit - used) };
  }

  private save(entries: BridgeCheckout[]) {
    if (!this.readable) throw new Error('無法讀取 worktree 記錄，已停止建立。');
    const temp = `${this.registry}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(entries), { flag: 'wx', mode: 0o600 });
      renameSync(temp, this.registry);
      this.entries = entries;
      this.existed = true;
    } finally { try { unlinkSync(temp); } catch { /* The rename removed it. */ } }
  }

  /** The caller must already have reserved the ticket ID and validated the ticket. */
  async create(ticketId: number, repo: string, ref = 'HEAD'): Promise<BridgeCheckout> {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1 || !isAbsolute(repo)) throw new Error('工單或 repo 無效。');
    const lock = `${this.registry}.lock`;
    try { mkdirSync(lock); }
    catch { throw new Error('worktree 建立程序正在執行或鎖定未解除，請先檢查。'); }
    try {
      // A different Bridge process may have written since this instance last read the registry.
      this.load();
      if (!this.readable) throw new Error('無法讀取 worktree 記錄，已停止建立。');
      const root = realpathSync(repo);
      const common = (await run('git', ['-C', root, 'rev-parse', '--git-common-dir'], { timeout: 10_000, maxBuffer: 16_000 })).stdout.trim();
      const commonPath = resolve(root, common);
      const name = basename(commonPath) === '.git' ? basename(dirname(commonPath)) : basename(commonPath).replace(/\.git$/, '');
      // Recheck after the asynchronous probe: two callers may have arrived together.
      if (!this.readable) throw new Error('無法讀取 worktree 記錄，已停止建立。');
      if (this.entries.some(entry => entry.ticketId === ticketId)) throw new Error('工單已有 worktree 記錄。');
      if (this.usedSlots() >= bridgeWorktreeLimit) {
        throw new Error(`Bridge worktree 已達上限 ${bridgeWorktreeLimit}，請先處理現有記錄。可先核實現有獨立 checkout、ref 同認領，再按需要用 --repo 派單；清理由 Founder 決定。`);
      }
      if (!/^[\p{L}\p{N} ._-]+$/u.test(name) || name === '.' || name === '..') throw new Error('repo 名稱不可用作 worktree 目錄。');
      mkdirSync(this.base, { recursive: true });
      const base = realpathSync(this.base);
      const parent = join(base, name);
      if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw new Error('worktree 目錄不可是連結。');
      mkdirSync(parent, { recursive: true });
      const path = resolve(parent, String(ticketId));
      if (existsSync(path)) throw new Error('worktree 目錄已存在，請先檢查。');
      const entry: BridgeCheckout = { ticketId, repo: root, path, branch: `bridge/${ticketId}`, ref, state: 'reserved', createdAt: new Date().toISOString() };
      this.save([...this.entries, entry]);
      try {
        // Git receives separate arguments, never a shell string. A failed create is never cleaned automatically.
        const git = (args: string[]) => run('git', ['-C', root, ...args], { timeout: 30_000, maxBuffer: 1_000_000 });
        const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).stdout.trim();
        if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new Error('無法核實 commit。');
        await git(['worktree', 'add', '-b', entry.branch, path, commit]);
        const created: BridgeCheckout = { ...entry, ref: commit, state: 'created' };
        this.save(this.entries.map(item => item.ticketId === ticketId ? created : item));
        return created;
      } catch (error) {
        const failed: BridgeCheckout = { ...entry, state: 'failed', error: '建立失敗；請檢查記錄及目錄。' };
        this.save(this.entries.map(item => item.ticketId === ticketId ? failed : item));
        throw error;
      }
    } finally { try { rmdirSync(lock); } catch { /* An unexpected lock is left for inspection. */ } }
  }
}
