import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalRoom } from '../types/guild';

import { advanceReadMarks, diffAttention, isUnread, lastAgentEntry, loadReadMarks, planReadMarks, saveReadMarks, type AttentionEvent, type ReadMarks, type Seen } from './attentionDiff';
export { diffAttention };
export type { AttentionEvent };

export const isWorking = (room: TerminalRoom) => Boolean(room.live && !room.ready && !room.pendingApproval && !room.menu && room.status === 'running');

/**
 * Tracks background activity across rooms: unread replies, when work started,
 * and transitions worth a chime or notification (new approval, work finished).
 */
/** Read marks kept by the Bridge and shared by every device: what it holds, whether it has told this device yet, and how to report what this device read. */
export interface SharedReadMarks { ready: boolean; marks: ReadMarks; send: (diff: ReadMarks) => void }

/** Is this page in front of the Founder? A page left open in the background has not been read by anyone. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function useRoomAttention(rooms: TerminalRoom[], viewedIds: string[], onAttention: (event: AttentionEvent) => void, shared?: SharedReadMarks) {
  const seen = useRef<Map<string, Seen> | null>(null);
  const handler = useRef(onAttention);
  handler.current = onAttention;
  // Unread dots come from what the Founder last saw; every member of an open group counts as seen. The Bridge keeps it for all devices;
  // the browser's own copy is the fallback for a Bridge that does not (and the source adopted once when sharing starts).
  const [marks, setMarks] = useState<ReadMarks>(loadReadMarks);
  const adopted = useRef(false);
  const pageVisible = usePageVisible();
  // Replies that arrive while the page is in the background are not read: only a page the Founder can see marks its rooms as read.
  const reading = pageVisible ? viewedIds : [];
  const [workingSince, setWorkingSince] = useState<Record<string, number>>({});
  // Last time each room's screen or conversation changed; a working room that stays unchanged may be stuck.
  const lastActivity = useRef<Record<string, { mark: string; at: number }>>({});
  const viewedKey = viewedIds.join(',');

  useEffect(() => {
    const { next, events } = diffAttention(seen.current, rooms, viewedIds);
    seen.current = next;
    trackActivity(lastActivity.current, rooms, Date.now());
    setWorkingSince(current => {
      const updated: Record<string, number> = {};
      for (const room of rooms) if (isWorking(room)) updated[room.id] = current[room.id] ?? Date.now();
      const same = Object.keys(updated).length === Object.keys(current).length && Object.keys(updated).every(id => current[id] === updated[id]);
      return same ? current : updated;
    });
    for (const event of events) handler.current(event);
  }, [rooms]);

  useEffect(() => {
    if (shared) {
      // Until the Bridge has said what it holds, nothing is decided: guessing would mark real unread replies as read for every device.
      if (!shared.ready) { adopted.current = false; return; }
      const plan = planReadMarks({ marks: shared.marks, rooms, viewedIds: reading, local: marks, adoptLocal: !adopted.current });
      adopted.current = true;
      if (Object.keys(plan.diff).length) shared.send(plan.diff);
      return;
    }
    const next = advanceReadMarks(marks, rooms, reading);
    if (next === marks) return;
    setMarks(next);
    saveReadMarks(next);
  }, [rooms, viewedKey, pageVisible, marks, shared?.ready, shared?.marks]);
  // The browser keeps a copy of what the Bridge holds, in case it is offline or an older Bridge answers later.
  useEffect(() => { if (shared?.ready) saveReadMarks(shared.marks); }, [shared?.ready, shared?.marks]);
  const effective = shared ? (shared.ready ? shared.marks : undefined) : marks;
  const unread = useMemo(() => effective
    ? Object.fromEntries(rooms.filter(room => !viewedIds.includes(room.id) && isUnread(room, effective)).map(room => [room.id, true as const])) as Record<string, true>
    : {} as Record<string, true>, [rooms, effective, viewedKey]);

  const quietSince = (roomId: string) => lastActivity.current[roomId]?.at;
  return { unread, workingSince, quietSince };
}

export function useNow(intervalMs: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

export function formatElapsed(since: number | undefined, now: number) {
  if (since === undefined) return undefined;
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return t('utils.elapsed.just');
  if (minutes < 60) return t('utils.elapsed.minutes', { count: minutes });
  return t('utils.elapsed.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Records when each room's screen, conversation or status last changed. */
