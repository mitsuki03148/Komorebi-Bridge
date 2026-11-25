import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GhClient } from '../src/utils/ghClient';
import type { ClientEvent } from '../src/types/bridge';

test('a call is sent as one GH event and resolves with the matching answer; other answers are ignored', async () => {
  const sent: ClientEvent[] = [];
  const client = new GhClient(event => { sent.push(event); return true; });
  const first = client.call<{ n: number }>('issues', { repo: 'o/r' });
  const second = client.call<{ n: number }>('repos', {});
  assert.equal(sent.length, 2);
  const [a, b] = sent as { type: 'GH'; requestId: string; op: string; params: object }[];
  assert.equal(a.type, 'GH');
  assert.equal(a.op, 'issues');
  assert.notEqual(a.requestId, b.requestId);
  client.handle({ type: 'GH_RESULT', requestId: 'unknown', ok: true, data: {} });
  client.handle({ type: 'GH_RESULT', requestId: b.requestId, ok: true, data: { n: 2 } });
  client.handle({ type: 'GH_RESULT', requestId: a.requestId, ok: true, data: { n: 1 } });
  assert.deepEqual(await first, { n: 1 });
  assert.deepEqual(await second, { n: 2 });
});

test('a refusal rejects with the reason, a lost connection rejects at once, and a silent Bridge times out', async () => {
  const sent: ClientEvent[] = [];
  const client = new GhClient(event => { sent.push(event); return true; }, 20);
  const refused = client.call('repo', {});
  client.handle({ type: 'GH_RESULT', requestId: (sent[0] as { requestId: string }).requestId, ok: false, message: '找不到，或者冇權限。' });
  await assert.rejects(refused, /找不到/);
  await assert.rejects(new GhClient(() => false).call('repo', {}), /未連線/);
  await assert.rejects(client.call('repo', {}), /沒有回應/);
  const pending = client.call('repo', {});
  client.rejectAll('連線中斷');
  await assert.rejects(pending, /連線中斷/);
});

test('the same client talks to Drive: it sends DRIVE events and only listens for DRIVE answers', async () => {
  const sent: ClientEvent[] = [];
  const client = new GhClient(event => { sent.push(event); return true; }, 1000, 'DRIVE');
  const call = client.call<{ n: number }>('list', { account: 'a', path: '' });
  const request = sent[0] as { type: string; requestId: string };
  assert.equal(request.type, 'DRIVE');
  client.handle({ type: 'GH_RESULT', requestId: request.requestId, ok: true, data: { n: 0 } });
  client.handle({ type: 'DRIVE_RESULT', requestId: request.requestId, ok: true, data: { n: 7 } });
  assert.deepEqual(await call, { n: 7 });
});
