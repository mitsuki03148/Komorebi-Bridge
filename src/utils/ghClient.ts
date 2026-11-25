import { t } from '../i18n';
import type { ClientEvent, ServerEvent } from '../types/bridge';

/** Asks the Bridge for GitHub (or Drive) data and matches each answer to its question. */
export class GhClient {
  private readonly pending = new Map<string, { resolve: (value: never) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;

  constructor(private readonly send: (event: ClientEvent) => boolean, private readonly timeoutMs = 30_000, private readonly kind: 'GH' | 'DRIVE' | 'INBOX' | 'WORKTREE' = 'GH') {}

  call = <T,>(op: string, params: Record<string, unknown> = {}): Promise<T> => new Promise<T>((resolve, reject) => {
    const requestId = `gh-${Date.now().toString(36)}-${++this.sequence}`;
    const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(t('utils.bridge.timeout'))); }, this.timeoutMs);
    this.pending.set(requestId, { resolve: resolve as (value: never) => void, reject, timer });
    if (!this.send({ type: this.kind, requestId, op, params } as ClientEvent)) { clearTimeout(timer); this.pending.delete(requestId); reject(new Error(t('utils.connection.offline'))); }
  });

  handle(event: ServerEvent) {
    if (event.type !== `${this.kind}_RESULT`) return;
    if (event.type !== 'GH_RESULT' && event.type !== 'DRIVE_RESULT' && event.type !== 'INBOX_RESULT' && event.type !== 'WORKTREE_RESULT') return;
    const entry = this.pending.get(event.requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(event.requestId);
    if (event.ok) entry.resolve(event.data as never); else entry.reject(new Error(event.message ?? t('utils.github.failed')));
  }

  rejectAll(reason: string) {
    for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error(reason)); this.pending.delete(id); }
  }
}
