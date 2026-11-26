import { t as translateCurrent } from '../../i18n';
import { useT } from '../../i18n/useLang';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Cloud, File as FileIcon, FileText, Folder, Loader2, MoreHorizontal } from 'lucide-react';
import { Markdown } from '../Markdown';
import { CopyLink, ago } from '../github/views';

export interface DriveEntry { name: string; type: 'dir' | 'file' | 'native'; size: number; modified: string; textual: boolean }
export interface DriveText { path: string; text: string; truncated: boolean; size: number; mtimeMs: number; editable: boolean }

export const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);
const nativeName = { gdoc: 'drive.native.doc', gsheet: 'drive.native.sheet', gslides: 'drive.native.slides', gform: 'drive.native.form', gdraw: 'drive.native.draw' } as const;
export const nativeLabel = (name: string) => translateCurrent(nativeName[(name.split('.').pop()?.toLowerCase() ?? '') as keyof typeof nativeName] ?? 'drive.native.file');
export const displayName = (entry: DriveEntry) => (entry.type === 'native' ? entry.name.replace(/\.[^.]+$/, '') : entry.name);

const pill = 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] px-3 text-[11px] font-semibold text-[#6E5D52] dark:text-[#C5CDE3] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95 disabled:opacity-50';
export { pill as drivePill };

export function Crumbs({ path, onOpen, loading }: { path: string; onOpen: (path: string) => void; loading?: boolean }) {
  const { t } = useT();
  const parts = path ? path.split('/') : [];
  const parentPath = parts.length > 0 ? parts.slice(0, -1).join('/') : null;
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (navRef.current) navRef.current.scrollLeft = navRef.current.scrollWidth;
  }, [path]);
  return <div className="flex items-center gap-1.5">
    <button type="button" disabled={parentPath === null} onClick={() => parentPath !== null && onOpen(parentPath)} aria-label={t('drive.back')}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[#DEC9B8] bg-white/95 px-2.5 py-1 text-[11px] font-bold text-[#4A3E36] shadow-2xs transition-all duration-150 hover:border-[#D48BA5] hover:bg-[#FFF5F8] active:scale-95 disabled:pointer-events-none disabled:opacity-35 dark:border-[#4A5682] dark:bg-[#252E4C] dark:text-[#F0F3FC] dark:hover:border-[#EFA4B2]/70 dark:hover:bg-[#2F3A5E]">
      <ChevronLeft className="h-3.5 w-3.5 text-[#C4668A] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />
      <span>{t('drive.back')}</span>
    </button>
    <nav ref={navRef} aria-label={t('drive.path')} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 text-xs text-[#7D6D61] dark:text-[#A4AECC]">
      <button type="button" onClick={() => onOpen('')} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition-colors active:scale-95 hover:bg-white/80 dark:hover:bg-[#27304D]"><Cloud className="h-3.5 w-3.5 text-[#5B82A6] dark:text-[#9CB2E5]" aria-hidden="true" />Drive</button>
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        return <span key={index} className="inline-flex shrink-0 items-center gap-0.5">
          <ChevronRight className="h-3 w-3 text-[#B8A89B] dark:text-[#697496]" aria-hidden="true" />
          <button type="button" onClick={() => onOpen(parts.slice(0, index + 1).join('/'))}
            className={`rounded-full px-2 py-0.5 transition-colors active:scale-95 hover:bg-white/80 dark:hover:bg-[#27304D] ${last ? 'font-semibold text-[#4A3E36] dark:text-[#ECE7DF]' : ''}`}>{part}</button>
        </span>;
      })}
    </nav>
    {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#C4668A] dark:text-[#EFA4B2]" aria-hidden="true" />}
  </div>;
}

