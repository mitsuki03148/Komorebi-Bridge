import type { GroupChat } from '../src/types/guild';

export const groupCloseDelays = { finished: 120_000, quiet: 180_000 } as const;

export interface GroupCloserDeps {
  groups(): GroupChat[];
  busy(roomId: string): boolean;
  isOpen(roomId: string): boolean;
  /** ID of the crown's final report in its current run, if observed. */
  report(group: GroupChat): string | undefined;
  close(roomId: string): void;
  now?(): number;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

interface State { crown: string; quietSince: number; report?: string; reportSince?: number; attempted?: boolean }

/** Only crowns use group clocks. A room leading several groups must satisfy all of their clocks. */
export class GroupCloser {
  private readonly states = new Map<string, State>();
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private timer?: unknown;
  private closing = false;

  constructor(private readonly deps: GroupCloserDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((run, ms) => { const timer = setTimeout(run, ms); timer.unref(); return timer; });
    this.clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  isCrown(roomId: string) {
    return this.deps.groups().some(group => group.orchestratorRoomId === roomId);
  }

  checkAll() { if (!this.closing) this.evaluate(false); }

  dispose() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.states.clear();
  }

  private evaluate(fired: boolean) {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    const now = this.now();
    const groups = this.deps.groups();
    const active = new Set<string>();
    const due = new Map<string, number>();
    for (const group of groups) {
      const crown = group.orchestratorRoomId;
      if (!crown || !this.deps.isOpen(crown)) continue;
      if (group.members.some(member => this.deps.busy(member.roomId))) {
        due.set(crown, Infinity);
        continue;
      }
      active.add(group.id);
      const previous = this.states.get(group.id);
      const state = previous?.crown === crown ? previous : { crown, quietSince: now };
      const report = this.deps.report(group);
      if (report !== state.report) {
        state.report = report;
        state.reportSince = report ? now : undefined;
        state.attempted = false;
      }
      this.states.set(group.id, state);
      const deadline = state.attempted ? Infinity : Math.min(state.quietSince + groupCloseDelays.quiet,
        state.reportSince === undefined ? Infinity : state.reportSince + groupCloseDelays.finished);
      due.set(crown, Math.max(due.get(crown) ?? -Infinity, deadline));
    }
    for (const id of this.states.keys()) if (!active.has(id)) this.states.delete(id);

    if (fired) {
      this.closing = true;
      try {
        for (const [crown, deadline] of due) {
          if (deadline > now || !this.deps.isOpen(crown)) continue;
          // A preceding close can have changed a shared room. Check live facts again before each kill.
          const current = this.deps.groups().filter(group => group.orchestratorRoomId === crown);
          if (!current.length || current.some(group => group.members.some(member => this.deps.busy(member.roomId)))) continue;
          for (const state of this.states.values()) if (state.crown === crown) state.attempted = true;
          this.deps.close(crown);
        }
      } finally { this.closing = false; }
      this.evaluate(false);
      return;
    }

    const deadline = Math.min(...due.values());
    if (Number.isFinite(deadline)) this.timer = this.setTimer(() => this.evaluate(true), Math.max(0, deadline - now));
  }
}
