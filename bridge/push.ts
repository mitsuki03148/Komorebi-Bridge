import { createHash } from 'node:crypto';
import { DEFAULT_DISPLAY_NAME } from '../src/brand';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import type { CLIModelId, TerminalRoom } from '../src/types/guild';
import { roomBlocker, blockerText } from './room-blocker';
import { diffAttention, type Seen } from '../src/utils/attentionDiff';

export interface PushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
type Stored = PushSubscription & { addedAt: string };

/** Only the browsers' own push services. A client must not be able to make the Bridge call an address of its choosing. */
const pushHosts = [/^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const key = /^[A-Za-z0-9_-]{16,128}$/;
const maxSubscriptions = 10;

export function validSubscription(value: unknown): PushSubscription | undefined {
  if (!value || typeof value !== 'object') return;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 1_024 || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return;
  if (!key.test(keys.p256dh) || !key.test(keys.auth)) return;
  let url: URL;
  try { url = new URL(endpoint); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !pushHosts.some(pattern => pattern.test(url.hostname))) return;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** VAPID keys and the subscribed devices, kept in a git-ignored file only this user can read. */
export class PushStore {
  private vapid!: { publicKey: string; privateKey: string };
  private subscriptions: Stored[] = [];
  /** False when the file exists but cannot be read; it is then left untouched and nothing is saved. */
  readable = true;

  constructor(private readonly path: string, generate: () => { publicKey: string; privateKey: string } = () => generateVAPIDKeys()) {
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof data?.vapid?.publicKey !== 'string' || typeof data?.vapid?.privateKey !== 'string') throw new Error('invalid');
        this.vapid = data.vapid;
        this.subscriptions = Array.isArray(data.subscriptions)
          ? data.subscriptions.flatMap((item: unknown) => { const sub = validSubscription(item); return sub ? [{ ...sub, addedAt: String((item as Stored).addedAt ?? '') }] : []; }) : [];
        return;
      } catch {
        this.readable = false;
        console.error('無法讀取推送設定，請檢查', path);
      }
    }
    this.vapid = generate();
    this.save();
  }

  get publicKey() { return this.vapid.publicKey; }
  get privateKey() { return this.vapid.privateKey; }
  list(): PushSubscription[] { return this.subscriptions.map(({ endpoint, keys }) => ({ endpoint, keys })); }
  has(endpoint: string) { return this.subscriptions.some(item => item.endpoint === endpoint); }

  add(subscription: PushSubscription) {
    this.subscriptions = [...this.subscriptions.filter(item => item.endpoint !== subscription.endpoint), { ...subscription, addedAt: new Date().toISOString() }].slice(-maxSubscriptions);
    this.save();
  }

  remove(endpoint: string) {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter(item => item.endpoint !== endpoint);
    if (this.subscriptions.length !== before) this.save();
  }

  private save() {
    if (!this.readable) return;
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ vapid: this.vapid, subscriptions: this.subscriptions }, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
  }
}

/** How long a room's screen may stay exactly as it is before the push calls it out. Longer than the page's own 60 s hint, which was too noisy as a push. */
export const stillCallOutMs = 15 * 60_000;

export type PushKind = 'approval' | 'question' | 'done' | 'attention' | 'resume' | 'test' | 'inbox';
export interface PushPayload { title: string; body: string; tag: string; roomId?: string; kind: PushKind; openInbox?: boolean }
type Sender = (subscription: PushSubscription, payload: string, options: { TTL: number; urgency: 'high' | 'normal'; topic: string; vapidDetails: { subject: string; publicKey: string; privateKey: string } }) => Promise<unknown>;

export function pushPayload(kind: PushKind, characterName: string, roomName: string, includeRoomName: boolean, roomId?: string, title = DEFAULT_DISPLAY_NAME): PushPayload {
  const who = includeRoomName ? `${characterName} · ${roomName}` : characterName;
  if (kind === 'test') return { title, body: '測試通知：收到這則通知，代表鎖屏推送可以使用', tag: 'komorebi-test', kind };
  const body = kind === 'approval' ? `${who} 等待你審批` : kind === 'question' ? `${who} 有問題等你回答` : kind === 'attention' ? `${who} 畫面長時間沒有變化，可能需要你處理` : kind === 'resume' ? `${who} 閒置太久，停在「Resume 舊對話」選單，等你揀（1 接回舊對話較耗額度，2 開新對話）` : `${who} 已完成`;
  return { title, body, tag: `komorebi-${roomId}-${kind}`, roomId, kind };
}

/**
 * Sends a push when a room starts waiting for an approval or finishes real work, to every subscribed device
 * that is not showing the app right now (the open page already chimes for itself).
 */
export class PushNotifier {
  includeRoomName = true;
  private seen = new Map<string, Seen>();
  private runningSince = new Map<string, number>();
  private lastDone = new Map<string, number>();
  private warned = new Map<string, number>();
  private still = new Map<string, { screenId: string | undefined; since: number; alerted: boolean }>();
  private readonly sender: Sender;
  private readonly now: () => number;

  constructor(private readonly store: PushStore, private readonly options: {
    subject: () => string; foreground: (endpoint: string) => boolean; characterName: (modelId: CLIModelId) => string;
    sender?: Sender; now?: () => number; minWorkMs?: number; doneGapMs?: number; displayName?: string;
    /** How long a room's screen may stay exactly as it is, away from its prompt, before it is called out. */
    stillMs?: number;
    /** Told when a room is called out, so the frozen screen can be looked at later. */
    onStuck?: (room: TerminalRoom) => void;
  }) {
    this.sender = options.sender ?? ((subscription, payload, sendOptions) => sendNotification(subscription, payload, sendOptions));
    this.now = options.now ?? Date.now;
  }

