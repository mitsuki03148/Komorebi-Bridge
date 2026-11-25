/** Tracks actual room viewers, allowing short network interruptions to recover. */
export class RoomPresence<Client> {
  private readonly viewers = new Map<Client, Set<string>>();
  private readonly unknown = new Set<Client>();
  private readonly deferred = new Set<string>();
  private readonly waitingIdle = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Called after the set of rooms being looked at changes. */
  onViewChange?: () => void;

  constructor(private readonly onEmpty: (roomId: string) => unknown, private readonly graceMs: number | ((roomId: string) => number) = 30_000,
    private readonly clock = { setTimeout, clearTimeout }) {}

  private graceFor(roomId: string) { return typeof this.graceMs === 'function' ? this.graceMs(roomId) : this.graceMs; }

  hasViewers(roomId: string) {
    return [...this.viewers.values()].some(rooms => rooms.has(roomId));
  }

  considerUnviewed(roomId: string) {
    if (!this.hasViewers(roomId) && !this.timers.has(roomId) &&
        !this.deferred.has(roomId) && !this.waitingIdle.has(roomId)) this.schedule(roomId);
  }

  register(client: Client) { this.unknown.add(client); }

  private schedule(roomId: string) {
    this.clock.clearTimeout(this.timers.get(roomId));
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(roomId);
      if (this.hasViewers(roomId)) return;
      if (this.unknown.size) this.deferred.add(roomId);
      else if (this.onEmpty(roomId) === false) this.waitingIdle.add(roomId);
    }, this.graceFor(roomId));
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  private resolveUnknown(client: Client) {
    this.unknown.delete(client);
    if (!this.unknown.size) {
      for (const roomId of this.deferred) if (!this.hasViewers(roomId)) this.schedule(roomId);
      this.deferred.clear();
    }
  }

  view(client: Client, roomId: string | null) { this.viewMany(client, roomId ? [roomId] : []); }

  viewMany(client: Client, roomIds: string[]) {
    const previous = this.viewers.get(client) ?? new Set<string>();
    const next = new Set(roomIds);
    if (next.size) this.viewers.set(client, next);
    else this.viewers.delete(client);
    for (const roomId of next) {
      this.clock.clearTimeout(this.timers.get(roomId));
      this.timers.delete(roomId);
      this.deferred.delete(roomId);
      this.waitingIdle.delete(roomId);
    }
    this.resolveUnknown(client);
    for (const roomId of previous) if (!next.has(roomId) && !this.hasViewers(roomId)) this.schedule(roomId);
    this.onViewChange?.();
  }

  stopIdle(roomId: string) {
    this.clock.clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
    this.deferred.delete(roomId);
    this.waitingIdle.delete(roomId);
  }

  /** Group rooms also need a clock when no browser ever viewed them, e.g. a workbench wake. */
  reconcileIdle(roomId: string, idle: boolean) {
    if (this.hasViewers(roomId)) return;
    if (!idle) {
      this.stopIdle(roomId);
      this.waitingIdle.add(roomId);
      return;
    }
    this.waitingIdle.delete(roomId);
    this.considerUnviewed(roomId);
  }

  idle(roomId: string) {
    if (this.waitingIdle.delete(roomId) && !this.hasViewers(roomId)) this.schedule(roomId);
  }

  activity(roomId: string, idle: boolean) {
    if (this.hasViewers(roomId)) return;
    if (this.timers.has(roomId)) this.schedule(roomId);
    if (idle) this.idle(roomId);
  }

  disconnect(client: Client) { this.view(client, null); }

  dispose() {
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    this.viewers.clear();
    this.unknown.clear();
    this.deferred.clear();
    this.waitingIdle.clear();
  }
}
