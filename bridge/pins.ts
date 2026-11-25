import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

const pinLimit = 20;

/** One ordered entry per room; a bound room has both its UI and native session keys. */
export class RoomPins {
  private entries: string[][] = [];
  private readable = true;

  constructor(private readonly file: string) {
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(data) || data.length > pinLimit || data.some(entry =>
        !Array.isArray(entry) || !entry.length || entry.some(key => typeof key !== 'string' || !key))) {
        throw new Error('Invalid room pins');
      }
      const keys = data.flat();
      if (new Set(keys).size !== keys.length) throw new Error('Duplicate room pin keys');
      this.entries = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.readable = false;
        console.error('無法讀取房間置頂設定，原檔不會覆寫：', file);
      }
    }
  }

  snapshot(inactive?: (key: string) => boolean) {
    return (inactive ? this.entries.filter(entry => !entry.some(inactive)) : this.entries).flat();
  }

  has(key: string) { return this.entries.some(entry => entry.includes(key)); }
  isReadable() { return this.readable; }

  set(keys: string[], pinned: boolean) {
    if (!this.readable) throw new Error('無法讀取房間置頂設定，請檢查 Mac 上的設定檔。');
    if (!pinned) return this.remove(new Set(keys));
    if (keys.some(key => this.has(key))) return this.link(keys);
    if (this.entries.length >= pinLimit) throw new Error(`最多可以置頂 ${pinLimit} 間房。`);
    return this.save([...this.entries, [...new Set(keys)]]);
  }

  /** Merge aliases at the earliest pin position when a room acquires its native session ID. */
  link(keys: string[]) {
    const matches = this.entries.filter(entry => entry.some(key => keys.includes(key)));
    if (!matches.length) return false;
    const merged = [...new Set([...matches.flat(), ...keys])];
    if (matches.length === 1 && matches[0].length === merged.length) return false;
    return this.save(this.entries.flatMap(entry => entry === matches[0] ? [merged] : matches.includes(entry) ? [] : [entry]));
  }

  remove(keys: ReadonlySet<string>) {
    const next = this.entries.filter(entry => !entry.some(key => keys.has(key)));
    return next.length !== this.entries.length && this.save(next);
  }

  private save(next: string[][]) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      try { writeFileSync(fd, JSON.stringify(next)); }
      finally { closeSync(fd); }
      renameSync(temporary, this.file);
      this.entries = next;
      return true;
    } finally {
      try { unlinkSync(temporary); } catch { /* Keep the original write error. */ }
    }
  }
}
