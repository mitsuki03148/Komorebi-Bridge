import type { TerminalRoom } from '../types/guild';

export type Seen = {
  status: TerminalRoom['status']; approvalId?: string; questionId?: string; lastAgent?: string;
  /** The agent's last message when this run began: a "final report" has to be newer than it. */
  runStartAgent?: string;
  /** When this run began, as far as this watcher saw. */
  runStartedAt?: number;
  /** When the room went idle and its closing message is still being waited for. */
  waitingReport?: number;
};
export type AttentionEvent = { room: TerminalRoom; kind: 'approval' | 'question' | 'done' };

/** The closing line of a report in the team's format, e.g. "RESULT — DONE" (also "RESULT: STOP", "**RESULT** – INCOMPLETE"). */
export const reportMarker = /\bRESULT\b[\s*`_]*[—–:：-]+[\s*`_]*(?:DONE|STOP|INCOMPLETE)\b/i;
const closingResult = new RegExp('^[\\s*`_]*' + reportMarker.source + '[\\s*`_]*$', 'i');

/** The room-wide verdict is an explicit last line. */
export function finalResult(text: string) {
  return closingResult.exec(text.trimEnd().split(/\r?\n/).at(-1) ?? '')?.[0]
    .match(/\b(?:DONE|STOP|INCOMPLETE)\b/i)?.[0].toUpperCase();
}

export function reportIsDone(text: string) {
  return finalResult(text) === 'DONE';
}
/** How long, after a room goes idle, its closing message may take to reach the conversation record. */
export const reportWaitMs = 10_000;
/** A run this long that stops is announced even with no report, so a stuck test or command does not go unnoticed. */
export const longRunMs = 15 * 60_000;

/** The last thing said in the room is the agent's own report. */
export function endsWithReport(room: TerminalRoom) {
  const last = room.logs.findLast(entry => entry.sender !== 'system');
  return last?.sender === 'agent' && reportMarker.test(last.text) ? last.id : undefined;
}

export const lastAgentEntry = (room: TerminalRoom) => room.logs.findLast(entry => entry.sender === 'agent')?.id;

/** Compares the last seen room states with the current ones. A room seen for the first time never signals. */
export function diffAttention(previous: Map<string, Seen> | null, rooms: TerminalRoom[], viewedIds: string[], now = Date.now()) {
  const next = new Map<string, Seen>();
  const events: AttentionEvent[] = [];
  const newlyUnread: string[] = [];
  for (const room of rooms) {
    const current: Seen = { status: room.status, approvalId: room.pendingApproval?.id, questionId: room.pendingQuestion?.id, lastAgent: lastAgentEntry(room) };
    next.set(room.id, current);
    const before = previous?.get(room.id);
    if (!before) continue;
    current.runStartedAt = before.status === 'running' ? (before.runStartedAt ?? now) : room.status === 'running' ? now : undefined;
    current.runStartAgent = before.status === 'running' ? before.runStartAgent : room.status === 'running' ? before.lastAgent : undefined;
    const idle = room.status === 'idle' && room.live;
    // Stopping is not finishing: "done" is for the closing report, which may land in the record a moment after the room goes idle.
    let waiting = idle ? (before.status === 'running' ? now : before.waitingReport) : undefined;
    if (current.approvalId && current.approvalId !== before.approvalId) events.push({ room, kind: 'approval' });
    else if (waiting !== undefined && before.status === 'running' && now - (before.runStartedAt ?? now) >= longRunMs && !endsWithReport(room)) {
      events.push({ room, kind: 'done' });
      waiting = undefined;
    } else if (waiting !== undefined) {
      const report = endsWithReport(room);
      if (now - waiting > reportWaitMs) waiting = undefined;
      else if (report && report !== before.runStartAgent) { events.push({ room, kind: 'done' }); waiting = undefined; }
      else { current.runStartAgent = before.runStartAgent; current.runStartedAt = before.runStartedAt; }
    }
    current.waitingReport = waiting;
    // A question the agent asks the Founder waits for an answer, so it is announced the way an approval is (once per question).
    if (current.questionId && current.questionId !== before.questionId) events.push({ room, kind: 'question' });
    if (current.lastAgent && current.lastAgent !== before.lastAgent && !viewedIds.includes(room.id)) newlyUnread.push(room.id);
  }
  return { next, events, newlyUnread };
}

