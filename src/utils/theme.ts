import { useCallback, useSyncExternalStore } from 'react';
import { makePrefs } from './ghPrefs';

export type ThemeMode = 'auto' | 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const themeModes: ThemeMode[] = ['auto', 'system', 'light', 'dark'];
export const DAY_THEME_COLOR = '#FBF8F3';
export const NIGHT_THEME_COLOR = '#121624';

const store = makePrefs('komorebi-ui-');
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'auto' || value === 'system' || value === 'light' || value === 'dark';

/** Night runs from 18:00 through 05:59 local time when automatic schedule is active. */
export const isNightHour = (date: Date = new Date()): boolean => {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
};

export const readSystemDark = (): boolean => {
  try {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
};

export function resolveTheme(
  mode: ThemeMode,
  options?: { date?: Date; systemDark?: boolean },
): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (mode === 'system') return (options?.systemDark ?? readSystemDark()) ? 'dark' : 'light';
  return isNightHour(options?.date) ? 'dark' : 'light';
}

export function readThemeMode(): ThemeMode {
  const saved = store.get('theme');
  return isThemeMode(saved) ? saved : 'auto';
}

let currentMode: ThemeMode = readThemeMode();
let currentResolved: ResolvedTheme = resolveTheme(currentMode);
const listeners = new Set<() => void>();

export function applyThemeToDocument(mode: ThemeMode = currentMode, resolved: ResolvedTheme = currentResolved) {
  if (typeof document === 'undefined') return;
  try {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.dataset.theme = mode;
    root.dataset.resolvedTheme = resolved;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', resolved === 'dark' ? NIGHT_THEME_COLOR : DAY_THEME_COLOR);
    const colorScheme = document.querySelector('meta[name="color-scheme"]');
    if (colorScheme) colorScheme.setAttribute('content', resolved);
  } catch { /* No DOM outside a browser. */ }
}

function syncResolved() {
  const next = resolveTheme(currentMode);
  const changed = next !== currentResolved;
  currentResolved = next;
  applyThemeToDocument(currentMode, currentResolved);
  if (changed) listeners.forEach(listener => listener());
}

export const getThemeMode = () => currentMode;
export const getResolvedTheme = () => currentResolved;

export function setThemeMode(next: ThemeMode) {
  const modeChanged = next !== currentMode;
  currentMode = next;
  store.set('theme', next);
  const nextResolved = resolveTheme(next);
  const resolvedChanged = nextResolved !== currentResolved;
  currentResolved = nextResolved;
  applyThemeToDocument(currentMode, currentResolved);
  if (modeChanged || resolvedChanged) listeners.forEach(listener => listener());
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let syncStarted = false;
export function initThemeSync() {
  applyThemeToDocument(currentMode, currentResolved);
  if (syncStarted || typeof window === 'undefined' || typeof document === 'undefined') return;
  syncStarted = true;
  try {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (currentMode === 'system') syncResolved();
    };
    media?.addEventListener?.('change', onMediaChange);
  } catch { /* Older browser without matchMedia listener. */ }
  const timer = window.setInterval(() => {
    if (currentMode === 'auto') syncResolved();
  }, 60_000);
  (timer as { unref?: () => void })?.unref?.();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncResolved();
  });
}

/** Reactive theme hook: returns current selection (`auto`|`system`|`light`|`dark`), resolved theme (`light`|`dark`), and setter. */
export function useTheme() {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode, getThemeMode);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme, getResolvedTheme);
  const setMode = useCallback((next: ThemeMode) => setThemeMode(next), []);
  return { mode, resolved, isDark: resolved === 'dark', setMode };
}
