/** Event-driven, metadata-only watcher for an explicitly selected file or one-level folder. */
import { lstatSync, realpathSync, readdirSync, watch, type FSWatcher, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type TriggerKind = 'file' | 'directory';
export type TriggerEvent = { path: string; type: 'add' | 'change' | 'delete'; observedAt: string };
export type TriggerStatus = 'watching' | 'gap' | 'error' | 'paused';
export interface ValidatedTrigger { workspace: string; target: string; kind: TriggerKind; rootDevice: number; rootInode: number; parentDevice: number; parentInode: number; }

export type TriggerStamp = { dev: number; ino: number; size: number; mtime: number; ctime: number };
export type TriggerBaseline = Array<{ path: string; stamp: TriggerStamp }>;
type Stamp = TriggerStamp;
const stamp = (s: Stats): Stamp => ({ dev: s.dev, ino: s.ino, size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs });
const changed = (a: Stamp, b: Stamp) => a.dev !== b.dev || a.ino !== b.ino || a.size !== b.size || a.mtime !== b.mtime || a.ctime !== b.ctime;
function within(root: string, path: string) { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); }
function noSymlink(root: string, target: string, missingLeaf: boolean) {
  const r = relative(root, target); let current = root;
  for (const [index, part] of r.split(sep).filter(Boolean).entries()) {
    current = resolve(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('symlink is not allowed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && missingLeaf && index === r.split(sep).filter(Boolean).length - 1) return; throw error; }
  }
}

/** Call on configuration and again immediately before accepting or delivering events. */
export function validateTriggerPath(workspace: string, target: string, kind: TriggerKind, expected?: ValidatedTrigger): ValidatedTrigger {
  if (!isAbsolute(workspace) || !isAbsolute(target) || target.split(/[\\/]/).includes('..') || workspace.split(/[\\/]/).includes('..')) throw new Error('absolute path without .. required');
  if (kind !== 'file' && kind !== 'directory') throw new Error('invalid trigger kind');
  const root = resolve(workspace); const path = resolve(target);
  if (!within(root, path) || root === path) throw new Error('outside workspace');
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('invalid workspace');
  const canonicalRoot = realpathSync(root);
  noSymlink(root, path, kind === 'file');
  const parent = kind === 'file' ? dirname(path) : path;
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || !within(canonicalRoot, realpathSync(parent))) throw new Error('outside workspace');
  try {
    const s = lstatSync(path);
    if (s.isSymbolicLink() || (kind === 'file' ? !s.isFile() : !s.isDirectory())) throw new Error('invalid trigger target');
    if (!within(canonicalRoot, realpathSync(path))) throw new Error('outside workspace');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || kind !== 'file') throw error; }
  const value = { workspace: root, target: path, kind, rootDevice: rootStat.dev, rootInode: rootStat.ino, parentDevice: parentStat.dev, parentInode: parentStat.ino };
  if (expected && (value.workspace !== expected.workspace || value.target !== expected.target || value.kind !== expected.kind || value.rootDevice !== expected.rootDevice || value.rootInode !== expected.rootInode || value.parentDevice !== expected.parentDevice || value.parentInode !== expected.parentInode)) throw new Error('watch root replaced');
  return value;
}