/** Per room: when the last agent reply the Founder has seen was written ('' = nothing seen yet). Kept in the browser so a refresh does not bring old dots back. */
export type ReadMarks = Record<string, string>;
const readMarksKey = 'komorebi-read-marks-v1';

/** The time of a room's last agent reply (its id when the entry has no time). A time survives an id that changes when a history window is read again. */
export const readStamp = (room: TerminalRoom) => {
  const last = room.logs.findLast(entry => entry.sender === 'agent');
  return last ? (last.createdAt ?? last.id) : undefined;
};

const newerThan = (stamp: string, mark: string) => {
  const at = Date.parse(stamp), seen = Date.parse(mark);
  return Number.isFinite(at) && Number.isFinite(seen) ? at > seen : stamp !== mark;
};

/** A reply is unread when it is newer than what was last seen. A room never seen before has nothing to compare, so it shows no dot. */
export function isUnread(room: TerminalRoom, marks: ReadMarks) {
  const stamp = readStamp(room), mark = marks[room.id];
  if (!stamp || mark === undefined) return false;
  return mark === '' || newerThan(stamp, mark);
}

/** Rooms on screen (every member of an open group) count as read; a room met for the first time starts as read, an empty one waits for its first reply. */
export function advanceReadMarks(marks: ReadMarks, rooms: TerminalRoom[], viewedIds: string[]) {
  let next = marks;
  for (const room of rooms) {
    const stamp = readStamp(room), mark = marks[room.id];
    const wanted = mark === undefined ? (stamp ?? '') : viewedIds.includes(room.id) && stamp ? stamp : mark;
    if (wanted === mark) continue;
    if (next === marks) next = { ...marks };
    next[room.id] = wanted;
  }
  return next;
}

export function loadReadMarks(): ReadMarks {
  try {
    const raw = JSON.parse(localStorage.getItem(readMarksKey) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'string')) as ReadMarks : {};
  } catch { return {}; }
}

export function saveReadMarks(marks: ReadMarks) {
  try { localStorage.setItem(readMarksKey, JSON.stringify(marks)); } catch { /* private window or blocked storage: dots just do not persist */ }
}

/**
 * Combine two sets of read marks (devices, or this device and the Bridge): per room the later "seen up to" wins, and '' (nothing seen)
 * loses to anything. Two marks that are not times (an entry id) cannot be ordered, so the incoming one wins. Returns `current` itself if nothing changed.
 */
export function mergeReadMarks(current: ReadMarks, incoming: ReadMarks) {
  let next = current;
  for (const [id, stamp] of Object.entries(incoming)) {
    const have = current[id];
    let take = have === undefined;
    if (!take && stamp !== have) {
      if (have === '') take = stamp !== '';
      else if (stamp === '') take = false;
      else { const at = Date.parse(stamp), seen = Date.parse(have!); take = Number.isFinite(at) && Number.isFinite(seen) ? at > seen : true; }
    }
    if (!take) continue;
    if (next === current) next = { ...current };
    next[id] = stamp;
  }
  return next;
}

/**
 * One round for a device that shares its read marks with the Bridge. `marks` is what the Bridge holds; `local` is this browser's own old marks,
 * adopted once (`adoptLocal`) so that what was read before sharing existed is not lost. `diff` is what has to be sent to the Bridge.
 */
export function planReadMarks(input: { marks: ReadMarks; rooms: TerminalRoom[]; viewedIds: string[]; local?: ReadMarks; adoptLocal?: boolean }) {
  const start = input.adoptLocal && input.local ? mergeReadMarks(input.marks, input.local) : input.marks;
  const next = advanceReadMarks(start, input.rooms, input.viewedIds);
  const diff: ReadMarks = {};
  for (const [id, stamp] of Object.entries(next)) if (input.marks[id] !== stamp) diff[id] = stamp;
  return { marks: next, diff };
}
