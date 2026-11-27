// Contents
// Ticket records and limits
// Saved state and wake reservations
// Workbench
//   Open, save and retire records
//   Restore context after 瞳 compacts
//   Schedule RSI reviews
//   Track stalled tickets
//   Look up routing and delivery history
//   Create tickets and record checkout results
//   Read and deliver tickets
//   Complete or cancel tickets
//   Reserve and acknowledge wakes
//   Find checkouts and manage claims
// Format tickets, wakes and hook replies

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';
import type { BenchRoutingError, RoleRouteReceipt } from '../src/types/bridge';
import { readExperience, readExperienceInput } from './bench-experience';
import type { CheckoutCompletion } from './bench-completion';

/**
 * The Bridge keeps them; the agent gets them through a hook while it works, or a short wake-up message while it is idle.
 * See Review/WORKBENCH/PLAN.md.
 */

// ── Ticket records and limits ──
// Define the records shared with callers and the limits applied to them.

export interface BenchParty { sessionId: string; roomName: string; modelId: CLIModelId }
export interface BenchSystem { system: 'rsi-tidy'; sessionId?: never }
export type BenchSender = BenchParty | BenchSystem;
export const isSystemSender = (party: BenchSender): party is BenchSystem => 'system' in party;

/** A notice only tells: it counts as finished the moment the recipient is handed it, so nobody has to close it. */
export type TicketKind = 'task' | 'reply' | 'done' | 'notice';
export type TicketStatus = 'new' | 'seen' | 'done';

export interface Ticket {
  id: number;
  kind: TicketKind;
  groupId: string;
  from: BenchSender;
  to: BenchParty;
  title: string;
  body: string;
  purpose?: 'persona-notice';
  repo?: string;
  ref?: string;
  boundary?: string;
  receipt?: string;
  /** The ticket this one answers. */
  replyTo?: number;
  /** How far it is from a person: an agent's own task is 1, each reply to a ticket adds one. */
  hops: number;
  status: TicketStatus;
  createdAt: string;
  seenAt?: string;
  doneAt?: string;
  note?: string;
  receiptProof?: ReceiptProof;
  completion?: CompletionEvidence;
  route?: RoleRouteReceipt;
  /** Snapshotted by the Bridge. Related replies/done notices keep exact endpoints but do not participate in rotation. */
  fixed?: { fromRoomId: string; toRoomId: string };
  wokenAt?: string;
  /** A completion gets at most one automatic follow-up delivery attempt. */
  completionRetriedAt?: string;
  /** Set when the Bridge closed this ticket for being open too long; a late `done` from the recipient still completes it. */
  expiredAt?: string;
  /** How many times the Bridge reminded the recipient that this task is still open, and when it last did. */
  nudges?: number;
  nudgedAt?: string;
  /** Set once the stall was reported to the group lead and the Founder, so it is reported only once. */
  escalatedAt?: string;
  /** Set when the sender called the ticket off; the recipient no longer owes it. */
  cancelledAt?: string;
  /** A locally registered pending lesson linked to this exact workbench task. */
  pendingLessonAt?: string;
  /** A requested checkout is held from delivery until it has been created and saved. */
  worktree?: { state: 'pending' | 'ready' | 'failed'; source: string; path?: string; branch?: string; error?: string; recordedAt?: string };
}

/** What the Bridge saw at the receipt path when the ticket was finished, so a later deletion can be told apart from "never there". */
export interface ReceiptProof { path: string; at: string; state: 'file' | 'dir' | 'missing' | 'unreadable'; bytes?: number; sha256?: string }

/** The saved notice keeps its own evidence even if its original ticket retires first. */
type CompletionEvidence = {
  checkout?: CheckoutCompletion;
  receipt?: ReceiptProof;
  closeout?: string[];
};

export type AcceptanceResult = 'PASS' | 'FAIL' | 'SKIP' | 'TIMEOUT' | 'CRASH' | 'ABORTED';
export type BenchCancellation = 'sender' | 'lead_final_report';
export type SavedBenchChange =
  | { kind: 'opened'; ticket: Ticket }
  | { kind: 'expired'; ticket: Ticket }
  | { kind: 'completed'; ticket: Ticket; late: boolean; checked?: AcceptanceResult }
  | { kind: 'cancelled'; ticket: Ticket; by: BenchCancellation };

type NewTicket = { groupId: string; from: BenchParty; to: BenchParty; title?: string; body: string; kind?: TicketKind; source?: 'verify-gate'; purpose?: Ticket['purpose']; replyTo?: number; repo?: string; ref?: string; boundary?: string; receipt?: string; route?: RoleRouteReceipt; fixed?: Ticket['fixed']; worktree?: Ticket['worktree']; completion?: CompletionEvidence };

export interface Claim { id: string; groupId: string; by: BenchParty; scope: string; at: string }

export const benchLimits = {
  /** Above this many hops the chain stops and the Founder is told: no endless back and forth. */
  hops: 10,
  /** Wake-up messages one member may get in an hour; past that, tickets wait for its hook or for the Founder. */
  pingsPerHour: 60,
  /** Maximum combined length of the ticket body and completion text in a non-Codex wake. */
  shortChars: 300,
  title: 120,
  body: 20_000,
  field: 500,
  /** How many tickets one hook call hands over at most, so a backlog does not flood the context. */
  perInjection: 3,
  /** How many finished tickets are kept at most; an open one is never dropped to make room. */
  kept: 500,
  /** A finished ticket is dropped after this many days. */
  retireDays: 7,
  /** Past this many tickets in all (open ones included) the oldest go, so a runaway sender cannot fill the disk. */
  hardCap: 2000,
  claimHours: 12,
  /** A task or reply nobody finished after this many hours is closed by itself: it is most likely stuck or was skipped, and it keeps its room looking busy. */
  staleHours: 3,
  /** A task or reply goes unanswered: after `unreadMs` an unread ticket is delivered again; a read task whose recipient sits idle for `idleMs` gets up to `nudges` reminders, then is reported. */
  stall: { unreadMs: 3 * 60_000, idleMs: 15 * 60_000, nudges: 2 },
};

/** The authority a ticket carries, always with the same limits as the Founder's handoff rules. */
export const benchAuthority = '本工單由同組成員派出，屬 Founder 已授權的協作工作。範圍只限任務 repo／worktree 內的正常工作；刪除、force push、覆寫共用資料、對外發送、改權限或模式，照原有規則仍須 Founder 確認。';

export class BenchError extends Error {
  /** STOP: a rule stopped it; the sender should tell the Founder, not retry. */
  /** `toast`: the Founder has to decide something, so the open pages are told; every other stop stays between the agents. */
  constructor(message: string, readonly stop = false, readonly code?: BenchRoutingError, readonly toast = false) { super(message); }
}

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';

// ── Saved state and wake reservations ──
// Keep saved records separate from the in-memory holds used while delivering a wake.