export function trackActivity(activity: Record<string, { mark: string; at: number }>, rooms: TerminalRoom[], now: number) {
  for (const room of rooms) {
    const mark = `${room.screenId ?? ''}|${room.logs.length}|${room.status}`;
    if (activity[room.id]?.mark !== mark) activity[room.id] = { mark, at: now };
  }
}

/** A working room whose screen has not changed for this long is shown as possibly stuck. */
/** A working CLI keeps its screen moving; one that has stood still this long is likely waiting for you. The page shows this hint; the push waits longer (stillCallOutMs in bridge/push.ts). */
export const stallAfterMs = 10 * 60_000;

export function workState(roomId: string, attention: { workingSince: Record<string, number>; quietSince: (id: string) => number | undefined }, now: number,
  awaitingAt?: number, room?: TerminalRoom) {
  // Approval cards and menus have their own UI; the bloom is for "the CLI is on it".
  if (room?.pendingApproval || room?.menu) return undefined;
  const since = attention.workingSince[roomId] ?? awaitingAt;
  if (since === undefined) return undefined;
  const quiet = attention.quietSince(roomId);
  const quietFor = quiet === undefined ? 0 : now - quiet;
  return {
    elapsed: formatElapsed(since, now) ?? '',
    stalled: quietFor >= stallAfterMs ? formatElapsed(now - quietFor, now) : undefined,
  };
}

type Awaiting = { at: number; lastAgent?: string; sawBusy: boolean; readyAt?: number };
const awaitLimitMs = 15 * 60_000;
const settleMs = 20_000;
/** At its prompt with a still screen this long after a send means the CLI is not working on it. */
export const idleDropMs = 12_000;

/**
 * Pure step for the "waiting for a reply" state started when a prompt is sent.
 * It ends on a new agent reply, when the CLI stops, after the CLI has been back at
 * its prompt for a while, or after a long limit. It does not rely on the CLI's
 * working text being recognised, which differs between CLIs.
 */
export function stepAwaiting(state: Record<string, Awaiting>, rooms: TerminalRoom[], now: number, quietSince?: (roomId: string) => number | undefined) {
  let changed = false;
  const next: Record<string, Awaiting> = {};
  for (const [id, entry] of Object.entries(state)) {
    const room = rooms.find(item => item.id === id);
    if (!room || !room.live || lastAgentEntry(room) !== entry.lastAgent || now - entry.at > awaitLimitMs) { changed = true; continue; }
    const quiet = quietSince?.(id);
    if (room.ready && quiet !== undefined && now - Math.max(entry.at, quiet) >= idleDropMs) { changed = true; continue; }
    let updated = entry;
    if (!room.ready && !entry.sawBusy) updated = { ...entry, sawBusy: true, readyAt: undefined };
    else if (!room.ready && entry.readyAt !== undefined) updated = { ...entry, readyAt: undefined };
    else if (room.ready && entry.sawBusy && entry.readyAt === undefined) updated = { ...entry, readyAt: now };
    if (updated.readyAt !== undefined && now - updated.readyAt > settleMs) { changed = true; continue; }
    if (updated !== entry) changed = true;
    next[id] = updated;
  }
  return changed ? next : state;
}

export function useAwaitingReply(rooms: TerminalRoom[]) {
  const [state, setState] = useState<Record<string, Awaiting>>({});
  const activity = useRef<Record<string, { mark: string; at: number }>>({});
  const active = Object.keys(state).length > 0;
  const now = useNow(5_000, active);
  useEffect(() => { trackActivity(activity.current, rooms, Date.now()); }, [rooms]);
  useEffect(() => {
    if (active) setState(current => stepAwaiting(current, rooms, Date.now(), id => activity.current[id]?.at));
  }, [rooms, now, active]);
  return {
    since: (roomId: string) => state[roomId]?.at,
    start: (room: TerminalRoom) => setState(current => ({ ...current, [room.id]: { at: Date.now(), lastAgent: lastAgentEntry(room), sawBusy: false } })),
    cancel: (roomId: string) => setState(current => {
      if (!current[roomId]) return current;
      const { [roomId]: _gone, ...rest } = current;
      return rest;
    }),
  };
}
