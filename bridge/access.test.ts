import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessScope, isProxied, originAllowed, tailnetAddress } from './access';

const serveHost = 'mac.tailnet-name.ts.net';
const base: Parameters<typeof accessScope>[0] = { peer: '127.0.0.1', local: '127.0.0.1', host: 'localhost:3000', headers: {}, port: 3000, tailscaleIp: '100.101.102.103', serveHost };
const scope = (change: Partial<typeof base>) => accessScope({ ...base, ...change });

test('only a program on this Mac talking to localhost directly is trusted without the pairing key', () => {
  assert.equal(scope({}), 'local');
  assert.equal(scope({ host: '127.0.0.1:3000' }), 'local');
  assert.equal(scope({ host: 'localhost:4000' }), undefined);
  assert.equal(scope({ peer: '192.168.1.20' }), undefined);
});

test('a request that came through a proxy is never local, even when its Host says localhost', () => {
  // This is what Tailscale Serve would produce if it rewrote Host to the backend address: it must not skip pairing.
  for (const headers of [{ 'x-forwarded-for': '100.64.1.2' }, { 'tailscale-user-login': 'someone@example.com' }, { 'x-forwarded-host': serveHost },
    { 'x-forwarded-proto': 'https' }, { forwarded: 'for=1.2.3.4' }, { 'tailscale-user-name': 'Someone' }]) {
    assert.equal(isProxied(headers), true);
    assert.notEqual(scope({ headers }), 'local', JSON.stringify(headers));
  }
  assert.equal(scope({ headers: { 'tailscale-user-login': 'a@b.c' } }), undefined);
  assert.equal(isProxied({ accept: '*/*', host: 'localhost:3000' }), false);
});

test('Tailscale Serve is accepted only with this Mac\'s own Serve host name and a Tailscale identity', () => {
  const identity = { 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': '100.64.9.9' };
  assert.equal(scope({ host: serveHost, headers: identity }), 'serve');
  assert.equal(scope({ host: serveHost, headers: { 'x-forwarded-for': '1.2.3.4' } }), undefined, 'public Funnel traffic has no identity');
  assert.equal(scope({ host: serveHost, headers: { ...identity, 'tailscale-user-login': '  ' } }), undefined);
  assert.equal(scope({ host: 'other.ts.net', headers: identity }), undefined);
  assert.equal(scope({ host: serveHost, headers: identity, serveHost: null }), undefined);
  assert.equal(scope({ host: serveHost, headers: identity, peer: '192.168.1.20' }), undefined, 'must arrive from the Serve proxy on loopback');
  assert.equal(scope({ host: serveHost, headers: identity, peer: '100.64.9.9', local: '100.101.102.103' }), undefined);
});

test('a tailnet device on the plain Tailscale address works as before, and nothing else on the network does', () => {
  const tailnet = { peer: '100.64.9.9', local: '100.101.102.103', host: '100.101.102.103:3000' };
  assert.equal(scope(tailnet), 'tailnet');
  assert.equal(scope({ ...tailnet, host: 'evil.example.com:3000' }), undefined);
  assert.equal(scope({ ...tailnet, local: '192.168.1.5', host: '192.168.1.5:3000' }), undefined);
  assert.equal(scope({ ...tailnet, peer: '8.8.8.8' }), undefined);
  assert.equal(scope({ ...tailnet, tailscaleIp: null }), undefined);
  assert.equal(tailnetAddress('100.64.0.1') && tailnetAddress('100.127.255.1'), true);
  assert.equal(tailnetAddress('100.128.0.1') || tailnetAddress('10.0.0.1') || tailnetAddress('not an ip'), false);
});

test('a WebSocket must come from the page it is served on, over https for Serve', () => {
  assert.equal(originAllowed('local', 'http://localhost:3000', 'localhost:3000'), true);
  assert.equal(originAllowed('tailnet', 'http://100.101.102.103:3000', '100.101.102.103:3000'), true);
  assert.equal(originAllowed('serve', `https://${serveHost}`, serveHost), true);
  assert.equal(originAllowed('serve', `http://${serveHost}`, serveHost), false);
  assert.equal(originAllowed('local', 'https://localhost:3000', 'localhost:3000'), false);
  assert.equal(originAllowed('serve', 'https://evil.example.com', serveHost), false);
  assert.equal(originAllowed(undefined, 'http://localhost:3000', 'localhost:3000'), false);
  assert.equal(originAllowed('local', undefined, 'localhost:3000'), false);
});
