import type { BenchRoutingError, ClientEvent, RoleRouteReceipt, RoleRouteRule, ServerEvent } from '../src/types/bridge';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { acceptanceOptions } from '../scripts/bench-acceptance';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Bench, BenchError, benchLimits, hookOutput, isSystemSender, partyName, pingCarriesTicket, pingText, proofText, ticketText, type AcceptanceResult, type BenchParty, type ReceiptProof, type Ticket, roleReceipt, routeQuotaText } from './bench';
import { groupRoleKey, isGroupRolePreset, normalizeRoleDirection } from '../src/types/groupRoles';
import type { Scope } from './access';
import { findRoom, lowDispatchQuota, remainingDispatchQuota, resolveTarget, type DispatchQuota } from './handoff';
import { claimedWorktree } from './worktree';
import { bridgeConfig } from './config';
import type { BridgeCheckout } from './auto-worktree';

export type RoleRoomState = Readonly<{
  room: TerminalRoom;
  inactive: boolean;
  verifiedSession: boolean;
  auto: boolean;
  working: boolean;
  openWork: boolean;
}>;
export type RoleRejectReason = 'self' | 'unavailable' | 'inactive' | 'unverified' | 'waiting' | 'approval-mode' | 'low-quota';
export type RoleRejection = { roomId: string; reason: RoleRejectReason; quota?: DispatchQuota };
type RoleRule = RoleRouteRule;

export type RolePickInput = Readonly<{
  group: GroupChat;
  sender: TerminalRoom;
  roleKey: string;
  rooms: ReadonlyMap<string, RoleRoomState>;
  characters: Partial<Record<CLIModelId, CharacterProfile>>;
  nativeAllowlist: ReadonlySet<string>;
  previousRoomId?: string;
}>;

type RoleCandidate = { room: TerminalRoom; sessionId: string; quota: DispatchQuota; workload: number };
type RolePick = { kind: 'picked'; room: TerminalRoom; sessionId: string; quota: DispatchQuota; rule: RoleRule } |
  { kind: 'unavailable'; cause: 'sender-outside' | 'unknown-role' | 'no-eligible'; available: string[]; rejected: RoleRejection[] };

const nativeSession = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const identityKeys = (room: TerminalRoom) => {
  const id = room.id.toLowerCase();
  const session = room.sessionId?.toLowerCase();
  return session ? [id, session, `session-${room.modelId.toLowerCase()}-${session}`] : [id];
};
const sameRoleIdentity = (a: TerminalRoom, b: TerminalRoom) =>
  a.id === b.id || (a.modelId === b.modelId && identityKeys(a).some(key => identityKeys(b).includes(key)));

/** All facts are from one Bridge snapshot. This does not open rooms, inspect files, or ask a model. */
export function pickRoleRoom(input: RolePickInput): RolePick {
  const { group, sender, roleKey, rooms, characters, nativeAllowlist, previousRoomId } = input;
  if (!group.members.some(member => member.roomId === sender.id && member.modelId === sender.modelId)) {
    return { kind: 'unavailable', cause: 'sender-outside', available: [], rejected: [] };
  }
  const eligible = new Map<string, RoleCandidate[]>();
  const configured = new Set<string>();
  const rejected: RoleRejection[] = [];
  const reject = (key: string, roomId: string, reason: RoleRejectReason, quota?: DispatchQuota) => {
    if (key === roleKey) rejected.push({ roomId, reason, ...(quota ? { quota } : {}) });
  };
  for (const member of group.members) {
    const key = member.role?.key;
    if (!key) continue;
    configured.add(key);
    const state = rooms.get(member.roomId);
    if (!state || state.room.id !== member.roomId || state.room.modelId !== member.modelId) {
      reject(key, member.roomId, 'unavailable');
      continue;
    }
    const { room, inactive, verifiedSession, auto, working, openWork } = state;
    if (sameRoleIdentity(sender, room)) { reject(key, room.id, 'self'); continue; }
    if (inactive) { reject(key, room.id, 'inactive'); continue; }
    if (!verifiedSession || !room.sessionId || !nativeSession.test(room.sessionId) || (!room.live && !room.resumable)) {
      reject(key, room.id, 'unverified'); continue;
    }
    if (room.pendingApproval || room.pendingQuestion || room.status === 'waiting_approval') { reject(key, room.id, 'waiting'); continue; }
    if (auto !== true) { reject(key, room.id, 'approval-mode'); continue; }
    const idle = room.live === true && room.ready === true && room.status === 'idle' && !working;
    const quota = remainingDispatchQuota(characters[room.modelId]);
    if (lowDispatchQuota(room.modelId, quota)) { reject(key, room.id, 'low-quota', quota); continue; }
    const workload = (idle ? 0 : 2) + (openWork ? 1 : 0);
    const candidate: RoleCandidate = { room, sessionId: room.sessionId, quota, workload };
    const prior = eligible.get(key);
    if (prior) prior.push(candidate);
    else eligible.set(key, [candidate]);
  }
  let options = eligible.get(roleKey);
  if (!options?.length) return { kind: 'unavailable', cause: configured.has(roleKey) ? 'no-eligible' : 'unknown-role', available: [...eligible.keys()].sort(), rejected };
  let quotaRule: RoleRule['quota'] = 'not-compared';
  const both40 = options.filter(({ quota: { hp, mp } }) => hp !== null && mp !== null && hp >= 40 && mp >= 40);
  if (both40.length) {
    options = both40;
    quotaRule = 'both-at-least-40';
  } else if (options.every(({ quota: { hp, mp } }) => hp !== null && mp !== null)) {
    const bottleneck = (candidate: RoleCandidate) => Math.min(candidate.quota.hp!, candidate.quota.mp!);
    const best = Math.max(...options.map(bottleneck));
    options = options.filter(candidate => bottleneck(candidate) === best);
    quotaRule = 'best-lower-quota';
  }
  const workload = Math.min(...options.map(candidate => candidate.workload));
  const peers = options.filter(candidate => candidate.workload === workload)
    .sort((a, b) => a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0);
  const selected = (previousRoomId ? peers.find(candidate => candidate.room.id > previousRoomId) : undefined) ?? peers[0];
  return {
    kind: 'picked', room: selected.room, sessionId: selected.sessionId, quota: selected.quota,
    rule: { quota: quotaRule, workload: (['idle-and-empty', 'idle', 'empty', 'busy-with-work'] as const)[workload], rotated: peers.length > 1 },
  };
}

/** What the Bridge gives the workbench: its rooms and groups, and ways to tell the people watching. */
export interface BenchDeps {
  bench: Bench;
  rooms: () => TerminalRoom[];
  groups: () => GroupChat[];
  /** The absolute path of `komorebi-room`, written into tickets so an agent never has to find it. */
  tool: string;
  /** A quiet line in a room's conversation, so the Founder sees the handoff in human words. */
  note: (roomId: string, text: string) => void;
  /** A message to the open pages (the Founder). */
  notice: (text: string) => void;
  /** Rooms that were taken over by another room (old → new), so a ticket for the old one goes to the new one. */
  successors?: () => Record<string, string>;
  /** A ticket moved between two rooms (for the heart in the group view). */
  flow?: (fromRoomId: string, toRoomId: string, kind: 'task' | 'done', ticket: number) => void;
  createWorktree?: (ticketId: number, repo: string, ref?: string) => Promise<BridgeCheckout>;
  roleRouting?: {
    characters(): Partial<Record<CLIModelId, CharacterProfile>>;
    state(room: TerminalRoom): Omit<RoleRoomState, 'room' | 'openWork'>;
    nativeAllowlist(): ReadonlySet<string>;
  };
}

type Result = Extract<ServerEvent, { type: 'BENCH_RESULT' }> & { provision?: { ticketId: number; fromRoomId: string; toRoomId: string } };

const text = (value: unknown) => typeof value === 'string' ? value : undefined;

function party(deps: BenchDeps, query: unknown, what: string): { room: TerminalRoom; party: BenchParty } {
  if (typeof query !== 'string' || !query.trim()) throw new BenchError(`請指明${what}（房名或 Session ID）。`);
  const found = findRoom(deps.rooms(), query);
  if ('error' in found) throw new BenchError(found.error);
  // A new room has no CLI session yet (AGY makes one at its first message): its room id stands in until then.
  return { room: found.room, party: { sessionId: found.room.sessionId ?? found.room.id, roomName: found.room.roomName, modelId: found.room.modelId } };
}

const hashLimit = 20 * 1024 * 1024;

/** Look at a receipt that is a file or folder path (a commit or free text is left alone): does it exist, how big, and its SHA-256. */
export function proveReceipt(receipt: string | undefined, now = () => new Date()): ReceiptProof | undefined {
  const raw = receipt?.trim();
  if (!raw || !(raw.startsWith('/') || raw.startsWith('~/'))) return undefined;
  const path = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  const at = now().toISOString();
  try {
    const stat = lstatSync(path);
    if (stat.isDirectory()) return { path: raw, at, state: 'dir' };
    if (!stat.isFile()) return { path: raw, at, state: 'missing' };
    return { path: raw, at, state: 'file', bytes: stat.size, ...(stat.size <= hashLimit ? { sha256: createHash('sha256').update(readFileSync(path)).digest('hex') } : {}) };
  } catch { return { path: raw, at, state: 'missing' }; }
}

