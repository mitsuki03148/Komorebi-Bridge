import { makePrefs } from '../utils/ghPrefs';
import { en } from './en';
import { ja } from './ja';
import { zh, type I18nKey } from './zh';

export type Lang = 'zh' | 'en' | 'ja';
export const languages: Lang[] = ['zh', 'en', 'ja'];
export type { I18nKey };

const store = makePrefs('komorebi-ui-');
const tables: Record<Lang, Partial<Record<I18nKey, string>>> = { zh, en, ja };
const isLang = (value: unknown): value is Lang => value === 'zh' || value === 'en' || value === 'ja';

let current: Lang = 'zh';
const listeners = new Set<() => void>();

function syncWorkerLang(lang: Lang) {
  try {
    if (typeof caches !== 'undefined' && typeof Response !== 'undefined') {
      void caches.open('komorebi-prefs').then(cache => cache.put('/__komorebi_lang', new Response(lang))).catch(() => {});
    }
  } catch { /* Cache Storage unavailable outside a browser. */ }
}

/** The language saved on this device; Chinese when nothing is saved. */
export function readLang(): Lang {
  const saved = store.get('lang');
  return isLang(saved) ? saved : 'zh';
}
current = readLang();
syncWorkerLang(current);

export const getLang = () => current;
export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  store.set('lang', next);
  syncWorkerLang(next);
  try { document.documentElement.lang = next === 'zh' ? 'zh-Hant' : next; } catch { /* No document outside a browser. */ }
  listeners.forEach(listener => listener());
}
export function subscribeLang(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The locale to format dates and times in for a language. */
export const localeOf = (lang: Lang) => (lang === 'zh' ? 'zh-HK' : lang === 'ja' ? 'ja-JP' : 'en-GB');

/** The text for a key in a language, with `{name}` values filled in. A missing translation shows the Chinese text. */
export function translate(lang: Lang, key: I18nKey, vars?: Record<string, string | number>): string {
  const text = tables[lang][key] ?? zh[key];
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}
export const t = (key: I18nKey, vars?: Record<string, string | number>) => translate(current, key, vars);
