import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupRoleKey } from '../src/types/groupRoles';
import type { CLIModelId } from '../src/types/guild';
import type { AcceptanceResult, BenchCancellation, SavedBenchChange, Ticket } from './bench';

export const experienceGroupFile = '.komorebi-bench-experience-group';
export const experienceFile = '.komorebi-bench-experience.jsonl';
export const tidyGroupFile = '.komorebi-bench-tidy-group';
export const experienceMaxBytes = 4 * 1024 * 1024;

const capacityReserveBytes = 512;

const versions = { version: 1, source: 'bench' } as const;
type AgentResult = 'DONE' | 'STOP' | 'INCOMPLETE';
type TaskIdentity = {
  groupId: string; ticketId: number; taskKey: string; sourceWorkId: 'unknown';
  role: string; cli: CLIModelId | 'unknown';
};
type Envelope = typeof versions & { id: string; at: string; groupId: string };
type ClosedReason = 'completed' | 'late_completion' | 'expired_unread' | 'expired_seen' | BenchCancellation;
type TaskEvent = Envelope & TaskIdentity & (
  | { event: 'task_opened' }
  | { event: 'task_closed'; reason: ClosedReason; agentResult?: AgentResult }
  | { event: 'acceptance_reported'; result: AcceptanceResult; evidenceSha256: string; reviewType: 'unknown' }
);
type Gap = Envelope & { event: 'capture_gap'; from: string; changes: number; reason: 'write' | 'capacity' };
export type ExperienceEvent = TaskEvent | Gap;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[0-9a-f]{64}$/;
const isoPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const isUtc = (value: unknown): value is string => typeof value === 'string' && isoPattern.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const cliFamilies: readonly string[] = ['AGY', 'CODEX', 'CLAUDE', 'unknown'];
const marker = /^RESULT — (DONE|STOP|INCOMPLETE)$/;
const checkedResults: readonly string[] = ['PASS', 'FAIL', 'SKIP', 'TIMEOUT', 'CRASH', 'ABORTED'];
const closeReasons: readonly string[] = ['completed', 'late_completion', 'expired_unread', 'expired_seen', 'sender', 'lead_final_report'];
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** A ticket's identity survives late delivery and session replacement. The journal belongs to one workbench. */
function taskEvents(change: SavedBenchChange, roleOf?: (ticket: Ticket) => string | undefined): TaskEvent[] {
  const ticket = change.ticket;
  const { groupId, id: ticketId, createdAt } = ticket;
  const at = change.kind === 'opened' ? createdAt : ticket.doneAt;
  if (!isUtc(at) || !isUtc(createdAt) || !isCount(ticketId)) throw new Error('Invalid workbench transition.');
  const taskKey = sha256(JSON.stringify([groupId, ticketId, createdAt]));
  const cli = cliFamilies.includes(ticket.to.modelId) ? ticket.to.modelId : 'unknown';
  const base = {
    ...versions, groupId, ticketId, taskKey, sourceWorkId: 'unknown' as const, cli: cli as TaskIdentity['cli'], at,
    role: groupRoleKey(roleOf?.(ticket) ?? ticket.route?.roleKey) ?? 'unknown',
  };
  if (change.kind === 'opened') return [{ ...base, id: sha256(taskKey + ':opened'), event: 'task_opened' }];
  const reason: ClosedReason = change.kind === 'completed' ? (change.late ? 'late_completion' : 'completed')
    : change.kind === 'expired' ? (ticket.seenAt ? 'expired_seen' : 'expired_unread') : change.by;
  const agentResult = change.kind === 'completed' ? marker.exec(ticket.note?.trimEnd().split('\n').at(-1) ?? '')?.[1] as AgentResult | undefined : undefined;
  const closed: TaskEvent = {
    ...base, id: sha256(taskKey + ':' + reason), event: 'task_closed', reason, ...(agentResult ? { agentResult } : {}),
  };
  if (change.kind !== 'completed' || !change.checked) return [closed];
  const evidenceSha256 = ticket.receiptProof?.sha256;
  if (!evidenceSha256 || !hashPattern.test(evidenceSha256)) throw new Error('Checked report has no evidence digest.');
  return [closed, {
    ...base, id: sha256(taskKey + ':acceptance'), event: 'acceptance_reported', result: change.checked, evidenceSha256, reviewType: 'unknown',
  }];
}

