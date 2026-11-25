import { t } from '../i18n';
export type PreviewState = { status: 'loading' } | { status: 'ready'; dataUrl: string; size: number } | { status: 'error'; message: string };
export type PreviewReply = { roomId: string; path: string } & ({ ok: true; mime: string; data: string; size: number } | { ok: false; message: string });
export type PreviewRequest = { type: 'IMAGE_PREVIEW'; roomId: string; path: string };

export const previewKey = (roomId: string, path: string) => `${roomId}\n${path}`;

/**
 * Asks the Bridge for image previews a few at a time (it closes a connection that sends more than
 * 45 requests in 10 seconds), times out silent requests, and forgets the oldest finished previews.
 */
export class PreviewLoader {
  version = 0;
  private states = new Map<string, PreviewState>();
  private queue: PreviewRequest[] = [];
  private running = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private stopped = false;

  constructor(
    private send: (request: PreviewRequest) => boolean,
    private options = { spacingMs: 400, timeoutMs: 30_000, keep: 40 },
  ) {}

  get(roomId: string, path: string) { return this.states.get(previewKey(roomId, path)); }

  request(roomId: string, path: string) {
    const key = previewKey(roomId, path);
    if (this.states.has(key) || this.stopped) return;
    this.states.set(key, { status: 'loading' });
    this.queue.push({ type: 'IMAGE_PREVIEW', roomId, path });
    this.emit();
    this.pump();
  }

  receive(reply: PreviewReply) {
    this.settle(previewKey(reply.roomId, reply.path), reply.ok
      ? { status: 'ready', dataUrl: `data:${reply.mime};base64,${reply.data}`, size: reply.size }
      : { status: 'error', message: reply.message });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose() {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queue = [];
  }

  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private settle(key: string, state: PreviewState) {
    if (!this.states.has(key)) return;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.states.set(key, state);
    const ready = [...this.states].filter(([, value]) => value.status === 'ready').map(([name]) => name);
    for (const old of ready.slice(0, Math.max(0, ready.length - this.options.keep))) this.states.delete(old);
    this.emit();
  }

  private pump() {
    if (this.running) return;
    this.running = true;
    const step = () => {
      const item = this.queue.shift();
      if (!item || this.stopped) { this.running = false; return; }
      const key = previewKey(item.roomId, item.path);
      if (this.send(item)) {
        this.timers.set(key, setTimeout(() => this.settle(key, { status: 'error', message: t('utils.preview.timeout') }), this.options.timeoutMs));
      } else this.settle(key, { status: 'error', message: t('utils.bridge.disconnected') });
      setTimeout(step, this.options.spacingMs);
    };
    step();
  }
}