/** How the receipt looks now, next to how it looked when the ticket was finished. */
export function receiptNow(proof: ReceiptProof) {
  const now = proveReceipt(proof.path);
  if (!now || now.state === 'missing') return proof.state === 'missing' ? `回報位置仍然唔存在：${proof.path}` : `⚠ 回報位置而家已經唔存在（完成時存在）：${proof.path}`;
  if (proof.sha256 && now.sha256 && proof.sha256 !== now.sha256) return `⚠ 回報位置內容自完成後有變（sha256 ${proof.sha256.slice(0, 12)}… → ${now.sha256.slice(0, 12)}…）：${proof.path}`;
  return `回報位置仍在${proof.sha256 && now.sha256 ? '，內容同完成時一樣' : ''}：${proof.path}`;
}

/** The recipient of a ticket: a room, `@orchestrator` (the sender's group's current lead), or the successor of a room that was taken over. */
const partyOf = (room: TerminalRoom): BenchParty => ({ sessionId: room.sessionId ?? room.id, roomName: room.roomName, modelId: room.modelId });
type Recipient = { room: TerminalRoom; party: BenchParty; notes: string[] };
function recipient(deps: BenchDeps, me: TerminalRoom, query: unknown, group?: GroupChat, exact = false): Recipient {
  if (typeof query !== 'string' || !query.trim()) throw new BenchError('請指明收件人（房名、Session ID 或 @orchestrator）。');
  const isMember = (room: TerminalRoom) => !group || group.members.some(member => member.roomId === room.id && member.modelId === room.modelId);
  const rooms = deps.rooms().filter(isMember);
  if (exact) {
    const found = findRoom(rooms, query);
    if ('error' in found) throw new BenchError(found.error);
    return { room: found.room, party: partyOf(found.room), notes: [] };
  }
  const found = resolveTarget(new Map(rooms.map(room => [room.id, room])), group ? [group] : deps.groups(), deps.successors?.() ?? {}, query, me.id);
  if ('error' in found) throw new BenchError(found.error);
  return { room: found.room, party: partyOf(found.room), notes: found.notes };
}

/** The keys a room's workbench may be under: its CLI session, and its room id from before it had one. */
const keysOf = (room: TerminalRoom) => [...new Set([room.sessionId, room.id].filter((key): key is string => Boolean(key)))];
const roomOf = (deps: BenchDeps, key: string) => deps.rooms().find(room => room.sessionId === key || room.id === key);

const groupsOf = (deps: BenchDeps, room: TerminalRoom) => deps.groups().filter(group => group.members.some(member => member.roomId === room.id && member.modelId === room.modelId));

function requestedGroup(deps: BenchDeps, room: TerminalRoom, groupId: unknown, required = false) {
  const ownGroups = groupsOf(deps, room);
  if (groupId !== undefined) {
    const group = typeof groupId === 'string' ? ownGroups.find(item => item.id === groupId) : undefined;
    if (!group) throw new BenchError('找不到所屬群組。--group 必須是你自己的群組 ID。', false, 'ROLE_GROUP_INVALID');
    return group;
  }
  if (!required) return;
  if (ownGroups.length !== 1) {
    const options = ownGroups.map(group => `${group.name}（${group.id}）`).join('、');
    throw new BenchError(options ? `請用 --group 指明群組：${options}。` : '你的房不屬於任何群組。', false, 'ROLE_GROUP_REQUIRED');
  }
  return ownGroups[0];
}

const memberOf = (group: GroupChat, room: TerminalRoom) => group.members.some(member => member.roomId === room.id && member.modelId === room.modelId);
const matchesParty = (room: TerminalRoom, party: BenchParty) => room.modelId === party.modelId && keysOf(room).includes(party.sessionId);
function hasOpenWork(deps: BenchDeps, room: TerminalRoom, excluding?: number) {
  return keysOf(room).some(key =>
    deps.bench.mine(key).some(ticket => ticket.id !== excluding && (ticket.kind === 'task' || ticket.kind === 'reply')) ||
    deps.bench.openFrom(key).some(ticket => ticket.id !== excluding));
}

/** A native test must not start on top of another: it waits for work in progress, work this room is waiting on, and older tickets queued for the room. */
export const hasNativeTestAheadForTest = (deps: BenchDeps, room: TerminalRoom, ticket: Ticket) => hasNativeTestAhead(deps, room, ticket);
function hasNativeTestAhead(deps: BenchDeps, room: TerminalRoom, ticket: Ticket) {
  return keysOf(room).some(key =>
    deps.bench.mine(key).some(other => other.id !== ticket.id && (other.kind === 'task' || other.kind === 'reply') && (other.status === 'seen' || other.id < ticket.id)) ||
    deps.bench.openFrom(key).some(other => other.id !== ticket.id));
}

function selectRoleRecipient(deps: BenchDeps, me: TerminalRoom, group: GroupChat, query: string) {
  const inputs = deps.roleRouting;
  if (!inputs) throw new BenchError('Bridge 未支援按崗位派單。請用房名或 Session ID 指名。', false, 'ROLE_NOT_SUPPORTED');
  const roleKey = groupRoleKey(query.slice(1));
  // Work that has been open for hours is closed first, so a stuck old ticket does not make the room look busy.
  deps.bench.sweep();
  const rooms = new Map(deps.rooms().map(room => [room.id, {
    room, ...inputs.state(room), openWork: hasOpenWork(deps, room),
  }]));
  const pick = pickRoleRoom({ group, sender: me, roleKey: roleKey ?? '', rooms, characters: inputs.characters(),
    nativeAllowlist: inputs.nativeAllowlist(), previousRoomId: roleKey ? deps.bench.lastRoleRoom(group.id, roleKey) : undefined });
  if (pick.kind === 'unavailable' || !roleKey) {
    if (pick.kind !== 'unavailable') throw new BenchError('崗位無效。', false, 'ROLE_UNKNOWN');
    const available = pick.available.length ? pick.available.map(key => '@' + key).join('、') : '無';
    const hint = `本群可用：${available}。也可用 Session ID 指名。`;
    if (pick.cause !== 'no-eligible' || !roleKey) throw new BenchError(`找不到這個崗位。${hint}`, false, 'ROLE_UNKNOWN');
    const reasons: Record<RoleRejectReason, string> = {
      self: '自己', unavailable: '房間未載入', inactive: '已封存或刪除', unverified: 'Session 未核實',
      waiting: '等待審批或回答', 'approval-mode': '逐項審批或模式未知',  'low-quota': '額度低於下限',
    };
    const why = pick.rejected.map(({ roomId, reason, quota }) =>
      `${rooms.get(roomId)?.room.roomName ?? roomId}：${reasons[reason]}${quota ? '，' + routeQuotaText(quota) : ''}`).join('；');
    throw new BenchError(`@${roleKey} 暫無合資格房${why ? '（' + why + '）' : ''}。${hint}`, true, 'ROLE_NO_ELIGIBLE');
  }
  const route: RoleRouteReceipt = { roleKey, groupId: group.id, selectedRoomId: pick.room.id, rule: pick.rule, ...pick.quota };
  return { room: pick.room, party: partyOf(pick.room), notes: [], route };
}

/** The RSI tidy goes to the group's Debug member; a group without one sends it to its lead. */
function tidyRoomId(group: GroupChat) {
  return group.members.find(member => groupRoleKey(member.role?.key) === 'debug')?.roomId ?? group.orchestratorRoomId;
}

/** The original native recipient must still hold the tidy role (Debug member, else the crown). */
function currentTidyRecipient(deps: BenchDeps, ticket: Ticket, room: TerminalRoom, group = deps.groups().find(item => item.id === ticket.groupId)) {
  return isSystemSender(ticket.from) && ticket.from.system === 'rsi-tidy' && ticket.kind === 'task' &&
    Boolean(group && tidyRoomId(group) === room.id && memberOf(group, room)) &&
    ticket.fixed?.toRoomId === room.id && ticket.to.sessionId === room.sessionId && ticket.to.modelId === room.modelId;
}

