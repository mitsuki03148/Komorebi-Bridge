import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Folder, Loader2 } from 'lucide-react';
import { useT } from '../i18n/useLang';

export interface FolderListing { path: string; parent: string | null; dirs: string[] }

function pathSegments(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.map((name, index) => ({ name, target: '/' + parts.slice(0, index + 1).join('/') }));
}

/** A folder path that can be typed or browsed. `onBrowse` asks the Bridge for the sub-folders of a folder; `listing` is its answer. */
export function FolderPicker({ value, onChange, onBrowse, listing, label, browsing }: {
  value: string; onChange: (path: string) => void; onBrowse: (path: string) => void; listing?: FolderListing; label: string; browsing?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(Boolean(browsing));
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const crumbsRef = useRef<HTMLElement>(null);
  useEffect(() => { if (open && !listing) onBrowse(value.trim() || '/'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPendingPath(null);
    if (crumbsRef.current) crumbsRef.current.scrollLeft = crumbsRef.current.scrollWidth;
  }, [listing?.path]);

  const navigate = (target: string) => {
    setPendingPath(target);
    onBrowse(target);
  };
  const segments = listing ? pathSegments(listing.path) : [];

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          className="min-w-0 flex-1 rounded-full border border-[#E6DCD0] dark:border-[#343D5E] bg-[#F7F2E9] dark:bg-[#141A2C] px-3 py-1.5 font-mono text-base text-[#4A3E36] dark:text-[#ECE7DF] transition-colors focus-visible:border-[#A24D6D] dark:focus-visible:border-[#D489A4] sm:text-[11px]" />
        <button type="button" aria-label={t('settings.folder.browse')} aria-pressed={open} onClick={() => { if (!open) navigate(value.trim() || '/'); setOpen(!open); }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5DAC9] dark:border-[#364062] bg-white/80 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition-all duration-150 hover:bg-[#FAF5EE] dark:hover:bg-[#2B3554] active:scale-95 aria-pressed:border-[#E3B5C5] aria-pressed:bg-[#FCF0F4] aria-pressed:text-[#9F4E6B] dark:aria-pressed:border-[#754E66] dark:aria-pressed:bg-[#312338] dark:aria-pressed:text-[#F0B4C8]"><Folder className="h-4 w-4" /></button>
      </div>
      {open && (
        <div className="guild-sheet-in space-y-2 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-[#FFFDF9] dark:bg-[#151B2E] p-2.5 shadow-[0_8px_24px_-12px_rgba(74,62,54,0.18)] dark:shadow-[0_12px_28px_-12px_rgba(4,7,18,0.55)]" data-folder-browser>
          {listing ? (
            <>
              <div className="flex items-center gap-1.5 border-b border-[#EFE7DC] pb-2 dark:border-[#27304C]">
                <button type="button" disabled={listing.parent === null} onClick={() => listing.parent !== null && navigate(listing.parent)}
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[#E5D7C6] bg-white px-2.5 text-[11px] font-semibold text-[#5C4D43] shadow-2xs transition-all duration-150 hover:border-[#D9A7B8] hover:bg-[#FCF0F4] active:scale-95 disabled:pointer-events-none disabled:opacity-35 dark:border-[#364062] dark:bg-[#212944] dark:text-[#E2E8F8] dark:hover:border-[#8C5B76] dark:hover:bg-[#2E233A]">
                  <ChevronLeft className="h-3.5 w-3.5 text-[#A24D6D] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />
                  <span>{t('settings.folder.parent')}</span>
                </button>
                <nav ref={crumbsRef} aria-label={label} title={listing.path} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 font-mono text-[11px] text-[#7D6D61] dark:text-[#9FAAC7]">
                  {segments.length === 0 ? (
                    <span className="px-1.5 font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">/</span>
                  ) : segments.map((seg, index) => {
                    const last = index === segments.length - 1;
                    return <span key={seg.target} className="inline-flex shrink-0 items-center gap-0.5">
                      {index > 0 && <ChevronRight className="h-3 w-3 text-[#C2B3A6] dark:text-[#5B6687]" aria-hidden="true" />}
                      <button type="button" disabled={last} onClick={() => navigate(seg.target)}
                        className={`rounded-full px-1.5 py-0.5 transition-colors active:scale-95 ${last ? 'font-semibold text-[#4A3E36] dark:text-[#ECE7DF]' : 'hover:bg-[#F5ECE0] hover:text-[#4A3E36] dark:hover:bg-[#232C49] dark:hover:text-[#ECE7DF]'}`}>
                        {seg.name}
                      </button>
                    </span>;
                  })}
                </nav>
                {pendingPath && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#A24D6D] dark:text-[#EFA4B2]" aria-hidden="true" />}
              </div>
              {/* Keyed by the folder: opening one starts its list at the top, not where the last list had been scrolled to. */}
              <div key={listing.path} className={`relative max-h-52 sm:max-h-60 space-y-1 overflow-y-auto overscroll-contain transition-opacity duration-150 ${pendingPath ? 'opacity-65' : ''}`}>
                {listing.dirs.map(name => {
                  const target = `${listing.path.replace(/\/$/, '')}/${name}`;
                  const loadingThis = pendingPath === target;
                  return <button key={name} type="button" onClick={() => navigate(target)}
                    className={`group flex min-h-10 sm:min-h-9 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-all duration-150 active:scale-[0.985] ${loadingThis ? 'bg-[#FCF0F4] text-[#7A3851] ring-1 ring-inset ring-[#E9C4D2] dark:bg-[#2A2136] dark:text-[#F4C4D4] dark:ring-[#754E66]/70' : 'text-[#4A3E36] hover:bg-[#F6EFE6] active:bg-[#FCF0F4] dark:text-[#ECE7DF] dark:hover:bg-[#212A45] dark:active:bg-[#2A2136]'}`}>
                    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EBF4EC] text-[#5A8D66] dark:bg-[#1F322B] dark:text-[#96C7A3]">
                      <Folder className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 break-all font-medium">{name}</span>
                    {loadingThis
                      ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#A24D6D] dark:text-[#EFA4B2]" aria-hidden="true" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#C2B3A6] transition-transform duration-150 group-hover:translate-x-0.5 dark:text-[#5F6A8C]" aria-hidden="true" />}
                  </button>;
                })}
                {!listing.dirs.length && <p className="px-2 py-3 text-center text-[#7D6D61] dark:text-[#98A3C2]">{t('settings.folder.empty')}</p>}
                {listing.dirs.length > 4 && <div aria-hidden="true" className="pointer-events-none sticky bottom-0 h-4 bg-gradient-to-t from-[#FFFDF9] to-transparent dark:from-[#151B2E]" />}
              </div>
              <button type="button" onClick={() => { onChange(listing.path); setOpen(false); }}
                className="min-h-10 sm:min-h-9 w-full rounded-full border border-[#DF99A9] bg-[#FCF2F5] px-3 py-1.5 font-bold text-[#9F4E6B] transition-all duration-150 hover:bg-[#F9E6EC] active:scale-[0.985] dark:border-[#8C5B76] dark:bg-[#2A2034] dark:text-[#F4B8CA] dark:hover:bg-[#352742]">{t('settings.folder.select')}</button>
            </>
          ) : <p className="flex items-center gap-2 px-2 py-3 text-[#7D6D61] dark:text-[#A4AECC]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[#A24D6D] dark:text-[#EFA4B2]" aria-hidden="true" />{t('settings.folder.loading')}</p>}
        </div>
      )}
    </div>
  );
}