  async observe(room: TerminalRoom): Promise<PushKind[]> {
    const now = this.now();
    const { next, events } = diffAttention(this.seen, [room], [], now);
    this.seen.set(room.id, next.get(room.id)!);
    if (room.status === 'running' && !this.runningSince.has(room.id)) this.runningSince.set(room.id, now);
    const sent: PushKind[] = [];
    for (const event of events) {
      if (event.kind === 'done') {
        const worked = now - (this.runningSince.get(room.id) ?? now);
        const gap = now - (this.lastDone.get(room.id) ?? -Infinity);
        // A quick command or a flip between states is not "finished"; and one task should not buzz twice.
        if (worked < (this.options.minWorkMs ?? 8_000) || gap < (this.options.doneGapMs ?? 30_000)) continue;
        this.lastDone.set(room.id, now);
      }
      await this.deliver(pushPayload(event.kind, this.options.characterName(room.modelId), room.roomName, this.includeRoomName, room.id, this.options.displayName));
      sent.push(event.kind);
    }
    // How long the work ran is kept while the closing report is still being waited for.
    if (room.status === 'idle' && this.seen.get(room.id)?.waitingReport === undefined) this.runningSince.delete(room.id);
    return sent;
  }

  /**
   * A CLI that is working keeps moving its screen (spinners, timers). One that waits for a question the Bridge does
   * not recognise leaves it exactly as it is, away from its prompt. Such a room is called out once per stretch;
   * returns the rooms called out this time.
   */
  async tick(rooms: TerminalRoom[]): Promise<TerminalRoom[]> {
    const now = this.now();
    const stillMs = this.options.stillMs ?? stillCallOutMs;
    const called: TerminalRoom[] = [];
    for (const room of rooms) {
      const reason = room.live && !room.pendingApproval && !room.pendingQuestion ? roomBlocker(room) : undefined;
      const waitingOnYou = reason || (room.live && !room.ready && !room.pendingApproval && !room.pendingQuestion && !room.menu && room.status === 'running' && Boolean(room.screen));
      const screenId = reason ? JSON.stringify([room.sessionId, reason]) : room.screenId;
      if (!waitingOnYou) { this.still.delete(room.id); continue; }
      const state = this.still.get(room.id);
      if (!state || state.screenId !== screenId) { this.still.set(room.id, { screenId, since: now, alerted: false }); continue; }
      if (state.alerted || now - state.since < (reason ? Math.min(180_000, stillMs) : stillMs)) continue;
      state.alerted = true;
      called.push(room);
      try { this.options.onStuck?.(room); } catch { /* Looking at it later is a bonus. */ }
      const character = this.options.characterName(room.modelId);
      const payload = pushPayload('attention', character, room.roomName, this.includeRoomName, room.id, this.options.displayName);
      if (reason) payload.body = (this.includeRoomName ? character + ' · ' + room.roomName : character) + ' ' + blockerText[reason];
      await this.deliver(payload);
    }
    for (const id of [...this.still.keys()]) if (!rooms.some(room => room.id === id)) this.still.delete(id);
    return called;
  }

  /** A room stopped at Claude Code's "Resume this conversation?" menu: said once per time the menu appears. */
  async callOutResume(room: TerminalRoom) {
    await this.deliver(pushPayload('resume', this.options.characterName(room.modelId), room.roomName, this.includeRoomName, room.id, this.options.displayName));
  }

  async callOutInbox() {
    await this.deliver({ title: this.options.displayName ?? DEFAULT_DISPLAY_NAME, body: 'Inbox 有項目需要查看', tag: 'komorebi-inbox', kind: 'inbox', openInbox: true });
  }

  /** A test push to one device, regardless of whether it is looking at the app. */
  async sendTest(endpoint: string): Promise<{ ok: boolean; message: string }> {
    const subscription = this.store.list().find(item => item.endpoint === endpoint);
    if (!subscription) return { ok: false, message: '這部裝置未訂閱，請先開啟通知。' };
    const result = await this.send(subscription, pushPayload('test', '', '', false, undefined, this.options.displayName));
    return result === 'ok' ? { ok: true, message: '已發出測試通知，幾秒內應該會收到。' } : { ok: false, message: result === 'gone' ? '這部裝置的訂閱已失效，請關閉再重新開啟通知。' : '推送服務沒有回應，請確認 Mac 有連網。' };
  }

  private async deliver(payload: PushPayload) {
    const targets = this.store.list().filter(subscription => !this.options.foreground(subscription.endpoint));
    await Promise.all(targets.map(subscription => this.send(subscription, payload)));
  }

  private async send(subscription: PushSubscription, payload: PushPayload): Promise<'ok' | 'gone' | 'failed'> {
    try {
      await this.sender(subscription, JSON.stringify(payload), {
        TTL: payload.kind === 'done' ? 900 : 3_600, urgency: payload.kind === 'done' ? 'normal' : 'high',
        topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32),
        vapidDetails: { subject: this.options.subject(), publicKey: this.store.publicKey, privateKey: this.store.privateKey },
      });
      return 'ok';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) { this.store.remove(subscription.endpoint); return 'gone'; }
      const code = String(status ?? 'network');
      if (this.now() - (this.warned.get(code) ?? 0) > 60_000) { this.warned.set(code, this.now()); console.warn(`推送失敗（${code}）`); }
      return 'failed';
    }
  }
}
