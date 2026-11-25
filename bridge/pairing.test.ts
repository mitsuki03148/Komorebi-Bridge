import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairingBanner, resolvePairingKey } from './pairing';

test('pairing key prefers the environment, then Keychain, and never prints a fixed key', async () => {
  const fixed = 'k'.repeat(32);
  assert.deepEqual(await resolvePairingKey(fixed, async () => 'other'.repeat(10)), { key: fixed, source: 'environment' });
  await assert.rejects(resolvePairingKey('short'));
  const fromKeychain = await resolvePairingKey(undefined, async () => fixed);
  assert.deepEqual(fromKeychain, { key: fixed, source: 'keychain' });
  assert.doesNotMatch(pairingBanner('keychain', fixed), new RegExp(fixed));
  assert.doesNotMatch(pairingBanner('environment', fixed), new RegExp(fixed));
  const short = await resolvePairingKey(undefined, async () => 'tooShort');
  assert.equal(short.source, 'random');
  assert.match(short.warning!, /少過 24/);
  const missing = await resolvePairingKey(undefined, async () => undefined);
  assert.equal(missing.source, 'random');
  assert.equal(missing.warning, undefined);
  assert.match(pairingBanner('random', missing.key), new RegExp(missing.key));
});
