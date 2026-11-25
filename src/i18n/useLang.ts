import { useCallback, useSyncExternalStore } from 'react';
import { getLang, subscribeLang, translate, type I18nKey } from './index';

/** The current interface language and a `t` that re-renders the component when the language changes. */
export function useT() {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  const t = useCallback((key: I18nKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  return { t, lang };
}
