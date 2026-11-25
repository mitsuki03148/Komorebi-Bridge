// Read-only inventory of native transcript files, used by the settings panel.
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { CLIModelId, TerminalRoom } from '../src/types/guild';
import { cliIds, ignoredPath, isTranscript } from './sessions';
import type { WorktreeUsage } from './auto-worktree';

export type TranscriptFile = { path: string; bytes: number; modified: number };
export type StorageUsage = { totals: Record<CLIModelId, number>; rooms: { id: string; name: string; modelId: CLIModelId; bytes: number; modified: string; candidate: boolean }[]; unmatched: number; unassigned: { id: string; modelId: CLIModelId; bytes: number; modified: string }[]; incomplete: boolean; worktrees?: WorktreeUsage[]; worktreeError?: boolean };

/** Never follow symlinks: each file is counted once, under the configured CLI roots. */
export async function inventoryTranscripts(roots: Record<CLIModelId, string[]>) {
  const files = new Map<string, TranscriptFile>();
  let incomplete = false;
  for (const modelId of cliIds) for (const root of roots[modelId]) {
    const walk = async (path: string): Promise<void> => {
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          // Electron's singleton locks are not transcript roots.
          if (!/^(?:Singleton(?:Socket|Cookie|Lock)|RunningChromeVersion)$/.test(basename(path))) incomplete = true;
          return;
        }
        if (info.isDirectory()) {
          if (path !== root && ignoredPath(modelId, path, root)) return;
          for (const name of await readdir(path)) await walk(join(path, name));
        } else if (info.isFile() && (isTranscript(modelId, path, root) || (modelId === 'CODEX' && /^rollout-.*\.jsonl\.zst$/.test(basename(path))))) {
          files.set(path, { path, bytes: info.size, modified: info.mtimeMs });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') incomplete = true;
      }
    };
    await walk(root);
  }
  return { files, incomplete };
}

/** A file with more than one room identity is never suggested for cleanup. */
export function makeStorageUsage(files: Map<string, TranscriptFile>, roots: Record<CLIModelId, string[]>, rooms: TerminalRoom[],
  home: string, protectedKeys: readonly string[], pinnedKeys: readonly string[], busy: (room: TerminalRoom) => boolean,
  days: number, incomplete: boolean, now = Date.now()): StorageUsage {
  const totals: Record<CLIModelId, number> = { AGY: 0, CODEX: 0, CLAUDE: 0 };
  const nativeFiles = new Map<string, string[]>();
  const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
  for (const file of files.values()) for (const id of cliIds) {
    const root = roots[id].find(root => file.path.startsWith(root + '/'));
    if (root) {
      totals[id] += file.bytes;
      const native = id === 'AGY' ? relative(root, file.path).split('/')[0].match(new RegExp(`^${uuid}$`, 'i'))?.[0] :
        basename(file.path).match(new RegExp(`(${uuid})\\.jsonl(?:\\.zst)?$`, 'i'))?.[1];
      if (native) {
        const key = `${id}:${native.toLowerCase()}`;
        nativeFiles.set(key, [...nativeFiles.get(key) ?? [], file.path]);
      }
      break;
    }
  }
  const paths = rooms.map(room => {
    const direct = room.syncedStateFile?.startsWith('~/') ? join(home, room.syncedStateFile.slice(2)) : '';
    if (files.has(direct)) return direct;
    const matches = room.sessionId ? nativeFiles.get(`${room.modelId}:${room.sessionId.toLowerCase()}`) : undefined;
    return matches?.length === 1 ? matches[0] : '';
  });
  const counts = new Map<string, number>();
  for (const path of paths) if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
  const items = rooms.flatMap((room, index) => {
    const file = files.get(paths[index]);
    if (!file || !room.sessionId) return [];
    const keys = [room.id, `session-${room.modelId.toLowerCase()}-${room.sessionId}`];
    const excluded = keys.some(key => protectedKeys.includes(key) || pinnedKeys.includes(key));
    const nativeMatches = nativeFiles.get(`${room.modelId}:${room.sessionId.toLowerCase()}`);
    return [{ id: room.id, name: room.roomName, modelId: room.modelId, bytes: file.bytes,
      modified: new Date(file.modified).toISOString(), candidate: !incomplete && !excluded && !room.live && !busy(room) && counts.get(file.path) === 1 && (nativeMatches?.length ?? 0) <= 1 && file.modified < now - days * 86_400_000 }];
  });
  // Unknown identities cannot be classified as idle: their Bridge aliases or external CLI may still be in use.
  const unassigned = [...nativeFiles].flatMap(([key, paths]) => paths.filter(path => !counts.has(path)).map(path => {
    const file = files.get(path)!;
    const [modelId, id] = key.split(':') as [CLIModelId, string];
    return { id, modelId, bytes: file.bytes, modified: new Date(file.modified).toISOString() };
  })).sort((a, b) => b.modified.localeCompare(a.modified));
  return { totals, rooms: items, unmatched: [...files.keys()].filter(path => !counts.has(path)).length, unassigned, incomplete };
}