function isSavedStamp(value: unknown) {
  if (typeof value !== 'string') return false;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value;
}

type ClaimedCheckout = { path: string; ticketId?: number };
interface TidyState {
  version: 1;
  groupId: string;
  count: number;
  pendingLesson?: true;
  firstAt?: string;
  lastDispatchAt?: string;
  lessonCursor?: string;
  experienceCursor?: number;
  lastTidyTicketId?: number;
}
interface Saved { next: number; tickets: Ticket[]; claims: Claim[]; pings: Record<string, number[]>; worktrees?: Record<string, ClaimedCheckout>; tidy?: TidyState; agyCheckpoints?: Record<string, number> }

type ReservedPing = {
  id: string;
  roomKeys: string[];
  ticketIds: number[];
  expiresAt: number;
  legacy: boolean;
  writing: boolean;
  counted: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

// ── Workbench ──
// Load and update the ticket store used by the Bridge.

export class Bench {
  // ── Open, save and retire records ──
  // Recover the last committed state and keep the file bounded.

  private data: Saved = { next: 1, tickets: [], claims: [], pings: {} };
  private readonly reservedPings = new Map<string, ReservedPing>();
  onRecoveryChange?: () => void;

  /** Set while the saved workbench file exists but could not be read: nothing is written until it can be, so the file is never replaced by an empty start. */
  private unreadable?: string;
  /** The last state that reached the disk; a failed save puts the memory back to it, so memory never gets ahead of the file. */
  private persisted?: string;

  constructor(private readonly path?: string, private readonly now = () => Date.now(), private readonly onSavedChanges?: (changes: SavedBenchChange[]) => void, private readonly tidyGroup?: string,
    /** Groups whose finished tasks count toward the tidy and may carry a pending lesson; by default the tidy group alone. */
    private readonly tidyMaterialGroup: (groupId: string) => boolean = groupId => groupId === tidyGroup,
    private readonly lessonsLogPath?: string, private readonly experienceLogPath?: string) {
    if (!path) return;
    this.load();
    if (!this.unreadable) this.sweep();
  }

  /** Only a missing file is a new workbench. Any other failure keeps the file as it is and pauses writing. */
  private load() {
    if (!this.path) return;
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!Array.isArray(saved?.tickets)) throw new Error('工作台檔案格式不正確。');
      this.data = { next: Number(saved.next) || 1, tickets: saved.tickets, claims: Array.isArray(saved.claims) ? saved.claims : [], pings: saved.pings ?? {},
        worktrees: saved.worktrees && typeof saved.worktrees === 'object' ? saved.worktrees : undefined, tidy: saved.tidy,
        agyCheckpoints: saved.agyCheckpoints && typeof saved.agyCheckpoints === 'object' ? saved.agyCheckpoints : undefined };
      this.persisted = JSON.stringify(this.data);
      this.unreadable = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') { this.unreadable = undefined; return; }
      this.unreadable = error instanceof Error ? error.message : '原因不明';
    }
  }

  /** Try the file again after a read failure (the permission may be back); true when the workbench is usable. */
  private ready() {
    if (this.unreadable) this.load();
    return !this.unreadable;
  }

  /** Why the workbench is paused, or undefined when it works. */
  problem() { this.ready(); return this.unreadable; }

  /** A ticket that needs nothing more from anyone: finished, or a completion note / notice already read. */
  private static closed(ticket: Ticket) { return ticket.status === 'done' || (ticket.kind === 'done' && ticket.status === 'seen'); }

  /**
   * Let go of what is no longer needed, so the file stays small: finished tickets after a week (and past the newest 500),
   * claims that have lapsed, and hourly-ping records that are empty. An open task or reply older than `staleHours` is closed
   * by itself (not dropped: the recipient can still finish it with `done`).
   */
  retire(changes?: SavedBenchChange[]) {
    const before = JSON.stringify([this.data.tickets.length, this.data.claims.length, Object.keys(this.data.pings).length]);
    const staleBefore = this.now() - benchLimits.staleHours * 3_600_000;
    let expired = 0;
    for (const ticket of this.data.tickets) {
      if (Bench.closed(ticket) || (ticket.kind !== 'task' && ticket.kind !== 'reply')) continue;
      if (ticket.worktree?.state === 'pending' || ticket.worktree?.state === 'failed') continue;
      const created = Date.parse(ticket.createdAt);
      if (!Number.isFinite(created) || created >= staleBefore) continue;
      ticket.status = 'done';
      ticket.doneAt = ticket.expiredAt = this.stamp();
      ticket.note = `自動結案：超過 ${benchLimits.staleHours} 小時未${ticket.seenAt ? '完成' : '讀取'}。`;
      if (ticket.kind === 'task') changes?.push({ kind: 'expired', ticket });
      expired++;
    }
    const cutoff = this.now() - benchLimits.retireDays * 86_400_000;
    const closedAt = (ticket: Ticket) => Date.parse(ticket.doneAt ?? ticket.seenAt ?? ticket.createdAt) || 0;
    // A completion note or notice nobody read in a week is stale too; a task someone still owes is never dropped for age.
    const informational = (ticket: Ticket) => ticket.kind === 'done' || ticket.kind === 'notice';
    let tickets = this.data.tickets.filter(ticket => Bench.closed(ticket) ? closedAt(ticket) >= cutoff : !(informational(ticket) && (Date.parse(ticket.createdAt) || 0) < cutoff));
    const closed = tickets.filter(Bench.closed);
    if (closed.length > benchLimits.kept) {
      const drop = new Set(closed.slice(0, closed.length - benchLimits.kept).map(ticket => ticket.id));
      tickets = tickets.filter(ticket => !drop.has(ticket.id));
    }
    if (tickets.length > benchLimits.hardCap) tickets = tickets.slice(-benchLimits.hardCap);
    this.data.tickets = tickets;
    const claimCutoff = this.now() - benchLimits.claimHours * 3_600_000;
    this.data.claims = this.data.claims.filter(claim => Date.parse(claim.at) > claimCutoff);
    const hourAgo = this.now() - 3_600_000;
    for (const [key, times] of Object.entries(this.data.pings)) {
      const recent = times.filter(at => at > hourAgo);
      if (recent.length) this.data.pings[key] = recent; else delete this.data.pings[key];
    }
    return expired > 0 || before !== JSON.stringify([this.data.tickets.length, this.data.claims.length, Object.keys(this.data.pings).length]);
  }

  /** Close what has been open too long and save, for callers that read open work without sending anything (role routing). */
  sweep() {
    const changes: SavedBenchChange[] = [];
    if (this.retire(changes)) this.save(changes);
  }

  private save(changes: SavedBenchChange[] = []) {
    if (!this.path) { this.onRecoveryChange?.(); return; }
    if (this.unreadable) {
      // The file could not be read, so what is in memory is not the workbench: leave the file alone.
      throw new BenchError(`工作台檔案暫時讀不到，已暫停寫入並保留原檔（${this.unreadable}）。修復後會自動恢復。`);
    }
    const beforeTidy = this.data.tidy;
    let state = this.activeTidyState();
    if (state) {
      for (const change of changes) if (change.kind === 'completed' && this.isTidyMaterial(change.ticket)) {
        state = { ...state, count: Math.min(10, state.count + 1), firstAt: state.firstAt ?? change.ticket.doneAt };
      }
      this.data.tidy = state;
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const text = JSON.stringify(this.data);
    try {
      writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      this.persisted = text;
      if (changes.length) {
        // A secondary observation sink must never put ticket delivery or completion on the failure path.
        try { this.onSavedChanges?.(changes); } catch { console.warn('Workbench experience observer failed.'); }
      }
    } catch (error) {
      // Memory goes back to what the file holds, so a change that was not saved is not treated as done.
      if (this.persisted !== undefined) { try { this.data = JSON.parse(this.persisted); } catch { /* Keep memory as it is. */ } }
      else this.data.tidy = beforeTidy;
      throw error;
    } finally { try { unlinkSync(temporary); } catch { /* The rename moved it. */ } }
    // The rename is the success point. A later notification cannot roll it back.
    try { this.onRecoveryChange?.(); } catch { console.warn('Workbench recovery observer failed.'); }
  }

  private stamp() { return new Date(this.now()).toISOString(); }

  /** The Bridge's clock, so a caller measuring ticket age uses the same time. */
  time() { return this.now(); }

  // ── Restore context after 瞳 compacts ──
  // Save each new checkpoint before asking the hook to restore context.

  /**
   * The first observation only establishes a baseline, so a checkpoint before that observation can be missed.
   * Saving before the hook reply prevents duplicates; a lost reply after saving can miss that injection.
   */
  agyCheckpoint(session: string, latest: number): boolean {
    if (!this.ready()) return false;
    const previous = this.data.agyCheckpoints?.[session];
    if (previous !== undefined && latest <= previous) return false;
    const before = this.data.agyCheckpoints;
    this.data.agyCheckpoints = { ...before, [session]: latest };
    try { this.save(); } catch { this.data.agyCheckpoints = before; return false; }
    return previous !== undefined;
  }

  // ── Schedule RSI reviews ──
  // Track eligible material and open a review when the configured group is due.

  private activeTidyState(): TidyState | undefined {
    if (!this.tidyGroup) return;
    const state = this.data.tidy;
    if (state === undefined) return { version: 1, groupId: this.tidyGroup, count: 0 };
    if (!state || state.version !== 1 || state.groupId !== this.tidyGroup || !Number.isInteger(state.count) || state.count < 0 || state.count > 10 ||
        (state.pendingLesson !== undefined && state.pendingLesson !== true) ||
        ((state.firstAt !== undefined || state.count || state.pendingLesson) && !isSavedStamp(state.firstAt)) ||
        (state.lastDispatchAt !== undefined && !isSavedStamp(state.lastDispatchAt)) ||
        (state.lessonCursor !== undefined && !/^[a-f0-9]{64}$/.test(state.lessonCursor)) ||
        (state.experienceCursor !== undefined && (!Number.isSafeInteger(state.experienceCursor) || state.experienceCursor < 0)) ||
        (state.lastTidyTicketId !== undefined && (!Number.isSafeInteger(state.lastTidyTicketId) || state.lastTidyTicketId < 1))) return;
    return state;
  }

  tidyEnabled(groupId: string) { return this.path !== undefined && this.activeTidyState()?.groupId === groupId; }

  private isTidyMaterial(ticket: Ticket) {
    return Boolean(this.tidyGroup) && this.tidyMaterialGroup(ticket.groupId) && ticket.kind === 'task' && !ticket.cancelledAt &&
      !isSystemSender(ticket.from) && ticket.title !== 'RSI 整理';
  }

  /** The server checks the current workbench recipient before registering the local proposal. */
  markPendingLesson(id: number): boolean {
    if (!this.path || !this.ready()) throw new BenchError('RSI 整理暫時未啟用。');
    const state = this.activeTidyState();
    const ticket = this.get(id);
    if (!state || !ticket || !this.isTidyMaterial(ticket)) throw new BenchError('只可登記試點群嘅原工作單。');
    if (ticket.pendingLessonAt) return false;
    const previous = this.data;
    const at = this.stamp();
    this.data = { ...previous, tickets: previous.tickets.map(row => row.id === id ? { ...row, pendingLessonAt: at } : row),
      tidy: { ...state, firstAt: state.firstAt ?? at, pendingLesson: true } };
    try { this.save(); } catch (error) { this.data = previous; throw error; }
    return true;
  }

  /** The Bridge supplies the group's Debug member, or its lead when the group has no Debug member. */
  dispatchTidy(groupId: string, to: BenchParty, toRoomId: string): Ticket | undefined {
    if (!this.ready() || !this.tidyEnabled(groupId)) return;
    let state = this.activeTidyState();
    if (!state) return;
    if (this.data.tickets.some(t => t.groupId === groupId && t.kind === 'task' && t.status !== 'done' &&
        (isSystemSender(t.from) || (t.title === 'RSI 整理' && t.to.sessionId === to.sessionId)))) return;
    // An unreadable log preserves the old eligibility rules; an empty readable log has no material.
    let lessonCursor: string | undefined;
    let newLessons = false;
    let readableLessons = false;
    if (this.lessonsLogPath) try {
      const info = statSync(this.lessonsLogPath);
      if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('Lesson log unavailable within read limit.');
      const text = readFileSync(this.lessonsLogPath, 'utf8');
      const rows = text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      const material = rows.filter(row => ['add', 'replace', 'pending', 'used', 'recur', 'friction'].includes(row.action));
      lessonCursor = createHash('sha256').update(JSON.stringify(material)).digest('hex');
      readableLessons = true;
      newLessons = material.length > 0 && lessonCursor !== state.lessonCursor;
    } catch { /* Log unavailable: retain the established count/time fallback. */ }
    let experienceCursor: number | undefined;
    let newExperience = false;
    if (this.experienceLogPath) try {
      const { events, invalid, conflicts } = readExperience(readExperienceInput(this.experienceLogPath));
      if (invalid || conflicts) throw new Error('Experience log has invalid or conflicting rows.');
      experienceCursor = events.length;
      const start = (state.experienceCursor ?? 0) <= events.length ? state.experienceCursor ?? 0 : 0;
      newExperience = events.slice(start).some(event => this.tidyMaterialGroup(event.groupId) &&
        (event.event === 'capture_gap' || !(event.groupId === groupId && (event.ticketId === state!.lastTidyTicketId ||
          this.data.tickets.some(ticket => ticket.groupId === event.groupId && ticket.id === event.ticketId && isSystemSender(ticket.from))))));
    } catch { /* Missing capture does not override the readable lessons decision. */ }
    const fresh = newLessons || newExperience;
    if (readableLessons && !fresh) return;
    if (!state.firstAt && fresh) {
      const previous = this.data;
      state = { ...state, firstAt: this.stamp() };
      this.data = { ...previous, tidy: state };
      try { this.save(); } catch (error) { this.data = previous; throw error; }
    }
    if (!state.firstAt || (!state.count && !state.pendingLesson && !fresh)) return;
    const since = Date.parse(state.lastDispatchAt ?? state.firstAt);
    if (state.count < 10 && (!Number.isFinite(since) || this.now() - since < 7 * 86_400_000)) return;
    const previous = this.data;
    const at = this.stamp();
    const ticket: Ticket = { id: previous.next, kind: 'task', groupId, from: { system: 'rsi-tidy' }, to,
      title: 'RSI 整理', body: '先跑 lesson report（包括 friction 分組），核對原單及證據，比較所有角色的 lesson（不止 pending）。跨角色同一成因有至少三張獨立工單，才提案升入對應 SKILL.md 或共用 skill；recur 至少兩次，提案改寫、升入 SKILL 或加工具／測試檢查；60 日沒有 used 或 recur，提案刪除。再跑 node --import tsx scripts/bench-experience.ts summary <group> <from-UTC> <until-UTC>（summarizeExperience）看今期返工、過期、取消、卡住等事件；未捕捉的回合上限等訊號須另查原單，不當成零。同一 Bridge 問題涉及至少三張獨立工單或單一嚴重 bug，提出改善提案：問題、證據工單、建議修法、影響範圍。相近文字只是候選，須核對原因。所有改動只作提案，有可行提案才用問題卡問 Founder；批准後才派 @implement 或 @debug，循正常 review／merge。整理房不要自改 Bridge code、lesson 或 skills，也不要發送待審全文或受控檔案。',
      hops: 1, status: 'new', createdAt: at, fixed: { fromRoomId: '', toRoomId } };
    this.data = { ...previous, next: previous.next + 1, tickets: [...previous.tickets, ticket],
      tidy: { version: 1, groupId, count: 0, lastDispatchAt: at, lastTidyTicketId: ticket.id,
        ...((lessonCursor ?? state.lessonCursor) ? { lessonCursor: lessonCursor ?? state.lessonCursor } : {}),
        ...((experienceCursor ?? state.experienceCursor) !== undefined ? { experienceCursor: experienceCursor ?? state.experienceCursor } : {}) } };
    try { this.save([{ kind: 'opened', ticket }]); } catch (error) { this.data = previous; throw error; }
    return ticket;
  }

  // ── Track stalled tickets ──
  // Record reminders and escalations so the Bridge can avoid repeating them.

  recordNudge(ids: number[]) {
    for (const id of ids) {
      const ticket = this.get(id);
      if (!ticket) continue;
      ticket.nudges = (ticket.nudges ?? 0) + 1;
      ticket.nudgedAt = this.stamp();
    }
    this.save();
  }

  markEscalated(id: number) {
    const ticket = this.get(id);
    if (!ticket || ticket.escalatedAt) return;
    ticket.escalatedAt = this.stamp();
    this.save();
  }

  // ── Look up routing and delivery history ──
  // Find tickets, recent replies, role recipients and saved verify-gate result paths.

  get(id: number) { return this.data.tickets.find(ticket => ticket.id === id); }

  /** A verify-gate worker posts its saved result path as a workbench self-notice. */
  gateResultPaths(keys: string[]) {
    return this.data.tickets.flatMap(ticket => {
      if (ticket.kind !== 'notice' || ticket.from.sessionId !== ticket.to.sessionId || !keys.includes(ticket.to.sessionId)) return [];
      const match = /^verify-gate (?:PASS|FAIL)；[\s\S]*；結果：(.+)$/.exec(ticket.body);
      return match ? [match[1]] : [];
    });
  }

  /** A recipient can report progress on a specific task without closing it. */
  lastRecipientReply(task: Ticket) {
    return this.data.tickets.findLast(reply => reply.kind === 'reply' && reply.replyTo === task.id &&
      reply.groupId === task.groupId && !isSystemSender(reply.from) && reply.from.sessionId === task.to.sessionId &&
      !isSystemSender(task.from) && reply.to.sessionId === task.from.sessionId)?.createdAt;
  }

  lastRoleRoom(groupId: string, roleKey: string) {
    return this.data.tickets.findLast(ticket => ticket.kind === 'task' && ticket.groupId === groupId && ticket.route?.roleKey === roleKey)?.route?.selectedRoomId;
  }

  // ── Create tickets and record checkout results ──
  // Hold delivery until a requested worktree is ready.

  /** Write a ticket into the recipient's workbench. */
  send(input: NewTicket): Ticket {
    return this.addTicket(input);
  }

  /** Keep the ticket held on failure; never hand out an unfinished checkout. */
  finishWorktree(id: number, roomId: string, result: { path: string; branch: string } | { error: string }): Ticket {
    const ticket = this.get(id);
    if (!ticket?.worktree || ticket.worktree.state !== 'pending') throw new BenchError('工單沒有待處理 worktree。');
    const previous = this.data;
    const worktree: NonNullable<Ticket['worktree']> = 'error' in result
      ? { ...ticket.worktree, state: 'failed', error: result.error, recordedAt: this.stamp() }
      : { ...ticket.worktree, state: 'ready', path: result.path, branch: result.branch, recordedAt: this.stamp() };
    const updated = { ...ticket, worktree, ...(!('error' in result) ? { repo: result.path, ref: result.branch } : {}) };
    this.data = { ...previous, tickets: previous.tickets.map(item => item.id === id ? updated : item),
      ...(!('error' in result) && ticket.status !== 'done' ? { worktrees: { ...previous.worktrees, [roomId]: { path: result.path, ticketId: id } } } : {}) };
    try { this.save(); } catch (error) { this.data = previous; throw error; }
    return updated;
  }

  private addTicket(input: NewTicket, relatedChange?: SavedBenchChange): Ticket {
    this.ready();
    const body = clean(input.body, benchLimits.body);
    if (!body) throw new BenchError('工單內容為空。');
    if (input.from.sessionId === input.to.sessionId && !(input.kind === 'notice' && input.source === 'verify-gate' && input.replyTo === undefined)) throw new BenchError('不能派工單給自己。');
    const parent = input.replyTo !== undefined ? this.get(input.replyTo) : undefined;
    if (input.replyTo !== undefined && !parent) throw new BenchError(`找不到工單 #${input.replyTo}。`);
    if (parent && (isSystemSender(parent.from) || ![parent.from.sessionId, parent.to.sessionId].includes(input.from.sessionId))) throw new BenchError(`工單 #${parent.id} 與你無關。`);
    const kind = input.kind ?? (parent ? 'reply' : 'task');
    // A completion note answers; it does not ask for more work, so it does not add a hop.
    const hops = parent ? parent.hops + (kind === 'done' ? 0 : 1) : 1;
    if (hops > benchLimits.hops) {
      throw new BenchError(`已達 ${benchLimits.hops} 回合上限（開單計第 1 回合；工單 #${parent!.id}）。為免無限來回，請先交 Founder 決定。`, true, undefined, true);
    }
    const firstLine = body.split('\n')[0];
    const ticket: Ticket = {
      id: this.data.next, kind, groupId: input.groupId, from: input.from, to: input.to,
      title: clean(input.title, benchLimits.title) || firstLine.slice(0, benchLimits.title),
      body, hops, status: 'new', createdAt: this.stamp(), ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(parent ? { replyTo: parent.id } : {}),
      ...(input.route ? { route: input.route } : {}),
      ...(input.fixed ? { fixed: input.fixed } : {}),
      ...(input.worktree ? { worktree: input.worktree } : {}),
      ...(input.completion ? { completion: input.completion } : {}),
      ...Object.fromEntries((['repo', 'ref', 'boundary', 'receipt'] as const).flatMap(key => clean(input[key], benchLimits.field) ? [[key, clean(input[key], benchLimits.field)]] : [])),
    };
    const previous = this.data;
    const pending = { ...previous, next: previous.next + 1, tickets: [...previous.tickets, ticket], pings: { ...previous.pings } };
    this.data = pending;
    const changes: SavedBenchChange[] = [];
    if (ticket.kind === 'task') changes.push({ kind: 'opened', ticket });
    if (relatedChange) changes.push(relatedChange);
    try { this.retire(changes); this.save(changes); }
    catch (error) {
      // A failed save restores the last committed snapshot. Before the first save, restore the empty workbench.
      if (this.data === pending) this.data = previous;
      throw error;
    }
    return ticket;
  }

  // ── Read and deliver tickets ──
  // List work, record delivery and transfer unfinished tickets when a member changes rooms.

  /** Retained tasks include completed notifications needed for duplicate checks. */
  tasks(groupId: string) {
    return this.data.tickets.filter(ticket => ticket.groupId === groupId && ticket.kind === 'task');
  }

  /** The recipient's tickets it has not finished, oldest first, and the completion notes it has not read. */
  mine(sessionId: string) {
    return this.data.tickets.filter(ticket => ticket.to.sessionId === sessionId && ticket.worktree?.state !== 'pending' && ticket.worktree?.state !== 'failed' && (ticket.status !== 'done' && !(ticket.kind === 'done' && ticket.status === 'seen')));
  }

  /** Tasks this session wrote that the recipient has not finished yet. */
  openFrom(sessionId: string) {
    return this.data.tickets.filter(ticket => !isSystemSender(ticket.from) && ticket.from.sessionId === sessionId && ticket.kind === 'task' && ticket.status !== 'done' && ticket.worktree?.state !== 'failed');
  }

  /** Tickets in the recipient's workbench it has not been shown yet; they are marked seen as they are handed over. */
  takeNew(sessionId: string, limit = benchLimits.perInjection, visible: (ticket: Ticket) => boolean = () => true) {
    if (!this.ready()) return [];
    const fresh = this.data.tickets.filter(ticket => ticket.to.sessionId === sessionId && ticket.status === 'new' && ticket.worktree?.state !== 'pending' && ticket.worktree?.state !== 'failed' && visible(ticket)).slice(0, limit);
    if (!fresh.length) return [];
    for (const ticket of fresh) this.see(ticket);
    // A ticket that could not be saved as seen was not handed over: it stays new and goes out again at the next chance.
    try { this.save(); } catch { return []; }
    return fresh;
  }

  /**
   * A member kept its identity but changed rooms: its unfinished tickets (and the ones it wrote) now name the new room.
   * Finished tickets are history and stay as they were. Returns the ids moved.
   */
  retarget(from: string[], to: BenchParty, rooms?: { from: string; to: string }): number[] {
    const old = new Set(from.filter(key => key && key !== to.sessionId));
    if (!old.size) return [];
    const moved: number[] = [];
    const previous = this.data;
    const tickets = previous.tickets.map(ticket => {
      if (Bench.closed(ticket)) return ticket;
      if (isSystemSender(ticket.from)) return ticket;
      const toMoves = old.has(ticket.to.sessionId), fromMoves = old.has(ticket.from.sessionId);
      if (!toMoves && !fromMoves) return ticket;
      moved.push(ticket.id);
      // A fixed ticket names its two rooms; the room that changed is replaced there too, or neither side could finish it.
      const fixed = ticket.fixed && rooms ? { fromRoomId: ticket.fixed.fromRoomId === rooms.from ? rooms.to : ticket.fixed.fromRoomId, toRoomId: ticket.fixed.toRoomId === rooms.from ? rooms.to : ticket.fixed.toRoomId } : ticket.fixed;
      const route = ticket.route && rooms && ticket.route.selectedRoomId === rooms.from ? { ...ticket.route, selectedRoomId: rooms.to } : ticket.route;
      return { ...ticket, ...(toMoves ? { to: { ...ticket.to, sessionId: to.sessionId, roomName: to.roomName } } : {}), ...(fromMoves ? { from: { ...ticket.from, sessionId: to.sessionId, roomName: to.roomName } } : {}), ...(fixed ? { fixed } : {}), ...(route ? { route } : {}) };
    });
    let claimsMoved = false;
    const claims = previous.claims.map(claim => {
      if (!old.has(claim.by.sessionId)) return claim;
      claimsMoved = true;
      return { ...claim, by: { ...claim.by, sessionId: to.sessionId, roomName: to.roomName } };
    });
    if (!moved.length && !claimsMoved) return [];
    this.data = { ...previous, tickets, claims };
    try { this.save(); } catch (error) { this.data = previous; throw error; }
    return moved;
  }

  markSeen(id: number) {
    this.ready();
    const ticket = this.get(id);
    if (ticket && ticket.status === 'new') { this.see(ticket); this.save(); }
  }

  private see(ticket: Ticket) {
    ticket.status = 'seen';
    ticket.seenAt = this.stamp();
    if (ticket.kind === 'notice') { ticket.status = 'done'; ticket.doneAt = ticket.seenAt; }
  }

  // ── Complete or cancel tickets ──
  // Save the state change together with any notice it produces.

  /** The recipient finishes a ticket; the sender gets a completion note in its own workbench (unless it was one already). */
  done(id: number, by: string, note?: string, receipt?: string, proof?: ReceiptProof, checked?: AcceptanceResult, completion?: Omit<CompletionEvidence, 'receipt'>): { ticket: Ticket; notice?: Ticket } {
    this.ready();
    const ticket = this.get(id);
    if (!ticket) throw new BenchError(`找不到工單 #${id}。`);
    if (ticket.to.sessionId !== by) throw new BenchError(`工單 #${id} 不是派給你的。`);
    if (ticket.worktree?.state === 'pending' || ticket.worktree?.state === 'failed') throw new BenchError(`工單 #${id} 的 worktree 尚未準備好。`);
    // A manual close marks an unread notice as seen and done without generating a second notice.
    if (ticket.kind === 'notice') { if (ticket.status !== 'done') { this.see(ticket); this.save(); } return { ticket }; }
    if (ticket.cancelledAt) throw new BenchError(`工單 #${id} 已被派單方取消，毋須再做。${ticket.note ? `（${ticket.note}）` : ''}`);
    if (ticket.status === 'done' && !ticket.expiredAt) throw new BenchError(`工單 #${id} 已完成。`);
    const previous = { status: ticket.status, doneAt: ticket.doneAt, note: ticket.note, expiredAt: ticket.expiredAt,
      receipt: ticket.receipt, receiptProof: ticket.receiptProof };
    try {
      ticket.status = 'done';
      ticket.doneAt = this.stamp();
      // A late finish of a ticket the Bridge closed for age is a real completion: the sender is told as usual.
      delete ticket.expiredAt;
      ticket.note = clean(note, benchLimits.body) || undefined;
      if (clean(receipt, benchLimits.field)) ticket.receipt = clean(receipt, benchLimits.field);
      if (proof) ticket.receiptProof = proof;
      if (isSystemSender(ticket.from)) { this.save([{ kind: 'completed', ticket, late: Boolean(previous.expiredAt), checked }]); return { ticket }; }
      if (ticket.kind === 'done') { this.save(); return { ticket }; }
      // Saving the notice commits both it and the finished ticket in the same file replacement.
      const notice = this.addTicket({
        groupId: ticket.groupId, from: ticket.to, to: ticket.from, kind: 'done', replyTo: ticket.id,
        title: `#${ticket.id} 已完成：${ticket.title}`.slice(0, benchLimits.title),
        body: [
          `#${ticket.id}「${ticket.title}」已完成。`,
          completion?.closeout && '收尾提示：本群最後一張主工單已回。請核對結果同現有待辦。齊料就整理 HANDOFF，核對文員回執（如適用），交正式回報同下一步。若只完成一項 Inbox 交接，請在 Evidence 附 HANDOFF 路徑，末行寫 INBOX — DONE。',
          ticket.note && `結果：${ticket.note}`,
          ticket.receipt && `回報位置：${ticket.receipt}`,
          ticket.receiptProof && proofText(ticket.receiptProof),
        ].filter(Boolean).join('\n'),
        ...(ticket.receipt ? { receipt: ticket.receipt } : {}),
        completion: { ...completion, receipt: ticket.receiptProof },
        ...(ticket.fixed ? { fixed: { fromRoomId: ticket.fixed.toRoomId, toRoomId: ticket.fixed.fromRoomId } } : {}),
      }, ticket.kind === 'task' ? { kind: 'completed', ticket, late: Boolean(previous.expiredAt), checked } : undefined);
      return { ticket, notice };
    } catch (error) {
      Object.assign(ticket, previous);
      throw error;
    }
  }

  /**
   * The sender calls off a task or reply it sent that is still open. A ticket the recipient already read gets a notice in the
   * recipient's workbench, so a member still working on it stops; an unread one simply goes. Returns undefined when nothing was open.
   */
  cancel(id: number, by: string[], reason?: string, source: BenchCancellation = 'sender'): { ticket: Ticket; notice?: Ticket } | undefined {
    this.ready();
    const ticket = this.get(id);
    if (!ticket) throw new BenchError(`找不到工單 #${id}。`);
    if (isSystemSender(ticket.from) || !by.includes(ticket.from.sessionId)) throw new BenchError(`工單 #${id} 不是你派出的，只有派單方可以取消。`);
    if (ticket.kind !== 'task' && ticket.kind !== 'reply') throw new BenchError(`#${id} 是通知，毋須取消。`);
    if (Bench.closed(ticket)) return;
    const previous = { status: ticket.status, doneAt: ticket.doneAt, note: ticket.note, cancelledAt: ticket.cancelledAt };
    const read = ticket.status === 'seen';
    try {
      ticket.status = 'done';
      ticket.doneAt = ticket.cancelledAt = this.stamp();
      ticket.note = `已取消：${clean(reason, benchLimits.field) || '派單方取消'}`;
      const change = ticket.kind === 'task' ? { kind: 'cancelled' as const, ticket, by: source } : undefined;
      if (!read) { this.save(change ? [change] : []); return { ticket }; }
      const notice = this.addTicket({
        groupId: ticket.groupId, from: ticket.from, to: ticket.to, kind: 'notice',
        title: `#${ticket.id} 已取消：${ticket.title}`.slice(0, benchLimits.title),
        body: `#${ticket.id}「${ticket.title}」已被派單方取消，請停手，毋須再交。${ticket.note}`,
        ...(ticket.fixed ? { fixed: ticket.fixed } : {}),
      }, change);
      return { ticket, notice };
    } catch (error) {
      Object.assign(ticket, previous);
      if (previous.cancelledAt === undefined) delete ticket.cancelledAt;
      throw error;
    }
  }

  // ── Reserve and acknowledge wakes ──
  // Count recent wakes and prevent two delivery attempts from owning the same ticket.

  private forgetPing(id: string) {
    const ping = this.reservedPings.get(id);
    if (!ping) return;
    clearTimeout(ping.timer);
    this.reservedPings.delete(id);
    this.onRecoveryChange?.();
  }

  hasDeliveryHold(keys: string[]) {
    return this.activePings().some(ping => ping.roomKeys.some(key => keys.includes(key)));
  }

  hasLegacyPing(keys: string[], ticketId: number) {
    return this.activePings().some(ping => ping.legacy && ping.ticketIds.includes(ticketId) && ping.roomKeys.some(key => keys.includes(key)));
  }

  disposeDeliveryHolds() { for (const id of this.reservedPings.keys()) this.forgetPing(id); }

  private activePings() {
    const now = this.now();
    for (const [id, ping] of this.reservedPings) if (ping.expiresAt <= now) this.forgetPing(id);
    return [...this.reservedPings.values()];
  }

  /** Count successful wakes and outstanding reservations across the room's aliases. */
  pingAllowed(sessionId: string, aliases: string[] = []) {
    const keys = new Set([sessionId, ...aliases]);
    const hourAgo = this.now() - 3_600_000;
    const sent = Object.entries(this.data.pings).filter(([key]) => keys.has(key))
      .reduce((count, [, times]) => count + times.filter(at => at > hourAgo).length, 0);
    const inFlight = this.activePings().filter(ping => ping.counted && ping.roomKeys.some(key => keys.has(key))).length;
    return sent + inFlight < benchLimits.pingsPerHour;
  }

  pingPending(ticketId: number) { return this.activePings().some(ping => ping.ticketIds.includes(ticketId)); }

  reservePing(roomKeys: string[], ticketIds: number[], legacy = false) {
    // Unknown ticket IDs count conservatively; only done and reply are exempt.
    const counted = ticketIds.some(id => { const kind = this.get(id)?.kind; return kind !== 'done' && kind !== 'reply'; });
    if (!roomKeys.length || !ticketIds.length || (counted && !this.pingAllowed(roomKeys[0], roomKeys.slice(1))) ||
        ticketIds.some(id => this.pingPending(id))) return;
    const id = randomUUID();
    const lifetime = 90_000;
    const ping: ReservedPing = { id, roomKeys, ticketIds, legacy, writing: false, counted, expiresAt: this.now() + lifetime };
    if (this.onRecoveryChange) {
      ping.timer = setTimeout(() => this.forgetPing(id), lifetime);
      ping.timer.unref();
    }
    this.reservedPings.set(id, ping);
    this.onRecoveryChange?.();
    return id;
  }

  hasPing(id: string, ticketId: number) {
    return this.activePings().some(ping => ping.id === id && !ping.legacy && ping.ticketIds.includes(ticketId));
  }

  beginPingWrite(id: string, ticketId: number) {
    const ping = this.activePings().find(item => item.id === id && !item.legacy && item.ticketIds.includes(ticketId));
    if (!ping || ping.writing) return false;
    ping.writing = true;
    return true;
  }

  finishPing(id: string, sent: boolean, seen: number[] = []) {
    const ping = this.activePings().find(item => item.id === id);
    if (!ping) return;
    this.forgetPing(id);
    if (!sent) return;
    const sessionId = ping.roomKeys[0];
    const hourAgo = this.now() - 3_600_000;
    if (ping.counted) this.data.pings[sessionId] = [...(this.data.pings[sessionId] ?? []).filter(at => at > hourAgo), this.now()];
    for (const id of ping.ticketIds) {
      const ticket = this.get(id);
      if (!ticket) continue;
      if (ticket.fixed) ticket.wokenAt = this.stamp();
      if (ticket.status === 'new' && seen.includes(id)) this.see(ticket);
    }
    this.save();
  }

  ackLegacyPing(ticket: Ticket, sent: boolean) {
    const pending = this.activePings().find(ping => ping.legacy && ping.ticketIds.includes(ticket.id));
    if (pending) this.finishPing(pending.id, sent, pingCarriesTicket(ticket) ? [ticket.id] : []);
  }

  markCompletionRetry(ids: number[]) {
    for (const id of ids) {
      const ticket = this.get(id);
      if (ticket?.kind === 'done' && ticket.status === 'new' && !ticket.completionRetriedAt) ticket.completionRetriedAt = this.stamp();
    }
    this.save();
  }

  notePing(sessionId: string) {
    const hourAgo = this.now() - 3_600_000;
    this.data.pings[sessionId] = [...(this.data.pings[sessionId] ?? []).filter(at => at > hourAgo), this.now()];
    this.save();
  }

  // ── Find checkouts and manage claims ──
  // List a group’s open work, active claims and the worktrees a room can use.

  lastWorktree(roomId: string) {
    if (!this.data.worktrees || !Object.hasOwn(this.data.worktrees, roomId)) return undefined;
    const saved = this.data.worktrees[roomId];
    if (typeof saved?.path !== 'string') return undefined;
    const ticket = saved.ticketId === undefined ? undefined : this.get(saved.ticketId);
    return { path: saved.path, title: ticket?.title };
  }

  /** Use a room's assignments, and the dispatches it made as group lead. */
  worktreeTickets(room: Pick<TerminalRoom, 'id' | 'sessionId'>, groups: GroupChat[]) {
    const memberships = new Map(groups.filter(group => group.members.some(member => member.roomId === room.id))
      .map(group => [group.id, group.orchestratorRoomId === room.id]));
    const belongs = (party: BenchParty, fixedId?: string) => (!fixedId || fixedId === room.id) &&
      (party.sessionId === room.id || party.sessionId === room.sessionId);
    return this.data.tickets.filter(ticket => ticket.kind === 'task' && typeof ticket.repo === 'string' && ticket.repo.startsWith('/') &&
      !ticket.cancelledAt && !ticket.expiredAt && memberships.has(ticket.groupId) &&
      (belongs(ticket.to, ticket.fixed?.toRoomId) ||
        (memberships.get(ticket.groupId) === true && !isSystemSender(ticket.from) && belongs(ticket.from, ticket.fixed?.fromRoomId))))
      .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.id - a.id)
      .map(ticket => ({ path: ticket.repo!, title: ticket.title }));
  }

  claim(groupId: string, by: BenchParty, scope: string, checkout?: ClaimedCheckout & { roomId: string }): Claim {
    const what = clean(scope, benchLimits.field);
    if (!what) throw new BenchError('請寫明認領的範圍（例如檔案或模組）。');
    const taken = this.claims(groupId).find(claim => claim.scope.toLowerCase() === what.toLowerCase() && claim.by.sessionId !== by.sessionId);
    if (taken) throw new BenchError(`「${what}」已由 ${taken.by.roomName} 認領（${taken.at}）。請先同對方協調。`);
    const previous = this.data;
    const claims = previous.claims.filter(claim => !(claim.groupId === groupId && claim.by.sessionId === by.sessionId && claim.scope.toLowerCase() === what.toLowerCase()));
    const claim = { id: randomUUID().slice(0, 8), groupId, by, scope: what, at: this.stamp() };
    this.data = { ...previous, claims: [...claims, claim] };
    if (checkout) {
      const { roomId, path, ticketId } = checkout;
      this.data.worktrees = { ...previous.worktrees, [roomId]: { path, ticketId } };
    }
    try { this.save(); }
    catch (error) { this.data = previous; throw error; }
    return claim;
  }

  release(groupId: string, by: string, scope?: string) {
    const before = this.data.claims.length;
    this.data.claims = this.data.claims.filter(claim => !(claim.groupId === groupId && claim.by.sessionId === by && (!scope || claim.scope.toLowerCase() === scope.trim().toLowerCase())));
    if (this.data.claims.length !== before) this.save();
    return before - this.data.claims.length;
  }

  /** Claims still in force in a group (they lapse after a while, so a forgotten one does not block anyone). */
  claims(groupId: string) {
    const cutoff = this.now() - benchLimits.claimHours * 3_600_000;
    return this.data.claims.filter(claim => claim.groupId === groupId && Date.parse(claim.at) > cutoff);
  }

  /** A room can retain a claim even after its group is removed from the current roster. */
  activeClaims() {
    const cutoff = this.now() - benchLimits.claimHours * 3_600_000;
    return this.data.claims.filter(claim => Date.parse(claim.at) > cutoff);
  }

  /** What is still open in a group: for an agent to see who works on what before it starts. */
  open(groupId: string) {
    return this.data.tickets.filter(ticket => ticket.groupId === groupId && ticket.kind !== 'done' && ticket.status !== 'done');
  }
}

