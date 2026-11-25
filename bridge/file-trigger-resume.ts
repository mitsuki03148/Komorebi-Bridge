/** One confirmed offline generation may be resumed only once, in the current Bridge process. */
export function resumeOfflineTrigger(options: {
  token: string;
  expectedToken?: string;
  isOffline(): boolean;
  validate(): void;
  consume(): void;
  start(): boolean;
  refreshAfterFailure(): void;
}): 'accepted' | 'stale' | 'invalid' | 'failed' {
  if (!options.isOffline() || !options.expectedToken || options.token !== options.expectedToken) return 'stale';
  try { options.validate(); } catch { options.refreshAfterFailure(); return 'invalid'; }
  options.consume();
  try { if (options.start()) return 'accepted'; } catch { /* remains offline */ }
  options.refreshAfterFailure();
  return 'failed';
}
