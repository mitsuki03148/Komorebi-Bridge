import { groupRoleFromChoice, normalizeRoleDirection } from '../types/groupRoles';
import type { GroupMemberRole, GroupRoleChoice } from '../types/groupRoles';
import type { ClientEvent } from '../types/bridge';

type SaveEvent = Extract<ClientEvent, { type: 'GROUP_SET_MEMBER_ROLE' | 'GROUP_SET_MEMBER_DIRECTION' | 'GROUP_SET_ORCHESTRATOR_DIRECTION' }>;
type ErrorCode = 'invalid' | 'unsupported' | 'missing' | 'repair' | 'failed' | 'conflict' | 'disconnected';
type Common = { groupId: string; roomId: string; choice: GroupRoleChoice; direction: string; target: GroupMemberRole | null; roleSaved: boolean };
export type RoleEditorSave = Common & (
  | { status: 'pending'; event: SaveEvent; nextDirection: boolean }
  | { status: 'done' }
  | { status: 'error'; error: ErrorCode }
);
export type RoleEditorSaveInput = {
  groupId: string; roomId: string; currentRole?: GroupMemberRole;
  choice: GroupRoleChoice; direction?: string; directionSupported: boolean;
};

/** Return the first event only; send subsequent events only after a matching success ACK. */
export function beginRoleEditorSave(input: RoleEditorSaveInput, requestId: string): RoleEditorSave {
  const target = groupRoleFromChoice(input.choice);
  const direction = input.directionSupported ? normalizeRoleDirection(input.direction) : undefined;
  const common: Common = { groupId: input.groupId, roomId: input.roomId, choice: input.choice, direction: input.direction ?? '', target: target ?? null, roleSaved: false };
  if (target === undefined || (input.directionSupported && direction === undefined)) return { ...common, status: 'error', error: 'invalid' };
  const roleChanged = target?.key !== input.currentRole?.key || target?.label !== input.currentRole?.label;
  const directionChanged = input.directionSupported && !!target && direction !== (target.key === input.currentRole?.key ? input.currentRole.direction ?? '' : '');
  if (roleChanged) return { ...common, status: 'pending', nextDirection: directionChanged, event: { type: 'GROUP_SET_MEMBER_ROLE', groupId: input.groupId, roomId: input.roomId, role: input.choice, requestId } };
  if (directionChanged && target) return { ...common, status: 'pending', nextDirection: false, event: { type: 'GROUP_SET_MEMBER_DIRECTION', groupId: input.groupId, roomId: input.roomId, direction: direction!, expectedRoleKey: target.key, requestId } };
  return { ...common, status: 'done' };
}

/** Ignore unrelated, stale and repeated results. Pass a fresh request ID for the next operation. */
export function advanceRoleEditorSave(state: RoleEditorSave, result: { requestId: string; ok: true } | { requestId: string; ok: false; code: Exclude<ErrorCode, 'unsupported' | 'disconnected'> }, nextRequestId: string): RoleEditorSave {
  if (state.status !== 'pending' || state.event.requestId !== result.requestId) return state;
  if (!result.ok) return { ...state, status: 'error', error: result.code };
  if (state.event.type === 'GROUP_SET_MEMBER_ROLE') {
    const roleSaved = true;
    if (state.nextDirection && state.target) {
      const direction = normalizeRoleDirection(state.direction)!;
      return { ...state, status: 'pending', roleSaved, nextDirection: false, event: { type: 'GROUP_SET_MEMBER_DIRECTION', groupId: state.groupId, roomId: state.roomId, expectedRoleKey: state.target.key, direction, requestId: nextRequestId } };
    }
    return { ...state, status: 'done', roleSaved };
  }
  return { ...state, status: 'done' };
}

/** A lost connection leaves an unacknowledged write unknown; refresh the group before retrying. */
export function interruptRoleEditorSave(state: RoleEditorSave): RoleEditorSave {
  return state.status === 'pending' ? { ...state, status: 'error', error: 'disconnected' } : state;
}