// ── Format tickets, wakes and hook replies ──
// Present routing and completion evidence in the form the recipient’s CLI expects.

const roleName: Record<CLIModelId, string> = { AGY: '瞳', CODEX: '光', CLAUDE: '響' };

export function routeQuotaText({ hp, mp }: Pick<RoleRouteReceipt, 'hp' | 'mp'>) {
  return `HP ${hp === null ? '—' : hp + '%'}／MP ${mp === null ? '—' : mp + '%'}${hp === null || mp === null ? '（額度未核）' : ''}`;
}

export function roleReceipt(ticket: Ticket) {
  const route = ticket.route;
  if (!route) return;
  const quotaReasons = { 'both-at-least-40': '兩項額度達 40%', 'best-lower-quota': '兩項中較低的額度最高', 'not-compared': '不比較未知額度' };
  const workloadReasons = { 'idle-and-empty': '閒置且無未完工單', idle: '閒置', empty: '無未完工單', 'busy-with-work': '工單留待對方處理' };
  return `去向：@${route.roleKey} → ${partyName(ticket.to)}（${ticket.to.sessionId}）；原因：${quotaReasons[route.rule.quota]}，${workloadReasons[route.rule.workload]}${route.rule.rotated ? '，同順位輪替' : ''}；${routeQuotaText(route)}。`;
}
export const partyName = (party: BenchSender) => isSystemSender(party) ? 'Bridge' : `${roleName[party.modelId]} · ${party.roomName}`;