/** A fixed ticket can wake only its exact room. The stall check uses already-read tickets. */
function fixedRecipient(deps: BenchDeps, ticket: Ticket, phase: 'start' | 'input' | 'submit' | 'hook' | 'stall') {
  const inputs = deps.roleRouting;
  const fixed = ticket.fixed;
  if (!inputs || !fixed || ticket.status !== (phase === 'stall' ? 'seen' : 'new')) return;
  const group = deps.groups().find(item => item.id === ticket.groupId);
  if (!group) return;
  const rooms = deps.rooms();
  const to = rooms.find(item => item.id === fixed.toRoomId);
  const from = rooms.find(item => item.id === fixed.fromRoomId);
  if (!to || !memberOf(group, to) || !matchesParty(to, ticket.to)) return;
  if (isSystemSender(ticket.from)) {
    if (!deps.bench.tidyEnabled(group.id) || !currentTidyRecipient(deps, ticket, to, group)) return;
  } else if (!from || !memberOf(group, from) || sameRoleIdentity(from, to) || !matchesParty(from, ticket.from)) return;
  // Routed originals used a verified native ID. Do not accept even an alias after it changes.
  if (ticket.route && (ticket.route.selectedRoomId !== to.id || ticket.route.groupId !== group.id || ticket.to.sessionId !== to.sessionId)) return;
  const { inactive, auto, verifiedSession, working } = inputs.state(to);
  if (inactive || !auto || !verifiedSession || !to.sessionId || !nativeSession.test(to.sessionId) ||
      (!to.live && !to.resumable) || to.pendingApproval || to.pendingQuestion || to.status === 'waiting_approval') return;
  if ((phase === 'input' || phase === 'submit' || phase === 'stall') && (!to.live || to.menu)) return;
  if (ticket.route?.roleKey === 'native-test') {
    if ((phase === 'start' || phase === 'input' || (phase === 'hook' && !ticket.wokenAt)) &&
        // A busy room still takes the ticket; the ticket waits its turn. The ones queued behind it do not hold it up, only work in progress and older queued tickets do.
        (working || hasNativeTestAhead(deps, to, ticket) || (to.live && !(to.ready && to.status === 'idle')))) return;
  }
  return to;
}

function boardRevision(path: string): string | undefined {
  try {
    // Read only a bounded header. A path to a FIFO must not stall the Bridge.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) return;
      const head = Buffer.alloc(Math.min(info.size, 64 * 1024));
      const bytes = readSync(fd, head, 0, head.length, 0);
      const lines = head.toString('utf8', 0, bytes).split(/\r\n?|\n/);
      // A clipped line cannot establish a complete revision token.
      if (bytes < info.size) lines.pop();
      const rev = lines.slice(0, 40).join('\n').match(/^Rev:\s*(\S+)/m)?.[1];
      return rev && rev.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(rev) ? rev : undefined;
    } finally { closeSync(fd); }
  } catch { return undefined; }
}

function taskBodyWithBoard(body: string, shared: GroupChat[], preserveBody = false) {
  if (!body.trim() || /^[ \t\u3000]*告示版：/m.test(body)) return body;
  const path = shared.find(group => group.boardPath)?.boardPath;
  if (!path) return body;
  const line = `告示版：${path}。Rev ${boardRevision(path) ?? '未知'}。開工前讀一次。Rev 有變就重讀。`;
  if (preserveBody && `${body.replace(/\r\n?/g, '\n').trim()}\n${line}`.length > benchLimits.body) return body;
  // Keep the metadata line intact within the same body limit as other tickets.
  return `${body.replace(/\r\n?/g, '\n').trim().slice(0, benchLimits.body - line.length - 1).trimEnd()}\n${line}`;
}

/** How a ticket reaches its recipient: through its hook while it works, a wake-up message while it is idle, or held past the hourly limit. */
function deliver(deps: BenchDeps, ticket: Ticket, fromRoom: TerminalRoom): Pick<Result, 'lines' | 'ping' | 'wake'> {
  const target = ticket.fixed ? fixedRecipient(deps, ticket, 'start') : roomOf(deps, ticket.to.sessionId);
  if (ticket.fixed && !target) {
    return { lines: [`工單 #${ticket.id} 已存，但原收件房不可喚醒。工單仍留在原工作台。`] };
  }
  const working = Boolean(target?.live && !target.ready && target.benchHooked);
  if (working) {
    return { lines: [`已放入 ${partyName(ticket.to)} 的工作台（#${ticket.id}）。對方工作中，下一步會自動收到，毋須等候。`] };
  }
  const wakeId = deps.bench.reservePing(target ? keysOf(target) : [ticket.to.sessionId], [ticket.id], !ticket.fixed);
  if (!wakeId) {
    return { lines: [`已放入 ${partyName(ticket.to)} 的工作台（#${ticket.id}），但對方本小時提示已達上限，暫時不叫醒。對方下次工作時會收到；急的話請 Founder 處理。`] };
  }
  return {
    lines: [`已放入 ${partyName(ticket.to)} 的工作台（#${ticket.id}），正在叫醒對方。`],
    ...(ticket.fixed ? { wake: { roomId: ticket.fixed.toRoomId, ticket: ticket.id, wakeId } } :
      { ping: { to: ticket.to.sessionId, from: fromRoom.roomName, text: pingText(ticket, deps.tool), ticket: ticket.id } }),
  };
}

function listLine(ticket: Ticket) {
  const state = ticket.status === 'new' ? '新' : ticket.status === 'seen' ? '已讀' : '完成';
  return `#${ticket.id} [${state}] ${partyName(ticket.from)} → ${partyName(ticket.to)}：${ticket.title}`;
}

type BenchRequest = Record<string, unknown> & { requestId: string; action: string };

/** Only the local CLI supplies a caller directory. Failed verification leaves the ordinary claim usable. */
export async function benchRequest(deps: BenchDeps, event: BenchRequest): Promise<Result> {
  if (event.action === 'send' && event.worktree !== undefined) {
    const held = benchAction(deps, event);
    if (!held.ok || !held.provision) return held;
    const { ticketId, fromRoomId, toRoomId } = held.provision;
    let ready: Ticket;
    let path: string;
    try {
      const ticket = deps.bench.get(ticketId)!;
      const checkout = await deps.createWorktree!(ticketId, ticket.worktree!.source, ticket.ref);
      ready = deps.bench.finishWorktree(ticketId, toRoomId, checkout);
      path = checkout.path;
    } catch (error) {
      const reason = error instanceof Error && !('cmd' in error) ? error.message : '建立失敗，請檢查 Bridge worktree 記錄。';
      try { deps.bench.finishWorktree(ticketId, toRoomId, { error: reason }); } catch { /* Keep the pending ticket and reservation. */ }
      return { type: 'BENCH_RESULT', requestId: event.requestId, ok: false, lines: [`工單 #${ticketId} 的 worktree 未完成，工單未送出：${reason}。請先檢查現場；如需取消，派單者可用 bench cancel ${ticketId}。`] };
    }
    if (ready.status === 'done') return { ...held, provision: undefined, lines: [`工單 #${ticketId} 已結束；worktree 保留待檢查：${path}`] };
    try {
      const sender = deps.rooms().find(room => room.id === fromRoomId);
      deps.note(toRoomId, `工作台 #${ticketId}：${partyName(ready.from)} → ${partyName(ready.to)}「${ready.title}」`);
      deps.flow?.(fromRoomId, toRoomId, 'task', ticketId);
      const delivery = sender ? deliver(deps, ready, sender) : { lines: [`工單 #${ticketId} 已準備好，原派單房未找到；工單留在工作台。`] };
      return { ...held, provision: undefined, lines: [`worktree：${path}`, ...delivery.lines], ...(delivery.ping ? { ping: delivery.ping } : {}), ...(delivery.wake ? { wake: delivery.wake } : {}) };
    } catch {
      return { type: 'BENCH_RESULT', requestId: event.requestId, ok: true, lines: [`工單 #${ticketId} 已準備好但未能叫醒，仍留在工作台：${path}`] };
    }
  }
  if (event.action === 'done-checked') {
    try {
      const { room } = party(deps, event.from, '收件房');
      const ticket = deps.bench.get(Number(event.id));
      if (!ticket || !keysOf(room).includes(ticket.to.sessionId) || (ticket.fixed && ticket.fixed.toRoomId !== room.id) ||
          ticket.kind !== 'task' || (isSystemSender(ticket.from) && !currentTidyRecipient(deps, ticket, room))) {
        throw new Error('只可提交自己工單嘅驗收記錄。');
      }
      const { note, receipt } = acceptanceOptions(String(event.note));
      const report = JSON.parse(note);
      const { commit, branch } = report;
      const cwd = ticket.repo || room.repoPath;
      const git = (...args: string[]) => {
        if (!cwd || !isAbsolute(cwd)) throw new Error('找不到工單 repo。');
        return promisify(execFile)('git', ['-C', cwd, ...args], { timeout: 3000 });
      };
      if (commit && (await git('cat-file', '-t', commit)).stdout.trim() !== 'commit') throw new Error('SHA 未對應到 commit。');
      if (branch) {
        const ref = 'refs/heads/' + branch;
        await git('check-ref-format', ref);
        await git('show-ref', '--verify', '--quiet', ref);
        if (commit) await git('merge-base', '--is-ancestor', commit, ref);
      }
      return benchAction(deps, { ...event, action: 'done', note: JSON.stringify({ report, review: 'pending', verification: 'Bridge 已核對基本資料，正式驗收待 Reviewer／Owner 判定。' }), receipt }, undefined, report.result);
    } catch (error) {
      const reason = error instanceof Error && !('cmd' in error) ? error.message : '工單 repo 無法核實 SHA、分支或所屬關係。';
      return { type: 'BENCH_RESULT', ok: false, requestId: event.requestId, lines: [reason] };
    }
  }
  if (event.action !== 'claim' || typeof event.claimCwd !== 'string') return benchAction(deps, event);
  const cwd = event.claimCwd;
  let checkout: { roomId: string; repoPath: string; path: string } | undefined;
  try {
    const { room } = party(deps, event.from, '你自己的房（--from）');
    const path = await claimedWorktree(room.repoPath, cwd);
    if (path) checkout = { roomId: room.id, repoPath: room.repoPath, path };
  } catch { /* the claim still works without a verified checkout */ }
  return benchAction(deps, event, checkout);
}

