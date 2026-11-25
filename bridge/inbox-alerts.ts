// Read-only inventory: never follows symlinks or reads file contents.
import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Dirent } from 'node:fs';

export type InboxAlert = { path: string; persona: string; task: string; bytes: number; largest?: { name: string; bytes: number }; derived: boolean; incomplete: boolean; firstSeenAt?: number };
export type InboxAlertScan = { alerts: InboxAlert[]; incomplete: boolean; checkedPaths?: string[] };
const derived = /^(?:\.build|Pods|node_modules|\.git|DerivedData|system\.logarchive|simctl_diagnostics)$|\.(?:dSYM|o|pcm)$/i;
const threshold = 100 * 1024 * 1024;
// Phone originals and common video formats count as media even when the in-app reader cannot preview them.
const media = /\.(?:png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?|mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

/** Preserve earlier alerts when a traversal could not prove that they disappeared. */
export function reconcileInboxAlerts(previous: InboxAlertScan | undefined, result: InboxAlertScan, baseline: boolean, now = Date.now()) {
  const old = previous?.alerts ?? [];
  const known = new Set(old.map(item => item.path));
  const observed = result.alerts.map(item => {
    const before = old.find(entry => entry.path === item.path);
    // A partial result cannot prove earlier bytes or derived artifacts disappeared.
    const current = item.incomplete && before ? {
      ...before, bytes: Math.max(before.bytes, item.bytes), derived: before.derived || item.derived,
      largest: (item.largest?.bytes ?? 0) > (before.largest?.bytes ?? 0) ? item.largest : before.largest,
      incomplete: true,
    } : item;
    const firstSeenAt = before?.firstSeenAt ?? (!before && baseline && !previous?.incomplete ? now : undefined);
    return firstSeenAt === undefined ? current : { ...current, firstSeenAt };
  });
  const checked = new Set(result.checkedPaths ?? []);
  const alerts = result.incomplete ? [...observed, ...old.filter(item => !result.alerts.some(entry => entry.path === item.path) && !checked.has(item.path)).map(item => ({ ...item, incomplete: true }))] : observed;
  return { data: { alerts, incomplete: result.incomplete }, fresh: baseline && alerts.some(item => !known.has(item.path)) };
}

/** Limits are checked between I/O batches; inaccessible or unfinished work is unknown. */
export async function scanInboxAlerts(root: string, options: { maxEntries?: number; maxDepth?: number; maxMs?: number; taskMaxMs?: number; now?: () => number } = {}): Promise<InboxAlertScan> {
  const maxEntries = options.maxEntries ?? 50_000, maxDepth = options.maxDepth ?? 32, now = options.now ?? Date.now;
  // The SSD can take over 20 seconds on a real 10k-entry task. Keep a bound,
  // but allow that task to finish without turning every scan into a warning.
  const deadline = now() + (options.maxMs ?? 60_000);
  let visited = 0, incomplete = false;
  const alerts: InboxAlert[] = [], checkedPaths: string[] = [];
  async function dirs(path: string) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) { incomplete = true; return []; }
      return await readdir(path, { withFileTypes: true });
    } catch { incomplete = true; return []; }
  }
  for (const person of await dirs(root)) {
    if (!person.isDirectory() || person.isSymbolicLink()) continue;
    const personPath = join(root, person.name);
    for (const task of await dirs(personPath)) {
      if (!task.isDirectory() || task.isSymbolicLink()) continue;
      const path = join(personPath, task.name), taskDeadline = now() + (options.taskMaxMs ?? 30_000);
      let bytes = 0, hasDerived = derived.test(task.name), taskIncomplete = false;
      const sizes = new Map<string, number>();
      type Entry = { path: string; depth: number; top?: string; dirent?: Dirent };
      const queue: Entry[] = [{ path, depth: 0 }];
      let position = 0;
      while (position < queue.length) {
        if (now() > deadline || now() > taskDeadline || visited >= maxEntries) { taskIncomplete = true; break; }
        const batch = queue.slice(position, Math.min(position + 8, maxEntries - visited + position));
        position += batch.length; visited += batch.length;
        await Promise.all(batch.map(async entry => {
          if (entry.depth > maxDepth) { taskIncomplete = true; return; }
          try {
            const info = entry.dirent;
            if (info?.isSymbolicLink()) return;
            if (derived.test(basename(entry.path))) hasDerived = true;
            if (!info || info.isDirectory()) {
              const children = await readdir(entry.path, { withFileTypes: true });
              for (const child of children) queue.push({ path: join(entry.path, child.name), depth: entry.depth + 1, top: entry.top ?? child.name, dirent: child });
            } else if (info.isFile()) {
              const file = await lstat(entry.path);
              if (!file.isFile() || file.isSymbolicLink()) { taskIncomplete = true; return; }
              const occupied = Number.isFinite(file.blocks) && file.blocks >= 0 ? file.blocks * 512 : file.size;
              if (!media.test(entry.path)) bytes += occupied;
              if (entry.top && entry.depth > 1) sizes.set(entry.top, (sizes.get(entry.top) ?? 0) + occupied);
            }
          } catch { taskIncomplete = true; }
        }));
      }
      incomplete ||= taskIncomplete;
      if (!taskIncomplete) checkedPaths.push(path);
      if (taskIncomplete || hasDerived || bytes > threshold) {
        const largest = [...sizes].sort((a, b) => b[1] - a[1])[0];
        alerts.push({ path, persona: person.name, task: task.name, bytes, derived: hasDerived, incomplete: taskIncomplete,
          ...(largest ? { largest: { name: largest[0], bytes: largest[1] } } : {}) });
      }
    }
  }
  return incomplete ? { alerts, incomplete, checkedPaths } : { alerts, incomplete };
}
