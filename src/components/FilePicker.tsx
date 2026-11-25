import { ChevronUp, FileText, Folder } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { FolderListing } from './FolderPicker';

export interface FileListing extends FolderListing { files: string[]; error?: string }

const row = 'flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[#4A3E36] dark:text-[#ECE7DF] hover:bg-[#FBF8F3] dark:hover:bg-[#242C48] focus-visible:outline-[#689B73]';
const child = (path: string, name: string) => `${path.replace(/\/$/, '')}/${name}`;

export function FilePicker({ listing, root, onBrowse, onChoose, onChooseDirectory }: {
  listing?: FileListing; root: string; onBrowse: (path: string) => void; onChoose: (path: string) => void; onChooseDirectory?: (path: string) => void;
}) {
  const { t } = useT();
  return <div data-board-file-picker className="space-y-1 rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#141A2C] p-2 text-xs">
    {!listing ? <p role="status" className="px-2 py-1 text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.folder.loading')}</p> : <>
      <p className="max-h-12 overflow-auto break-all font-mono text-[11px] text-[#5C4D43] dark:text-[#C5CDE3]">{listing.path}</p>
      {onChooseDirectory && !listing.error && <button type="button" onClick={() => onChooseDirectory(listing.path)} className={`${row} font-semibold`}>{t('fileTrigger.chooseDirectory')}</button>}
      {listing.error ? <>
        <p role="alert" className="px-2 py-1 text-[#9F4856] dark:text-[#F09AA6]">{listing.error}</p>
        <button type="button" onClick={() => onBrowse(listing.path)} className={row}>{t('group.board.retry')}</button>
        {listing.path !== root && <button type="button" onClick={() => onBrowse(root)} className={row}>{t('group.board.root')}</button>}
      </> : <div className="max-h-[min(40dvh,16rem)] space-y-0.5 overflow-y-auto overscroll-contain">
        {listing.parent !== null && <button type="button" onClick={() => onBrowse(listing.parent!)} className={`${row} font-semibold text-[#7D6D61] dark:text-[#A4AECC]`}>
          <ChevronUp size={14} aria-hidden="true" />{t('settings.folder.parent')}
        </button>}
        {listing.dirs.map(name => <button key={`dir:${name}`} type="button" onClick={() => onBrowse(child(listing.path, name))} className={row}>
          <Folder size={14} aria-hidden="true" className="shrink-0 text-[#689B73] dark:text-[#96BD9F]" /><span className="min-w-0 break-all">{name}</span>
        </button>)}
        {listing.files.map(name => <button key={`file:${name}`} type="button" onClick={() => onChoose(child(listing.path, name))} className={row}>
          <FileText size={14} aria-hidden="true" className="shrink-0 text-[#8C6D58] dark:text-[#D6BFA8]" /><span className="min-w-0 break-all">{name}</span>
        </button>)}
        {!listing.dirs.length && !listing.files.length && <p className="px-2 py-1 text-[#7D6D61] dark:text-[#A4AECC]">{t('group.board.empty')}</p>}
      </div>}
    </>}
  </div>;
}
