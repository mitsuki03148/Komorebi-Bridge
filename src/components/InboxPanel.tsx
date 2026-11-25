import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, FileText, Film, Folder, HelpCircle, Image as ImageIcon, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import { useT } from '../i18n/useLang';
import { focusScope } from '../utils/focusScope';
import { useEscape } from '../utils/roomUi';
import type { GhCall } from './github/GitHubPanel';
import type { TerminalRoom } from '../types/guild';
import type { InboxAlertScan } from '../../bridge/inbox-alerts';
import { formatElapsed, useNow } from '../utils/roomAttention';

export interface InboxListing {
  root: string; path: string; parent: string | null;
  dirs: { name: string; modified: number }[];
  files: { name: string; kind: 'text' | 'image' | 'video' | 'other'; size: number; modified: number }[];
}

const button = 'flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95';
const row = 'flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-[#F5EFE6] dark:hover:bg-[#222947] focus-visible:outline-2 focus-visible:outline-[#965069]';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * A look into the Inbox folder, where a persona's task leaves its handoff and evidence: folders newest first,
 * Markdown, images and (where the Bridge supports it) videos open in the reader. Read only.
 */
export function InboxPanel({ call, onOpen, mediaSupported, onClose, rooms, alerts, pendingSince, connected, initialPending, onRoom, inboxEnabled = true }: {
  call: GhCall; onOpen: (path: string) => void; mediaSupported: boolean; onClose: () => void;
  rooms: TerminalRoom[]; alerts?: InboxAlertScan; pendingSince?: Record<string, number>; connected: boolean; initialPending?: boolean; onRoom: (id: string) => void; inboxEnabled?: boolean;
}) {
  const { t } = useT();
  useEscape(true, onClose);
  const [path, setPath] = useState<string>();
  const [tab, setTab] = useState<'folders' | 'pending'>(initialPending || !inboxEnabled ? 'pending' : 'folders');
  const [state, setState] = useState<{ data?: InboxListing; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!inboxEnabled) return;
    let live = true;
    setState(current => ({ data: current.data, loading: true }));
    call<InboxListing>('list', path ? { path } : {}).then(
      data => { if (live) setState({ data, loading: false }); },
      error => { if (live) setState({ error: error instanceof Error ? error.message : t('inbox.error'), loading: false }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, inboxEnabled]);
  const listing = state.data;
  const crumbs = listing ? listing.path.slice(listing.root.length).split('/').filter(Boolean) : [];
  const joinTo = (count: number) => [listing!.root, ...crumbs.slice(0, count)].join('/');
  const empty = listing && !listing.dirs.length && !listing.files.length;
  const pending = rooms.flatMap(room => [
    ...(room.pendingApproval ? [{ key: `approval:${room.id}:${room.pendingApproval.id}`, room, kind: 'approval' as const }] : []),
    ...(room.pendingQuestion ? [{ key: `question:${room.id}:${room.pendingQuestion.id}`, room, kind: 'question' as const }] : []),
  ]);
  const count = pending.length + (alerts?.alerts.length ?? 0);
  const now = useNow(30_000, tab === 'pending');
  return <div onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#3A2E27]/30 dark:bg-[#090C16]/68 p-2 backdrop-blur-xs sm:p-3">
    <section ref={focusScope} role="dialog" aria-modal="true" aria-label={inboxEnabled ? 'Inbox' : t('inbox.pending')}
      className="guild-dialog-in relative flex h-[88dvh] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-[26px] border border-[#E5D7C6] dark:border-[#313958] bg-[#FFFCF7]/96 dark:bg-[#171D31]/96 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_22px_50px_-12px_rgba(74,62,54,0.28)] backdrop-blur-md">
      <header className="shrink-0 space-y-2 border-b border-[#EADFD1]/80 dark:border-[#2C3450] bg-[#F7F1E8]/80 dark:bg-[#1C233A]/90 px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#EBC5CA]/80 dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#C4668A] dark:text-[#EFA4B2]">
            <Inbox className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="flex-1 font-display text-[15px] font-semibold">{inboxEnabled ? 'Inbox' : t('inbox.pending')}</h3>
          {inboxEnabled && <button type="button" aria-label={t('inbox.refresh')} title={t('inbox.refresh')} onClick={() => { if (tab === 'pending') void call('alerts', {}).catch(() => {}); else setTick(value => value + 1); }} className={button}><RefreshCw className="h-4 w-4" /></button>}
          <button type="button" aria-label={t('inbox.close')} onClick={onClose} className={button}><X className="h-4 w-4" /></button>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-[#E5D7C6] dark:border-[#343D5E] bg-[#EFE8DC]/75 dark:bg-[#141A2C] p-1" role="group" aria-label={t('inbox.sections')}>
          {inboxEnabled && <button type="button" aria-pressed={tab === 'folders'} onClick={() => setTab('folders')}
            className={`min-h-8 rounded-full px-3.5 text-xs font-semibold transition cursor-pointer ${tab === 'folders'
              ? 'border border-[#EBC5CA]/90 dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#9E4E68] dark:text-[#F4B6C4] shadow-[0_1px_3px_rgba(166,87,114,0.14)]'
              : 'border border-transparent text-[#6E5D52] dark:text-[#A4AECC] hover:bg-white/70 dark:hover:bg-[#232B45]'}`}>{t('inbox.folders')}</button>}
          <button type="button" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition cursor-pointer ${tab === 'pending'
              ? 'border border-[#EBC5CA]/90 dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#9E4E68] dark:text-[#F4B6C4] shadow-[0_1px_3px_rgba(166,87,114,0.14)]'
              : 'border border-transparent text-[#6E5D52] dark:text-[#A4AECC] hover:bg-white/70 dark:hover:bg-[#232B45]'}`}>
            <span>{t('inbox.pending')}</span>
            <span className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-px text-[10.5px] font-bold tabular-nums ${count > 0
              ? 'bg-[#D9828B] dark:bg-[#C9788A] text-white'
              : 'bg-[#E8DFD3] dark:bg-[#27304D] text-[#7D6D61] dark:text-[#A4AECC]'}`}>{count}</span>
          </button>
        </div>
        {tab === 'folders' && listing && <nav aria-label={t('inbox.path')} className="flex flex-wrap items-center gap-0.5 text-xs text-[#6E5D52] dark:text-[#B5BED6]">
          <button type="button" onClick={() => setPath(undefined)} className="rounded-full px-2 py-1 font-semibold hover:bg-white/80 dark:hover:bg-[#2B3554]">Inbox</button>
          {crumbs.map((name, index) => <span key={joinTo(index + 1)} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            <button type="button" disabled={index === crumbs.length - 1} onClick={() => setPath(joinTo(index + 1))}
              className="max-w-[40vw] truncate rounded-full px-2 py-1 hover:bg-white/80 disabled:font-semibold disabled:hover:bg-transparent dark:hover:bg-[#2B3554]">{name}</button>
          </span>)}
        </nav>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2 text-sm">
        {tab === 'pending' ? <div className="space-y-2 px-1 py-1">
          {(!connected || !alerts || alerts.incomplete) && <p role="status" className="rounded-2xl border border-[#EBC5CA]/80 dark:border-[#59354B] bg-[#FFF5F7] dark:bg-[#2B1D27] px-3.5 py-2.5 text-xs text-[#9A4B4F] dark:text-[#F0A8AC]">{!connected ? t('inbox.disconnected') : !alerts ? t('inbox.checking') : t('inbox.incomplete')}</p>}
          {connected && alerts && !alerts.incomplete && count === 0 && <p className="rounded-2xl border border-dashed border-[#E5D7C6] dark:border-[#313958] bg-[#FAF6F0]/70 dark:bg-[#1B2238]/60 px-4 py-6 text-center text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('inbox.pendingEmpty')}</p>}
          <ul className="space-y-2">
            {pending.map(item => {
              const isApproval = item.kind === 'approval';
              const elapsed = formatElapsed(pendingSince?.[item.key], now);
              return <li key={item.key}><button type="button" onClick={() => onRoom(item.room.id)}
                className="flex w-full items-start gap-3 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white/95 dark:bg-[#1E253D] px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(74,62,54,0.04)] transition hover:border-[#D9C7B4] dark:hover:border-[#434F7A] hover:bg-[#FFFDF9] dark:hover:bg-[#242D4A] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#965069] cursor-pointer">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${isApproval
                  ? 'border-[#ECD1A6] dark:border-[#6B5130] bg-[#FFF2DF] dark:bg-[#3B2D1E] text-[#B87324] dark:text-[#F0B870]'
                  : 'border-[#EBC5CA] dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#B35A76] dark:text-[#F2AFC0]'}`}>
                  {isApproval ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <HelpCircle className="h-4 w-4" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t(isApproval ? 'inbox.approval' : 'inbox.question')}</strong>
                  <span className="mt-0.5 block break-words text-xs font-semibold text-[#5C4E44] dark:text-[#D4DCF0]">{item.room.roomName}</span>
                  <span className="mt-1 block text-[11px] text-[#9A8778] dark:text-[#8E98B8]">{elapsed ? t('inbox.observed', { elapsed }) : t('inbox.timeUnknown')}</span>
                </span>
                <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#B4A394] dark:text-[#6E7A9E]" />
              </button></li>;
            })}
            {alerts?.alerts.map(item => {
              const elapsed = formatElapsed(item.firstSeenAt, now);
              return <li key={item.path}><button type="button" onClick={() => { setPath(item.path); setTab('folders'); }}
                className="flex w-full items-start gap-3 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white/95 dark:bg-[#1E253D] px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(74,62,54,0.04)] transition hover:border-[#EBC5CA] dark:hover:border-[#59354B] hover:bg-[#FFFDFB] dark:hover:bg-[#242D4A] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#965069] cursor-pointer">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#EBC5CA]/90 dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#C4668A] dark:text-[#EFA4B2]">
                  <Folder className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{item.incomplete ? t('inbox.incomplete') : t('inbox.oversize')}</strong>
                  <span className="mt-1 block break-all rounded-lg bg-[#FAF6F0] dark:bg-[#151B2E] px-2 py-1 font-mono text-[11px] leading-snug text-[#6E5D52] dark:text-[#B5BED6]">{item.path}</span>
                  <span className="mt-1.5 block text-[11.5px] text-[#7D6D61] dark:text-[#A4AECC]">{item.incomplete ? t('inbox.partialSize', { size: size(item.bytes) }) : t('inbox.nonMediaSize', { size: size(item.bytes) })}{item.derived ? ` · ${t('inbox.derived')}` : ''}</span>
                  {item.largest && <span className="mt-0.5 block break-all text-[11.5px] text-[#7D6D61] dark:text-[#A4AECC]">{t('inbox.largest', { name: item.largest.name, size: size(item.largest.bytes) })}</span>}
                  <span className="mt-1 block text-[10.5px] text-[#9A8778] dark:text-[#8E98B8]">{elapsed ? t('inbox.observed', { elapsed }) : t('inbox.timeUnknown')}</span>
                </span>
                <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-[#B4A394] dark:text-[#6E7A9E]" />
              </button></li>;
            })}
          </ul>
        </div> : <>
        {state.loading && !listing && <p role="status" className="flex items-center gap-1.5 px-3 py-4 text-xs text-[#7D6D61] dark:text-[#A4AECC]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('inbox.loading')}</p>}
        {state.error && <p role="alert" className="px-3 py-4 text-xs text-[#A94D5A] dark:text-[#F09AA6]">{state.error}<button type="button" onClick={() => setTick(value => value + 1)} className="ml-2 underline">{t('inbox.retry')}</button></p>}
        {listing && <ul className="space-y-0.5">
          {listing.dirs.map(dir => <li key={`d:${dir.name}`}>
            <button type="button" onClick={() => setPath(`${listing.path}/${dir.name}`)} className={row}>
              <Folder className="h-4 w-4 shrink-0 text-[#689B73] dark:text-[#96BD9F]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-semibold">{dir.name}</span>
              <span className="shrink-0 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">{when(dir.modified)}</span>
            </button>
          </li>)}
          {listing.files.map(file => {
            const openable = file.kind === 'text' || ((file.kind === 'image' || file.kind === 'video') && mediaSupported);
            const Icon = file.kind === 'image' ? ImageIcon : file.kind === 'video' ? Film : FileText;
            return <li key={`f:${file.name}`}>
              <button type="button" disabled={!openable} onClick={() => onOpen(`${listing.path}/${file.name}`)}
                title={openable ? undefined : t('inbox.cannotOpen')} className={`${row} disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent`}>
                <Icon className="h-4 w-4 shrink-0 text-[#8C6D58] dark:text-[#D6BFA8]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">{size(file.size)}</span>
              </button>
            </li>;
          })}
        </ul>}
        {empty && !state.loading && <p className="px-3 py-6 text-center text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('inbox.empty')}</p>}
        </>}
      </div>
    </section>
  </div>;
}
