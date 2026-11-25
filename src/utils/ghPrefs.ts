/** Small things a panel remembers on this device, under its own prefix; a blocked store is not an error. */
export const makePrefs = (prefix: string) => ({
  get(key: string, storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string | undefined {
    try { return storage?.getItem(prefix + key) ?? undefined; } catch { return undefined; }
  },
  set(key: string, value: string, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()) {
    try { storage?.setItem(prefix + key, value); } catch { /* A private window may not keep it. */ }
  },
});

/** What the GitHub panel remembers: the repo, the tab, and the branch picked for each repo. */
export const ghPrefs = makePrefs('komorebi-gh-');
/** What the Drive panel remembers: the account, and the folder last open in each account. */
export const drivePrefs = makePrefs('komorebi-drive-');
function safeStorage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export const ghKeys = { repo: 'repo', tab: 'tab', branch: (repo: string) => `branch:${repo}` } as const;
