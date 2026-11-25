import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * Best-effort notification only. Every delivery and mutation must independently verify
 * the signature and Keychain anchor: fs.watch can miss events, including at startup.
 * onObserved is an optional local observer used to establish test readiness.
 */
export function watchTriggerConfig(path: string, valid: () => boolean, failed: () => void, onObserved?: () => void): FSWatcher {
  let stopped = false;
  const fail = () => { if (!stopped) { stopped = true; watcher.close(); failed(); } };
  const watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
    if (!name || name.toString() === basename(path)) {
      if (!valid()) fail();
      else onObserved?.();
    }
  });
  watcher.on('error', fail);
  watcher.on('close', () => { stopped = true; });
  // Synchronous check closes changes before/during registration. A second one-shot
  // check narrows the native watch startup window; it is not a readiness guarantee.
  if (!valid()) queueMicrotask(fail);
  else setImmediate(() => { if (!stopped && !valid()) fail(); }).unref();
  return watcher;
}
