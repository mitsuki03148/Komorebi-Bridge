import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FileNoticeEvent, FileNoticeReservation, FileNoticeStore, NoticeFinish } from './file-trigger-delivery';
import type { TriggerBaseline, TriggerKind, ValidatedTrigger } from './file-trigger-watch';

export interface TriggerSetting { id: string; groupId: string; path: string; kind: TriggerKind; enabled: boolean; identity: ValidatedTrigger; offline?: true; watchBaseline?: TriggerBaseline }
type Pending = { id: string; groupId: string; event: FileNoticeEvent; state: 'pending' | 'inflight' | 'uncertain'; reservation?: string };
type Data = { version: 1; confirmationHint: string; settings: TriggerSetting[]; pending: Pending[]; lastDelivery: Record<string, number>; cancelled: { at: string }[]; overflow: Record<string, boolean> };
const empty = (): Data => ({ version: 1, confirmationHint: '', settings: [], pending: [], lastDelivery: {}, cancelled: [], overflow: {} });
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
function validWatchBaseline(value: unknown, setting: { path: string; kind: TriggerKind }): value is TriggerBaseline {
 if (!Array.isArray(value) || value.length > 2048) return false;
 const paths = new Set<string>();
 return value.every(entry => {
  if (!object(entry) || Object.keys(entry).sort().join(',') !== 'path,stamp' || typeof entry.path !== 'string' || entry.path.length > 4096 ||
      (setting.kind === 'file' ? entry.path !== setting.path : dirname(entry.path) !== setting.path) || paths.has(entry.path) || !object(entry.stamp) ||
      Object.keys(entry.stamp).sort().join(',') !== 'ctime,dev,ino,mtime,size' || !['ctime','dev','ino','mtime','size'].every(k => Number.isFinite(entry.stamp[k]))) return false;
  paths.add(entry.path); return true;
 });
}
function valid(v: unknown): v is Data {
 if (!object(v) || v.version !== 1 || typeof v.confirmationHint !== 'string' || v.confirmationHint.length > 500 || !Array.isArray(v.settings) || !Array.isArray(v.pending) || !object(v.lastDelivery) || !object(v.overflow) || !Array.isArray(v.cancelled)) return false;
 return v.settings.length <= 512 && v.pending.length <= 4096 && v.cancelled.length <= 100 && v.settings.every((s: any) => object(s) && typeof s.id === 'string' && typeof s.groupId === 'string' && typeof s.path === 'string' && (s.kind === 'file' || s.kind === 'directory') && typeof s.enabled === 'boolean' && (s.offline === undefined || s.offline === true) && object(s.identity) && s.identity.target === s.path && s.identity.kind === s.kind && typeof s.identity.workspace === 'string' && ['rootDevice','rootInode','parentDevice','parentInode'].every(k => Number.isFinite(s.identity[k])) && (s.watchBaseline === undefined || validWatchBaseline(s.watchBaseline, { path: s.path, kind: s.kind }))) && v.pending.every((p: any) => object(p) && typeof p.id === 'string' && typeof p.groupId === 'string' && ['pending','inflight','uncertain'].includes(p.state) && object(p.event) && typeof p.event.watchId === 'string' && typeof p.event.path === 'string' && ['add','change','delete','gap'].includes(p.event.kind) && typeof p.event.observedAt === 'string' && (p.reservation === undefined || typeof p.reservation === 'string')) && Object.values(v.lastDelivery).every(Number.isFinite) && Object.values(v.overflow).every(x => typeof x === 'boolean');
}

export interface TriggerAnchorState { committed: string | null; pending: string | null }
/** Secure, independently durable storage. Production must implement this using Keychain. */
export interface TriggerAnchor { read(): TriggerAnchorState; write(value: TriggerAnchorState): void }
const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
// One Bridge process owns a port; this synchronous guard prevents reentrant writes in that process.
const activeMutations = new Set<string>();
function singleWriter<T>(path: string, fn: () => T): T {
 if (activeMutations.has(path)) throw Error('File trigger write already in progress');
 activeMutations.add(path);
 try { return fn(); } finally { activeMutations.delete(path); }
}
const anchorValid = (a: TriggerAnchorState) => !!a && [a.committed, a.pending].every(value => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)));

