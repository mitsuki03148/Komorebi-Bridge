import type { GroupChat } from '../types/guild';

/**
 * Who a group message goes to: the member the user picked, else the orchestrator (the room with the crown), else the first member.
 * A pick that is not a member of this group does not count.
 */
export function groupRecipientId(group: GroupChat | undefined, picked: string | null): string | undefined {
  if (!group) return undefined;
  const isMember = (roomId: string | undefined) => group.members.some(member => member.roomId === roomId);
  if (picked && isMember(picked)) return picked;
  if (group.orchestratorRoomId && isMember(group.orchestratorRoomId)) return group.orchestratorRoomId;
  return group.members[0]?.roomId;
}