export function proofText(proof: ReceiptProof) {
  if (proof.state === 'missing') return `⚠ 完成時 ${proof.path} 已經唔存在，請補返 evidence`;
  if (proof.state === 'unreadable') return `⚠ 完成時 ${proof.path} 讀唔到，請核對 evidence`;
  const size = proof.bytes === undefined ? '' : proof.bytes >= 1_048_576 ? `${(proof.bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(proof.bytes / 1024))} KB`;
  return `完成時存在（${proof.state === 'dir' ? '目錄' : size}${proof.sha256 ? `，sha256 ${proof.sha256.slice(0, 12)}…` : ''}）：${proof.path}`;
}

function completionLines(ticket: Ticket, showCloseout: boolean) {
  const evidence = ticket.completion;
  if (!evidence) return [];
  const { checkout, receipt, closeout } = evidence;
  const gate = checkout?.gate;
  const gateResult = gate
    ? `${gate.verdict}${gate.count ? ' ' + gate.count : ''}${gate.head === checkout.head ? '' : '（HEAD 不同）'}${gate.dirty ? '（驗證時工作樹有變更）' : ''}`
    : 'UNKNOWN';
  return [
    `自動核對：HEAD ${checkout?.head ?? 'UNKNOWN'}｜${checkout?.pushed === undefined ? '推送 UNKNOWN' : checkout.pushed ? '已推' : '未推'}｜未 commit ${checkout?.changed === undefined ? 'UNKNOWN' : checkout.changed + ' 個檔'}｜gate ${gateResult}｜receipt ${receipt?.sha256 ? 'sha256 ' + receipt.sha256 : 'UNKNOWN'}`,
    ...(showCloseout && closeout ? ['仍未完成嘅派單：', ...(closeout.length ? closeout : ['冇。'])] : []),
  ];
}

