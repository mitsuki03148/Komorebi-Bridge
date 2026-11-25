import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { CLIModelId } from '../src/types/guild';

export interface UsagePoint { at: number; hp: number | null; mp: number | null }
const maxPointsPerDay = 1500;
const flatSampleMs = 30 * 60_000;

/** The local calendar day a moment falls in, as YYYY-MM-DD. */
export const dayOf = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Today's quota readings for each CLI, kept in one small file that starts again from empty at 00:00:
 * a new day overwrites the same file, so nothing piles up and a restart does not lose the day so far.
 */
export class DailyUsageStore {
  private day = '';
  private points: Record<CLIModelId, UsagePoint[]> = { AGY: [], CODEX: [], CLAUDE: [] };
  private writable = true;

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (saved?.day === dayOf(this.now()) && saved.points) {
        this.day = saved.day;
        for (const id of ['AGY', 'CODEX', 'CLAUDE'] as CLIModelId[]) {
          this.points[id] = Array.isArray(saved.points[id]) ? saved.points[id].filter((point: UsagePoint) =>
            Number.isFinite(point?.at) && dayOf(point.at) === saved.day).slice(-maxPointsPerDay) : [];
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A file we cannot read is never overwritten: it stays for the Founder to look at.
        this.writable = false;
        console.error('無法讀取今日額度記錄，這次不會保存額度走勢，請檢查', path);
      }
    }
  }

  /** Today's points for one CLI (after a day change, none until the next reading). */
  series(modelId: CLIModelId): UsagePoint[] {
    return this.day === dayOf(this.now()) ? this.points[modelId] : [];
  }

  /**
   * Records a reading when the numbers changed, or when the last one is half an hour old so a flat
   * stretch still shows on the chart. The first reading of a new day starts the day afresh.
   */
  record(modelId: CLIModelId, hp: number | null, mp: number | null, changed: boolean) {
    const at = this.now();
    const today = dayOf(at);
    if (this.day !== today) {
      this.day = today;
      this.points = { AGY: [], CODEX: [], CLAUDE: [] };
    }
    const list = this.points[modelId];
    const last = list.at(-1);
    if (last && !changed && at - last.at < flatSampleMs) return false;
    this.points[modelId] = [...list.slice(-(maxPointsPerDay - 1)), { at, hp, mp }];
    this.save();
    return true;
  }

  private save() {
    if (!this.writable) return;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ day: this.day, points: this.points }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } catch { /* The chart still works from memory; the next reading tries again. */ }
    finally { try { unlinkSync(temporary); } catch { /* The rename removed it. */ } }
  }
}
