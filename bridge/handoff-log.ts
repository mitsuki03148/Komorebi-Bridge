import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { HandoffEntry } from '../src/types/bridge';

const keep = 200;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * What happened to the messages agents sent each other with `komorebi-room send`: who to whom, how it ended, how long it took.
 * Only the outcome is kept, never the message, so a failure can be looked at afterwards instead of guessed at.
 */
export class HandoffLog {
  private entries: HandoffEntry[] = [];

  constructor(private readonly path?: string, private readonly now = () => Date.now()) {
    if (!path) return;
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(saved)) this.entries = saved.filter(item => item && typeof item.at === 'string' && typeof item.to === 'string').slice(-keep);
    } catch { /* No log yet. */ }
  }

  add(report: { from?: unknown; to?: unknown; code?: unknown; ms?: unknown; note?: unknown }) {
    const code = Number(report.code);
    const entry: HandoffEntry = {
      at: new Date(this.now()).toISOString(),
      ...(text(report.from, 120) ? { from: text(report.from, 120) } : {}),
      to: text(report.to, 160) || '（未知）',
      code: Number.isInteger(code) && code >= 0 && code <= 3 ? code : 1,
      ms: Math.max(0, Math.min(3_600_000, Math.round(Number(report.ms) || 0))),
      note: text(report.note, 300),
    };
    this.entries = [...this.entries, entry].slice(-keep);
    this.save();
    return entry;
  }

  recent(count = 20, failedOnly = false) {
    const list = failedOnly ? this.entries.filter(entry => entry.code !== 0) : this.entries;
    return list.slice(-Math.min(Math.max(Math.floor(count) || 20, 1), keep));
  }

  private save() {
    if (!this.path) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.entries), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch { /* A log that cannot be written must never break a handoff. */ }
    finally { try { unlinkSync(temporary); } catch { /* The rename moved it. */ } }
  }
}