function ensurePrivateFile(fd: number) {
  const info = fstatSync(fd);
  if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid?.() || info.nlink !== 1) {
    throw new Error('Experience input must be a private, owned regular file without other links.');
  }
  if (info.size > experienceMaxBytes) throw new Error('Experience input exceeds the size limit.');
  return info;
}

const inputFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export function readExperienceInput(path: string) {
  const fd = openSync(path, inputFlags);
  try {
    ensurePrivateFile(fd);
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

/** `all` captures every group; otherwise the listed group IDs. */
export type ExperienceScope = 'all' | readonly string[];
const groupPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const inExperienceScope = (scope: ExperienceScope, groupId: string) => scope === 'all' || scope.includes(groupId);

/** The Mac operator opts in `all`, or one or more group IDs (one per line). A missing file means capture is off. */
export function readExperienceScope(workspace: string, warn = console.warn): ExperienceScope | undefined {
  try {
    const text = readExperienceInput(join(workspace, experienceGroupFile)).trim();
    if (text === 'all') return 'all';
    const groups = text.split(/\s+/);
    if (text && groups.every(id => groupPattern.test(id))) return [...new Set(groups)];
    warn('Workbench experience capture is off: expected `all` or group IDs.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn('Workbench experience capture is off: unable to read the private group setting.');
  }
}

/** Separate private opt-in names the one group whose lead reviews lessons. It must be inside the capture scope, otherwise dispatch is off. */
export function readTidyGroup(workspace: string, scope: ExperienceScope | undefined, warn = console.warn) {
  if (!scope) return;
  try {
    const groupId = readExperienceInput(join(workspace, tidyGroupFile)).trim();
    if (groupPattern.test(groupId) && inExperienceScope(scope, groupId)) return groupId;
    warn('RSI Tidy dispatch is off: opt-in must name one captured group.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn('RSI Tidy dispatch is off: unable to read private opt-in.');
  }
}

function parseEvent(value: unknown): ExperienceEvent | undefined {
  const row = value as Partial<ExperienceEvent> | null;
  if (!row || row.version !== 1 || row.source !== 'bench' || !isUtc(row.at) || typeof row.id !== 'string' ||
      !hashPattern.test(row.id) || typeof row.groupId !== 'string' || !row.groupId) return;
  if (row.event === 'capture_gap') {
    if (isUtc(row.from) && isCount(row.changes) && (row.reason === 'write' || row.reason === 'capacity')) return row as Gap;
    return;
  }
  if (row.event !== 'task_opened' && row.event !== 'task_closed' && row.event !== 'acceptance_reported') return;
  if (!isCount(row.ticketId) || typeof row.taskKey !== 'string' || !hashPattern.test(row.taskKey) || row.sourceWorkId !== 'unknown' ||
      typeof row.role !== 'string' || (row.role !== 'unknown' && groupRoleKey(row.role) !== row.role) ||
      typeof row.cli !== 'string' || !cliFamilies.includes(row.cli)) return;
  switch (row.event) {
    case 'task_opened': return row as TaskEvent;
    case 'task_closed':
      if (typeof row.reason === 'string' && closeReasons.includes(row.reason) &&
          (row.agentResult === undefined || marker.test('RESULT — ' + row.agentResult))) return row as TaskEvent;
      return;
    case 'acceptance_reported':
      if (typeof row.result === 'string' && checkedResults.includes(row.result) && row.reviewType === 'unknown' &&
          typeof row.evidenceSha256 === 'string' && hashPattern.test(row.evidenceSha256)) return row as TaskEvent;
  }
}

function parseRows<T>(raw: string, parse: (value: unknown) => T | undefined) {
  const rows: T[] = [];
  let invalid = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = parse(JSON.parse(line));
      if (row) { rows.push(row); continue; }
    } catch { /* Report damaged lines without showing their content. */ }
    invalid++;
  }
  return { rows, invalid };
}

export function readExperience(raw: string) {
  const { rows, invalid } = parseRows(raw, parseEvent);
  const unique = new Map<string, ExperienceEvent>();
  let duplicates = 0;
  let conflicts = 0;
  for (const row of rows) {
    const first = unique.get(row.id);
    if (first) {
      duplicates++;
      if (JSON.stringify(first) !== JSON.stringify(row)) conflicts++;
    } else unique.set(row.id, row);
  }
  return { events: [...unique.values()], invalid, duplicates, conflicts };
}

/** The opted-in Bridge is the only writer. Losses are observable without changing the outcome of a ticket. */
export class BenchExperience {
  private ids?: Set<string>;
  /** Missed changes, filed under the group of the first change that was missed. */
  private gap?: { from: string; changes: number; groupId: string };
  private capacityWarned = false;
  private haltedForCapacity = false;

  private readonly scope: ExperienceScope;

  constructor(private readonly path: string, scope: ExperienceScope | string,
    private readonly warn: (message: string) => void = console.warn, private readonly now = () => new Date().toISOString(),
    private readonly roleOf?: (ticket: Ticket) => string | undefined) {
    this.scope = typeof scope === 'string' && scope !== 'all' ? [scope] : scope as ExperienceScope;
  }

  record(changes: SavedBenchChange[]) {
    const scoped = changes.filter(change => inExperienceScope(this.scope, change.ticket.groupId));
    if (!scoped.length || this.haltedForCapacity) return;
    const times = scoped.map(({ ticket, kind }) => kind === 'opened' ? ticket.createdAt : ticket.doneAt).filter(isUtc).sort();
    const from = times[0] ?? this.now();
    try {
      const rows = scoped.flatMap(change => taskEvents(change, this.roleOf));
      const fd = openSync(this.path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const info = ensurePrivateFile(fd);
        if (!this.ids) {
          const previous = readExperience(readFileSync(fd, 'utf8'));
          this.ids = new Set(previous.events.map(event => event.id));
          if (previous.invalid || previous.conflicts) this.warn('Workbench experience log has damaged or conflicting rows.');
          if (previous.events.some(event => inExperienceScope(this.scope, event.groupId) && event.event === 'capture_gap' && event.reason === 'capacity')) {
            this.haltedForCapacity = true;
            this.warn('Workbench experience capture remains paused at capacity.');
            return;
          }
        }
        const ids = this.ids;
        const batch = new Map(rows.filter(row => !ids.has(row.id)).map(row => [row.id, row]));
        if (!batch.size && !this.gap) return;
        // A separator isolates any incomplete last line left by a failed write. Blank lines are ignored.
        const encode = (events: ExperienceEvent[]) => (info.size ? '\n' : '') + events.map(row => JSON.stringify(row) + '\n').join('');
        const data = encode([...(this.gap ? [this.gapEvent(this.gap, 'write')] : []), ...batch.values()]);
        const nextSize = info.size + Buffer.byteLength(data);
        if (!this.capacityWarned && nextSize >= experienceMaxBytes * 0.75) {
          this.warn('Workbench experience file is at least 75% full.');
          this.capacityWarned = true;
        }
        if (nextSize > experienceMaxBytes - capacityReserveBytes) {
          const gap = this.gapEvent({
            from: this.gap && this.gap.from < from ? this.gap.from : from,
            changes: (this.gap?.changes ?? 0) + scoped.length,
            groupId: this.gap?.groupId ?? scoped[0].ticket.groupId,
          }, 'capacity');
          const marker = encode([gap]);
          if (info.size + Buffer.byteLength(marker) <= experienceMaxBytes) writeFileSync(fd, marker, 'utf8');
          this.haltedForCapacity = true;
          this.warn('Workbench experience capture paused at capacity. Ticket storage was unaffected.');
          return;
        }
        writeFileSync(fd, data, 'utf8');
        for (const id of batch.keys()) ids.add(id);
        this.gap = undefined;
      } finally { closeSync(fd); }
    } catch {
      // A write can partially succeed. Reload IDs so a later attempt does not append committed lines twice.
      this.ids = undefined;
      if (!this.gap) {
        this.gap = { from, changes: 0, groupId: scoped[0].ticket.groupId };
        this.warn('Workbench experience capture missed at least one change. Ticket storage was unaffected.');
      }
      if (from < this.gap.from) this.gap.from = from;
      this.gap.changes += scoped.length;
    }
  }

  private gapEvent({ groupId, ...gap }: { from: string; changes: number; groupId: string }, reason: Gap['reason']): Gap {
    const at = this.now();
    return { ...versions, groupId, id: sha256(JSON.stringify([groupId, gap, at, reason])),
      event: 'capture_gap', at, ...gap, reason };
  }
}

type ManualReview = {
  taskKey: string; at: string; reviewType: string; outcome: 'rework' | 'clear' | 'pending';
  by: 'reviewer' | 'owner'; workId?: string; findingSha256?: string;
};
const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function parseReview(value: unknown): ManualReview | undefined {
  const row = value as Partial<ManualReview> | null;
  if (!row || !isUtc(row.at) || typeof row.taskKey !== 'string' || !hashPattern.test(row.taskKey) ||
      typeof row.reviewType !== 'string' || !slug.test(row.reviewType) ||
      (row.by !== 'reviewer' && row.by !== 'owner') ||
      (row.outcome !== 'rework' && row.outcome !== 'clear' && row.outcome !== 'pending') ||
      (row.workId !== undefined && (typeof row.workId !== 'string' || !slug.test(row.workId)))) return;
  if ((row.outcome === 'rework' || row.findingSha256 !== undefined) &&
      (typeof row.findingSha256 !== 'string' || !hashPattern.test(row.findingSha256))) return;
  return row as ManualReview;
}

type Cohort = {
  role: string; cli: TaskIdentity['cli']; opened: number; closed: Set<string>; closedWithoutOpening: Set<string>;
  closures: Partial<Record<ClosedReason, number>>; agentResults: Partial<Record<AgentResult, number>>;
  reportedAcceptance: Partial<Record<AcceptanceResult, number>>;
};

function count<K extends string>(counts: Partial<Record<K, number>>, key: K) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Cohorts use the opening metadata when captured. A review opportunity needs a human annotation. */
export function summarizeExperience(raw: string, groupId: string, from: string, until: string, reviewInput = '') {
  if (!groupId || !isUtc(from) || !isUtc(until) || from >= until) throw new Error('Provide a group and increasing UTC timestamps.');
  const { events, invalid, duplicates, conflicts } = readExperience(raw);
  const within = (at: string) => from <= at && at < until;
  const group = events.filter(event => event.groupId === groupId);
  const taskKeys = new Set(group.flatMap(row => row.event === 'capture_gap' ? [] : [row.taskKey]));
  const openings = new Set(group.flatMap(row => row.event === 'task_opened' ? [row.taskKey] : []));
  const closedInWindow = new Set<string>();
  const cohorts = new Map<string, Cohort>();
  for (const event of group) {
    if (event.event === 'capture_gap' || !within(event.at)) continue;
    const { role, cli, taskKey } = event;
    const key = JSON.stringify([role, cli]);
    const cohort = cohorts.get(key) ?? { role, cli, opened: 0, closed: new Set<string>(), closedWithoutOpening: new Set<string>(),
      closures: {}, agentResults: {}, reportedAcceptance: {} };
    cohorts.set(key, cohort);
    if (event.event === 'task_opened') cohort.opened++;
    if (event.event === 'task_closed') {
      closedInWindow.add(taskKey);
      cohort.closed.add(taskKey);
      if (!openings.has(taskKey)) cohort.closedWithoutOpening.add(taskKey);
      count(cohort.closures, event.reason);
      if (event.agentResult) count(cohort.agentResults, event.agentResult);
    }
    if (event.event === 'acceptance_reported') count(cohort.reportedAcceptance, event.result);
  }

  const { rows: annotations, invalid: invalidReviews } = parseRows(reviewInput, parseReview);
  const latest = new Map<string, ManualReview[]>();
  let unmatchedReviews = 0;
  for (const row of annotations) {
    if (!within(row.at)) continue;
    if (!taskKeys.has(row.taskKey)) { unmatchedReviews++; continue; }
    const key = JSON.stringify([row.reviewType, row.taskKey, row.by]);
    const existing = latest.get(key);
    if (!existing || row.at > existing[0].at) latest.set(key, [row]);
    else if (row.at === existing[0].at) existing.push(row);
  }
  const byTicket = new Map<string, ManualReview[]>();
  for (const row of [...latest.values()].flat()) {
    const key = JSON.stringify([row.reviewType, row.taskKey]);
    const prior = byTicket.get(key) ?? [];
    prior.push(row);
    byTicket.set(key, prior);
  }
  const opportunities = new Map<string, Set<ManualReview['outcome'] | 'conflict'>>();
  for (const caseRows of byTicket.values()) {
    const [{ reviewType, taskKey }] = caseRows;
    const workIds = [...new Set(caseRows.flatMap(row => row.workId ? [row.workId] : []))];
    const workId = workIds.length === 1 ? workIds[0] : undefined;
    const key = JSON.stringify([reviewType, workId ? 'confirmed-work' : 'ticket-only', workId ?? taskKey]);
    const outcomes = opportunities.get(key) ?? new Set();
    opportunities.set(key, outcomes);
    for (const row of caseRows) outcomes.add(row.outcome);
    if (workIds.length > 1) outcomes.add('conflict');
  }
  type ReviewCounts = { opportunities: number; resolved: number; rework: number; clear: number; pending: number; conflicts: number };
  const reviewCounts = new Map<string, { confirmedWork: ReviewCounts; ticketOnly: ReviewCounts }>();
  const empty = (): ReviewCounts => ({ opportunities: 0, resolved: 0, rework: 0, clear: 0, pending: 0, conflicts: 0 });
  for (const [key, outcomes] of opportunities) {
    const [type, basis] = JSON.parse(key) as [string, 'confirmed-work' | 'ticket-only', string];
    const breakdown = reviewCounts.get(type) ?? { confirmedWork: empty(), ticketOnly: empty() };
    reviewCounts.set(type, breakdown);
    const counts = basis === 'confirmed-work' ? breakdown.confirmedWork : breakdown.ticketOnly;
    counts.opportunities++;
    if (outcomes.has('conflict') || (outcomes.has('clear') && outcomes.has('rework'))) { counts.conflicts++; continue; }
    if (outcomes.has('rework')) { counts.rework++; counts.resolved++; }
    else if (outcomes.has('clear')) { counts.clear++; counts.resolved++; }
    else counts.pending++;
  }
  return {
    version: 1, groupId, window: { from, until },
    coverage: {
      measure: 'observed-only', invalid, duplicates, conflicts, invalidReviews, unmatchedReviews,
      atCapacity: Buffer.byteLength(raw) >= experienceMaxBytes - capacityReserveBytes,
      gaps: group.filter(event => event.event === 'capture_gap' && event.from < until &&
        (event.reason === 'capacity' || event.at >= from)),
    },
    uniqueTasksClosed: closedInWindow.size,
    cohorts: [...cohorts.values()].map(({ closed, closedWithoutOpening, ...fields }) => ({
      ...fields, uniqueTasksClosed: closed.size, uniqueTasksClosedWithoutRecordedOpening: closedWithoutOpening.size,
    })),
    reviews: [...reviewCounts].map(([reviewType, breakdown]) => ({ reviewType, ...breakdown })),
  };
}
