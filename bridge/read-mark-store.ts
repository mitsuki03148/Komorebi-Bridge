import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mergeReadMarks, type ReadMarks } from '../src/utils/attentionDiff';

/** Limits so a client cannot make the file grow without end. */
export const readMarkLimits = { perMessage: 500, id: 200, stamp: 100, total: 5000 };

/**
 * What the Founder has read, kept by the Bridge so every device agrees: per room, the time of the last agent reply seen.
 * It holds no message text. A bad or oversized entry is ignored, never an error for the sender.
 */
export class ReadMarkStore {
  private marks: ReadMarks = {};

  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) this.marks = this.clean(saved as Record<string, unknown>);
    } catch { /* No file yet, or one that cannot be read: start empty and write a new one on the first change. */ }
  }

  private clean(raw: Record<string, unknown>) {
    const marks: ReadMarks = {};
    for (const [id, stamp] of Object.entries(raw)) {
      if (id.length === 0 || id.length > readMarkLimits.id || typeof stamp !== 'string' || stamp.length > readMarkLimits.stamp) continue;
      marks[id] = stamp;
      if (Object.keys(marks).length >= readMarkLimits.total) break;
    }
    return marks;
  }

  all(): ReadMarks { return { ...this.marks }; }

  /** Merge what a device reports; returns only the entries that changed (empty if none), already saved. */
  apply(raw: unknown): ReadMarks {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const incoming = this.clean(Object.fromEntries(Object.entries(raw as Record<string, unknown>).slice(0, readMarkLimits.perMessage)));
    const room = readMarkLimits.total - Object.keys(this.marks).length;
    const fresh = Object.keys(incoming).filter(id => this.marks[id] === undefined);
    for (const id of fresh.slice(Math.max(room, 0))) delete incoming[id];
    const merged = mergeReadMarks(this.marks, incoming);
    if (merged === this.marks) return {};
    const changed: ReadMarks = {};
    for (const id of Object.keys(incoming)) if (merged[id] !== this.marks[id]) changed[id] = merged[id];
    this.marks = merged;
    this.save();
    return changed;
  }

  /** Forget rooms that no longer exist. */
  prune(keep: ReadonlySet<string>) {
    const next = Object.fromEntries(Object.entries(this.marks).filter(([id]) => keep.has(id)));
    if (Object.keys(next).length === Object.keys(this.marks).length) return;
    this.marks = next;
    this.save();
  }

  get size() { return Object.keys(this.marks).length; }

  private save() {
    if (!this.path) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.marks), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch { /* A failed save is not fatal: the marks stay in memory and the next change tries again. */ }
    finally { try { unlinkSync(temporary); } catch { /* The rename moved it. */ } }
  }
}
