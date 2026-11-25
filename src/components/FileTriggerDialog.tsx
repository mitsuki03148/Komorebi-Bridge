import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useLang';
import type { FileTriggerItem, FileTriggerStatus } from '../types/bridge';
import { focusScope } from '../utils/focusScope';
import { useEscape } from '../utils/roomUi';
import { FilePicker, type FileListing } from './FilePicker';

const statusKey: Record<FileTriggerStatus, 'fileTrigger.disabled' | 'fileTrigger.monitoring' | 'fileTrigger.noLeader' | 'fileTrigger.waiting' | 'fileTrigger.offline' | 'fileTrigger.gap' | 'fileTrigger.error'> = {
  disabled: 'fileTrigger.disabled', monitoring: 'fileTrigger.monitoring', 'waiting-leader': 'fileTrigger.noLeader',
  waiting: 'fileTrigger.waiting', offline: 'fileTrigger.offline', gap: 'fileTrigger.gap', error: 'fileTrigger.error',
};
const pill = 'min-h-10 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-3 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF]';

/** Settings control only; the server is the authority for scope, identity and notification text. */
export function FileTriggerDialog({ name, root, items, listing, onBrowse, onAdd, onEnable, onRemove, onClose, confirmationHint, onSaveHint, integrity, onConfirmStale, onReset, onResumeOffline }: {
  name: string; root: string; items?: FileTriggerItem[]; listing?: FileListing;
  confirmationHint?: string; onSaveHint: (hint: string) => void;
  integrity?: { integrity: 'ok' | 'stale' | 'invalid'; stalePaths?: string[]; staleDigest?: string; staleHint?: string };
  onConfirmStale: (digest: string) => void; onReset: () => void;
  onResumeOffline: (id: string, offlineToken: string) => void;
  onBrowse: (path: string) => void; onAdd: (path: string, kind: 'file' | 'directory') => void;
  onEnable: (id: string, enabled: boolean) => void; onRemove: (id: string) => void; onClose: () => void;
}) {
  const { t } = useT();
  const [hint, setHint] = useState('');
  const [hintDirty, setHintDirty] = useState(false);
  const [reviewedDigest, setReviewedDigest] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const lastIntegrity = useRef(integrity?.integrity);
  useEffect(() => {
    if (lastIntegrity.current === 'stale' && integrity?.integrity === 'ok') setConfirmed(true);
    if (lastIntegrity.current === 'invalid' && integrity?.integrity === 'ok') setResetDone(true);
    if (integrity?.integrity !== 'ok') setResetDone(false);
    if (integrity?.integrity !== 'ok') setConfirmed(false);
    if (integrity?.integrity !== 'stale') setReviewedDigest(undefined);
    lastIntegrity.current = integrity?.integrity;
  }, [integrity?.integrity]);
  useEffect(() => {
    if (confirmationHint !== undefined && (!hintDirty || hint === confirmationHint)) {
      setHint(confirmationHint);
      setHintDirty(false);
    }
  }, [confirmationHint]);
  useEscape(true, onClose);
  useEffect(() => { onBrowse(root); }, []);
  return <div className="guild-backdrop-in fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8dvh] sm:items-center sm:pt-4"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="file-trigger-title"
      className="guild-sheet-in max-h-[84dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-3xl border border-transparent bg-[#FBF8F3] p-5 text-[#4A3E36] shadow-xl dark:border-[#313958] dark:bg-[#171D31] dark:text-[#ECE7DF]">
      <h2 id="file-trigger-title" className="break-words font-bold">{t('fileTrigger.title', { name })}</h2>
      {confirmed && <p role="status" className="rounded-xl bg-[#E6F2E8] p-3 text-sm text-[#426B4C] dark:bg-[#20332C] dark:text-[#A7D3B1]">{t('fileTrigger.confirmed')}</p>}
      {resetDone && <p role="status" className="rounded-xl bg-[#E6F2E8] p-3 text-sm text-[#426B4C] dark:bg-[#20332C] dark:text-[#A7D3B1]">{t('fileTrigger.resetDone')}</p>}
      {!integrity ? <p role="status">{t('fileTrigger.loading')}</p> : integrity.integrity === 'invalid' ?
        <div role="alert" className="space-y-3 rounded-xl border border-[#E5C9C9] bg-white p-3 text-sm text-[#9F4856] dark:border-[#5C3240] dark:bg-[#2C1A23] dark:text-[#F09AA6]"><p>{t('fileTrigger.invalidIntegrity')}</p><button type="button" className={pill} onClick={onReset}>{t('fileTrigger.reset')}</button></div> :
        integrity.integrity === 'stale' ? <div role="alert" className="space-y-3 rounded-xl border border-[#E5C9C9] bg-white p-3 text-sm dark:border-[#5C3240] dark:bg-[#2C1A23]">
          <p className="font-semibold text-[#9F4856] dark:text-[#F09AA6]">{t('fileTrigger.stale')}</p>
          <p>{t('fileTrigger.staleDiscard')}</p>
          <p>{t('fileTrigger.stalePaths')}</p>
          {integrity.stalePaths?.length ? <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">{integrity.stalePaths.map((path, index) => <li key={index} className="whitespace-pre-wrap break-all">{path.replace(/[\u0000-\u001f\u007f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}</li>)}</ul> : <p>{t('fileTrigger.staleNoPaths')}</p>}
          <div><p className="font-semibold">{t('fileTrigger.staleHint')}</p><p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all">{integrity.staleHint === undefined ? t('fileTrigger.loading') : integrity.staleHint || t('fileTrigger.staleHintEmpty')}</p></div>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={Boolean(integrity.staleDigest && reviewedDigest === integrity.staleDigest)} onChange={event => setReviewedDigest(event.target.checked ? integrity.staleDigest : undefined)} />{t('fileTrigger.staleReviewed')}</label>
          <button type="button" disabled={!integrity.staleDigest || !integrity.stalePaths || integrity.staleHint === undefined || reviewedDigest !== integrity.staleDigest} onClick={() => integrity.staleDigest && onConfirmStale(integrity.staleDigest)} className={`${pill} disabled:opacity-40`}>{t('fileTrigger.staleConfirm')}</button>
        </div> : <>
      <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('fileTrigger.hint')}</p>
      <FilePicker root={root} listing={listing} onBrowse={onBrowse} onChoose={path => onAdd(path, 'file')} onChooseDirectory={path => onAdd(path, 'directory')} />
      <div aria-live="polite" className="space-y-2">
        {!items ? <p role="status" className="text-sm">{t('fileTrigger.loading')}</p> : !items.length ? <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('fileTrigger.empty')}</p> : items.map(item => <div key={item.id} className="space-y-2 rounded-xl border border-[#E2D6C5] bg-white p-3 dark:border-[#364062] dark:bg-[#1E253D]">
          <p className="break-all text-xs" title={item.path}>{item.path}</p>
          <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t(item.kind === 'file' ? 'fileTrigger.file' : 'fileTrigger.directory')} · {t(statusKey[item.status] ?? 'fileTrigger.error')}</p>
          <p className="text-xs text-[#6E5D52] dark:text-[#B5BED6]">{t('fileTrigger.pauseEffect')}</p>
          {item.enabled && item.status === 'offline' && <p className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{t('fileTrigger.offlineRecoveryHint')}</p>}
          <div className="flex flex-wrap gap-2">
            {item.enabled && item.status === 'offline' && <button type="button" disabled={!item.offlineToken} onClick={() => item.offlineToken && onResumeOffline(item.id, item.offlineToken)} className={`${pill} disabled:opacity-40`}>{t('fileTrigger.offlineResume')}</button>}
            <button type="button" disabled={item.status === 'offline'} onClick={() => onEnable(item.id, !item.enabled)} className={`${pill} disabled:opacity-40`}>{t(item.enabled ? 'fileTrigger.pause' : 'fileTrigger.enable')}</button>
            <button type="button" onClick={() => onRemove(item.id)} className={pill}>{t('fileTrigger.remove')}</button>
          </div>
        </div>)}
      </div>
      <div className="space-y-2 border-t border-[#E2D6C5] pt-3 dark:border-[#364062]">
        <label htmlFor="file-trigger-hint" className="block text-sm font-semibold">{t('fileTrigger.confirmHint')}</label>
        <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('fileTrigger.confirmHintDescription')}</p>
        <textarea id="file-trigger-hint" value={hint} maxLength={500} disabled={confirmationHint === undefined}
          onChange={event => { setHint(event.target.value); setHintDirty(true); }}
          className="min-h-24 w-full resize-y rounded-xl border border-[#DFD3C3] bg-white px-3 py-2 text-base dark:border-[#343D5E] dark:bg-[#141A2C]" />
        <div className="flex items-center justify-between gap-2"><span className="text-xs">{hint.length} / 500</span>
          <button type="button" disabled={confirmationHint === undefined || hint === confirmationHint} onClick={() => onSaveHint(hint)} className={`${pill} disabled:opacity-40`}>{t('common.save')}</button>
        </div>
      </div>
      </>}
      <button type="button" data-autofocus onClick={onClose} className={`${pill} w-full`}>{t('common.close')}</button>
    </section>
  </div>;
}
