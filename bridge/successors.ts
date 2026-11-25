import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * "This room has been taken over by that one": a reply or a message aimed at the old room goes to its successor instead.
 * Rooms are named here by the CLI session id (the room id until a room has one), the way the workbench names them.
 */
export class Successors {
  private map = new Map<string, string>();

  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      for (const [from, to] of Object.entries(saved ?? {})) if (typeof to === 'string' && from !== to) this.map.set(from, to);
    } catch { /* None yet. */ }
  }

  snapshot(): Record<string, string> { return Object.fromEntries(this.map); }

  /** Set (or with null, clear) who took over `from`. A takeover that would loop back to `from` is refused. */
  set(from: string, to: string | null) {
    if (!from) throw new Error('請指明要交出的房。');
    if (to === null) { if (!this.map.delete(from)) return false; this.save(); return true; }
    if (to === from) throw new Error('房不能由自己接手。');
    for (let at: string | undefined = to, steps = 0; at !== undefined; at = this.map.get(at), steps++) {
      if (at === from || steps > 20) throw new Error('接手關係會繞返轉頭，請重新揀。');
    }
    this.map.set(from, to);
    this.save();
    return true;
  }

  /** Drop a room's links, from it and to it (the room is gone). */
  forget(key: string) {
    let changed = this.map.delete(key);
    for (const [from, to] of [...this.map]) if (to === key) { this.map.delete(from); changed = true; }
    if (changed) this.save();
  }

  private save() {
    if (!this.path) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.snapshot()), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally { try { unlinkSync(temporary); } catch { /* The rename moved it. */ } }
  }
}

/** Follow takeovers from a room key to the room that now does its work (at most a few steps, never in a circle). */
export function followSuccessor(successors: Record<string, string>, key: string): { key: string; via: string[] } {
  const via: string[] = [];
  let at = key;
  for (let steps = 0; steps < 5 && successors[at] !== undefined && !via.includes(successors[at]) && successors[at] !== key; steps++) {
    at = successors[at];
    via.push(at);
  }
  return { key: at, via };
}
