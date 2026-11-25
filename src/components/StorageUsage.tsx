import { useEffect, useState } from 'react';
import { ChevronRight, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import { useT } from '../i18n/useLang';
import { localeOf } from '../i18n';
import type { StorageUsage } from '../../bridge/storage-usage';
import type { CleanupReason } from '../../bridge/auto-worktree';

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const reasonKey: Record<CleanupReason, 'worktree.unfinished' | 'worktree.tooRecent' | 'worktree.dirty' | 'worktree.unpushed' | 'worktree.running' | 'worktree.protected' | 'worktree.unverified'> = {
  unfinished: 'worktree.unfinished', tooRecent: 'worktree.tooRecent', dirty: 'worktree.dirty', unpushed: 'worktree.unpushed',
  running: 'worktree.running', protected: 'worktree.protected', unverified: 'worktree.unverified',
};

const detailsBox = 'group overflow-hidden rounded-xl border border-[#EFE6DA] dark:border-[#2C3450] bg-[#FBF8F3]/75 dark:bg-[#161C30]/80';
const summaryRow = 'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-[#5C4E44] dark:text-[#D4DCF0] transition hover:bg-[#F5EFE6]/80 dark:hover:bg-[#1E253D]/80 [&::-webkit-details-marker]:hidden';

export function StoragePanel({ data, request }: { data?: StorageUsage; request: (days: number) => void }) {
  const { t, lang } = useT();
  const [days, setDays] = useState(7);
  useEffect(() => { request(7); }, []);
  return (
    <section
      className="space-y-3 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3.5"
      aria-label={t('storage.title')}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]">
          <HardDrive className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('storage.title')}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#7D6D61] dark:text-[#A4AECC]">{t('storage.scope')}</p>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2 rounded-xl border border-[#EFE6DA] dark:border-[#2C3450] bg-[#FAF6F0] dark:bg-[#161C30] px-3 py-2"
        onSubmit={event => { event.preventDefault(); request(days); }}
      >
        <label htmlFor="storage-days" className="text-xs font-semibold text-[#5C4E44] dark:text-[#C5CDE3]">{t('storage.days')}</label>
        <input
          id="storage-days"
          type="number"
          min={1}
          max={3650}
          value={days}
          onChange={event => setDays(Number(event.target.value))}
          className="w-20 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-3 py-1 text-center text-sm font-semibold tabular-nums text-[#4A3E36] dark:text-[#ECE7DF] focus:border-[#D9828B] focus:outline-none focus:ring-2 focus:ring-[#D9828B]/25"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white dark:bg-[#232B45] px-3.5 py-1.5 text-xs font-bold text-[#6E5D52] dark:text-[#D4DCF0] shadow-2xs transition hover:border-[#EBC5CA] hover:bg-[#FCEEF2] hover:text-[#9E4E68] dark:hover:border-[#59354B] dark:hover:bg-[#312338] dark:hover:text-[#F4B6C4] active:scale-95 cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {t('storage.refresh')}
        </button>
      </form>

      {!data ? (
        <p role="status" className="flex items-center gap-1.5 px-1 py-1 text-xs text-[#7D6D61] dark:text-[#A4AECC]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D9828B] dark:text-[#EFA4B2]" aria-hidden="true" />
          {t('storage.loading')}
        </p>
      ) : (
        <>
          {data.incomplete && (
            <p role="alert" className="rounded-xl border border-[#EBC5CA]/80 dark:border-[#59354B] bg-[#FFF5F7] dark:bg-[#2B1D27] px-3 py-2 text-xs text-[#9A4B4F] dark:text-[#F0A8AC]">
              {t('storage.incomplete')}
            </p>
          )}

          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-xl border border-[#F0D4D8] dark:border-[#49324B] bg-[#FFF7F8] dark:bg-[#261B2A] px-2.5 py-2 text-center">
              <div className="text-[10px] font-bold tracking-wide text-[#C85A68] dark:text-[#EFA4B2]">AGY</div>
              <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#5C3A47] dark:text-[#FADCE4]">{size(data.totals.AGY)}</div>
            </div>
            <div className="rounded-xl border border-[#D3E4D5] dark:border-[#2E4440] bg-[#F6FBF7] dark:bg-[#192624] px-2.5 py-2 text-center">
              <div className="text-[10px] font-bold tracking-wide text-[#4E7A55] dark:text-[#96C7A3]">Codex</div>
              <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#35523A] dark:text-[#D5EEDB]">{size(data.totals.CODEX)}</div>
            </div>
            <div className="rounded-xl border border-[#D4DFEC] dark:border-[#343C60] bg-[#F6F9FD] dark:bg-[#1C223A] px-2.5 py-2 text-center">
              <div className="text-[10px] font-bold tracking-wide text-[#4F729B] dark:text-[#A9B7E8]">Claude</div>
              <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-[#364B6E] dark:text-[#E1E6FC]">{size(data.totals.CLAUDE)}</div>
            </div>
          </div>

          <div className="space-y-1 px-0.5 text-[11px] leading-relaxed text-[#7D6D61] dark:text-[#A4AECC]">
            {data.unmatched > 0 && <p>{t('storage.unmatched', { count: data.unmatched })}</p>}
            <p>{t('storage.external')}</p>
          </div>

          <div className="rounded-xl border border-[#EFE6DA] dark:border-[#2C3450] bg-[#FBF8F3]/80 dark:bg-[#161C30]/80 p-2.5">
            <h4 className="text-xs font-bold text-[#5C4E44] dark:text-[#ECE7DF]">{t('storage.candidates')}</h4>
            {!data.rooms.some(room => room.candidate) ? (
              <p className="mt-1 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">{t('storage.none')}</p>
            ) : (
              <ul className="mt-1.5 max-h-40 divide-y divide-[#EFE6DA] dark:divide-[#27304D] overflow-y-auto text-xs text-[#5C4E44] dark:text-[#D4DCF0]">
                {data.rooms.filter(room => room.candidate).map(room => (
                  <li key={room.id} className="py-1.5">
                    {room.name} · {room.modelId} · <span className="font-mono tabular-nums">{size(room.bytes)}</span> · {new Date(room.modified).toLocaleString(localeOf(lang))}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <details className={detailsBox}>
              <summary className={summaryRow}>
                <span>{t('storage.allRooms', { count: data.rooms.length })}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9A8778] dark:text-[#8E98B8] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
              </summary>
              <ul className="max-h-40 divide-y divide-[#EFE6DA] dark:divide-[#27304D] overflow-y-auto border-t border-[#EFE6DA] dark:border-[#2C3450] px-3 py-1 text-xs text-[#5C4E44] dark:text-[#C5CDE3]">
                {data.rooms.map(room => (
                  <li key={room.id} className="py-1.5">
                    {room.name} · {room.modelId} · <span className="font-mono tabular-nums">{size(room.bytes)}</span> · {new Date(room.modified).toLocaleString(localeOf(lang))}
                  </li>
                ))}
              </ul>
            </details>

            {data.unassigned.length > 0 && (
              <details className={detailsBox}>
                <summary className={summaryRow}>
                  <span>{t('storage.unassigned', { count: data.unassigned.length })}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9A8778] dark:text-[#8E98B8] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
                </summary>
                <div className="border-t border-[#EFE6DA] dark:border-[#2C3450] px-3 py-2 space-y-1.5">
                  <p className="text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{t('storage.unassignedHelp')}</p>
                  <ul className="max-h-40 divide-y divide-[#EFE6DA] dark:divide-[#27304D] overflow-y-auto break-all text-xs text-[#5C4E44] dark:text-[#C5CDE3]">
                    {data.unassigned.map((session, index) => (
                      <li key={`${session.modelId}:${session.id}:${index}`} className="py-1.5">
                        {session.modelId} · <span className="font-mono">{session.id}</span> · <span className="font-mono tabular-nums">{size(session.bytes)}</span> · {new Date(session.modified).toLocaleString(localeOf(lang))}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            {data.worktrees && (
              <details className={detailsBox}>
                <summary className={summaryRow}>
                  <span>{t('worktree.storage', { count: data.worktrees.length })}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9A8778] dark:text-[#8E98B8] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
                </summary>
                <div className="border-t border-[#EFE6DA] dark:border-[#2C3450] px-3 py-2 space-y-1.5">
                  <p className="text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.readOnly')}</p>
                  <p className="text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.isolation')}</p>
                  {data.worktreeError && (
                    <p role="alert" className="rounded-lg border border-[#EBC5CA]/80 dark:border-[#59354B] bg-[#FFF5F7] dark:bg-[#2B1D27] px-2.5 py-1.5 text-xs text-[#A33A49] dark:text-[#F0A8AC]">
                      {t('worktree.registryError')}
                    </p>
                  )}
                  <ul className="max-h-40 divide-y divide-[#EFE6DA] dark:divide-[#27304D] overflow-y-auto break-all text-xs text-[#5C4E44] dark:text-[#C5CDE3]">
                    {data.worktrees.map(tree => (
                      <li key={tree.ticketId} className={`py-1.5 ${tree.oversized ? 'text-[#A33A49] dark:text-[#F09AA6]' : ''}`}>
                        #{tree.ticketId} · <span className="font-mono">{tree.path}</span> · {tree.bytes === undefined ? t('worktree.unknown') : size(tree.bytes)}{tree.oversized && ` · ${t('worktree.oversized')}`}
                        <br />
                        <span className="text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">
                          {tree.candidate ? t('worktree.candidate') : tree.reasons.map(reason => t(reasonKey[reason])).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}
