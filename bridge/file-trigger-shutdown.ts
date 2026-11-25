/** Stop all file-trigger observers and pending retries after invalid Keychain/config state. */
export function stopFileTriggerObservers<T extends { close(): void }>(options: {
  watches: Map<string, T>;
  returns: Map<string, () => void>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  onStopped(id: string): void;
}) {
  for (const timer of options.timers.values()) clearTimeout(timer);
  options.timers.clear();
  // close() can synchronously mutate the map through a status callback.
  for (const [id, watcher] of [...options.watches]) {
    try { watcher.close(); } catch { /* Continue closing the remaining observers. */ }
    options.onStopped(id);
  }
  options.watches.clear();
  for (const stop of options.returns.values()) { try { stop(); } catch { /* Close the others. */ } }
  options.returns.clear();
}
