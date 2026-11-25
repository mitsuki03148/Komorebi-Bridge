import type { TerminalRoom } from '../types/guild';

export const pendingKeys = (room: TerminalRoom) => [
  ...(room.pendingApproval ? [`approval:${room.id}:${room.pendingApproval.id}`] : []),
  ...(room.pendingQuestion ? [`question:${room.id}:${room.pendingQuestion.id}`] : []),
];

/** A snapshot may contain an old prompt, so only transitions observed after it have a known age. */
export class PendingAges {
  private known = new Map<string, string[]>();
  private times: Record<string, number> = {};
  reset(rooms: TerminalRoom[]) {
    this.known = new Map(rooms.map(room => [room.id, pendingKeys(room)]));
    this.times = {};
    return this.times;
  }
  update(room: TerminalRoom, now = Date.now()) {
    const previous = this.known.get(room.id);
    const next = pendingKeys(room);
    const times = { ...this.times };
    for (const key of previous ?? []) if (!next.includes(key)) delete times[key];
    if (previous) for (const key of next) if (!previous.includes(key)) times[key] = now;
    this.known.set(room.id, next);
    this.times = times;
    return times;
  }
  remove(roomId: string) {
    const times = { ...this.times };
    for (const key of this.known.get(roomId) ?? []) delete times[key];
    this.known.delete(roomId); this.times = times;
    return times;
  }
}
