import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Groups } from './groups';
import type { TerminalRoom } from '../src/types/guild';
import { savedGroupRole, type GroupMemberRole } from '../src/types/groupRoles';

/** A group an archived room belonged to, its assignment, and whether it led that group. */
export interface RememberedGroup { groupId: string; orchestrator: boolean; role?: GroupMemberRole }

/**
 * Remembers which groups a room was in when it was archived, so restoring it puts it back.
 * Archiving still removes the room from its groups; only this note is kept. An unreadable file is never overwritten.
 */
export class ArchiveGroups {
  private data: Record<string, RememberedGroup[]> = {};
  private readable = true;

  constructor(private readonly path: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [roomId, items] of Object.entries(parsed)) {
          if (!Array.isArray(items)) continue;
          const valid = items.filter((item): item is RememberedGroup => Boolean(item) && typeof item.groupId === 'string' && typeof item.orchestrator === 'boolean');
          if (valid.length) this.data[roomId] = valid;
        }
      } else this.readable = false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.readable = false;
        console.error('無法讀取封存群組記錄，請檢查', path);
      }
    }
  }

  remember(roomId: string, items: RememberedGroup[]) {
    if (!items.length) return;
    // Re-archiving after a partial restore must not erase the groups still waiting.
    const combined = new Map((this.data[roomId] ?? []).map(item => [item.groupId, item]));
    for (const item of items) {
      const pendingLead = combined.get(item.groupId)?.orchestrator === true;
      combined.set(item.groupId, { ...item, orchestrator: item.orchestrator || pendingLead });
    }
    this.data = { ...this.data, [roomId]: [...combined.values()] };
    this.save();
  }

  /** The remembered groups of a room, forgotten as they are taken. */
  take(roomId: string): RememberedGroup[] {
    const items = this.data[roomId] ?? [];
    if (!items.length) return [];
    const { [roomId]: _gone, ...rest } = this.data;
    this.data = rest;
    this.save();
    return items;
  }

  /** Put a restored room back into the groups it left. Returns the names of groups it could not rejoin. */
  restore(roomId: string, room: TerminalRoom | undefined, groups: Groups, canJoin: (room: TerminalRoom) => boolean): string[] {
    const remembered = this.data[roomId] ?? [];
    const remaining: RememberedGroup[] = [];
    const skipped: string[] = [];
    for (const item of remembered) {
      let group = groups.get(item.groupId);
      if (!group) continue; // The group was deleted meanwhile.
      if (!group.members.some(member => member.roomId === roomId)) {
        try {
          if (!room || !canJoin(room)) throw new Error('room cannot join');
          // A valid remembered role is saved atomically with the membership.
          group = groups.addMember(item.groupId, { modelId: room.modelId, roomId }, savedGroupRole(item.role));
        } catch {
          skipped.push(group.name);
          remaining.push(item);
          continue;
        }
      }
      if (item.orchestrator && !group.orchestratorRoomId && !group.orchestratorCleared) {
        try { groups.setOrchestrator(item.groupId, roomId); }
        catch (error) {
          // The membership is already present. Keep its original note to retry only the missing lead.
          remaining.push(item);
          console.warn('房間已回到群組，但未能還原總指揮；已保留記錄供重試。', group.name, error);
        }
      }
    }
    if (remaining.length < remembered.length) {
      const next = { ...this.data };
      if (remaining.length) next[roomId] = remaining;
      else delete next[roomId];
      // Only consume records once the archive file has been replaced.
      if (this.save(next)) this.data = next;
      else console.warn('未能更新封存群組記錄；已保留記錄供重試。', this.path);
    }
    return skipped;
  }

  private save(data = this.data): boolean {
    if (!this.readable) return false;
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      return true;
    } catch { return false; }
    finally { try { unlinkSync(temporary); } catch { /* The rename removed it. */ } }
  }
}