/** A reply can still need attention, but cannot hold back the last task's closeout reminder. */
function isLastLeadTask(deps: BenchDeps, ticket: Ticket | undefined) {
  if (!ticket || ticket.kind !== 'task' || ticket.status === 'done' || isSystemSender(ticket.from)) return false;
  const group = deps.groups().find(item => item.id === ticket.groupId);
  const lead = group?.orchestratorRoomId && deps.rooms().find(room => room.id === group.orchestratorRoomId);
  if (!group || !lead || !memberOf(group, lead) || !matchesParty(lead, ticket.from) ||
      (ticket.fixed && ticket.fixed.fromRoomId !== lead.id)) return false;
  return !keysOf(lead).some(key => deps.bench.openFrom(key).some(other => other.groupId === group.id &&
    other.id !== ticket.id && !isSystemSender(other.from) && other.from.modelId === lead.modelId &&
    (!other.fixed || other.fixed.fromRoomId === lead.id)));
}

/** One workbench request from `komorebi-room bench …`. */
export function benchAction(deps: BenchDeps, event: BenchRequest, checkout?: { roomId: string; repoPath: string; path: string }, checked?: AcceptanceResult): Result {
  const result = (lines: string[], extra: Partial<Result> = {}): Result => ({ type: 'BENCH_RESULT', requestId: event.requestId, ok: true, lines, ...extra });
  try {
    const me = party(deps, event.from, '你自己的房（--from）');
    const mine = (id: unknown) => {
      const ticket = deps.bench.get(Number(id));
      if (!ticket) throw new BenchError(`找不到工單 #${String(id)}。`);
      if (isSystemSender(ticket.from) && !currentTidyRecipient(deps, ticket, me.room)) throw new BenchError(`工單 #${ticket.id} 與你無關。`);
      if (![ticket.from.sessionId, ticket.to.sessionId].some(key => key !== undefined && keysOf(me.room).includes(key))) throw new BenchError(`工單 #${ticket.id} 與你無關。`);
      if ((ticket.worktree?.state === 'pending' || ticket.worktree?.state === 'failed') && keysOf(me.room).includes(ticket.to.sessionId)) {
        throw new BenchError(`工單 #${ticket.id} 的 worktree 尚未準備好。`);
      }
      return ticket;
    };
    switch (event.action) {
      case 'send': {
        if (event.worktree !== undefined && (event.worktree !== 'new' || !deps.createWorktree || event.notify === true || event.replyTo !== undefined || !isAbsolute(text(event.repo) ?? ''))) {
          throw new BenchError('新 worktree 只適用於指定絕對 repo 路徑的新工單。');
        }
        const query = text(event.to)?.trim() ?? '';
        const byRole = query.startsWith('@') && query.toLowerCase() !== '@orchestrator';
        if (byRole && (event.replyTo !== undefined || event.notify === true)) {
          throw new BenchError('只能按崗位發出新的工單。回覆及通知請指名。', false, 'ROLE_NEW_TASK_ONLY');
        }
        const parent = event.replyTo === undefined ? undefined : deps.bench.get(Number(event.replyTo));
        if (parent && isSystemSender(parent.from)) throw new BenchError('Bridge 工單不接受回覆；請用完成記錄回報。');
        const fixedParent = parent?.fixed;
        let group = requestedGroup(deps, me.room, event.groupId, byRole);
        if (parent && fixedParent && !isSystemSender(parent.from)) {
          if (group && group.id !== parent.groupId) throw new BenchError('這張工單屬於另一個群組。', false, 'ROLE_GROUP_INVALID');
          group = requestedGroup(deps, me.room, parent.groupId);
        }
        const picked = byRole ? selectRoleRecipient(deps, me.room, group!, query) : undefined;
        const selfGate = event.notify === true && event.source === 'verify-gate' && event.replyTo === undefined && keysOf(me.room).includes(query);
        let to = picked ?? (selfGate ? { room: me.room, party: me.party, notes: [] } : recipient(deps, me.room, event.to, group, Boolean(fixedParent)));
        let sender = me.party;
        let fixed: Ticket['fixed'] = picked ? { fromRoomId: me.room.id, toRoomId: picked.room.id } : undefined;
        if (parent && fixedParent && !isSystemSender(parent.from)) {
          const isSender = me.room.id === fixedParent.fromRoomId && matchesParty(me.room, parent.from);
          const isRecipient = me.room.id === fixedParent.toRoomId && matchesParty(me.room, parent.to);
          const other = isSender ? parent.to : parent.from;
          const otherId = isSender ? fixedParent.toRoomId : fixedParent.fromRoomId;
          if ((!isSender && !isRecipient) || to.room.id !== otherId || !matchesParty(to.room, other)) {
            throw new BenchError(`工單 #${parent.id} 已固定收件人，請用原來的 Session ID。`);
          }
          sender = isSender ? parent.from : parent.to;
          to = { ...to, party: other };
          fixed = { fromRoomId: me.room.id, toRoomId: to.room.id };
        }
        const shared = (group ? [group] : groupsOf(deps, me.room)).filter(item => memberOf(item, to.room));
        if (!shared.length) throw new BenchError(`${partyName(to.party)} 與你不在同一個群組。工作台只限同組成員。`, true);
        // Check before sending that what the receiver is told to read is there (for example a checkout still running).
        const required = Array.isArray(event.requirePaths) ? event.requirePaths.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
        for (const wanted of required) {
          if (!isAbsolute(wanted) && !text(event.repo)) throw new BenchError(`派單前核對：相對路徑「${wanted}」要配 --repo 才知道喺邊度。`);
          const full = isAbsolute(wanted) ? wanted : join(text(event.repo) as string, wanted);
          if (!existsSync(full)) throw new BenchError(`派單前核對：找不到 ${full}。工單未送出；請等 checkout 或建檔完成後再派。`);
        }
        const body = text(event.body) ?? '';
        // Copy the selected member's direction into the new routed task. This is a
        // snapshot: later changes to the group never rewrite already sent tickets.
        const direction = picked?.route?.roleKey && event.notify !== true && event.replyTo === undefined
          ? shared[0].members.find(member => member.roomId === to.room.id && member.modelId === to.room.modelId)?.role?.direction
          : undefined;
        const repo = text(event.repo)?.replace(/\r\n?/g, '\n').trim().slice(0, benchLimits.field);
        const newTask = event.notify !== true && event.replyTo === undefined;
        const taskBody = !newTask ? body : taskBodyWithBoard(body, shared, Boolean(repo));
        // Stored role metadata must remain canonical even when injected through an
        // unexpected in-memory source. A malformed block must not be dispatched.
        if (direction && normalizeRoleDirection(direction) !== direction) {
          throw new BenchError('崗位工作方向無效，請重新設定。');
        }
        const directionHeader = '❤️ 崗位工作方向（Founder 設定，至下方 ❤️ 為止）：只影響觀點和重點，不改權限；與工單或 Founder 指示衝突時，以後者為準。';
        // Prefix even empty lines, so task-like content cannot become an unquoted
        // header or authority line within the direction block.
        const quotedDirection = direction?.split('\n').map(line => `｜ ${line}`).join('\n');
        let combined = direction && body.trim() ? `${directionHeader}\n${quotedDirection}\n❤️\n\n${taskBody}` : taskBody;
        // Never silently discard part of the original task to make room for a direction.
        if (direction && combined.replace(/\r\n?/g, '\n').trim().length > benchLimits.body) {
          throw new BenchError('工單連同崗位工作方向過長，請縮短工單。');
        }
        if (newTask && repo && body.trim()) {
          const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
          // A new worktree's final path is assigned after this ticket is saved.
          const targetRepo = event.worktree === 'new' ? '<工單 repo 一欄嘅路徑>' : quote(repo);
          const background = to.room.modelId === 'CODEX' ? '全套可用 --background --from <你>，之後結束該輪等通知；' : '';
          const hint = `🛠 加速工具：讀 code 先用 ${quote(deps.tool)} task-context --repo ${targetRepo} --bench <本單編號> --from <你>；中途 verify-gate 可用 --test-changed；${background}commit／push 前用 ${quote(deps.tool)} verify-gate --repo ${targetRepo} --base <SHA> --lint "<cmd>" --test "<cmd>"，成功先用 && 接 push。`;
          // Do not drop any task text to fit optional guidance.
          if (`${combined.replace(/\r\n?/g, '\n').trim()}\n\n${hint}`.length <= benchLimits.body) combined = `${combined.trimEnd()}\n\n${hint}`;
        }
        const ticket = deps.bench.send({
          groupId: shared[0].id, from: sender, to: to.party,
          title: text(event.title)?.trim() || (direction ? body.replace(/\r\n?/g, '\n').trim().split('\n')[0] : undefined),
          route: picked?.route, fixed,
          body: combined,
          ...(event.notify === true ? { kind: 'notice' as const } : {}),
          ...(selfGate ? { source: 'verify-gate' as const } : {}),
          replyTo: event.replyTo === undefined ? undefined : Number(event.replyTo),
          repo: text(event.repo), ref: text(event.ref), boundary: text(event.boundary), receipt: text(event.receipt),
          ...(event.worktree === 'new' ? { worktree: { state: 'pending' as const, source: text(event.repo)! } } : {}),
        });
        if (ticket.worktree?.state === 'pending') return result([], { provision: { ticketId: ticket.id, fromRoomId: me.room.id, toRoomId: to.room.id } });
        deps.note(to.room.id, `工作台 #${ticket.id}：${partyName(ticket.from)} → ${partyName(ticket.to)}「${ticket.title}」`);
        deps.flow?.(me.room.id, to.room.id, 'task', ticket.id);
        const warning = ticket.kind === 'task' && ticket.body.length > benchLimits.shortChars && (!ticket.repo || !ticket.boundary)
          ? ['提示：較長的任務最好寫明 --repo／--ref、--boundary（可改範圍）同 --receipt（回報位置），免得對方讀錯地方或撞工。'] : [];
        const delivery = deliver(deps, ticket, me.room);
        const receipt = roleReceipt(ticket);
        return result([...to.notes, ...(receipt ? [receipt] : []), ...delivery.lines, ...warning], {
          ...(delivery.ping ? { ping: delivery.ping } : {}), ...(delivery.wake ? { wake: delivery.wake } : {}),
          ...(ticket.route ? { route: ticket.route } : {}),
        });
      }
      case 'pinged': {
        const ticket = mine(event.id);
        deps.bench.ackLegacyPing(ticket, event.ok === true);
        return result([]);
      }
      case 'wake-release': {
        const ticket = mine(event.id);
        const wakeId = text(event.wakeId);
        if (ticket.fixed && wakeId && !isSystemSender(ticket.from) && ticket.fixed.fromRoomId === me.room.id && matchesParty(me.room, ticket.from) &&
            deps.bench.hasPing(wakeId, ticket.id)) deps.bench.finishPing(wakeId, false);
        return result([]);
      }
      case 'mine': {
        const tickets = keysOf(me.room).flatMap(key => deps.bench.mine(key)).filter(ticket => !isSystemSender(ticket.from) ||
          currentTidyRecipient(deps, ticket, me.room)).sort((a, b) => a.id - b.id);
        return result(tickets.length ? tickets.map(listLine) : ['工作台冇未完成的工單。']);
      }
      case 'show': {
        const ticket = mine(event.id);
        if (keysOf(me.room).includes(ticket.to.sessionId)) deps.bench.markSeen(ticket.id);
        return result([ticketText(ticket, deps.tool), ...(ticket.receiptProof ? [receiptNow(ticket.receiptProof)] : [])]);
      }
      case 'lesson-pending': {
        const ticket = mine(event.id);
        const group = deps.groups().find(item => item.id === ticket.groupId);
        if (!group || !memberOf(group, me.room) || ticket.to.modelId !== me.room.modelId ||
            ticket.to.sessionId !== (me.room.sessionId ?? me.room.id) || (ticket.fixed && ticket.fixed.toRoomId !== me.room.id)) {
          throw new BenchError('只可登記自己收到嘅群組原工單。');
        }
        const added = deps.bench.markPendingLesson(ticket.id);
        return result([added ? `#${ticket.id} 已登記待審 lesson。` : `#${ticket.id} 已有待審 lesson 登記。`]);
      }
      case 'done': {
        const original = deps.bench.get(Number(event.id));
        if (original && isSystemSender(original.from) && !currentTidyRecipient(deps, original, me.room)) {
          throw new BenchError(`工單 #${original.id} 不是派給你的。`);
        }
        if (original?.fixed && (me.room.id !== original.fixed.toRoomId || !matchesParty(me.room, original.to))) {
          throw new BenchError(`工單 #${original.id} 不是派給你的。`);
        }
        const addressed = original?.to.sessionId;
        const proof = proveReceipt(text(event.receipt));
        if (checked && (!proof || proof.state !== 'file' || !proof.sha256)) throw new BenchError('驗收證據須為可讀普通檔案，最大 20 MiB；可提交摘要並引用原始記錄。');
        const { ticket, notice } = deps.bench.done(Number(event.id), addressed && keysOf(me.room).includes(addressed) ? addressed : me.party.sessionId,
          text(event.note), text(event.receipt), proof, checked, isLastLeadTask(deps, original));
        if (ticket.kind === 'notice') return result([`通知 #${ticket.id} 已讀，自動結案，毋須再做任何事。`]);
        if (!isSystemSender(ticket.from)) for (const key of keysOf(me.room)) deps.bench.release(ticket.groupId, key);
        if (isSystemSender(ticket.from)) return result([`#${ticket.id} 已完成，結果已保存。`]);
        if (!notice) return result([`已將完成通知 #${ticket.id} 標為已讀。`]);
        const senderRoom = notice.fixed ? fixedRecipient(deps, notice, 'start') : roomOf(deps, notice.to.sessionId);
        if (senderRoom) deps.flow?.(me.room.id, senderRoom.id, 'done', ticket.id);
        if (senderRoom) deps.note(senderRoom.id, `工作台 #${ticket.id} 完成：${partyName(ticket.to)}${ticket.note ? `「${ticket.note.split('\n')[0].slice(0, 80)}」` : ''}`);
        const delivery = deliver(deps, notice, me.room);
        const message = notice.fixed ? `#${ticket.id} 已完成，通知已存入 ${partyName(notice.to)} 的工作台。`
          : `#${ticket.id} 已完成，並通知 ${partyName(notice.to)}。`;
        return result([message, ...(checked ? ['基本核對通過。正式驗收由 Reviewer 或 Owner 判定。'] : []), ...(proof ? [proofText(proof)] : []), ...(notice.fixed ? delivery.lines : delivery.lines.slice(1))], {
          ...(delivery.ping ? { ping: delivery.ping } : {}), ...(delivery.wake ? { wake: delivery.wake } : {}),
        });
      }
      case 'cancel': {
        const ticket = mine(event.id);
        const outcome = deps.bench.cancel(ticket.id, keysOf(me.room), text(event.note));
        if (!outcome) return result([`#${ticket.id} 已經結束，毋須取消。`]);
        const recipient = roomOf(deps, ticket.to.sessionId);
        if (recipient) deps.note(recipient.id, `工作台 #${ticket.id} 已被 ${partyName(ticket.from)} 取消「${ticket.title.slice(0, 60)}」`);
        return result([outcome.notice ? `#${ticket.id} 已取消；${partyName(ticket.to)} 已讀過，停手通知已放入對方工作台。` : `#${ticket.id} 已取消（對方未讀）。`]);
      }
      case 'claim': {
        const group = requestedGroup(deps, me.room, event.groupId) ?? groupsOf(deps, me.room)[0];
        if (!group) throw new BenchError('你的房不在任何群組，毋須認領。', true);
        const verified = checkout?.roomId === me.room.id && checkout.repoPath === me.room.repoPath ? checkout : undefined;
        const tasks = verified ? deps.bench.open(group.id).filter(ticket => ticket.kind === 'task' && ticket.status === 'seen' &&
          keysOf(me.room).includes(ticket.to.sessionId) && (!ticket.fixed || ticket.fixed.toRoomId === me.room.id)) : [];
        const claim = deps.bench.claim(group.id, me.party, text(event.scope) ?? '',
          verified && { roomId: me.room.id, path: verified.path, ticketId: tasks.length === 1 ? tasks[0].id : undefined });
        return result([`已認領「${claim.scope}」。完成工單時會自動釋放，亦可用 bench release。`]);
      }
      case 'release': {
        const chosen = requestedGroup(deps, me.room, event.groupId);
        const count = (chosen ? [chosen] : groupsOf(deps, me.room)).reduce((total, group) => total + keysOf(me.room).reduce((sum, key) => sum + deps.bench.release(group.id, key, text(event.scope)), 0), 0);
        return result([count ? `已釋放 ${count} 項認領。` : '冇需要釋放的認領。']);
      }
      case 'overview': {
        const lines = groupsOf(deps, me.room).flatMap(group => [
          `── ${group.name} ──`,
          ...deps.bench.claims(group.id).map(claim => `認領：${claim.scope}（${partyName(claim.by)}，${claim.at}）`),
          ...deps.bench.open(group.id).map(listLine),
        ]);
        return result(lines.length ? lines : ['你的房不在任何群組。']);
      }
      default: throw new BenchError(`未知的 bench 動作：${event.action}`);
    }
  } catch (error) {
    const stop = error instanceof BenchError && error.stop;
    // Only what the Founder has to decide reaches the open pages; a refused route or a wrong group is for the sending agent.
    if (stop && error instanceof BenchError && error.toast) deps.notice(`工作台已停止：${error.message}`);
    return { type: 'BENCH_RESULT', requestId: event.requestId, ok: false, stop,
      ...(error instanceof BenchError && error.code ? { errorCode: error.code } : {}),
      lines: [error instanceof Error ? error.message : '工作台出錯。'] };
  }
}

