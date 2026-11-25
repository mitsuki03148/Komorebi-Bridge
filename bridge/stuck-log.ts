import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TerminalRoom } from '../src/types/guild';

export const maxLogBytes = 512 * 1024;
export const tailLines = 30;

/**
 * Keeps the last lines of a screen that stood still away from its prompt, in a private log on this Mac, so what the
 * CLI was asking can be looked at later and the Bridge taught to recognise it. Never throws; the log never grows past
 * one old copy and the current one.
 */
export function noteStuckScreen(room: Pick<TerminalRoom, 'modelId' | 'roomName' | 'sessionId' | 'id' | 'screen'>, path: string, now = new Date()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    try { if (statSync(path).size > maxLogBytes) renameSync(path, `${path}.1`); } catch { /* No log yet. */ }
    const tail = (room.screen ?? '').split('\n').slice(-tailLines).join('\n');
    appendFileSync(path, `\n===== ${now.toISOString()} · ${room.modelId} · ${room.roomName} · ${room.sessionId ?? room.id}\n${tail}\n`, { mode: 0o600 });
    return true;
  } catch { return false; }
}
