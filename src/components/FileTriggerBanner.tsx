import { useT } from '../i18n/useLang';
import type { FileTriggerItem } from '../types/bridge';

/** The same in-flow banner is shown immediately before the composer on phone and desktop. */
export function FileTriggerBanner({ stale, offline, onReview, onResume }: {
  stale: boolean; offline?: FileTriggerItem; onReview: () => void; onResume: (item: FileTriggerItem) => void;
}) {
  const { t } = useT();
  if (!stale && !offline) return null;
  const safePath = offline?.path.replace(/[\u0000-\u001f\u007f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`) ?? '';
  const name = safePath.split('/').filter(Boolean).at(-1) || safePath;
  return <section aria-label={t(stale ? 'fileTrigger.bannerStaleLabel' : 'fileTrigger.bannerOfflineLabel')}
    className={stale ? 'space-y-1 rounded-xl border border-[#E5C9C9] bg-[#FFF1F3] p-2 dark:border-[#7C4054] dark:bg-[#321E2A]' : 'space-y-1 rounded-xl border border-[#E9D7A8] bg-[#FFF8E2] p-2 dark:border-[#6E5934] dark:bg-[#2C2519]'}>
    <p role="status" className={stale ? 'truncate text-xs font-semibold text-[#8D4051] dark:text-[#F0ACB7]' : 'truncate text-xs font-semibold text-[#75551E] dark:text-[#F0C882]'}
      title={stale ? undefined : safePath}>{stale ? t('fileTrigger.bannerStale') : t('fileTrigger.bannerOffline', { path: name })}</p>
    {stale ? <button type="button" onClick={onReview} className="min-h-11 w-full rounded-xl bg-[#9F5264] px-3 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#965069]">{t('fileTrigger.bannerReview')}</button> :
      <button type="button" disabled={!offline?.offlineToken} onClick={() => offline && onResume(offline)} aria-label={t('fileTrigger.bannerResumeLabel', { path: safePath })}
        className="min-h-11 w-full rounded-xl bg-[#805F2E] px-3 text-sm font-bold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#805F2E]">{t('fileTrigger.bannerResume')}</button>}
  </section>;
}
