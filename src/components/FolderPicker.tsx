import { useEffect, useState } from 'react';
import { ChevronUp, Folder } from 'lucide-react';
import { useT } from '../i18n/useLang';

export interface FolderListing { path: string; parent: string | null; dirs: string[] }

/** A folder path that can be typed or browsed. `onBrowse` asks the Bridge for the sub-folders of a folder; `listing` is its answer. */
export function FolderPicker({ value, onChange, onBrowse, listing, label, browsing }: {
  value: string; onChange: (path: string) => void; onBrowse: (path: string) => void; listing?: FolderListing; label: string; browsing?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(Boolean(browsing));
  useEffect(() => { if (open && !listing) onBrowse(value.trim() || '/'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          className="min-w-0 flex-1 rounded-full border border-[#E6DCD0] dark:border-[#343D5E] bg-[#F7F2E9] dark:bg-[#141A2C] px-3 py-1.5 font-mono text-base text-[#4A3E36] dark:text-[#ECE7DF] sm:text-[11px]" />
        <button type="button" aria-label={t('settings.folder.browse')} aria-pressed={open} onClick={() => { if (!open) onBrowse(value.trim() || '/'); setOpen(!open); }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5DAC9] dark:border-[#364062] dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] aria-pressed:bg-[#FFF5F6] dark:aria-pressed:bg-[#312338]"><Folder className="h-4 w-4" /></button>
      </div>
      {open && (
        <div className="space-y-1 rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#181E33] p-2" data-folder-browser>
          {listing ? (
            <>
              <p className="break-all font-mono text-[11px] text-[#5C4D43] dark:text-[#C5CDE3]">{listing.path}</p>
              {/* Keyed by the folder: opening one starts its list at the top, not where the last list had been scrolled to. */}
              <div key={listing.path} className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain">
                {listing.parent !== null && (
                  <button type="button" onClick={() => onBrowse(listing.parent!)} className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left font-semibold text-[#7D6D61] dark:text-[#A4AECC] hover:bg-[#FBF8F3] dark:hover:bg-[#242C48]">
                    <ChevronUp className="h-3.5 w-3.5" />{t('settings.folder.parent')}
                  </button>
                )}
                {listing.dirs.map(name => (
                  <button key={name} type="button" onClick={() => onBrowse(`${listing.path.replace(/\/$/, '')}/${name}`)}
                    className="flex min-h-9 w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[#4A3E36] dark:text-[#ECE7DF] hover:bg-[#FBF8F3] dark:hover:bg-[#242C48]"><Folder className="h-3.5 w-3.5 shrink-0 text-[#689B73] dark:text-[#96BD9F]" /><span className="min-w-0 break-all">{name}</span></button>
                ))}
                {!listing.dirs.length && <p className="px-2 py-1 text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.folder.empty')}</p>}
              </div>
              <button type="button" onClick={() => { onChange(listing.path); setOpen(false); }}
                className="min-h-9 w-full rounded-full border border-[#D9828B] dark:border-[#EFA4B2]/70 px-3 py-1.5 font-bold text-[#B35C68] dark:text-[#F4B4C2]">{t('settings.folder.select')}</button>
            </>
          ) : <p className="px-2 py-1 text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.folder.loading')}</p>}
        </div>
      )}
    </div>
  );
}