/**
 * The crown's final report says the run is DONE: every task or reply it sent in this group that is still open is called off,
 * so no member keeps working on it and nothing waits for the three-hour close. Returns the cancelled ticket ids.
 */
/** The tickets the lead sent that a member still works on. */
export function openLeadTickets(deps: BenchDeps, groupId: string, lead: TerminalRoom) {
  const keys = keysOf(lead);
  return deps.bench.open(groupId).filter(ticket => (ticket.kind === 'task' || ticket.kind === 'reply') && !isSystemSender(ticket.from) && keys.includes(ticket.from.sessionId));
}

export function cancelLeadTickets(deps: BenchDeps, groupId: string, lead: TerminalRoom): number[] {
  const keys = keysOf(lead);
  const cancelled: number[] = [];
  for (const ticket of openLeadTickets(deps, groupId, lead)) {
    try {
      if (!deps.bench.cancel(ticket.id, keys, '隊長已交最後報告（RESULT — DONE）', 'lead_final_report')) continue;
    } catch { continue; }
    cancelled.push(ticket.id);
    const recipient = roomOf(deps, ticket.to.sessionId);
    if (recipient) deps.note(recipient.id, `工作台 #${ticket.id} 已由 Bridge 取消：隊長已交最後報告。`);
  }
  if (cancelled.length) deps.note(lead.id, `Bridge 已取消你派出但未完成的工單：${cancelled.map(id => `#${id}`).join('、')}（最後報告為 DONE）。`);
  return cancelled;
}

type FixedWakeEvent = Extract<ClientEvent, { type: 'BENCH_WAKE' }>;
type WakeInputPhase = 'paste' | 'submit';
type WakeRooms = (event: Extract<ClientEvent, { type: 'START' | 'INPUT' }>, reply: (event: ServerEvent) => void,
  options: { stillWanted?: () => boolean; authorizeBenchInput?: (phase: WakeInputPhase) => boolean }) => Promise<unknown>;

/** Recognize the legacy workbench envelope without changing its on-wire shape or normal handoff. */
export function legacyBenchInputGuard(deps: BenchDeps, roomId: string, value: unknown, connected: () => boolean) {
  if (typeof value !== 'string') return;
  const match = /^(\[交接｜來自 [^\n]*?\] )\[工作台 #(\d+)/.exec(value);
  const ticket = match && deps.bench.get(Number(match[2]));
  if (!ticket || ticket.fixed || value.slice(match![1].length) !== pingText(ticket, deps.tool)) return;
  return () => {
    const room = deps.rooms().find(candidate => candidate.id === roomId);
    const group = deps.groups().find(candidate => candidate.id === ticket.groupId);
    const state = room && deps.roleRouting?.state(room);
    return Boolean(connected() && room?.live && group && memberOf(group, room) && matchesParty(room, ticket.to) &&
      ticket.status === 'new' && deps.bench.hasLegacyPing(keysOf(room), ticket.id) &&
      !room.pendingApproval && !room.pendingQuestion && !room.menu &&
      !state?.inactive && (state?.auto ?? room.autoMode) === true);
  };
}

/** Both phases re-read the stored ticket and live room; the client cannot provide a prompt or a successor. */
export async function runFixedBenchWake(
  deps: BenchDeps, scope: Scope | undefined, event: FixedWakeEvent, handle: WakeRooms,
  reply: (event: ServerEvent) => void, connected: () => boolean,
) {
  const refused = '不能喚醒已固定的工單。原工單仍留在工作台。';
  if (scope !== 'local') throw new Error('工作台只供本機 agent 使用。');
  if (!Number.isSafeInteger(event.ticket) || typeof event.wakeId !== 'string' || event.wakeId.length !== 36 ||
      typeof event.roomId !== 'string' || typeof event.requestId !== 'string' || !event.requestId || event.requestId.length > 64 ||
      (event.phase !== 'start' && event.phase !== 'input')) throw new Error(refused);
  const current = (phase: 'start' | 'input' | 'submit') => {
    if (!connected() || !deps.bench.hasPing(event.wakeId, event.ticket)) return;
    const ticket = deps.bench.get(event.ticket);
    if (!ticket || ticket.fixed?.toRoomId !== event.roomId || !fixedRecipient(deps, ticket, phase)) return;
    return ticket;
  };
  const ticket = current(event.phase);
  if (!ticket) throw new Error(refused);
  if (event.phase === 'start') {
    await handle({ type: 'START', roomId: event.roomId }, reply, { stillWanted: () => Boolean(current('start')) });
    return;
  }
  if (!deps.bench.beginPingWrite(event.wakeId, event.ticket)) throw new Error(refused);
  const text = pingText(ticket, deps.tool);
  try {
    await handle({ type: 'INPUT', roomId: event.roomId, text, requestId: event.requestId }, eventReply => {
      if (eventReply.type === 'ACTION_RESULT') {
        try { deps.bench.finishPing(event.wakeId, eventReply.ok, pingCarriesTicket(ticket) ? [ticket.id] : []); }
        catch { deps.notice('工作台未能保存喚醒記錄；請檢查 Mac 上的設定檔。'); }
      }
      reply(eventReply);
    }, { authorizeBenchInput: phase => Boolean(current(phase === 'paste' ? 'input' : 'submit')) });
  } catch (error) {
    deps.bench.finishPing(event.wakeId, false);
    throw error;
  }
}

const MAX_BYTES = 1800; // Leave space for the hook JSON envelope and escaping.
const compact = (value: string | undefined, max = 120) => {
  const clean = (value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
};

function checkout(ticket: Ticket): string {
  const repo = ticket.worktree?.path ?? ticket.repo;
  if (!repo || !isAbsolute(repo)) return 'checkout: not recorded';
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args], {
    encoding: 'utf8', timeout: 200, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();
  try {
    const head = git('rev-parse', '--verify', 'HEAD');
    const status = git('status', '--porcelain=v1');
    return `HEAD ${head}; changed paths ${status ? status.split('\n').length : 0}`;
  } catch { return 'checkout: unavailable'; }
}

function stopPoint(ticket: Ticket): string {
  const repo = ticket.worktree?.path ?? ticket.repo;
  if (!repo || !isAbsolute(repo) || !ticket.receipt || !/HANDOFF(?:-[^/]*)?\.md$/i.test(ticket.receipt)) return 'PLAN: not recorded';
  try {
    const base = realpathSync(repo);
    const handoff = isAbsolute(ticket.receipt) ? ticket.receipt : resolve(base, ticket.receipt);
    const plan = join(dirname(handoff), 'PLAN.md');
    const path = realpathSync(plan);
    const rel = relative(base, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !lstatSync(path).isFile() || lstatSync(path).size > 64 * 1024) return 'PLAN: unavailable';
    const file = readFileSync(path, 'utf8');
    const match = /(?:^|\n)#{1,6}\s*(?:stop point|where (?:we|i) stopped|停點|停止點)[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(file);
    const inline = /(?:^|\n)(?:\*\*)?(?:stop point|where (?:we|i) stopped|停點|停止點)(?:\*\*)?[:：]\s*([^\n]+)/i.exec(file);
    return match || inline ? `PLAN stop: ${compact((match ?? inline)![1], 180)}` : 'PLAN: stop section not found';
  } catch { return 'PLAN: unavailable'; }
}

/** Read only: never mark tickets seen or manufacture a missing boundary. */
function compactContext(room: TerminalRoom, groups: GroupChat[], mine: Ticket[], outgoing: Ticket[], project: string): string | undefined {
  const memberGroups = groups.filter(group => group.members.some(member => member.roomId === room.id && member.modelId === room.modelId));
  const ids = new Set(memberGroups.map(group => group.id));
  const assigned = mine.filter(t => t.kind === 'task' && ids.has(t.groupId));
  const sent = outgoing.filter(t => memberGroups.some(g => g.id === t.groupId && g.orchestratorRoomId === room.id));
  const all = [...new Map([...assigned, ...sent].map(t => [t.id, t])).values()];
  if (!all.length) return;
  const group = memberGroups.find(g => g.id === all[0].groupId)!;
  const role = group.orchestratorRoomId === room.id ? 'lead' : group.members.find(m => m.roomId === room.id)?.role?.key;
  const skills = bridgeConfig(process.env, project).skills;
  const guideNames = role === 'lead' ? ['lead-standard', 'lead-large'] : [role && isGroupRolePreset(role) ? `role-${role}` : 'member'];
  const guides = guideNames.map(name => join(skills, name, 'SKILL.md')).filter(existsSync);
  const lines = [`Live workbench: ${compact(room.roomName, 80)} (${room.modelId}; ${compact(room.sessionId, 80)}); role ${compact(role, 40) || 'not set'}.`,
    `Role guide: ${guides.length ? guides.join(' or ') : 'not found; check ticket'}${role === 'lead' ? ' (check task level)' : ''}`];
  let omitted = false;
  for (const ticket of all.slice(0, 4)) {
    const detail = [`#${ticket.id} ${compact(ticket.title, 100)}${sent.includes(ticket) && !assigned.includes(ticket) ? ' (sent)' : ''}`,
      `boundary: ${compact(ticket.boundary) || 'not separately recorded; read ticket'}`,
      `repo: ${compact(ticket.worktree?.path ?? ticket.repo, 160) || 'not recorded'}`,
      `handoff: ${compact(ticket.receipt, 160) || 'not recorded'}`,
      checkout(ticket), stopPoint(ticket)].join('\n');
    const suffix = '\nLive state above takes priority over the summary; recheck before acting.';
    if (Buffer.byteLength([...lines, detail].join('\n') + suffix) > MAX_BYTES) { omitted = true; break; }
    lines.push(detail);
  }
  if (omitted || all.length > 4) lines.push('Further tickets omitted; inspect workbench.');
  lines.push('Live state above takes priority over the summary; recheck before acting.');
  const result = lines.join('\n');
  return Buffer.byteLength(result) <= MAX_BYTES && Buffer.byteLength(JSON.stringify(hookOutput('claude', 'SessionStart', result))) <= 2048
    ? result : 'Live workbench has open tickets; inspect workbench for current state.';
}

type AgyLogCursor = { identity: string; offset: number; latest: number };
const agyLogCursors = new Map<string, AgyLogCursor>();

/** Read only appended complete JSONL lines; a partial line is retried at the next invocation. */
function agyLatestCheckpoint(session: string, path: unknown): number | undefined {
  if (typeof path !== 'string' || !isAbsolute(path)) return;
  let fd: number | undefined;
  try {
    const canonical = realpathSync(path);
    const key = `${session}\0${canonical}`;
    fd = openSync(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return;
    const identity = `${stat.dev}:${stat.ino}`;
    const previous = agyLogCursors.get(key);
    const cursor = previous?.identity === identity && previous.offset <= stat.size
      ? { ...previous } : { identity, offset: 0, latest: -1 };
    let start = cursor.offset;
    let pending = Buffer.alloc(0);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (start < stat.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - start), start);
      if (!count) return;
      start += count;
      pending = Buffer.concat([pending, buffer.subarray(0, count)]);
      let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        const line = pending.subarray(0, end).toString('utf8');
        cursor.offset += end + 1;
        pending = pending.subarray(end + 1);
        if (!line.includes('CHECKPOINT')) continue;
        try {
          const row = JSON.parse(line);
          if (row.type === 'CHECKPOINT' && row.status === 'DONE' && Number.isSafeInteger(row.step_index) && row.step_index >= 0)
            cursor.latest = Math.max(cursor.latest, row.step_index);
        } catch { /* An invalid record cannot prove a completed checkpoint. */ }
      }
      if (pending.length > 8 * 1024 * 1024) return;
    }
    agyLogCursors.set(key, cursor);
    return cursor.latest;
  } catch { return; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * A CLI hook asks whether its agent has new tickets: the answer is them, ready for that CLI to put in front of the agent,
 * or an empty answer (for a room outside the workbench, and for anything it cannot read, so a hook never breaks the CLI).
 */
export function benchHook(deps: BenchDeps, cli: string, body: unknown) {
  if (cli !== 'codex' && cli !== 'claude' && cli !== 'agy') return {};
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const session = text(cli === 'agy' ? input.conversationId : input.session_id);
  const event = text(cli === 'agy' ? input.hookEventName : input.hook_event_name) ?? 'PostToolUse';
  if (!session) return {};
  const room = deps.rooms().find(item => item.sessionId === session);
  if (event === 'SessionStart') {
    if ((cli !== 'claude' && cli !== 'codex') || input.source !== 'compact' || !room || room.modelId.toLowerCase() !== cli) return {};
    const keys = [...new Set([session, room.id])];
    return hookOutput(cli, event, compactContext(room, deps.groups(), keys.flatMap(key => deps.bench.mine(key)), keys.flatMap(key => deps.bench.openFrom(key)), dirname(dirname(deps.tool))));
  }
  let restored: string | undefined;
  if (cli === 'agy' && event === 'PreInvocation' && room?.modelId === 'AGY') {
    const latest = agyLatestCheckpoint(session, input.transcriptPath);
    if (latest !== undefined && deps.bench.agyCheckpoint(session, latest)) {
      const keys = [...new Set([session, room.id])];
      restored = compactContext(room, deps.groups(), keys.flatMap(key => deps.bench.mine(key)), keys.flatMap(key => deps.bench.openFrom(key)), dirname(dirname(deps.tool)));
    }
  }
  const tickets = [...new Set([session, ...(room ? [room.id] : [])])].flatMap(key =>
    deps.bench.takeNew(key, benchLimits.perInjection, ticket => !ticket.fixed ||
      (room?.modelId.toLowerCase() === cli && fixedRecipient(deps, ticket, 'hook')?.id === room.id))).slice(0, benchLimits.perInjection * 2);
  const parts = [...(restored ? [restored] : []), ...tickets.map(ticket => ticketText(ticket, deps.tool))];
  return hookOutput(cli, event, parts.length ? parts.join('\n\n') : undefined);
}


/**
 * A member came back to its prompt with tickets still unread (it finished before its hook could pass them on, or it was
 * busy without the hook): the wake-up message to send it now, or nothing. With the hook the message only names them and
 * the hook adds them in full; without it the tickets themselves go in the message.
 */
/**
 * A recipient whose CLI is closed holds tickets nobody has read. The sender's wake-up tries once, for about half a minute; when the
 * CLI is slow to come back that try is over and nothing else would ever start it. Say whether this closed room should be started now,
 * so the usual wake-up can reach it once it is back at its prompt. Each ticket gets a few such starts, spaced out, then it waits as before.
 */
export function startClosedRecipient(deps: BenchDeps, room: TerminalRoom): boolean {
  if (room.live || !room.resumable) return false;
  if (deps.roleRouting && deps.roleRouting.state(room).auto === false) return false;
  const now = deps.bench.time();
  const { unreadMs, nudges } = benchLimits.stall;
  const due = keysOf(room).flatMap(key => deps.bench.mine(key)).filter(ticket =>
    ticket.status === 'new' && (ticket.kind === 'task' || ticket.kind === 'reply' || (ticket.kind === 'done' && !ticket.completionRetriedAt)) && !ticket.expiredAt &&
    now - (Date.parse(ticket.createdAt) || 0) >= unreadMs && (ticket.nudges ?? 0) < (ticket.kind === 'done' ? 1 : nudges) &&
    (!ticket.nudgedAt || now - (Date.parse(ticket.nudgedAt) || 0) >= unreadMs) &&
    (!ticket.fixed || fixedRecipient(deps, ticket, 'start')?.id === room.id));
  if (!due.length) return false;
  deps.bench.recordNudge([...new Set(due.map(ticket => ticket.id))]);
  return true;
}

/**
 * The Bridge itself sends this ticket, so no CLI runs the fixed wake that `deliver` reserved for it. Release that reservation,
 * or the Bridge's own wake-up skips the ticket as already pending and the recipient waits for the unread retry.
 */
export function sendFromBridge(deps: BenchDeps, event: BenchRequest): Result {
  const result = benchAction(deps, event);
  if (result.ok && result.wake) deps.bench.finishPing(result.wake.wakeId, false);
  return result;
}

export function idleWake(deps: BenchDeps, room: TerminalRoom) {
  const session = room.sessionId ?? room.id;
  if (!room.live || !room.ready || room.pendingApproval || room.pendingQuestion || room.menu) return;
  let waiting = keysOf(room).flatMap(key => deps.bench.mine(key)).filter(ticket => ticket.status === 'new' &&
    !(ticket.kind === 'done' && ticket.completionRetriedAt) &&
    !deps.bench.pingPending(ticket.id) && (!ticket.fixed || fixedRecipient(deps, ticket, 'input')?.id === room.id));
  // Exempt notices still get through when ordinary work has filled the hourly quota.
  if (!deps.bench.pingAllowed(session, keysOf(room))) waiting = waiting.filter(ticket => ticket.kind === 'done' || ticket.kind === 'reply');
  if (!waiting.length) return;
  const wakeId = deps.bench.reservePing(keysOf(room), waiting.map(ticket => ticket.id));
  // At the hourly cap the tickets simply wait for the recipient's next hook; that is not the Founder's business.
  if (!wakeId) return;
  const completions = waiting.filter(ticket => ticket.kind === 'done').map(ticket => ticket.id);
  try { if (completions.length) deps.bench.markCompletionRetry(completions); }
  catch { deps.bench.finishPing(wakeId, false); return; }
  const full = !room.benchHooked && room.modelId !== 'CODEX';
  const text = full
    ? `[交接｜來自 工作台]\n${waiting.map(ticket => ticketText(ticket, deps.tool)).join('\n\n')}`
    : `[交接｜來自 工作台] 你的工作台有 ${waiting.length} 張新工單：${waiting.map(ticket => `#${ticket.id} ${ticket.title.split('\n')[0]}`).join('；')}。內容會自動附上；如未見到：${deps.tool} bench mine --from ${session}`;
  return {
    text,
    authorizeBenchInput: (phase: WakeInputPhase) => {
      const recipient = roomOf(deps, session);
      return Boolean(recipient?.id === room.id && recipient.live && !recipient.menu && !recipient.pendingApproval && !recipient.pendingQuestion &&
        waiting.every(ticket => ticket.status === 'new' && deps.bench.hasPing(wakeId, ticket.id) &&
          (!ticket.fixed || fixedRecipient(deps, ticket, phase === 'paste' ? 'input' : 'submit')?.id === room.id)));
    },
    finish: (ok: boolean) => {
      try { deps.bench.finishPing(wakeId, ok, full ? waiting.map(ticket => ticket.id) : []); }
      catch { deps.notice('工作台未能保存喚醒記錄；請檢查 Mac 上的設定檔。'); }
    },
  };
}

const stalledTicketsOf = (deps: BenchDeps, room: TerminalRoom) => keysOf(room).flatMap(key => deps.bench.mine(key)).filter(ticket => ticket.kind === 'task');
function stallQuietSince(bench: Bench, ticket: Ticket) {
  const reply = bench.lastRecipientReply(ticket);
  return Math.max(Date.parse(ticket.nudgedAt ?? ticket.seenAt ?? ticket.createdAt) || 0, reply ? Date.parse(reply) : 0);
}

/** A ticket nobody picked up (the first wake-up failed, and nothing since has changed the room) is delivered again. */
export function retryUnreadWake(deps: BenchDeps, room: TerminalRoom) {
  const cutoff = deps.bench.time() - benchLimits.stall.unreadMs;
  const old = keysOf(room).some(key => deps.bench.mine(key).some(ticket => ticket.status === 'new' && (Date.parse(ticket.createdAt) || 0) <= cutoff));
  return old ? idleWake(deps, room) : undefined;
}

/**
 * A member sat at its prompt for `idleFor` ms with a task it has read but not finished: remind it, at most `stall.nudges` times,
 * `stall.idleMs` apart. A member waiting for the Founder (approval, question, menu) is not stuck, so it is left alone.
 */
export function stalledWake(deps: BenchDeps, room: TerminalRoom, idleFor: number) {
  const { idleMs, nudges } = benchLimits.stall;
  if (!room.live || !room.ready || room.status !== 'idle' || room.pendingApproval || room.pendingQuestion || room.menu || idleFor < idleMs) return;
  const now = deps.bench.time();
  const tickets = stalledTicketsOf(deps, room).filter(ticket => ticket.status === 'seen' && (ticket.nudges ?? 0) < nudges &&
    now - stallQuietSince(deps.bench, ticket) >= idleMs && !deps.bench.pingPending(ticket.id) && (!ticket.fixed || fixedRecipient(deps, ticket, 'stall')?.id === room.id));
  if (!tickets.length) return;
  const wakeId = deps.bench.reservePing(keysOf(room), tickets.map(ticket => ticket.id));
  if (!wakeId) return;
  const ids = tickets.map(ticket => ticket.id);
  const list = tickets.map(ticket => `#${ticket.id}「${ticket.title.split('\n')[0].slice(0, 60)}」`).join('、');
  const session = room.sessionId ?? room.id;
  let pasted = false;
  return {
    text: `[交接｜來自 工作台] 工單提示：${list}仍未完成。請繼續做，或用 ${deps.tool} bench done <編號> --from ${session} --note "<結果或停點>" 交返；未完成要寫明停點。`,
    authorizeBenchInput: (phase: WakeInputPhase = 'paste') => {
      const recipient = roomOf(deps, session);
      // Typing the reminder marks the room busy until Enter, so the room must be idle before the paste only.
      const ok = Boolean(recipient?.id === room.id && recipient.live && !recipient.menu &&
        (phase !== 'paste' || (recipient.ready && recipient.status === 'idle')) &&
        !recipient.pendingApproval && !recipient.pendingQuestion &&
        tickets.every(ticket => ticket.status === 'seen' && deps.bench.hasPing(wakeId, ticket.id) &&
          deps.bench.time() - stallQuietSince(deps.bench, ticket) >= idleMs &&
          (!ticket.fixed || fixedRecipient(deps, ticket, 'stall')?.id === room.id)));
      if (ok && phase === 'paste') pasted = true;
      return ok;
    },
    finish: (ok: boolean) => {
      // A reminder that reached the input box counts even when Enter was refused: pasting it again every minute fills the box.
      try { deps.bench.finishPing(wakeId, ok); if (ok || pasted) deps.bench.recordNudge(ids); }
      catch { deps.notice('工作台未能保存喚醒記錄；請檢查 Mac 上的設定檔。'); }
    },
  };
}

/** A task that was reminded the full number of times and still sits unfinished is reported once: to the group lead's room and to the Founder. */
/**
 * A ticket nobody has read for as long as a stuck one is given (a closed recipient, or a wake-up that never got through) is
 * reported to the group's lead, once. This looks at the tickets, not the rooms, because the recipient may be closed.
 */
/** This entry point is internal to Bridge maintenance, never a public bench action. */
export function dispatchRsiTidy(deps: BenchDeps, groupId: string) {
  const group = deps.groups().find(item => item.id === groupId);
  const tidyId = group && tidyRoomId(group);
  const lead = tidyId && deps.rooms().find(room => room.id === tidyId);
  if (!group || !lead || !memberOf(group, lead) || !deps.roleRouting || !lead.sessionId || !nativeSession.test(lead.sessionId)) return;
  const state = deps.roleRouting.state(lead);
  if (state.inactive || !state.auto || !state.verifiedSession || (!lead.live && !lead.resumable) || lead.pendingApproval || lead.pendingQuestion || lead.status === 'waiting_approval') return;
  return deps.bench.dispatchTidy(groupId, partyOf(lead), lead.id);
}

export function escalateUnread(deps: BenchDeps): number[] {
  // This runs on the Bridge's maintenance tick even when no new work comes in.
  try { deps.bench.sweep(); } catch { return []; }
  const now = deps.bench.time();
  const { idleMs } = benchLimits.stall;
  const reported: number[] = [];
  for (const group of deps.groups()) {
    const lead = group.orchestratorRoomId ? deps.rooms().find(room => room.id === group.orchestratorRoomId) : undefined;
    for (const ticket of deps.bench.open(group.id)) {
      if (isSystemSender(ticket.from) || ticket.status !== 'new' || (ticket.kind !== 'task' && ticket.kind !== 'reply') || ticket.worktree?.state === 'pending' || ticket.worktree?.state === 'failed' || ticket.expiredAt || ticket.escalatedAt) continue;
      if (now - (Date.parse(ticket.createdAt) || 0) < idleMs) continue;
      const recipient = roomOf(deps, ticket.to.sessionId);
      if (!lead || recipient?.id === lead.id) continue;
      deps.bench.markEscalated(ticket.id);
      const state = !recipient ? '房已不在' : recipient.live ? 'CLI 已開但未讀' : 'CLI 未開';
      const line = `工單 #${ticket.id}「${ticket.title.slice(0, 60)}」：${partyName(ticket.to)} ${Math.round(idleMs / 60_000)} 分鐘仍未讀（${state}）。Bridge 已提示${ticket.nudges ? ` ${ticket.nudges} 次` : ''}；請隊長跟進，或請 Founder 開房。`;
      deps.note(lead.id, line);
      try {
        deps.bench.send({ groupId: group.id, from: ticket.to, to: partyOf(lead), kind: 'notice', title: `工單 #${ticket.id} 未被讀取`, body: line });
      } catch { /* The line above already shows it in the lead's room. */ }
      reported.push(ticket.id);
    }
  }
  return reported;
}

export function escalateStalled(deps: BenchDeps, room: TerminalRoom, idleFor: number) {
  const { idleMs, nudges } = benchLimits.stall;
  if (!room.live || !room.ready || room.status !== 'idle' || room.pendingApproval || room.pendingQuestion || room.menu || idleFor < idleMs) return [];
  const now = deps.bench.time();
  const stuck = stalledTicketsOf(deps, room).filter(ticket => !isSystemSender(ticket.from) && ticket.status === 'seen' && (ticket.nudges ?? 0) >= nudges && !ticket.escalatedAt &&
    now - stallQuietSince(deps.bench, ticket) >= idleMs);
  for (const ticket of stuck) {
    deps.bench.markEscalated(ticket.id);
    const line = `工單 #${ticket.id}「${ticket.title.slice(0, 60)}」：${partyName(ticket.to)} 已提示 ${nudges} 次仍未回應，不會再提示；超過 ${benchLimits.staleHours} 小時未完成就自動結案。`;
    const lead = deps.groups().find(group => group.id === ticket.groupId)?.orchestratorRoomId;
    if (lead && lead !== room.id) deps.note(lead, line);
    deps.notice(line);
  }
  return stuck.map(ticket => ticket.id);
}
