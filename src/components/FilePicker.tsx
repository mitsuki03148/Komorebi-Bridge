import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Folder, Loader2 } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { FolderListing } from './FolderPicker';

export interface FileListing extends FolderListing { files: string[]; error?: string }

const row = 'group flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[#4A3E36] dark:text-[#ECE7DF] transition-all duration-150 hover:bg-[#F6EFE6] active:scale-[0.985] active:bg-[#FCF0F4] dark:hover:bg-[#212A45] dark:active:bg-[#2A2136] focus-visible:outline-[#A24D6D]';
const child = (path: string, name: string) => `${path.replace(/\/$/, '')}/${name}`;

function pathSegments(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.map((name, index) => ({ name, target: '/' + parts.slice(0, index + 1).join('/') }));
}

export function FilePicker({ listing, root, onBrowse, onChoose, onChooseDirectory }: {
  listing?: FileListing; root: string; onBrowse: (path: string) => void; onChoose: (path: string) => void; onChooseDirectory?: (path: string) => void;
}) {
  const { t } = useT();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const crumbsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setPendingPath(null);
    if (crumbsRef.current) crumbsRef.current.scrollLeft = crumbsRef.current.scrollWidth;
  }, [listing?.path]);

  const navigate = (target: string) => {
    setPendingPath(target);
    onBrowse(target);
  };
  const segments = listing ? pathSegments(listing.path) : [];

  return <div data-board-file-picker className="space-y-2 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-[#FFFDF9] dark:bg-[#141A2C] p-2.5 text-xs">
    {!listing ? <p role="status" className="flex items-center gap-2 px-2 py-3 text-[#7D6D61] dark:text-[#A4AECC]"><Loader2 className="h-3.5 w-3.5 animate-spin text-[#A24D6D] dark:text-[#EFA4B2]" aria-hidden="true" />{t('settings.folder.loading')}</p> : <>
      <div className="flex items-center gap-1.5 border-b border-[#EFE7DC] pb-2 dark:border-[#27304C]">
        <button type="button" disabled={listing.parent === null} onClick={() => listing.parent !== null && navigate(listing.parent)}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[#E5D7C6] bg-white px-2.5 text-[11px] font-semibold text-[#5C4D43] shadow-2xs transition-all duration-150 hover:border-[#D9A7B8] hover:bg-[#FCF0F4] active:scale-95 disabled:pointer-events-none disabled:opacity-35 dark:border-[#364062] dark:bg-[#212944] dark:text-[#E2E8F8] dark:hover:border-[#8C5B76] dark:hover:bg-[#2E233A]">
          <ChevronLeft className="h-3.5 w-3.5 text-[#A24D6D] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />
          <span>{t('settings.folder.parent')}</span>
        </button>
        <nav ref={crumbsRef} title={listing.path} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 font-mono text-[11px] text-[#7D6D61] dark:text-[#9FAAC7]">
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
      {onChooseDirectory && !listing.error && <button type="button" onClick={() => onChooseDirectory(listing.path)} className="min-h-9 w-full rounded-full border border-[#DF99A9] bg-[#FCF2F5] px-3 py-1.5 font-bold text-[#9F4E6B] transition-all duration-150 hover:bg-[#F9E6EC] active:scale-[0.985] dark:border-[#8C5B76] dark:bg-[#2A2034] dark:text-[#F4B8CA] dark:hover:bg-[#352742]">{t('fileTrigger.chooseDirectory')}</button>}
      {listing.error ? <>
        <p role="alert" className="px-2 py-1 text-[#9F4856] dark:text-[#F09AA6]">{listing.error}</p>
        <button type="button" onClick={() => navigate(listing.path)} className={row}>{t('group.board.retry')}</button>
        {listing.path !== root && <button type="button" onClick={() => navigate(root)} className={row}>{t('group.board.root')}</button>}
      </> : <div key={listing.path} className={`relative max-h-[min(40dvh,16rem)] space-y-1 overflow-y-auto overscroll-contain transition-opacity duration-150 ${pendingPath ? 'opacity-65' : ''}`}>
        {listing.dirs.map(name => {
          const target = child(listing.path, name);
          const loadingThis = pendingPath === target;
          return <button key={`dir:${name}`} type="button" onClick={() => navigate(target)} className={row}>
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EBF4EC] text-[#5A8D66] dark:bg-[#1F322B] dark:text-[#96C7A3]"><Folder size={14} /></span>
            <span className="min-w-0 flex-1 break-all font-medium">{name}</span>
            {loadingThis
              ? <Loader2 size={14} className="shrink-0 animate-spin text-[#A24D6D] dark:text-[#EFA4B2]" aria-hidden="true" />
              : <ChevronRight size={14} className="shrink-0 text-[#C2B3A6] transition-transform duration-150 group-hover:translate-x-0.5 dark:text-[#5F6A8C]" aria-hidden="true" />}
          </button>;
        })}
        {listing.files.map(name => <button key={`file:${name}`} type="button" onClick={() => onChoose(child(listing.path, name))} className={row}>
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FCEEF2] text-[#B85A79] dark:bg-[#312338] dark:text-[#EFA4B2]"><FileText size={14} /></span>
          <span className="min-w-0 flex-1 break-all">{name}</span>
        </button>)}
        {!listing.dirs.length && !listing.files.length && <p className="px-2 py-3 text-center text-[#7D6D61] dark:text-[#98A3C2]">{t('group.board.empty')}</p>}
      </div>}
    </>}
  </div>;
}
