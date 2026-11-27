// Contents
// Group and roster definitions — Keep group records and roster messages consistent.
// Check group records — Keep invalid data out of groups.
// Save and load groups — Keep group changes on disk and give callers safe copies.
// Manage groups and members — Change which rooms belong together and how groups are ordered.
// Change the name or board — Keep the group's display settings up to date.
// Set roles and choose a lead — Give each room its responsibilities and directions.
// Share the roster — Give rooms the context they need to work together.

import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOrder } from '../src/utils/reorder';
import { validGroupBoardPath } from '../src/utils/groupBoard';
import { groupRosterPrefix } from '../src/utils/bridgeNote';
import type { CLIModelId, GroupChat, TerminalRoom } from '../src/types/guild';
import { groupRoleFromChoice, normalizeRoleDirection, savedGroupRole, type GroupMemberRole } from '../src/types/groupRoles';

// ── Group and roster definitions ─────────────────────────────────────
// These names and rules are shared when reading group records or preparing a roster.

export type GroupMember = GroupChat['members'][number];
export type { GroupChat };

export type ReserveRoster = () => { suffix: string; finish: (sent: boolean) => void } | undefined;

const models: CLIModelId[] = ['AGY', 'CODEX', 'CLAUDE'];
const labels: Record<CLIModelId, string> = { AGY: '瞳', CODEX: '光', CLAUDE: '響' };
const safeId = /^[A-Za-z0-9][\w-]{0,149}$/;
const validName = /^[\p{L}\p{N}][\p{L}\p{N} _.()\-]{0,79}$/u;
const sessionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// ── Check group records ──────────────────────────────────────────────
// These checks protect saved groups and changes made from the group menu.

function validMember(member: unknown): member is GroupMember {
  if (!member || typeof member !== 'object') return false;
  const candidate = member as GroupMember;
  return models.includes(candidate.modelId) && typeof candidate.roomId === 'string' && safeId.test(candidate.roomId);
}

function validGroup(value: unknown): value is GroupChat {
  if (!value || typeof value !== 'object') return false;
  const group = value as GroupChat;
  if (typeof group.id !== 'string' || !safeId.test(group.id) || typeof group.name !== 'string' || !validName.test(group.name) ||
      // A merged duplicate can leave one member; keep that group recoverable so another can be added.
      typeof group.createdAt !== 'string' || !Array.isArray(group.members) || group.members.length < 1 || group.members.length > 8 ||
      !group.members.every(validMember) ||
      new Set(group.members.map(member => member.roomId)).size !== group.members.length) return false;
  if (group.orchestratorRoomId !== undefined && (typeof group.orchestratorRoomId !== 'string' || !group.members.some(member => member.roomId === group.orchestratorRoomId))) return false;
  if (group.boardPath !== undefined && !validGroupBoardPath(group.boardPath)) return false;
  if (group.orchestratorDirection !== undefined && typeof group.orchestratorDirection !== 'string') return false;
  return group.rosterShared === undefined || group.rosterShared === true;
}

export class GroupMemberRoleError extends Error {
  constructor(readonly code: 'invalid' | 'missing' | 'repair' | 'conflict', message: string) { super(message); }
}

export class Groups {
  // ── Save and load groups ───────────────────────────────────────────
  // When the Bridge starts or a group changes, keep the in-memory groups and the saved file in sync.

  boardEnabled = true;
  private groups: GroupChat[] = [];
  private readable = true;
  private invalidRoles = false;

