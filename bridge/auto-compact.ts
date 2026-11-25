import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { CLIModelId } from '../src/types/guild';

export const autoCompactTarget = 250_000;

/** Run at the end of a Codex turn. The regular native safeguards still run. */
function codexCompactPercent(window: number | undefined) {
  if (!window || !Number.isSafeInteger(window) || window <= autoCompactTarget) return;
  return Math.max(1, Math.floor(autoCompactTarget * 100 / window));
}

export function autoCompactArgs(model: CLIModelId, remote: boolean, codexWindow?: number) {
  if (model === 'CLAUDE') return ['--autocompact', String(autoCompactTarget)];
  if (model !== 'CODEX' || remote) return [];
  const percent = codexCompactPercent(codexWindow);
  return percent === undefined ? [] : ['-c', `model_post_turn_compact_threshold_percent=${percent}`];
}

export function supportsAutoCompact(model: CLIModelId, output: string) {
  if (model === 'CLAUDE') return /(?:^|\s)--autocompact\s/.test(output);
  const version = model === 'CODEX' ? /\bcodex-cli (\d+)\.(\d+)\.(\d+)\b/.exec(output) : /^(\d+)\.(\d+)\.(\d+)$/.exec(output.trim());
  if (!version) return false;
  const [, major, minor, patch] = version.map(Number);
  return model === 'CODEX' ? major > 0 || minor >= 169 : major > 1 || major === 1 && (minor > 5 || minor === 5 && patch >= 15);
}

const validKeys = (keys: unknown): keys is string[] => Array.isArray(keys) && keys.every(key => typeof key === 'string' && key);

/**
 * Stores room and native session keys for the rooms that opted in, and the switch that turns it on for every room.
 * An older file is a plain list of keys; it is read as it is, with the all-rooms switch off.
 */
export class AutoCompactRooms {
  private keys = new Set<string>();
  private everyRoom = false;
  private writable = true;

  constructor(private readonly path: string) {
    try {
      const saved: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (validKeys(saved)) this.keys = new Set(saved);
      else if (saved && typeof saved === 'object' && (saved as { version?: unknown }).version === 1 &&
          typeof (saved as { all?: unknown }).all === 'boolean' && validKeys((saved as { rooms?: unknown }).rooms)) {
        this.everyRoom = (saved as { all: boolean }).all;
        this.keys = new Set((saved as { rooms: string[] }).rooms);
      } else throw new Error('Invalid Auto Compact settings');
    } catch (error) {
      this.writable = (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
  }

  get all() { return this.everyRoom; }

  enabled(keys: string[]) { return this.everyRoom || keys.some(key => this.keys.has(key)); }

  set(keys: string[], enabled: boolean) {
    if (keys.every(key => this.keys.has(key) === enabled)) return;
    const next = new Set(this.keys);
    for (const key of keys) {
      if (enabled) next.add(key);
      else next.delete(key);
    }
    this.save(this.everyRoom, next);
  }

  setAll(enabled: boolean) {
    if (this.everyRoom === enabled) return;
    this.save(enabled, this.keys);
  }

  private save(all: boolean, keys: Set<string>) {
    if (!this.writable) throw new Error('無法讀取 Auto Compact 設定，請檢查 Mac 上的設定檔。');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, all, rooms: [...keys] }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      this.everyRoom = all;
      this.keys = keys;
    } finally { try { unlinkSync(temporary); } catch { /* Renamed or never created. */ } }
  }
}
