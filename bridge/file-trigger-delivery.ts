import type { GroupChat, TerminalRoom } from '../src/types/guild';
import type { ClientEvent, ServerEvent } from '../src/types/bridge';

/** Bridge-owned system notification; never a workbench party, task, or reply. */
export type FileNoticeEvent = Readonly<{ watchId: string; path: string; kind: 'add' | 'change' | 'delete' | 'gap'; observedAt: string }>;
export type FileNoticeReservation = Readonly<{
  id: string; groupId: string; roomId: string; sessionId: string; repoPath: string;
  events: readonly FileNoticeEvent[]; confirmationHint: string;
}>;
export type NoticeFinish = 'delivered' | 'uncertain';

/**
 * Store implementation is responsible for atomic, durable transitions. `reserve` must write
 * inflight before returning; a persisted inflight after restart becomes uncertain, never pending.
 * Cancellation removes pending events and must invalidate any reservation before input.
 * minimum interval, per-path merging and bounded overflow are enforced by the store.
 */
export interface FileNoticeStore {
  hasPending(groupId: string): boolean;
  pendingEvents(groupId: string): readonly FileNoticeEvent[];
  /** `usable` limits the notice to events whose watch is healthy; the others stay pending for later. */
  reserve(groupId: string, target: { roomId: string; sessionId: string; repoPath: string }, usable?: (event: FileNoticeEvent) => boolean): FileNoticeReservation | undefined;
  isCurrent(reservation: FileNoticeReservation): boolean;
  finish(id: string, state: NoticeFinish): void;
  cancel(watchId: string): void;
  recoverInflight(): void;
}

export interface FileNoticeDeps {
  store: FileNoticeStore;
  /** Check the signed state and Keychain anchor; on failure stop every watcher. */
  verifyIntegrity(): boolean;
  groups(): GroupChat[];
  rooms(): TerminalRoom[];
  state(room: TerminalRoom): { inactive: boolean; verifiedSession: boolean; auto: boolean; working: boolean };
  /** Revalidate every affected watch root/path, including its original root identity. */
  validatePaths(events: readonly FileNoticeEvent[]): boolean;
  /** Binds a guard to the current PTY, as in rooms.ptyGuard. */
  ptyGuard(roomId: string): () => boolean;
  handle(event: Extract<ClientEvent, { type: 'START' | 'INPUT' }>, reply: (event: ServerEvent) => void,
    options: { stillWanted?: () => boolean; authorizeBenchInput?: (phase: 'paste' | 'submit') => boolean }): Promise<unknown>;
  notice(message: string): void;
}

/** A pending or in-flight notice holds only the group's current crown, never a former crown. */
export function fileNoticeHoldsRoom(groups: readonly GroupChat[], hasHold: (groupId: string) => boolean, roomId: string) {
  return groups.some(group => group.orchestratorRoomId === roomId && group.members.some(member => member.roomId === roomId) && hasHold(group.id));
}

const sessionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fixedSafety = '不可逆操作、對外發送、刪除、改權限、Merge、Deploy 仍須先取得 Founder 確認。';
const maxEvents = 32;

/** Escape controls and bidirectional formatting, including newlines; input is always data. */
export function untrustedDisplay(value: string, limit = 500): string {
  const escaped = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return escaped.length <= limit ? escaped : `${escaped.slice(0, limit)}…`;
}

export function fileNoticeText(reservation: FileNoticeReservation): string {
  const labels = { add: '新增', change: '修改', delete: '刪除', gap: '觀察有缺口，檔案可能已更新' } as const;
  const rows = reservation.events.slice(0, maxEvents).map(event =>
    `路徑（不可信資料）：${untrustedDisplay(event.path)}；事件：${labels[event.kind]}；Bridge 觀察時間：${untrustedDisplay(event.observedAt, 64)}`);
  const hint = reservation.confirmationHint ? `確認提示（Founder 設定）：${untrustedDisplay(reservation.confirmationHint, 500)}` : '';
  return ['[Bridge 系統通知｜檔案觸發]', ...rows, fixedSafety, hint].filter(Boolean).join('\n');
}

type AttemptResult = 'no-pending' | 'no-crown' | 'held' | 'starting' | 'submitted';