export class FileTriggerWatch {
  private readonly validation: ValidatedTrigger;
  private readonly watchers: FSWatcher[] = [];
  private readonly pendingPaths = new Set<string>();
  private baseline = new Map<string, Stamp>();
  private timer?: NodeJS.Timeout;
  private initialScan?: NodeJS.Immediate;
  private closed = false;
  private broken = false;
  constructor(private options: { workspace: string; target: string; kind: TriggerKind; onEvent: (event: TriggerEvent) => void; onStatus: (status: TriggerStatus) => void; debounceMs?: number; maxEntries?: number;
    expectedIdentity?: ValidatedTrigger; baseline?: TriggerBaseline; onBaseline?: (baseline: TriggerBaseline) => void;
    manualResume?: boolean; onGap?: (changedPaths: string[]) => void;
    /** Files of the Bridge itself (its own settings and their temporary copies): saving the watch state changes them, so they must never count as a change. Folders only. */
    ignore?: (path: string) => boolean }) {
    this.validation = validateTriggerPath(options.workspace, options.target, options.kind, options.expectedIdentity);
    if (options.baseline !== undefined) {
      if (!Array.isArray(options.baseline) || options.baseline.length > (options.maxEntries ?? 2048)) throw new Error('invalid baseline');
      for (const entry of options.baseline) {
        if (!entry || typeof entry.path !== 'string' || (this.validation.kind === 'file' ? entry.path !== this.validation.target : dirname(entry.path) !== this.validation.target) ||
            !entry.stamp || !['dev','ino','size','mtime','ctime'].every(key => Number.isFinite(entry.stamp[key as keyof TriggerStamp])) || this.baseline.has(entry.path)) throw new Error('invalid baseline');
        this.baseline.set(entry.path, { ...entry.stamp });
      }
    } else this.baseline = this.snapshot();
  }
  /** Expose immutable identity for revalidation before delivery. */
  get identity(): ValidatedTrigger { return { ...this.validation }; }
  get metadataBaseline(): TriggerBaseline { return [...this.baseline].map(([path, value]) => ({ path, stamp: { ...value } })); }
  validate() { return validateTriggerPath(this.validation.workspace, this.validation.target, this.validation.kind, this.validation); }
  private snapshot(): Map<string, Stamp> {
    this.validate();
    const result = new Map<string, Stamp>();
    const { target, kind } = this.validation;
    const paths = kind === 'file' ? [target] : readdirSync(target).map(name => resolve(target, name)).filter(path => !this.options.ignore?.(path));
    if (paths.length > (this.options.maxEntries ?? 2048)) throw new Error('directory entry limit exceeded');
    for (const path of paths) {
      try { const s = lstatSync(path); if (s.isFile() && !s.isSymbolicLink()) result.set(path, stamp(s)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return result;
  }
  private fail() { if (this.closed || this.broken) return; this.broken = true; clearTimeout(this.timer); clearImmediate(this.initialScan); this.closeWatches(); this.options.onStatus('gap'); }
  private closeWatches() { for (const watcher of this.watchers.splice(0)) watcher.close(); }
  private scan() {
    if (this.closed || this.broken) return;
    try {
      const next = this.snapshot(); const paths = new Set([...this.baseline.keys(), ...next.keys(), ...this.pendingPaths]);
      this.pendingPaths.clear();
      const events: TriggerEvent[] = [];
      for (const path of paths) {
        const old = this.baseline.get(path), current = next.get(path);
        if (!old && current) events.push({ path, type: 'add', observedAt: new Date().toISOString() });
        else if (old && !current) events.push({ path, type: 'delete', observedAt: new Date().toISOString() });
        else if (old && current && changed(old, current)) events.push({ path, type: 'change', observedAt: new Date().toISOString() });
      }
      this.baseline = next;
      for (const event of events) {
        this.validate();
        // A directory child may have become a symlink since the scan. Never emit it.
        if (this.validation.kind === 'directory') validateTriggerPath(this.validation.workspace, event.path, 'file');
        if (!this.closed && !this.broken) this.options.onEvent(event);
      }
      if (!this.closed && !this.broken) this.options.onBaseline?.(this.metadataBaseline);
    } catch { this.fail(); }
  }
  /** Manual resume compares only presence, size, and mtime; it never fabricates offline events. */
  private reconcileManualResume() {
    if (this.closed || this.broken) return;
    if (!this.options.onGap) throw new Error('manual resume requires gap handler');
    const next = this.snapshot();
    const changedPaths = [...new Set([...this.baseline.keys(), ...next.keys()])].filter(path => {
      const before = this.baseline.get(path), after = next.get(path);
      return !before || !after || before.size !== after.size || before.mtime !== after.mtime;
    });
    if (changedPaths.length || this.options.baseline === undefined) this.options.onGap(changedPaths);
    this.baseline = next;
    this.options.onBaseline?.(this.metadataBaseline);
  }
  private reconcileStartup() {
    if (this.closed || this.broken) return;
    try {
      const current = this.snapshot();
      // The callback also rechecks signed store validity before accepting changes.
      this.options.onBaseline?.(this.metadataBaseline);
      const differs = current.size !== this.baseline.size || [...current].some(([path, value]) => {
        const old = this.baseline.get(path); return !old || changed(old, value);
      });
      if (differs && !this.timer) this.timer = setTimeout(() => this.scan(), this.options.debounceMs ?? 700);
    } catch { this.fail(); }
  }
  start() {
    if (this.closed || this.broken || this.watchers.length) throw new Error('watcher is not startable');
    this.validate();
    const { workspace, target, kind } = this.validation;
    const observedDir = kind === 'file' ? dirname(target) : target;
    const onDirectory = (_event: string, filename: string | null) => {
      if (this.closed || this.broken) return;
      if (filename) {
        const p = resolve(observedDir, filename);
        if (kind === 'file' && p !== target) return;
        if (kind === 'directory' && dirname(p) !== observedDir) return;
        this.pendingPaths.add(p);
      }
      clearTimeout(this.timer); this.timer = setTimeout(() => this.scan(), this.options.debounceMs ?? 700);
    };
    const register = (path: string, callback: (event: string, name: string | null) => void) => {
      const w = watch(path, { persistent: false }, callback); w.on('error', () => this.fail()); this.watchers.push(w);
    };
    try {
      register(observedDir, onDirectory);
      // Parent watches detect a detached or replaced watched directory and workspace without polling.
      const check = () => { try { this.validate(); } catch { this.fail(); } };
      if (observedDir !== workspace) register(dirname(observedDir), (_event, name) => { if (!name || name === basename(observedDir)) check(); });
      register(dirname(workspace), (_event, name) => { if (!name || name === basename(workspace)) check(); });
      this.validate();
      // Close the constructor/start registration window using one metadata comparison.
      if (this.options.manualResume) this.reconcileManualResume(); else this.scan();
      // fs.watch registration may not yet receive events in the current turn.
      // One post-registration check closes that startup window without polling.
      if (!this.broken) this.initialScan = setImmediate(() => { this.initialScan = undefined; this.reconcileStartup(); });
      if (!this.broken) this.options.onStatus('watching');
    } catch (error) { this.closeWatches(); this.broken = true; this.options.onStatus('error'); throw error; }
  }
  close() { if (this.closed) return; this.closed = true; clearTimeout(this.timer); clearImmediate(this.initialScan); this.pendingPaths.clear(); this.closeWatches(); this.options.onStatus('paused'); }
}
