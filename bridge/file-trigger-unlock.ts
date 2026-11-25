import type { KeychainRead } from './file-trigger-keychain';

/**
 * Unlock without losing anything: load a new store from the configuration file and the Keychain anchor, and give it back only if it verifies.
 * It believes nothing outside the anchor (the same load a restart does), so a tampered or stale file stays locked and is never repaired here.
 */
export function unlockWithKey<T extends { readable: boolean }>(deps: { read(): KeychainRead; createStore(key: Buffer): T }): T | undefined {
  const key = deps.read();
  if (key.state !== 'available') return;
  const fresh = deps.createStore(key.key);
  return fresh.readable ? fresh : undefined;
}

/** Lets an automatic try through at most once per `ms`; an explicit action by the Founder always goes through. */
export function reloadGate(ms: number, now: () => number = Date.now) {
  let last = -Infinity;
  return (force = false) => {
    const at = now();
    if (!force && at - last < ms) return false;
    last = at;
    return true;
  };
}