/**
 * Server invokes on a new event, crown change, wake-ready, and onIdle; it must also
 * schedule one bounded timer for a rate-limited group. No client supplies text/target.
 */
export async function deliverFileNotice(deps: FileNoticeDeps, groupId: string): Promise<AttemptResult> {
  if (!deps.verifyIntegrity()) return 'held';
  if (!deps.store.hasPending(groupId)) return 'no-pending';
  const group = deps.groups().find(value => value.id === groupId);
  const room = group?.orchestratorRoomId && deps.rooms().find(value => value.id === group.orchestratorRoomId);
  if (!group?.orchestratorRoomId) { deps.notice('檔案觸發等待群組大佬。'); return 'no-crown'; }
  if (!room || !group.members.some(member => member.roomId === room.id && member.modelId === room.modelId)) return 'held';
  const roomId = room.id, sessionId = room.sessionId, repoPath = room.repoPath;
  if (!sessionId || !sessionPattern.test(sessionId) || !repoPath) return 'held';
  const current = (phase: 'start' | 'paste' | 'submit', reservation?: FileNoticeReservation) => {
    if (!deps.verifyIntegrity()) return false;
    const currentGroup = deps.groups().find(item => item.id === groupId);
    const recipient = deps.rooms().find(item => item.id === roomId);
    if (!recipient || currentGroup?.orchestratorRoomId !== roomId ||
      !currentGroup.members.some(member => member.roomId === roomId && member.modelId === recipient.modelId) ||
      recipient.sessionId !== sessionId || recipient.repoPath !== repoPath ||
      !recipient.resumable || recipient.pendingApproval || recipient.pendingQuestion || recipient.menu || recipient.status === 'waiting_approval') return false;
    const state = deps.state(recipient);
    if (state.inactive || !state.verifiedSession || !state.auto) return false;
    if (phase === 'paste' && (!recipient.live || !recipient.ready || recipient.status !== 'idle' || state.working)) return false;
    if (phase === 'submit' && !recipient.live) return false;
    return !reservation || (deps.store.isCurrent(reservation) && deps.validatePaths(reservation.events));
  };
  // One watch that is offline or broken must not hold back the notices of the healthy ones: they go, the others wait.
  const usable = (event: FileNoticeEvent) => deps.validatePaths([event]);
  const pendingPathsValid = () => deps.store.pendingEvents(groupId).some(usable);
  if (!current('start') || deps.state(room).working || !pendingPathsValid()) return 'held';
  if (!room.live) {
    await deps.handle({ type: 'START', roomId }, () => {}, { stillWanted: () => current('start') && deps.store.hasPending(groupId) && pendingPathsValid() });
    return 'starting';
  }
  if (!current('paste')) return 'held';
  const ptyGuard = deps.ptyGuard(roomId);
  const reservation = deps.store.reserve(groupId, { roomId, sessionId, repoPath }, usable);
  if (!reservation) return 'held';
  // Guard against an incorrect or stale store adapter: the store cannot select the recipient.
  if (reservation.groupId !== groupId || reservation.roomId !== roomId || reservation.sessionId !== sessionId || reservation.repoPath !== repoPath ||
      !reservation.events.length || reservation.events.length > maxEvents || !current('paste', reservation) || !ptyGuard()) {
    deps.store.finish(reservation.id, 'uncertain');
    return 'held';
  }
  let finished = false;
  const finish = (state: NoticeFinish) => {
    if (finished) return;
    finished = true;
    try { deps.store.finish(reservation.id, state); }
    catch { deps.notice('檔案觸發遞送狀態未能儲存；請檢查並勿重送。'); }
  };
  try {
    await deps.handle({ type: 'INPUT', roomId, text: fileNoticeText(reservation), requestId: reservation.id }, result => {
      if (result.type === 'ACTION_RESULT') finish(result.ok ? 'delivered' : 'uncertain');
    }, { authorizeBenchInput: phase => ptyGuard() && current(phase, reservation) });
  } catch {
    finish('uncertain');
  }
  // INPUT can return before its asynchronous ACTION_RESULT; inflight remains durable.
  return 'submitted';
}
