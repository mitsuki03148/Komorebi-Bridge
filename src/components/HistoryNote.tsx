import { useT } from '../i18n/useLang';
import { useEffect, useRef, useState } from 'react';
import { HISTORY_MAX } from '../utils/history';

/**
 * Sits at the top of a conversation that has older messages not shown. Reaching it loads more, as in a
 * chat app, and the button does the same where scrolling is awkward. Without a loader it only says so.
 */
export function HistoryNote({ truncated, count, onLoadMore }: { truncated?: boolean; count: number; onLoadMore?: () => void }) {
  const { t } = useT();
  const [pending, setPending] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const lastLoad = useRef(0);
  const atMax = count >= HISTORY_MAX;
  const load = () => {
    // One request at a time, and not again within 1.5 seconds, so a note that stays on screen cannot loop.
    if (!onLoadMore || pending || atMax || Date.now() - lastLoad.current < 1_500) return;
    lastLoad.current = Date.now();
    setPending(true);
    onLoadMore();
  };

  useEffect(() => { setPending(false); }, [count, truncated]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(false), 10_000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    const element = holder.current;
    if (!element || !onLoadMore || !truncated || atMax || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onLoadMore, truncated, count, pending]);

  if (!truncated) return null;
  return (
    <div ref={holder} role="note" className="py-1 text-center text-[11px] text-[#8C7A6E]">
      {onLoadMore && !atMax ? (
        <button type="button" onClick={load} disabled={pending}
          className="min-h-9 rounded-full border border-[#E2D6C5] bg-white/80 px-4 font-semibold text-[#6E5D52] disabled:opacity-60">
          {pending ? t('history.loading') : t('history.more', { count })}
        </button>
      ) : (
        <p>{atMax ? t('history.max', { max: HISTORY_MAX }) : t('history.recent', { count })}</p>
      )}
    </div>
  );
}
