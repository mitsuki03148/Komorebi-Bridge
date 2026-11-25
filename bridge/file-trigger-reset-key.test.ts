import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetWithKey } from './file-trigger-reset-key';
const key = Buffer.alloc(32, 5);
const fake = () => ({ readable: false, stalePreview: () => undefined, resetInvalid: () => true });
test('explicit reset creates only a missing dedicated key, then resets the invalid store', () => {
 let creates = 0, resets = 0;
 const result = resetWithKey({ read: () => ({ state: 'missing' }), provisionMissing: () => { creates++; return { state: 'available', key }; },
  createStore: actual => { assert.equal(actual, key); return { ...fake(), resetInvalid: () => { resets++; return true; } }; } });
 assert.equal(creates, 1); assert.equal(resets, 1); assert.equal(result.readable, false);
});
test('existing key is not replaced; unavailable key, valid and stale stores never reset', () => {
 let creates = 0, resets = 0;
 const make = () => ({ ...fake(), resetInvalid: () => { resets++; return true; } });
 const provisionMissing = () => { creates++; return { state: 'available' as const, key }; };
 resetWithKey({ read: () => ({ state: 'available', key }), provisionMissing, createStore: make });
 assert.equal(creates, 0); assert.equal(resets, 1);
 assert.throws(() => resetWithKey({ read: () => ({ state: 'unavailable' }), provisionMissing, createStore: make }));
 assert.throws(() => resetWithKey({ read: () => ({ state: 'available', key }), provisionMissing, createStore: () => ({ ...make(), readable: true }) }));
 assert.throws(() => resetWithKey({ read: () => ({ state: 'available', key }), provisionMissing, createStore: () => ({ ...make(), stalePreview: () => ({ sha: 'old' }) }) }));
 assert.equal(creates, 0); assert.equal(resets, 1);
});
