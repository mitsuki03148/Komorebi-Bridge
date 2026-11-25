import type { LaunchModes } from '../types/bridge';
import type { TerminalRoom } from '../types/guild';

/** The name of the no-approval mode: AGY runs in Turbo, Claude and Codex with full access. */
export const autoModeLabel = (modelId: TerminalRoom['modelId']) => modelId === 'AGY' ? 'Turbo' : '免審批';

/** Whether a room runs (or, once opened, will run) without asking for approval. */
export function roomAutoMode(room: TerminalRoom, modes: LaunchModes | null | undefined) {
  if (room.live && room.autoMode !== undefined) return room.autoMode;
  if (!modes) return false;
  const bySession = room.sessionId ? modes.rooms[`session-${room.modelId.toLowerCase()}-${room.sessionId}`] : undefined;
  return modes.rooms[room.id] ?? bySession ?? modes.defaults[room.modelId];
}
