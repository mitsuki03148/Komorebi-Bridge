// Room protection persists independently of pin order and follows native session aliases.
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export class RoomProtection {
  private entries: string[][] = [];
  readable: boolean;
  constructor(private readonly file: string) {
    let readable = true;
    try {
      const entries: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || !entry.length || entry.some(key => typeof key !== 'string' || !key)) || new Set(entries.flat()).size !== entries.flat().length) throw new Error('Invalid protection data');
      this.entries = entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') readable = false;
    }
    this.readable = readable;
  }
  snapshot() { return this.entries.flat(); }
  has(keys: readonly string[]) { return !this.readable || this.entries.some(entry => entry.some(key => keys.includes(key))); }
  set(keys: string[], enabled: boolean) {
    if (!this.readable) throw new Error('無法讀取房間保護設定，請先檢查原檔。');
    const matches = this.entries.filter(entry => entry.some(key => keys.includes(key)));
    if (enabled && matches.length === 1 && keys.every(key => matches[0].includes(key))) return false;
    const next = this.entries.filter(entry => !matches.includes(entry));
    if (enabled) next.push([...new Set([...matches.flat(), ...keys])]);
    if (JSON.stringify(next) === JSON.stringify(this.entries)) return false;
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); renameSync(temp, this.file); }
    catch (error) { this.readable = false; throw error; }
    finally { try { unlinkSync(temp); } catch { /* rename already removed it */ } }
    this.entries = next;
    return true;
  }
  link(keys: string[]) { if (this.readable && this.has(keys)) return this.set(keys, true); return false; }
}