/** How a ticket reads to the agent that receives it: who, what, where, its limits and how to answer. */
export function ticketText(ticket: Ticket, tool: string, showCloseout = true) {
  const me = ticket.to.sessionId;
  const details = [
    ticket.repo && `repo：${ticket.repo}`, ticket.ref && `ref：${ticket.ref}`,
    ticket.boundary && `可改範圍：${ticket.boundary}`, ticket.receipt && `回報位置：${ticket.receipt}`,
  ].filter(Boolean).join('　');
  const lines = [
    `[工作台 #${ticket.id}｜${partyName(ticket.from)} → 你${ticket.kind === 'done' ? '｜完成通知' : ticket.kind === 'notice' ? '｜通知' : ticket.kind === 'reply' ? `｜回覆 #${ticket.replyTo}` : ''}]`,
    `標題：${ticket.title}`,
    ...(ticket.route ? [roleReceipt(ticket)!] : []),
    ...(ticket.fixed && ticket.kind !== 'done' ? [`群組 ID：${ticket.groupId}；認領請加 --group ${ticket.groupId}。`] : []),
    ...(details ? [details] : []),
    ...(ticket.worktree?.state === 'ready' ? ['已準備獨立 worktree，agent 須按路徑進入；非強制隔離。'] : []),
    ticket.body,
    ...completionLines(ticket, showCloseout),
  ];
  if (ticket.kind === 'done') {
    lines.push(`（只係通知，唔使回覆。標為已讀：${tool} bench done ${ticket.id} --from ${me}）`);
  } else if (ticket.kind === 'notice') {
    lines.push('（只係通知：唔使回覆，唔使 bench done，讀過就自動結案。）');
  } else {
    if (ticket.kind === 'task' && ticket.to.modelId === 'AGY') {
      lines.push(`開工核對可用 ${tool} task-context，按工單加 --repo "<工作樹>" 同 --ref "<版本>"。可順便預覽已知嘅短片段，要全文就用原生讀檔。指定必讀資料照讀。`);
    }
    lines.push(isSystemSender(ticket.from) ? '本工單由 Bridge 發出；核對證據和整理待審資料，試行及正式採用須由 Founder 決定。' : benchAuthority,
      '做完唔好自行清理 raw log、receipt、build、scratch：留低，整個大任務完晒由總指揮 ♛ 統一代清。',
      `完成：${tool} bench done ${ticket.id} --from ${me} --note "<結果>" [--receipt <commit 或本機路徑>]`,
      ...(!isSystemSender(ticket.from) ? [`問對方：${tool} bench send ${ticket.from.sessionId} --from ${me} --reply-to ${ticket.id} "<訊息>"`] : []));
  }
  return lines.join('\n');
}

/** Codex's wake is a one-line notification. Its hook or bench show reads the saved ticket. */
export function pingCarriesTicket(ticket: Ticket) {
  return ticket.to.modelId !== 'CODEX' && ticket.body.length + completionLines(ticket, true).join('\n').length <= benchLimits.shortChars;
}

export function pingText(ticket: Ticket, tool: string) {
  if (pingCarriesTicket(ticket)) return ticketText(ticket, tool);
  const hint = `會自動附上；如未見到：${tool} bench show ${ticket.id} --from ${ticket.to.sessionId}）`;
  if (ticket.to.modelId === 'CODEX') return `[工作台 #${ticket.id}] ${ticket.title.split('\n')[0]} （內容${hint}`;
  return `[工作台 #${ticket.id}] ${ticket.title}\n（內容較長，${hint}`;
}

/** What a CLI hook prints: the tickets for that agent in the form its CLI takes, or an empty answer. */
export function hookOutput(cli: 'codex' | 'claude' | 'agy', event: string, text: string | undefined) {
  if (!text) return {};
  if (cli === 'agy') return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}