/** All mutations are synchronous and save before publication. Invalid/unknown files are never overwritten. */
export class FileTriggerStore implements FileNoticeStore {
 private data: Data = empty(); private trusted = false; private baseline: string | null = null;
 /** Why the store stopped trusting itself, for diagnosis only (never a key, a path or file content). */
 lockReason?: 'anchor-mismatch' | 'file-changed' | 'unreadable'; onLock?: (reason: 'anchor-mismatch' | 'file-changed' | 'unreadable') => void;
 private lock(reason: 'anchor-mismatch' | 'file-changed' | 'unreadable') { const was = this.trusted; this.trusted = false; this.lockReason = reason; if (was) this.onLock?.(reason); }
 constructor(private path: string, private key: Buffer | undefined, private now = () => Date.now(), private anchor?: TriggerAnchor) {
  if (!key || key.length < 32 || !anchor) return;
  try {
   let raw = this.currentRaw(), state = anchor.read(); if (!anchorValid(state)) return;
   if (state.pending !== null) {
    singleWriter(this.path, () => {
     raw = this.currentRaw(); state = anchor.read(); if (!anchorValid(state)) throw Error('Invalid trigger anchor');
     if (raw === null) {
      if (state.committed !== null) throw Error('Missing trigger configuration');
      anchor.write({ committed: null, pending: null });
     } else {
      this.parse(raw); const sha = digest(raw);
      if (sha !== state.committed && sha !== state.pending) throw Error('Stale trigger configuration');
      anchor.write({ committed: sha, pending: null });
     }
    });
   }
   if (raw === null) { if (state.committed !== null) return; this.trusted = true; return; }
   const data = this.parse(raw), sha = digest(raw); const finalState = anchor.read();
   if (!anchorValid(finalState) || sha !== finalState.committed) return;
   this.data = data; this.baseline = raw; this.trusted = true;
  } catch { /* fail closed */ }
 }
 private sign(payload: string) { return createHmac('sha256', this.key!).update(payload, 'utf8').digest(); }
 private parse(raw: string): Data {
  if (raw.length > 4_000_000) throw Error('Invalid trigger configuration');
  const envelope: unknown = JSON.parse(raw);
  if (!object(envelope) || envelope.version !== 1 || typeof envelope.payload !== 'string' || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)) throw Error('Invalid trigger signature');
  const supplied = Buffer.from(envelope.mac, 'hex'); const expected = this.sign(envelope.payload);
  if (!timingSafeEqual(supplied, expected)) throw Error('Invalid trigger signature');
  const value: unknown = JSON.parse(envelope.payload); if (!valid(value)) throw Error('Invalid trigger configuration'); return value;
 }
 private currentRaw(): string | null {
  try { return readFileSync(this.path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
 }
 /**
  * Is the file on disk still exactly what the Keychain anchor committed to, and what this instance last wrote or read?
  *  - a Keychain or file read that fails now is "cannot verify right now": this call is refused, the store stays trusted and the next call tries again;
  *  - content that differs from the committed hash, or an anchor that is not valid, is tampering or damage: the store locks;
  *  - content that matches the anchor but not this instance's memory means another writer got in first: this instance locks (it never writes over a newer commit).
  * A locked instance is not repaired in place. The Bridge loads a fresh one from the disk and the anchor, which believes nothing outside the anchor.
  */
 private check() {
  if (!this.trusted || !this.key || !this.anchor) return false;
  let raw: string | null, state: TriggerAnchorState;
  try { raw = this.currentRaw(); state = this.anchor.read(); } catch { return false; }
  if (!anchorValid(state) || (raw === null ? state.committed !== null : digest(raw) !== state.committed)) { this.lock('anchor-mismatch'); return false; }
  if (raw !== this.baseline) { this.lock('file-changed'); return false; }
  try { if (raw !== null) this.parse(raw); return true; } catch { this.lock('unreadable'); return false; }
 }
 get readable() { return this.check(); }
 /** Only authentic old files can be previewed; includes the signed confirmation hint. */
 stalePreview(): { sha: string; confirmationHint: string; settings: {groupId:string; path:string; kind:TriggerKind; enabled:boolean}[] } | undefined {
  if (!this.key || !this.anchor) return;
  try {
   const raw = this.currentRaw(); if (raw === null) return;
   const parsed = this.parse(raw); const state = this.anchor.read(); const sha = digest(raw);
   if (!anchorValid(state) || sha === state.committed || sha === state.pending) return;
   return { sha, confirmationHint: parsed.confirmationHint, settings: parsed.settings.map(({groupId,path,kind,enabled}) => ({groupId,path,kind,enabled})) };
  } catch { return; }
 }
 /** Confirm the exact preview, once; the Bridge serializes Mac and phone in-process. */
 confirmStale(sha: string): boolean {
  if (!this.key || !this.anchor || !/^[a-f0-9]{64}$/.test(sha)) return false;
  try { return singleWriter(this.path, () => {
   const preview = this.stalePreview(); if (!preview || preview.sha !== sha) return false;
   const raw = this.currentRaw(); if (raw === null || digest(raw) !== sha) return false;
   const data = this.parse(raw);
   // Approving historical configuration does not approve historical work or a stale metadata baseline.
   data.pending = []; data.lastDelivery = {}; data.cancelled = []; data.overflow = {};
   data.settings = data.settings.map(({ watchBaseline: _baseline, ...setting }) => setting);
   if (this.currentRaw() !== raw) { this.lock('unreadable'); return false; }
   const clean = this.encode(data);
   this.writeAtomically(clean);
   this.data = data; this.baseline = clean; this.trusted = true; return true;
  }); } catch { this.lock('unreadable'); return false; }
 }
 /** Preserve an invalid regular file and atomically install a signed empty configuration. */
 resetInvalid(): boolean {
  if (!this.key || this.key.length < 32 || !this.anchor) return false;
  try { return singleWriter(this.path, () => {
   const raw = this.currentRaw();
   if (raw === null) {
    // The configuration file is gone but the Keychain still holds its hash: nothing to preserve, so install a signed empty one.
    const state = this.anchor!.read(); if (!anchorValid(state) || state.committed === null) return false;
    const data = empty(); const clean = this.encode(data);
    this.writeAtomically(clean);
    this.data = data; this.baseline = clean; this.trusted = true; return true;
   }
   try { this.parse(raw); return false; } catch { /* Only invalid data may use this path. */ }
   const old = lstatSync(this.path); if (!old.isFile() || old.isSymbolicLink()) return false;
   const data = empty(); const clean = this.encode(data); const state = this.anchor!.read();
   if (!anchorValid(state)) return false;
   // A hard-link is a no-overwrite name for the original inode; rename of the new signed file
   // is then a single atomic replacement. A crash always leaves the original or its preserved link.
   const backup = `${this.path}.${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.invalid`;
   linkSync(this.path, backup);
   const linked = lstatSync(backup), current = lstatSync(this.path);
   if (old.dev !== linked.dev || old.ino !== linked.ino || old.dev !== current.dev || old.ino !== current.ino || this.currentRaw() !== raw) return false;
   const directory = openSync(dirname(this.path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
   this.writeAtomically(clean);
   this.data = data; this.baseline = clean; this.trusted = true; return true;
  }); } catch { this.lock('unreadable'); return false; }
 }
 private encode(data: Data) {
  if (!valid(data)) throw Error('Invalid trigger state');
  const payload = JSON.stringify(data); const raw = JSON.stringify({ version: 1, payload, mac: this.sign(payload).toString('hex') });
  if (raw.length > 4_000_000) throw Error('Trigger configuration exceeds size limit');
  return raw;
 }
 private writeAtomically(raw: string) {
  const sha = digest(raw); const prior = this.anchor!.read();
  if (!anchorValid(prior)) throw Error('Invalid trigger anchor');
  this.anchor!.write({ committed: prior.committed, pending: sha });
  const temp = `${this.path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, this.path);
  const directory = openSync(dirname(this.path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  this.anchor!.write({ committed: sha, pending: null });
 }
 private assertReadable() { if (!this.check()) throw Error('File trigger configuration unreadable; no writes permitted'); }
 private mutate(fn: (data: Data) => void) {
  this.assertReadable();
  // A rejected change (duplicate path, invalid value, oversize) happens before any write and leaves the
  // trusted state untouched. Only a failure once writing has begun can leave disk and anchor uncertain.
  let writing = false;
  try { singleWriter(this.path, () => {
   this.assertReadable();
   const next = structuredClone(this.data); fn(next);
   const raw = this.encode(next);
   writing = true; this.writeAtomically(raw);
   this.data = next; this.baseline = raw;
  }); } catch (error) { if (writing) this.lock('unreadable'); throw error; }
 }
 getHint() { if (!this.check()) return ''; return this.data.confirmationHint; }
 setHint(value: string) { if (typeof value !== 'string' || value.length > 500) throw Error('Invalid confirmation hint'); this.mutate(d => { d.confirmationHint = value; }); }
 settings(groupId?: string) { if (!this.check()) return []; return structuredClone(this.data.settings.filter(s => !groupId || s.groupId === groupId)); }
 add(groupId: string, path: string, kind: TriggerKind, identity: ValidatedTrigger) { const item: TriggerSetting = { id: randomUUID(), groupId, path, kind, enabled: false, identity }; this.mutate(d => { if (d.settings.some(s => s.groupId === groupId && s.path === path)) throw Error('Already watched'); d.settings.push(item); }); return item; }
 getWatchBaseline(groupId: string, id: string) {
  if (!this.check()) return undefined;
  const baseline = this.data.settings.find(s => s.id === id && s.groupId === groupId)?.watchBaseline;
  return baseline === undefined ? undefined : structuredClone(baseline);
 }
 setWatchBaseline(groupId: string, id: string, baseline: TriggerBaseline) {
  this.mutate(d => {
   const setting = d.settings.find(s => s.id === id && s.groupId === groupId);
   if (!setting || !validWatchBaseline(baseline, setting)) throw Error('Invalid watch baseline');
   setting.watchBaseline = structuredClone(baseline);
  });
 }
 rebindOffline(groupId: string, id: string, identity: ValidatedTrigger) {
  this.mutate(d => {
   const s = d.settings.find(v => v.id === id && v.groupId === groupId);
   if (!s?.enabled || !s.offline || identity.workspace !== s.identity.workspace || identity.target !== s.path || identity.kind !== s.kind ||
       identity.rootDevice !== s.identity.rootDevice || identity.rootInode !== s.identity.rootInode) throw Error('Offline watch identity changed');
   s.identity = identity;
  });
 }
 setOffline(groupId: string, id: string, offline: boolean) { this.mutate(d => { const s = d.settings.find(v => v.id === id && v.groupId === groupId); if (!s) throw Error('Watch not found'); if (offline) s.offline = true; else delete s.offline; }); }
 setEnabled(groupId: string, id: string, enabled: boolean) {
  this.mutate(d => {
   const s = d.settings.find(v => v.id === id && v.groupId === groupId);
   if (!s) throw Error('Watch not found');
   if (!enabled) {
    // Cancel only undelivered work for this watch; uncertain records are history.
    d.pending = d.pending.filter(p => p.event.watchId !== id || p.state === 'uncertain');
   }
   // Every actual pause/resume starts with a fresh metadata baseline. This prevents
   // edits during the pause from being reported as though they happened afterwards.
   if (s.enabled !== enabled || !enabled) delete s.watchBaseline;
   s.enabled = enabled;
  });
 }
 remove(groupId: string, id: string) { this.mutate(d => { if (!d.settings.some(s => s.id === id && s.groupId === groupId)) throw Error('Watch not found'); d.settings = d.settings.filter(s => s.id !== id); d.pending = d.pending.filter(p => p.event.watchId !== id); d.cancelled.push({ at: new Date(this.now()).toISOString() }); d.cancelled = d.cancelled.slice(-100); }); }
 cancel(watchId: string) { this.mutate(d => { d.pending = d.pending.filter(p => p.event.watchId !== watchId); }); }
 enqueue(groupId: string, event: FileNoticeEvent) { this.mutate(d => { const s = d.settings.find(v => v.groupId === groupId && v.id === event.watchId && v.enabled); if (!s) return; const old = d.pending.find(p => p.groupId === groupId && p.state === 'pending' && p.event.watchId === event.watchId && p.event.path === event.path); if (old) { old.event = event; return; } if (d.pending.filter(p => p.groupId === groupId && p.state === 'pending').length >= 32) { d.overflow[groupId] = true; return; } d.pending.push({ id: randomUUID(), groupId, event, state: 'pending' }); }); }
 pendingEvents(groupId: string) { if (!this.check()) return []; return structuredClone(this.data.pending.filter(p => p.groupId === groupId && p.state === 'pending').map(p => p.event)); }
 hasPending(groupId: string) { if (!this.check()) return false; return this.data.pending.some(p => p.groupId === groupId && p.state === 'pending'); }
 reserve(groupId: string, target: { roomId: string; sessionId: string; repoPath: string }, usable: (event: FileNoticeEvent) => boolean = () => true): FileNoticeReservation | undefined { if (!this.hasPending(groupId) || this.now() - (this.data.lastDelivery[groupId] ?? 0) < 60_000 || this.data.pending.some(p => p.groupId === groupId && p.state === 'inflight')) return; const id = randomUUID(); const selected = this.data.pending.filter(p => p.groupId === groupId && p.state === 'pending' && usable(p.event)).slice(0,32); if (!selected.length) return; this.mutate(d => { for (const p of d.pending) if (selected.some(s => s.id === p.id)) { p.state = 'inflight'; p.reservation = id; } d.lastDelivery[groupId] = this.now(); }); return { id, groupId, ...target, events: selected.map(s => s.event), confirmationHint: this.data.confirmationHint }; }
 isCurrent(r: FileNoticeReservation) { if (!this.check()) return false; const selected = this.data.pending.filter(p => p.reservation === r.id && p.state === 'inflight'); return selected.length === r.events.length && selected.every(p => this.data.settings.some(s => s.id === p.event.watchId && s.groupId === r.groupId && s.enabled && !s.offline)); }
 finish(id: string, state: NoticeFinish) { this.mutate(d => { if (state === 'delivered') d.pending = d.pending.filter(p => p.reservation !== id); else for (const p of d.pending) if (p.reservation === id) p.state = 'uncertain'; }); }
 recoverInflight() { this.assertReadable(); if (!this.data.pending.some(p => p.state === 'inflight')) return; this.mutate(d => { for (const p of d.pending) if (p.state === 'inflight') p.state = 'uncertain'; }); }
 overflow(groupId: string) { if (!this.check()) return false; return !!this.data.overflow[groupId]; }
 hasHold(groupId: string) { if (!this.check()) return false; return this.data.pending.some(p => p.groupId === groupId && (p.state === 'pending' || p.state === 'inflight')); }
 retryDelay(groupId: string) { if (!this.check()) return Infinity; return Math.max(0, 60_000 - (this.now() - (this.data.lastDelivery[groupId] ?? 0))); }
}