  private save(next: GroupChat[]) {
    if (!this.readable) throw new Error('無法讀取群組資料，請檢查 Mac 上的設定檔。');
    if (this.invalidRoles) throw new GroupMemberRoleError('repair', '群組檔案有無效的崗位。請先修復 Mac 上的群組設定檔。');
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      this.groups = next;
    } finally { try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ } }
  }

  private publish(next: GroupChat[], groupId: string) {
    this.save(next);
    const group = this.get(groupId);
    if (group) this.emit(group);
  }

  constructor(private readonly path: string, private readonly emit: (group: GroupChat) => void,
    private readonly getRoom: (roomId: string) => TerminalRoom | undefined,
    private readonly warn: (message: string, cause: 'repair' | 'conflict') => void = message => console.warn(message)) {
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(data) || !data.every(validGroup) || new Set(data.map(group => group.id)).size !== data.length) throw new Error('Invalid groups');
      // Copy only supported fields; legacy parent links are ignored until the next normal save.
      this.groups = data.map(({ id, name, members, createdAt, rosterShared, orchestratorRoomId, orchestratorCleared, orchestratorDirection, boardPath }) => ({
        id, name, createdAt, rosterShared,
        members: members.map(member => {
          const role = savedGroupRole(member.role);
          if ('role' in member && !role) this.invalidRoles = true;
          return { modelId: member.modelId, roomId: member.roomId, ...(role ? { role } : {}) };
        }),
        ...(orchestratorRoomId ? { orchestratorRoomId } : {}), ...(orchestratorCleared ? { orchestratorCleared } : {}),
        ...(orchestratorDirection && normalizeRoleDirection(orchestratorDirection) === orchestratorDirection ? { orchestratorDirection } : {}),
        ...(boardPath !== undefined ? { boardPath } : {}),
      }));
      if (this.invalidRoles) this.warn('群組檔案有無效的崗位。已顯示為未設定，原檔不會被覆寫。', 'repair');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.readable = false;
        console.error('無法讀取群組資料，請檢查', path);
      }
    }
  }

  isReadable() { return this.readable; }
  get rolesNeedRepair() { return this.invalidRoles; }

  visible(group: GroupChat) {
    const copy = structuredClone(group);
    if (!this.boardEnabled) delete copy.boardPath;
    return copy;
  }
  visibleSnapshot() { return this.groups.map(group => this.visible(group)); }
  snapshot() { return structuredClone(this.groups); }
  get(id: string) { const group = this.groups.find(item => item.id === id); return group && structuredClone(group); }

  // ── Manage groups and members ──────────────────────────────────────
  // Use this section when groups change order or rooms join, leave, or merge.

  private hasDuplicateSession(members: GroupMember[]) {
    const sessions = new Set<string>();
    for (const member of members) {
      const sessionId = this.getRoom(member.roomId)?.sessionId;
      if (!sessionId) continue;
      const key = `${member.modelId}\0${sessionId.toLowerCase()}`;
      if (sessions.has(key)) return true;
      sessions.add(key);
    }
    return false;
  }

  assertMember(groupId: string, roomId: string) {
    if (!this.groups.find(group => group.id === groupId)?.members.some(member => member.roomId === roomId)) {
      throw new Error('這間房已不在群組，請重新選擇收件房間。');
    }
  }

  create(name: string, members: GroupMember[]) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!validName.test(normalized) || !Array.isArray(members) || members.length < 2 || members.length > 8 ||
        !members.every(validMember) ||
        new Set(members.map(member => member.roomId)).size !== members.length || this.hasDuplicateSession(members) ||
        members.some(member => this.getRoom(member.roomId)?.modelId !== member.modelId)) {
      throw new Error('群組名稱或成員房間無效。');
    }
    const group: GroupChat = { id: randomUUID(), name: normalized, members: members.map(({ modelId, roomId }) => ({ modelId, roomId })),
      createdAt: new Date().toISOString() };
    this.publish([...this.snapshot(), group], group.id);
    return this.get(group.id)!;
  }

  addMember(groupId: string, member: GroupMember, rememberedRole?: GroupMemberRole) {
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group || !validMember(member) || this.getRoom(member.roomId)?.modelId !== member.modelId ||
        group.members.length >= 8 || group.members.some(item => item.roomId === member.roomId) ||
        this.hasDuplicateSession([...group.members, member])) {
      throw new Error('群組成員或房間無效。');
    }
    // Restore the member's own role and direction, even if no other member holds its custom key.
    const remembered = savedGroupRole(rememberedRole);
    const matching = remembered && group.members.find(item => item.role?.key === remembered.key)?.role;
    const role = remembered && matching?.label ? { ...remembered, label: matching.label } : remembered;
    group.members.push({ modelId: member.modelId, roomId: member.roomId, ...(role ? { role: { ...role } } : {}) });
    this.publish(next, groupId);
    return this.get(groupId)!;
  }

  /** Remove only the association; the native room and session stay untouched. */
  removeMember(groupId: string, roomId: string) {
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group || !group.members.some(member => member.roomId === roomId)) throw new Error('找不到這個群組成員。');
    if (group.members.length <= 1) throw new Error('群組至少要保留一間成員房。');
    group.members = group.members.filter(member => member.roomId !== roomId);
    if (group.orchestratorRoomId === roomId) delete group.orchestratorRoomId;
    this.publish(next, groupId);
    return this.get(groupId)!;
  }

  /** Follow a verified session-room merge without losing a now-single-member group. */
  replaceRoom(oldId: string, newId: string) {
    if (oldId === newId || !safeId.test(oldId) || !safeId.test(newId)) return 0;
    const replacement = this.getRoom(newId);
    if (!replacement) return 0;
    const next = this.snapshot();
    const changed: string[] = [];
    let roleConflict = false;
    for (const group of next) {
      const oldMember = group.members.find(member => member.roomId === oldId);
      if (!oldMember || oldMember.modelId !== replacement.modelId) continue;
      const existing = group.members.find(member => member.roomId === newId);
      if (existing && existing.modelId !== replacement.modelId) continue;
      if (existing) {
        if (!existing.role && oldMember.role) existing.role = oldMember.role;
        if (existing.role && oldMember.role && existing.role.key !== oldMember.role.key) roleConflict = true;
        group.members = group.members.filter(member => member.roomId !== oldId);
      } else oldMember.roomId = newId;
      if (group.orchestratorRoomId === oldId) group.orchestratorRoomId = newId;
      changed.push(group.id);
    }
    if (!changed.length) return 0;
    this.save(next);
    for (const id of changed) this.emit(this.get(id)!);
    if (roleConflict) this.warn('合併後沿用現有房間的崗位；請核對群組崗位設定。', 'conflict');
    return changed.length;
  }

  delete(groupId: string) {
    if (!this.groups.some(group => group.id === groupId)) throw new Error('找不到這個群組。');
    const next = this.snapshot().filter(group => group.id !== groupId);
    this.save(next);
    this.reservedRosters.delete(groupId);
    this.visitIds.delete(groupId);
    this.sharedVisits.delete(groupId);
  }

  reorder(ids: string[]) {
    const next = applyOrder(this.snapshot(), ids);
    this.save(next);
    return next.map(group => group.id);
  }

  // ── Change the name or board ───────────────────────────────────────
  // The group menu uses these settings to update what members see.

  rename(groupId: string, name: string) {
    const normalized = typeof name === 'string' ? name.trim() : '';
    if (!validName.test(normalized)) throw new Error('群組名稱無效。');
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group) throw new Error('找不到這個群組。');
    if (group.name === normalized) return this.get(groupId)!;
    group.name = normalized;
    this.publish(next, groupId);
    return this.get(groupId)!;
  }

  /** Save only the configured path; the file can be created or updated independently. */
  setBoard(groupId: unknown, path: unknown) {
    if (typeof groupId !== 'string') throw new Error('群組無效。');
    if (path !== null && !validGroupBoardPath(path)) throw new Error('告示版路徑無效。');
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group) throw new Error('找不到這個群組。');
    if ((group.boardPath ?? null) === path) return this.get(groupId)!;
    if (path === null) delete group.boardPath;
    else group.boardPath = path;
    this.publish(next, groupId);
    return this.get(groupId)!;
  }

  // ── Set roles and choose a lead ────────────────────────────────────
  // Use this section when assigning a role, choosing a lead, or setting written directions for either.

  setMemberRole(groupId: unknown, roomId: unknown, choice: unknown) {
    if (this.invalidRoles) throw new GroupMemberRoleError('repair', '群組檔案有無效的崗位。請先修復 Mac 上的群組設定檔。');
    const role = groupRoleFromChoice(choice);
    if (typeof groupId !== 'string' || typeof roomId !== 'string' || role === undefined) {
      throw new GroupMemberRoleError('invalid', '崗位設定無效。');
    }
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    const member = group?.members.find(item => item.roomId === roomId);
    if (!group || !member) throw new GroupMemberRoleError('missing', '找不到這個群組成員。');
    if (member.role?.key === role?.key) {
      if (!role || !member.role || role.label === member.role.label) return;
      member.role = { ...member.role, label: role.label };
      this.publish(next, group.id);
      return;
    }
    if (role) {
      const matching = group.members.find(item => item.role?.key === role.key)?.role;
      const label = matching?.label ?? role.label;
      member.role = label ? { key: role.key, label } : { key: role.key };
    } else {
      // The lead used to carry a role such as 統括 just to hold a direction. Taking the role off moves that direction to the lead's seat, unless the seat has its own.
      if (group.orchestratorRoomId === roomId && member.role?.direction && !group.orchestratorDirection) group.orchestratorDirection = member.role.direction;
      delete member.role;
    }
    this.publish(next, group.id);
  }

  setMemberDirection(groupId: unknown, roomId: unknown, value: unknown, expectedRoleKey: unknown) {
    if (this.invalidRoles) throw new GroupMemberRoleError('repair', '群組檔案有無效的崗位。請先修復 Mac 上的群組設定檔。');
    const direction = normalizeRoleDirection(value);
    if (typeof groupId !== 'string' || typeof roomId !== 'string' || direction === undefined) {
      throw new GroupMemberRoleError('invalid', '工作方向無效：最多 300 字及 6 行。');
    }
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    const member = group?.members.find(item => item.roomId === roomId);
    if (!group || !member) throw new GroupMemberRoleError('missing', '找不到這個群組成員。');
    if (!member.role || typeof expectedRoleKey !== 'string' || member.role.key !== expectedRoleKey) throw new GroupMemberRoleError('conflict', '崗位已變更，請重新設定工作方向。');
    if ((member.role.direction ?? '') === direction) return;
    member.role = { ...member.role, ...(direction ? { direction } : {}) };
    if (!direction) delete member.role.direction;
    this.publish(next, group.id);
  }

  /** Name the member that leads the group now. Returns the one that led before, if another did. */
  setOrchestrator(groupId: string, roomId: string) {
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group || !group.members.some(member => member.roomId === roomId)) throw new Error('總指揮要係群組成員。');
    const previous = group.orchestratorRoomId && group.orchestratorRoomId !== roomId ? group.orchestratorRoomId : undefined;
    if (group.orchestratorRoomId === roomId) return { group: this.get(groupId)!, previous };
    group.orchestratorRoomId = roomId;
    delete group.orchestratorCleared;
    this.publish(next, groupId);
    return { group: this.get(groupId)!, previous };
  }

  /** Take the lead away from whoever has it; nobody is made the lead by default afterwards. */
  clearOrchestrator(groupId: string) {
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group) throw new Error('找不到這個群組。');
    const previous = group.orchestratorRoomId;
    delete group.orchestratorRoomId;
    group.orchestratorCleared = true;
    this.publish(next, groupId);
    return { group: this.get(groupId)!, previous };
  }

  /** What the Founder wants of the lead's seat. It needs no role: whoever wears the crown has it. */
  setOrchestratorDirection(groupId: unknown, value: unknown) {
    const direction = normalizeRoleDirection(value);
    if (typeof groupId !== 'string' || direction === undefined) throw new GroupMemberRoleError('invalid', '工作方向無效：最多 300 字及 6 行。');
    const next = this.snapshot();
    const group = next.find(item => item.id === groupId);
    if (!group) throw new GroupMemberRoleError('missing', '找不到這個群組。');
    if (!group.orchestratorRoomId) throw new GroupMemberRoleError('conflict', '群組未有總指揮，請先設定皇冠。');
    if ((group.orchestratorDirection ?? '') === direction) return;
    if (direction) group.orchestratorDirection = direction; else delete group.orchestratorDirection;
    this.publish(next, group.id);
  }

  // ── Share the roster ───────────────────────────────────────────────
  // When a message goes to a room, share the roster once per visit and repeat the lead's directions when they change.

  private readonly reservedRosters = new Set<string>();
  private readonly visitIds = new Map<string, string>();
  private readonly sharedVisits = new Set<string>();
  /** The lead gets no tickets, so its own direction (set in the group menu) goes with the Founder's message to it, once, and again when the text changes. */
  private readonly directionSent = new Map<string, string>();

  private leadDirection(group: GroupChat, roomId: string) {
    if (group.orchestratorRoomId !== roomId) return;
    const direction = group.orchestratorDirection;
    if (!direction || normalizeRoleDirection(direction) !== direction) return;
    const key = `${group.id}:${roomId}`;
    if (this.directionSent.get(key) === direction) return;
    const header = '❤️ 你係今個群組嘅總指揮 ♛。你嘅崗位工作方向（Founder 設定，至下方 ❤️ 為止）：只影響觀點和重點，不改權限；與 Founder 指示衝突時，以 Founder 為準。';
    const text = `${header}\n${direction.split('\n').map(line => `｜ ${line}`).join('\n')}\n❤️`;
    return { text, sent: () => this.directionSent.set(key, direction) };
  }

  private rosterOnly(group: GroupChat, groupId: string, roomId: string): ReturnType<ReserveRoster> {
    if (this.sharedVisits.has(groupId) || this.reservedRosters.has(groupId)) return;
    const entries: { modelId: CLIModelId; sessionId: string; roomName: string; role?: string }[] = [];
    for (const member of group.members) {
      const room = this.getRoom(member.roomId);
      if (room?.modelId !== member.modelId || !room.sessionId || !sessionIdPattern.test(room.sessionId)) return;
      entries.push({ modelId: member.modelId, sessionId: room.sessionId, roomName: room.roomName, role: member.role?.key });
    }
    const parts = models.flatMap(modelId => entries.filter(entry => entry.modelId === modelId).map(entry =>
      `${entry.role ? '@' + entry.role : '未設定'} ${labels[modelId]} · ${entry.roomName.replace(/\s+/gu, ' ').trim()}（${entry.sessionId}）`));
    const tool = join(process.cwd(), 'scripts', 'komorebi-room');
    const recipient = entries.some(entry => entry.role) ? '@<崗位>' : '<房名或 Session ID>';
    const dispatch = `派單：${tool} bench send '${recipient}' --group ${group.id} --from <你> …；完成用 bench done。`;
    const visitId = this.visitIds.get(groupId);
    const lead = group.orchestratorRoomId ? this.getRoom(group.orchestratorRoomId) : undefined;
    const leadText = lead?.sessionId ? `　總指揮 ♛：${lead.roomName}（${lead.sessionId}）` : '';
    const selfLead = group.orchestratorRoomId === roomId ? '　你就係總指揮 ♛：按任務等級讀 lead skill（一般或冇寫等級都可以派單）。' : '';
    const boardText = this.boardEnabled && group.boardPath ? `　告示版：${group.boardPath}。開工前讀一次。檔案頂部嘅 Rev 有更新，就重讀。` : '';
    this.reservedRosters.add(groupId);
    return {
      suffix: ` ===== ${groupRosterPrefix}${parts.join('；')}${leadText}${selfLead}　${dispatch}${boardText}`,
      finish: sent => {
        if (this.visitIds.get(groupId) !== visitId) return;
        this.reservedRosters.delete(groupId);
        if (!sent) return;
        if (this.groups.some(item => item.id === groupId)) this.sharedVisits.add(groupId);
      },
    };
  }

  beginVisit(groupId: string) {
    this.visitIds.set(groupId, randomUUID());
    this.sharedVisits.delete(groupId);
    this.reservedRosters.delete(groupId);
  }

  reserveRoster(groupId: string, roomId: string): ReturnType<ReserveRoster> {
    this.assertMember(groupId, roomId);
    const group = this.groups.find(item => item.id === groupId)!;
    const own = this.leadDirection(group, roomId);
    const roster = this.rosterOnly(group, groupId, roomId);
    if (!roster && !own) return;
    if (!roster) return { suffix: ` ===== 我哋而家係協作狀態。${own!.text}`, finish: sent => { if (sent) own!.sent(); } };
    if (!own) return roster;
    return { suffix: `${roster.suffix}　${own.text}`, finish: sent => { roster.finish(sent); if (sent) own.sent(); } };
  }
}
