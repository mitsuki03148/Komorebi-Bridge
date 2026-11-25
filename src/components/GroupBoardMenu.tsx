import { useContext, useEffect, useState } from 'react';
import { useT } from '../i18n/useLang';
import { FileOpenContext } from '../utils/fileOpen';
import { focusScope } from '../utils/focusScope';
import { groupBoardPathMaxLength, validGroupBoardPath } from '../utils/groupBoard';
import { useEscape } from '../utils/roomUi';
import { FilePicker, type FileListing } from './FilePicker';

export function GroupBoardMenuItem({ path, onEdit, onOpen, compact }: { path?: string; onEdit: () => void; onOpen: () => void; compact?: boolean }) {
  const { t } = useT();
  const openFile = useContext(FileOpenContext);
  if (compact) return <div data-group-board-row className="flex min-w-0 items-center gap-2 rounded-xl bg-[#F3ECE1] dark:bg-[#1E253D] border border-transparent dark:border-[#2E3654] px-2.5 py-1">
    <div className="min-w-0 flex-1">
      <div className="text-xs font-semibold text-[#6E5D52] dark:text-[#B5BED6]">{t('group.board.label')}</div>
      <div className="truncate text-xs text-[#4A3E36] dark:text-[#ECE7DF]" title={path}>{path ? path.split('/').filter(Boolean).at(-1) ?? path : t('group.board.unset')}</div>
    </div>
    {path && openFile && <button type="button" aria-label={t('group.board.open.label')} onClick={() => { openFile(path); onOpen(); }}
      className="min-h-9 shrink-0 rounded-full px-2 text-xs font-semibold text-[#6E5D52] dark:text-[#C5CDE3] hover:bg-white dark:hover:bg-[#27304D]">{t('group.board.open')}</button>}
    <button type="button" aria-label={t('group.board.choose.label')} onClick={onEdit}
      className="min-h-9 shrink-0 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-2 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.board.choose')}</button>
  </div>;
  return <div className="space-y-1.5">
    <button type="button" onClick={onEdit} className="min-h-11 w-full rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
      {t('group.board.edit')}
    </button>
    {path && <div className="flex items-center gap-2 rounded-xl bg-[#F3ECE1] dark:bg-[#1E253D] px-2.5 py-1">
      <code className="max-h-16 min-w-0 flex-1 select-text overflow-auto break-all text-xs text-[#6E5D52] dark:text-[#B5BED6]" title={path}>{path}</code>
      {openFile && <button type="button" aria-label={t('group.board.open.label')} onClick={() => { openFile(path); onOpen(); }}
        className="min-h-11 shrink-0 rounded-full px-2.5 text-sm font-semibold text-[#6E5D52] dark:text-[#C5CDE3] hover:bg-white dark:hover:bg-[#27304D]">
        {t('group.board.open')}
      </button>}
    </div>}
  </div>;
}

export function GroupBoardDialog({ name, path, onSave, onCancel, listing, onBrowse, boardRoot }: {
  name: string; path?: string; onSave: (path: string | null) => void; onCancel: () => void;
  listing?: FileListing; onBrowse?: (path: string) => void; boardRoot: string;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(path ?? '');
  const [invalid, setInvalid] = useState(false);
  useEscape(true, onCancel);
  useEffect(() => { onBrowse?.(path ? path.slice(0, path.lastIndexOf('/')) || '/' : boardRoot); }, []); // Browse the saved folder once, on opening.
  const save = (value: string) => {
    if (!validGroupBoardPath(value)) { setInvalid(true); return; }
    onSave(value);
  };

  return <div className="guild-backdrop-in fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[12dvh] sm:items-center sm:pt-4"
    onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="group-board-title" onSubmit={event => {
      event.preventDefault();
      save(draft);
    }} className="guild-sheet-in max-h-[80dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-transparent dark:border-[#313958] text-[#4A3E36] dark:text-[#ECE7DF] p-5 shadow-xl">
      <h2 id="group-board-title" className="break-words font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.board.title', { name })}</h2>
      {onBrowse && <FilePicker root={boardRoot} listing={listing} onBrowse={onBrowse} onChoose={value => { setDraft(value); save(value); }} />}
      <div className="space-y-1">
        <label htmlFor="group-board-path" className="text-sm font-semibold text-[#6E5D52] dark:text-[#B5BED6]">{t('group.board.path')}</label>
        <input id="group-board-path" data-autofocus={!onBrowse || undefined} type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
          aria-invalid={invalid || undefined} aria-describedby={invalid ? 'group-board-error' : undefined} value={draft}
          onChange={event => { setDraft(event.target.value); setInvalid(false); }} placeholder={`${boardRoot}/Board.md`}
          className="w-full rounded-xl border border-[#DFD3C3] dark:border-[#343D5E] bg-white dark:bg-[#141A2C] px-3 py-3 text-[16px] text-[#4A3E36] dark:text-[#ECE7DF] focus:outline-[#689B73]" />
        {invalid && <p id="group-board-error" role="alert" className="text-sm text-[#9F4856] dark:text-[#F09AA6]">{t('group.board.invalid', { max: groupBoardPathMaxLength })}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-autofocus={Boolean(onBrowse) || undefined} onClick={onCancel} className="min-h-11 flex-1 rounded-xl bg-[#F3ECE1] dark:bg-[#27304D] px-3 text-sm text-[#4A3E36] dark:text-[#ECE7DF]">{t('common.cancel')}</button>
        {path && <button type="button" onClick={() => onSave(null)} className="min-h-11 flex-1 rounded-xl border border-[#E5C9C9] dark:border-[#5C3240] bg-white dark:bg-[#2C1A23] px-3 text-sm text-[#9F4856] dark:text-[#F09AA6]">{t('group.board.clear')}</button>}
        <button type="submit" className="min-h-11 flex-1 rounded-xl bg-[#4A3E36] dark:bg-[#D88B96] px-3 text-sm font-bold text-white">{t('common.save')}</button>
      </div>
    </form>
  </div>;
}