export function DriveRows({ entries, onOpen, onMenu, now, loading }: { entries: DriveEntry[]; onOpen: (entry: DriveEntry) => void; onMenu?: (entry: DriveEntry) => void; now?: number; loading?: boolean }) {
  const { t } = useT();
  if (!entries.length) return <p className="px-2 py-8 text-center text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('drive.empty')}</p>;
  return <ul className={`space-y-1.5 transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}>{entries.map(entry => {
    const badge = entry.type === 'dir'
      ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#EBF4EC] dark:bg-[#20332C] text-[#5A8D66] dark:text-[#96C7A3]"><Folder className="h-4 w-4" aria-hidden="true" /></span>
      : entry.textual
        ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FCEEF2] dark:bg-[#312338] text-[#C4668A] dark:text-[#EFA4B2]"><FileText className="h-4 w-4" aria-hidden="true" /></span>
        : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F4EDE4] dark:bg-[#252D48] text-[#8C7A6E] dark:text-[#A4AECC]"><FileIcon className="h-4 w-4" aria-hidden="true" /></span>;
    return <li key={entry.name} className="group flex items-center rounded-2xl border border-[#EDE3D5]/90 dark:border-[#2E3654] bg-white/75 dark:bg-[#1E253D]/90 shadow-[0_1px_2px_rgba(90,70,50,0.03)] transition-all duration-150 hover:bg-white dark:hover:bg-[#242C48] active:scale-[0.985] active:bg-[#FCF0F4]/80 dark:active:bg-[#2A2136]">
      <button type="button" data-drive-row={entry.type} data-name={entry.name} onClick={() => onOpen(entry)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
        {badge}
        <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{displayName(entry)}</span>
          <span className="block truncate text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">{entry.type === 'dir' ? ago(entry.modified, now) : `${entry.type === 'native' ? nativeLabel(entry.name) : fileSize(entry.size)} · ${ago(entry.modified, now)}`}</span></span>
        {entry.type === 'dir' && <ChevronRight className="h-4 w-4 shrink-0 text-[#C2B3A6] transition-transform duration-150 group-hover:translate-x-0.5 dark:text-[#667296]" aria-hidden="true" />}
      </button>
      {onMenu && <button type="button" aria-label={t('drive.more', { name: displayName(entry) })} data-drive-menu={entry.name} onClick={() => onMenu(entry)} className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#7D6D61] dark:text-[#A4AECC] transition hover:bg-[#F3ECE1] active:scale-95 dark:hover:bg-[#2C3658]"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></button>}
    </li>;
  })}</ul>;
}

export function MenuSheet({ entry, desktop, onCopyLink, onCopyPath, onReveal, onMove, onClose }: {
  entry: DriveEntry; desktop: boolean; onCopyLink: () => void; onCopyPath: () => void; onReveal: () => void; onMove: () => void; onClose: () => void;
}) {
  const { t } = useT();
  const item = 'block w-full rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold text-[#4A3E36] dark:text-[#ECE7DF] transition hover:bg-[#F3ECE1] dark:hover:bg-[#27304D]';
  return <div role="menu" aria-label={displayName(entry)} data-drive-sheet className="guild-sheet-in absolute inset-x-3 bottom-3 z-30 rounded-[24px] border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FFFDF9]/96 dark:bg-[#1B2238]/96 p-2 shadow-[0_18px_40px_-10px_rgba(74,62,54,0.28)] backdrop-blur-md">
    <p className="truncate px-3.5 py-1.5 text-[11px] font-semibold text-[#8C7A6E] dark:text-[#98A3C2]">{displayName(entry)}</p>
    <button role="menuitem" type="button" className={item} onClick={onCopyLink}>{t('drive.copy.link')}</button>
    <button role="menuitem" type="button" className={item} onClick={onCopyPath}>{t('drive.copy.path')}</button>
    {desktop && <button role="menuitem" type="button" className={item} onClick={onReveal}>{t('drive.finder.reveal')}</button>}
    <button role="menuitem" type="button" className={item} onClick={onMove}>{t('drive.move')}</button>
    <button role="menuitem" type="button" className={`${item} text-[#7D6D61] dark:text-[#A4AECC]`} onClick={onClose}>{t('drive.cancel')}</button>
  </div>;
}

/** A Google document or another file that is not text: what it is, and how to open it. */
export function FileCard({ entry, linkUrl, onBack, onCopyLink, onOpenLink }: { entry: DriveEntry; linkUrl?: string; onBack: () => void; onCopyLink: () => void; onOpenLink: () => void }) {
  const { t } = useT();
  return <div className="space-y-3">
    <button type="button" onClick={onBack} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#DEC9B8] bg-white/95 px-3 py-1 text-xs font-bold text-[#4A3E36] shadow-2xs transition hover:border-[#D48BA5] hover:bg-[#FFF5F8] active:scale-95 dark:border-[#4A5682] dark:bg-[#252E4C] dark:text-[#F0F3FC] dark:hover:border-[#EFA4B2]/70 dark:hover:bg-[#2F3A5E] cursor-pointer"><ChevronLeft className="h-4 w-4 text-[#C4668A] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />{t('drive.back')}</button>
    <div className="rounded-2xl border border-[#E8DDD0] dark:border-[#2E3654] bg-white/85 dark:bg-[#1E253D] p-4 shadow-2xs">
      <h4 className="break-words text-base font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{displayName(entry)}</h4>
      <p className="mt-1 text-xs text-[#8C7A6E] dark:text-[#98A3C2]">{entry.type === 'native' ? nativeLabel(entry.name) : fileSize(entry.size)} · {ago(entry.modified)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={pill} onClick={onOpenLink}>{t('drive.open')}</button>
        <button type="button" className={pill} onClick={onCopyLink}>{t('drive.copy.link')}</button>
      </div>
      {linkUrl && <p className="mt-2 break-all text-[11px] text-[#8C7A6E] select-text">{linkUrl}</p>}
    </div>
  </div>;
}

/** A text file: Markdown as a page, anything else as plain text; or, in edit mode, a box to change it and save. */
export function TextView({ name, file, editing, draft, onDraft, onEdit, onSave, onCancel, onBack, onCopyLink, onReveal, saving, error, linkUrl }: {
  name: string; file: DriveText; editing: boolean; draft: string; onDraft: (text: string) => void; onEdit: () => void; onSave: () => void; onCancel: () => void; onBack: () => void;
  onCopyLink: () => void; onReveal?: () => void; saving?: boolean; error?: string; linkUrl?: string;
}) {
  const { t } = useT();
  const [raw, setRaw] = useState(false);
  const isMarkdown = /\.(?:md|markdown)$/i.test(name) && !raw;
  return <div className="space-y-2.5">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onBack} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#DEC9B8] bg-white/95 px-3 py-1 text-xs font-bold text-[#4A3E36] shadow-2xs transition hover:border-[#D48BA5] hover:bg-[#FFF5F8] active:scale-95 dark:border-[#4A5682] dark:bg-[#252E4C] dark:text-[#F0F3FC] dark:hover:border-[#EFA4B2]/70 dark:hover:bg-[#2F3A5E] cursor-pointer"><ChevronLeft className="h-4 w-4 text-[#C4668A] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />{t('drive.back')}</button>
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{name}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {!editing && file.editable && <button type="button" className={pill} onClick={onEdit}>{t('drive.edit')}</button>}
      {!editing && /\.(?:md|markdown)$/i.test(name) && <button type="button" className={pill} onClick={() => setRaw(!raw)}>{raw ? t('drive.view.rendered') : t('drive.view.raw')}</button>}
      <button type="button" className={pill} onClick={onCopyLink}>{t('drive.copy.link')}</button>
      {onReveal && <button type="button" className={pill} onClick={onReveal}>{t('drive.finder.reveal')}</button>}
    </div>
    {linkUrl && <p data-link-shown className="break-all text-[11px] text-[#8C7A6E] dark:text-[#98A3C2] select-text">{linkUrl}</p>}
    {file.truncated && <p className="rounded-2xl border border-[#F0D9B5] dark:border-[#785B38] bg-[#FFF6E8] dark:bg-[#2B2219] px-3.5 py-2 text-xs text-[#8A5A1F] dark:text-[#F0C882]">{t('drive.file.truncated', { size: fileSize(file.size) })}</p>}
    {editing ? <form data-edit onSubmit={event => { event.preventDefault(); onSave(); }} className="space-y-2">
      <textarea value={draft} onChange={event => onDraft(event.target.value)} aria-label={t('drive.content')} spellCheck={false} className="h-[55dvh] w-full resize-y rounded-2xl border border-[#E6DCD0] dark:border-[#364062] bg-white dark:bg-[#141A2C] p-3 font-mono text-base leading-relaxed text-[#4A3E36] dark:text-[#ECE7DF] sm:text-[13px]" />
      {error && <p role="alert" className="text-xs text-[#A94D5A] dark:text-[#F09AA6]">{error}</p>}
      <div className="flex gap-2"><button type="submit" disabled={saving || draft === file.text} className="min-h-9 rounded-full bg-[#7A9580] px-4 text-xs font-bold text-white disabled:opacity-50">{saving ? t('drive.saving') : t('drive.save')}</button>
        <button type="button" onClick={onCancel} disabled={saving} className={pill}>{t('drive.cancel')}</button></div>
    </form>
      : isMarkdown ? <div className="rounded-2xl border border-[#E8DDD0] dark:border-[#2E3654] bg-white/85 dark:bg-[#1E253D] px-4 py-4 shadow-2xs select-text sm:px-6 sm:py-5"><Markdown variant="doc" text={file.text} /></div>
      : <pre className="whitespace-pre-wrap break-words rounded-2xl border border-[#E8DDD0] dark:border-[#2E3654] bg-white/90 dark:bg-[#141A2C] p-4 font-mono text-[12px] leading-[1.65] text-[#4A3E36] dark:text-[#EAE5DC] select-text">{file.text}</pre>}
  </div>;
}

export { CopyLink };
