import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { PushNotifier, PushStore, pushPayload, validSubscription, type PushSubscription } from './push';

const sub = (name: string, host = 'web.push.apple.com'): PushSubscription => ({
  endpoint: `https://${host}/${name}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const room = (extra: Partial<TerminalRoom> = {}) => ({ id: 'r1', modelId: 'CLAUDE', roomName: 'R5', live: true, status: 'idle', logs: [], ...extra }) as TerminalRoom;

test('only real push-service subscriptions are accepted, so a client cannot aim the Bridge at another address', () => {
  assert.deepEqual(validSubscription(sub('abc')), sub('abc'));
  assert.ok(validSubscription(sub('x', 'fcm.googleapis.com')));
  assert.ok(validSubscription(sub('x', 'updates.push.services.mozilla.com')));
  for (const bad of [sub('x', 'localhost'), sub('x', '127.0.0.1'), sub('x', 'internal.example.com'), sub('x', 'evil.push.apple.com.example.com'),
    { ...sub('x'), endpoint: 'http://web.push.apple.com/x' }, { ...sub('x'), endpoint: 'https://user:pw@web.push.apple.com/x' },
    { ...sub('x'), endpoint: 'https://web.push.apple.com:8443/x' }, { ...sub('x'), endpoint: 'not a url' },
    { ...sub('x'), keys: { p256dh: 'short', auth: 'a'.repeat(22) } }, { endpoint: sub('x').endpoint }, null, 'text', 42]) {
    assert.equal(validSubscription(bad), undefined, JSON.stringify(bad));
  }
});

test('keys are made once and kept, devices are stored privately, and a damaged file is never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-push-'));
  try {
    const path = join(dir, 'push.json');
    const first = new PushStore(path);
    first.add(sub('one')); first.add(sub('two')); first.add(sub('one'));
    assert.equal(first.list().length, 2);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const again = new PushStore(path);
    assert.equal(again.publicKey, first.publicKey);
    assert.equal(again.privateKey, first.privateKey);
    assert.deepEqual(again.list().map(item => item.endpoint), [sub('two').endpoint, sub('one').endpoint]);
    again.remove(sub('one').endpoint);
    assert.equal(new PushStore(path).list().length, 1);
    for (let i = 0; i < 14; i++) again.add(sub(`device-${i}`));
    assert.equal(again.list().length, 10, 'oldest devices are dropped past ten');
    await writeFile(path, '{ this is not json');
    const damaged = new PushStore(path);
    assert.equal(damaged.readable, false);
    damaged.add(sub('x'));
    assert.equal(await readFile(path, 'utf8'), '{ this is not json');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function fixture(options: { foreground?: (endpoint: string) => boolean; includeRoomName?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-push-'));
  const store = new PushStore(join(dir, 'push.json'));
  store.add(sub('phone'));
  let clock = 1_000_000;
  const sent: { endpoint: string; payload: Record<string, string>; options: Record<string, any> }[] = [];
  let failure: number | undefined;
  const notifier = new PushNotifier(store, {
    subject: () => 'https://mac.example.ts.net', foreground: options.foreground ?? (() => false), characterName: () => '響', now: () => clock,
    sender: async (subscription, payload, sendOptions) => {
      if (failure) throw Object.assign(new Error('push failed'), { statusCode: failure });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options: sendOptions });
    },
  });
  if (options.includeRoomName === false) notifier.includeRoomName = false;
  return { dir, store, notifier, sent, advance: (ms: number) => { clock += ms; }, fail: (status?: number) => { failure = status; } };
}

test('Inbox push opens its pending view without exposing a task path', async () => {
  const { dir, notifier, sent } = await fixture();
  try {
    await notifier.callOutInbox();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.kind, 'inbox');
    assert.equal((sent[0].payload as Record<string, unknown>).openInbox, true);
    assert.doesNotMatch(JSON.stringify(sent[0].payload), /\/Volumes\//);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a new approval pushes once, naming the room, and the same approval never pushes again', async () => {
  const { dir, notifier, sent } = await fixture();
  try {
    assert.deepEqual(await notifier.observe(room({ status: 'running' })), [], 'the first sighting never pushes');
    const waiting = room({ status: 'waiting_approval', pendingApproval: { id: 'ap-1' } as TerminalRoom['pendingApproval'] });
    assert.deepEqual(await notifier.observe(waiting), ['approval']);
    assert.deepEqual(await notifier.observe(waiting), []);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload, { title: 'Komorebi Bridge', body: '響 · R5 等待你審批', tag: 'komorebi-r1-approval', roomId: 'r1', kind: 'approval' });
    assert.equal(sent[0].options.urgency, 'high');
    assert.ok(sent[0].options.topic.length <= 32 && /^[A-Za-z0-9_-]+$/.test(sent[0].options.topic));
    assert.equal(sent[0].options.vapidDetails.subject, 'https://mac.example.ts.net');
    await notifier.observe(room({ status: 'waiting_approval', pendingApproval: { id: 'ap-2' } as TerminalRoom['pendingApproval'] }));
    assert.equal(sent.length, 2, 'a different approval does');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('finished work pushes only after real work and not twice in a row', async () => {
  const { dir, notifier, sent, advance } = await fixture();
  // Finished work is announced when the room's last message is the agent's closing report.
  let cycle = 0;
  const report = (n: number) => [{ id: `rep-${n}`, sender: 'agent', text: '做完。\nRESULT — DONE', timestamp: '' }] as never;
  try {
    await notifier.observe(room({ status: 'idle' }));
    await notifier.observe(room({ status: 'running' }));
    advance(3_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: report(++cycle) })), [], 'a 3 second command is not finished work');
    await notifier.observe(room({ status: 'running' }));
    advance(20_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: report(++cycle) })), ['done']);
    assert.equal(sent.at(-1)?.payload.body, '響 · R5 已完成');
    assert.equal(sent.at(-1)?.options.urgency, 'normal');
    await notifier.observe(room({ status: 'running' }));
    advance(10_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: report(++cycle) })), [], 'within 30 seconds of the last one');
    await notifier.observe(room({ status: 'running' }));
    advance(60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: report(++cycle) })), ['done']);
    assert.equal(sent.length, 2);
    await notifier.observe(room({ status: 'running', live: false }));
    advance(60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', live: false, logs: report(++cycle) })), [], 'a room that is not running is not "done"');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a device that is showing the app is not pushed to, and the room name can be left out of the lock screen', async () => {
  const { dir, notifier, sent, store } = await fixture({ foreground: endpoint => endpoint === sub('phone').endpoint });
  try {
    store.add(sub('other'));
    await notifier.observe(room());
    await notifier.observe(room({ status: 'waiting_approval', pendingApproval: { id: 'ap-1' } as TerminalRoom['pendingApproval'] }));
    assert.deepEqual(sent.map(item => item.endpoint), [sub('other').endpoint]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const quiet = await fixture({ includeRoomName: false });
  try {
    await quiet.notifier.observe(room());
    await quiet.notifier.observe(room({ status: 'waiting_approval', pendingApproval: { id: 'ap-1' } as TerminalRoom['pendingApproval'] }));
    assert.equal(quiet.sent[0].payload.body, '響 等待你審批');
    assert.equal(pushPayload('approval', '瞳', '房', false, 'x').body, '瞳 等待你審批');
  } finally { await rm(quiet.dir, { recursive: true, force: true }); }
});

test('an expired device is forgotten, other failures keep it, and the test push reaches one device whatever it is showing', async () => {
  const { dir, notifier, store, sent, fail } = await fixture({ foreground: () => true });
  try {
    assert.deepEqual(await notifier.sendTest(sub('phone').endpoint), { ok: true, message: '已發出測試通知，幾秒內應該會收到。' });
    assert.equal(sent[0].payload.kind, 'test');
    assert.equal((await notifier.sendTest(sub('nobody').endpoint)).ok, false);
    fail(500);
    assert.equal((await notifier.sendTest(sub('phone').endpoint)).ok, false);
    assert.equal(store.list().length, 1, 'a server error does not drop the device');
    fail(410);
    const gone = await notifier.sendTest(sub('phone').endpoint);
    assert.equal(gone.ok, false);
    assert.match(gone.message, /失效/);
    assert.equal(store.list().length, 0, 'a gone subscription is removed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('what the Bridge sends is accepted by the real web-push library: VAPID signed, encrypted, with urgency and topic', async () => {
  const { createECDH, randomBytes } = await import('node:crypto');
  const { generateRequestDetails } = await import('web-push');
  const device = createECDH('prime256v1');
  device.generateKeys();
  const real: PushSubscription = { endpoint: 'https://web.push.apple.com/real-looking-token',
    keys: { p256dh: device.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  assert.deepEqual(validSubscription(real), real);
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-push-'));
  try {
    const store = new PushStore(join(dir, 'push.json'));
    store.add(real);
    const built: { headers: Record<string, string>; body: Buffer; endpoint: string }[] = [];
    const notifier = new PushNotifier(store, {
      subject: () => 'https://mac.example.ts.net', foreground: () => false, characterName: () => '瞳',
      // The library builds the real request; only the network call is left out.
      sender: async (subscription, payload, options) => { built.push(generateRequestDetails(subscription, payload, options) as never); },
    });
    await notifier.observe(room());
    await notifier.observe(room({ status: 'waiting_approval', pendingApproval: { id: 'ap-1' } as TerminalRoom['pendingApproval'] }));
    assert.equal(built.length, 1);
    const { headers, body, endpoint } = built[0];
    assert.equal(endpoint, real.endpoint);
    assert.match(headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.ok(headers.Authorization.endsWith(`k=${store.publicKey}`));
    assert.equal(headers.Urgency, 'high');
    assert.equal(String(headers.TTL), '3600');
    assert.match(headers.Topic, /^[\w-]{1,32}$/);
    assert.equal(headers['Content-Encoding'], 'aes128gcm');
    assert.ok(body.length > 100 && !body.toString('utf8').includes('等待你審批'), 'the message is encrypted');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stop without a closing report does not announce finished work; the report may land a moment after the room goes idle', async () => {
  const { dir, notifier, sent, advance } = await fixture();
  try {
    const say = (id: string, text: string) => [{ id, sender: 'agent', text, timestamp: '' }] as never;
    await notifier.observe(room({ status: 'idle' }));
    await notifier.observe(room({ status: 'running' }));
    advance(30_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('m1', '我先做咗第一步，繼續？') })), [], 'a pause for a progress word is not a finish');
    assert.equal(sent.length, 0);
    // The report reaches the record 3 seconds after the room went idle.
    await notifier.observe(room({ status: 'running' }));
    advance(60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('m1', '我先做咗第一步，繼續？') })), []);
    advance(3_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('m2', 'RESULT — STOP\n卡喺權限') })), ['done']);
    // A report that came too late is not announced, and an old report is not announced again.
    await notifier.observe(room({ status: 'running', logs: say('m2', 'RESULT — STOP') }));
    advance(60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('m2', 'RESULT — STOP') })), [], 'the same old report');
    advance(15_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('m3', 'RESULT — DONE') })), [], 'after the wait it is too late');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a long run that stops with no report is still announced, so a stuck test or command is not missed', async () => {
  const { dir, notifier, sent, advance } = await fixture();
  try {
    const say = (id: string, text: string) => [{ id, sender: 'agent', text, timestamp: '' }] as never;
    await notifier.observe(room({ status: 'idle' }));
    await notifier.observe(room({ status: 'running' }));
    advance(14 * 60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('a', '等緊') })), [], 'fourteen minutes is not long');
    await notifier.observe(room({ status: 'running' }));
    advance(16 * 60_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('b', 'npm test 跑咗好耐') })), ['done'], 'sixteen minutes is');
    assert.equal(sent.length, 1);
    advance(3_000);
    assert.deepEqual(await notifier.observe(room({ status: 'idle', logs: say('c', 'RESULT — DONE') })), [], 'a report right after does not buzz twice');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a question the agent asks the Founder is announced once, on the page and by push, like an approval', async () => {
  const { diffAttention } = await import('../src/utils/attentionDiff');
  const asking = (id: string) => room({ pendingQuestion: { id, questions: [{ title: '要用哪個方案？', options: ['A', 'B'] }] } });
  let seen = diffAttention(null, [room()], []).next;
  let step = diffAttention(seen, [asking('q1')], []);
  assert.deepEqual(step.events.map(event => event.kind), ['question'], 'a new question signals');
  seen = step.next;
  step = diffAttention(seen, [asking('q1')], []);
  assert.deepEqual(step.events, [], 'the same question does not signal again');
  seen = step.next;
  step = diffAttention(seen, [room()], []);
  assert.deepEqual(step.events, [], 'answering it signals nothing');
  seen = step.next;
  assert.deepEqual(diffAttention(seen, [asking('q2')], []).events.map(event => event.kind), ['question'], 'the next question signals again');
  assert.deepEqual(diffAttention(null, [asking('q1')], []).events, [], 'a room seen for the first time never signals');
  // The push says what is waiting, and reaches a device that is not looking at the app.
  assert.equal(pushPayload('question', '光', 'R5', true, 'r1').body, '光 · R5 有問題等你回答');
  assert.equal(pushPayload('question', '光', 'R5', false, 'r1').body, '光 有問題等你回答');
  const sent: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-push-q-'));
  try {
    const store = new PushStore(join(dir, 'push.json'));
    store.add(sub('phone'));
    const notifier = new PushNotifier(store, { subject: () => 'mailto:test@example.com', foreground: () => false, characterName: () => '光', sender: async (_subscription, payload) => { sent.push(JSON.parse(payload).body); } });
    await notifier.observe(room());
    assert.deepEqual(await notifier.observe(asking('q1')), ['question']);
    assert.deepEqual(await notifier.observe(asking('q1')), []);
    assert.deepEqual(sent, ['光 · R5 有問題等你回答']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
