import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { LaunchModes } from '../src/types/bridge';
import type { CLIModelId } from '../src/types/guild';

const models: CLIModelId[] = ['AGY', 'CODEX', 'CLAUDE'];

/**
 * Which rooms start their CLI without asking for approval (Claude/Codex full access, AGY Turbo).
 * A room keeps the mode it was given for as long as it exists; a room nobody chose for follows its CLI's default.
 */
export class LaunchModeStore {
  private defaults: Record<CLIModelId, boolean> = { AGY: false, CODEX: false, CLAUDE: false };
  private rooms = new Map<string, boolean>();
  private writable = true;

  constructor(private readonly path: string) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      for (const id of models) if (typeof saved?.defaults?.[id] === 'boolean') this.defaults[id] = saved.defaults[id];
      for (const [key, value] of Object.entries(saved?.rooms ?? {})) if (typeof value === 'boolean') this.rooms.set(key, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Never overwrite a file we could not read: it may hold choices worth recovering by hand.
        this.writable = false;
        console.error('無法讀取房間權限模式設定，已用預設（需逐項審批），請檢查', path);
      }
    }
  }

  /** The mode a room should start with: its own choice (by room id or session key), else its CLI's default. */
  resolve(modelId: CLIModelId, keys: string[]) {
    for (const key of keys) {
      const own = this.rooms.get(key);
      if (own !== undefined) return own;
    }
    return this.defaults[modelId];
  }

  has(key: string) { return this.rooms.has(key); }
  get snapshot(): LaunchModes {
    return { defaults: { ...this.defaults }, rooms: Object.fromEntries(this.rooms) };
  }

  setRoom(keys: string[], auto: boolean) {
    const next = new Map(this.rooms);
    for (const key of keys) next.set(key, auto);
    this.save(this.defaults, next);
    this.rooms = next;
  }

  /** A room that was started before its session id was known keeps its mode once the session is known. */
  copy(from: string, to: string) {
    const value = this.rooms.get(from);
    if (value === undefined || this.rooms.get(to) === value) return;
    this.setRoom([to], value);
  }

  setDefault(modelId: CLIModelId, auto: boolean) {
    const next = { ...this.defaults, [modelId]: auto };
    this.save(next, this.rooms);
    this.defaults = next;
  }

  private save(defaults: Record<CLIModelId, boolean>, rooms: Map<string, boolean>) {
    if (!this.writable) throw new Error('無法讀取已保存的權限模式設定，請檢查 Mac 上的設定檔。');
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ defaults, rooms: Object.fromEntries(rooms) }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally {
      try { unlinkSync(temporary); } catch { /* The rename removed the temporary file. */ }
    }
  }
}
