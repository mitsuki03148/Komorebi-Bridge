import type { GroupChat } from '../src/types/guild';
import { groupRecipientId } from '../src/utils/groupRecipient';

type Visit = {
  groupId: string;
  members: string[];
  selected?: string;
  entry?: string;
};

type ViewDeps<Client> = {
  connected(client: Client): boolean;
  beginVisit(groupId: string): void;
  select(client: Client, roomId: string | null): void;
  hasRoom(roomId: string): boolean;
  canOpenEntry(roomId: string): boolean;
  open(roomId: string, stillWanted: () => boolean): Promise<void>;
  failed(roomId: string, error: unknown): void;
};

function entryRoom(group: GroupChat, selected?: string) {
  const crown = group.orchestratorRoomId;
  return crown && group.members.some(member => member.roomId === crown) ? crown : selected;
}

/** Following a group's transcripts, viewing a room, and waking its CLI are separate interests. */
export class GroupViews<Client> {
  private readonly visits = new Map<Client, Visit>();
  private readonly opening = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, Set<() => boolean>>();

  constructor(private readonly deps: ViewDeps<Client>) {}

  *watchedRooms() {
    for (const visit of this.visits.values()) yield* visit.members;
  }

  view(client: Client, group: GroupChat, selectedRoomId?: string) {
    if (!this.deps.connected(client)) return;
    const previous = this.visits.get(client);
    const selected = groupRecipientId(group, selectedRoomId ?? null);
    if (previous?.groupId === group.id) {
      this.reselect(client, group, previous, selected);
      return;
    }
    if (![...this.visits.values()].some(visit => visit.groupId === group.id)) this.deps.beginVisit(group.id);
    const visit = { groupId: group.id, members: group.members.map(member => member.roomId), selected, entry: entryRoom(group, selected) };
    this.visits.set(client, visit);
    this.deps.select(client, selected ?? null);
    if (visit.entry) return this.openPending(visit.entry);
  }

  /** Only an explicit member button activation may add a wake to an existing visit. */
  selectMember(client: Client, group: GroupChat, roomId: string) {
    const visit = this.visits.get(client);
    if (visit?.groupId !== group.id || !this.deps.connected(client) ||
        !group.members.some(member => member.roomId === roomId)) return;
    this.reselect(client, group, visit, roomId);
    return this.selectionGuard(client, group.id, roomId);
  }

  isOpening(roomId: string) { return this.opening.has(roomId); }

  update(group: GroupChat) {
    for (const [client, visit] of this.visits) {
      if (visit.groupId !== group.id || !this.deps.connected(client)) continue;
      this.reselect(client, group, visit, groupRecipientId(group, visit.selected ?? null));
    }
  }

  private reselect(client: Client, group: GroupChat, visit: Visit, selected?: string) {
    visit.members = group.members.map(member => member.roomId);
    visit.selected = selected;
    // Membership or selection changes can invalidate an old entry, but never create a new wake.
    if (visit.entry !== entryRoom(group, selected)) visit.entry = undefined;
    this.deps.select(client, selected ?? null);
  }

  leave(client: Client) { this.visits.delete(client); }

  *leaveGroup(groupId: string) {
    for (const [client, visit] of this.visits) {
      if (visit.groupId !== groupId) continue;
      this.leave(client);
      yield client;
    }
  }

  synced(roomId: string) { return this.openPending(roomId); }

  selectionGuard(client: Client, groupId: string, roomId: string) {
    const visit = this.visits.get(client);
    return () => Boolean(visit && this.visits.get(client) === visit && visit.groupId === groupId &&
      visit.selected === roomId && this.deps.connected(client));
  }

  async retry(roomId: string, stillSelected: () => boolean) {
    if (!stillSelected()) return;
    const guards = this.retries.get(roomId) ?? new Set<() => boolean>();
    guards.add(stillSelected);
    this.retries.set(roomId, guards);
    try { await this.openPending(roomId); }
    finally {
      guards.delete(stillSelected);
      if (!guards.size) this.retries.delete(roomId);
    }
  }

  private openPending(roomId: string) {
    const stillWanted = () => [...(this.retries.get(roomId) ?? [])].some(guard => guard()) ||
      (this.deps.canOpenEntry(roomId) && [...this.visits].some(([client, visit]) => visit.entry === roomId && this.deps.connected(client)));
    if (!stillWanted() || !this.deps.hasRoom(roomId)) return;
    const existing = this.opening.get(roomId);
    if (existing) return existing;
    // Shares the room-level guard across clients while Rooms waits for the old PTY or resolves its cwd.
    const opening = Promise.resolve().then(() => this.deps.open(roomId, stillWanted)).catch(error => {
      if (stillWanted()) this.deps.failed(roomId, error);
    }).finally(() => {
      this.opening.delete(roomId);
      for (const visit of this.visits.values()) if (visit.entry === roomId) visit.entry = undefined;
    });
    this.opening.set(roomId, opening);
    return opening;
  }
}
