import { t as translateCurrent } from '../../i18n';
import { useT } from '../../i18n/useLang';
import { PullIndicator } from '../PullIndicator';
import { usePullToRefresh } from '../../utils/pullRefresh';
import { useEffect, useMemo, useState } from 'react';
import { Cloud, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { focusScope } from '../../utils/focusScope';
import { copyText, useEscape } from '../../utils/roomUi';
import { drivePrefs } from '../../utils/ghPrefs';
import { SearchPicker, type PickItem } from '../github/SearchPicker';
import { Crumbs, DriveRows, FileCard, MenuSheet, TextView, drivePill, type DriveEntry, type DriveText } from './views';
import type { GhCall } from '../github/GitHubPanel';

interface Listing { path: string; parent: string | null; entries: DriveEntry[] }
type View = { kind: 'list' } | { kind: 'text'; entry: DriveEntry; path: string } | { kind: 'card'; entry: DriveEntry; path: string };
const message = (error: unknown) => (error instanceof Error ? error.message : translateCurrent('drive.error.generic'));
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const rootFolder = 'My Drive';

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(current => ({ data: current.data, loading: true }));
    load().then(data => { if (live) setState({ data, loading: false }); }, error => { if (live) setState({ error: message(error), loading: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick(value => value + 1) };
}

const Status = ({ loading, error, onRetry }: { loading?: boolean; error?: string; onRetry?: () => void }) => {
  const { t } = useT();
  return (
  loading ? <p role="status" className="flex items-center gap-1.5 px-2 py-4 text-xs text-[#7D6D61] dark:text-[#A4AECC]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('drive.loading')}</p>
    : error ? <p role="alert" className="px-2 py-4 text-xs text-[#A94D5A] dark:text-[#F09AA6]">{error}{onRetry && <button type="button" onClick={onRetry} className="ml-2 underline">{t('drive.retry')}</button>}</p> : null
  );
};

/** A popup for Google Drive: browse folders, read text files, copy links, move items, and edit a text file. Works on the Drive mounted on this Mac. */
export function DrivePanel({ call, onClose, desktop }: { call: GhCall; onClose: () => void; desktop: boolean }) {
  const { t } = useT();
  useEscape(true, onClose);
  const accounts = useLoad(() => call<{ accounts: { id: string }[] }>('accounts'), []);
  const [picked, setPicked] = useState<string | undefined>(() => drivePrefs.get('account'));
  const account = accounts.data?.accounts.find(item => item.id === picked)?.id ?? accounts.data?.accounts[0]?.id;
  const [path, setPath] = useState<string | undefined>();
  const folder = path ?? (account ? drivePrefs.get(`path:${account}`) ?? rootFolder : rootFolder);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<DriveEntry>();
  const [moving, setMoving] = useState<{ name: string; from: string; account: string }>();
  const [notice, setNotice] = useState<string>();
  const listing = useLoad(() => account ? call<Listing>('list', { account, path: folder }) : Promise.resolve(undefined), [account, folder]);
  const refreshAll = () => { accounts.reload(); listing.reload(); };
  const { ref: pullRef, pull, refreshing } = usePullToRefresh(refreshAll, view.kind === 'list');
  useEffect(() => { setFilter(''); }, [account, folder]);
  const say = (text: string) => { setNotice(text); setTimeout(() => setNotice(current => (current === text ? undefined : current)), 2500); };
  const go = (next: string) => { setPath(next); if (account) drivePrefs.set(`path:${account}`, next); setView({ kind: 'list' }); setMenu(undefined); };
  const pickAccount = (key: string) => { setMoving(undefined); setPicked(key); drivePrefs.set('account', key); setPath(undefined); setView({ kind: 'list' }); };

  const entries = useMemo(() => {
    const all = listing.data?.entries ?? [];
    const shown = moving ? all.filter(entry => entry.type === 'dir') : all;
    const needle = filter.trim().toLowerCase();
    return needle ? shown.filter(entry => entry.name.toLowerCase().includes(needle)) : shown;
  }, [listing.data, filter, moving]);

  const withLink = async (target: string, then: (url: string, localPath: string) => void | Promise<void>) => {
    try { const result = await call<{ url: string; localPath: string }>('link', { account, path: target }); await then(result.url, result.localPath); } catch (error) { say(message(error)); }
  };
  const copy = async (text: string, done: string) => { say((await copyText(text)) ? done : t('drive.copy.failed')); };
  const act = {
    link: (entry: DriveEntry, at = folder) => void withLink(join(at, entry.name), url => copy(url, t('drive.copy.link.done'))),
    path: async (entry: DriveEntry, at = folder) => { try { const result = await call<{ localPath: string }>('path', { account, path: join(at, entry.name) }); await copy(result.localPath, t('drive.copy.path.done')); } catch (error) { say(message(error)); } },
    reveal: async (entry: DriveEntry, at = folder) => { try { await call('reveal', { account, path: join(at, entry.name) }); } catch (error) { say(message(error)); } },
    openLink: (entry: DriveEntry, at = folder) => void withLink(join(at, entry.name), url => { window.open(url, '_blank', 'noopener'); }),
  };
  const open = (entry: DriveEntry) => {
    if (entry.type === 'dir') { go(join(folder, entry.name)); return; }
    setMenu(undefined);
    setView(entry.textual ? { kind: 'text', entry, path: folder } : { kind: 'card', entry, path: folder });
  };
  const move = async () => {
    if (!moving) return;
    // The item was picked in one account; a move must not run in another one.
    if (moving.account !== account) { setMoving(undefined); say(t('drive.move.accountChanged')); return; }
    try { const result = await call<{ path: string }>('move', { account: moving.account, from: join(moving.from, moving.name), to: folder }); setMoving(undefined); say(t('drive.move.done', { path: result.path })); listing.reload(); } catch (error) { say(message(error)); }
  };
  const accountItems: PickItem[] = (accounts.data?.accounts ?? []).map(item => ({ key: item.id, label: item.id }));

  return <div onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#3A2E27]/30 dark:bg-[#090C16]/68 p-2 backdrop-blur-xs sm:p-3">
    <section ref={focusScope} role="dialog" aria-modal="true" aria-label="Drive" className="guild-dialog-in relative flex h-[94dvh] w-full min-w-0 max-w-3xl flex-col overflow-hidden overflow-x-hidden rounded-[26px] border border-[#E5D7C6] dark:border-[#313958] bg-[#FFFCF7]/96 dark:bg-[#171D31]/96 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_22px_50px_-12px_rgba(74,62,54,0.28)] backdrop-blur-md">
      <header className="shrink-0 space-y-2 border-b border-[#EADFD1]/80 dark:border-[#2C3450] bg-[#F7F1E8]/80 dark:bg-[#1C233A]/90 px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#C6D7EA]/80 dark:border-[#3A4369] bg-[#EDF4FB] dark:bg-[#232B4A] text-[#5B82A6] dark:text-[#9CB2E5]">
            <Cloud className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="flex-1 font-display text-[15px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">Drive</h3>
          <button type="button" aria-label={t('drive.refresh')} onClick={refreshAll} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" aria-label={t('drive.close')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        {accountItems.length > 1 && <SearchPicker value={account ?? ''} placeholder={t('drive.account.search')} emptyLabel={t('drive.account.empty')} items={accountItems} onPick={pickAccount} title={t('drive.account.choose')} />}
        {moving && <p data-moving className="rounded-2xl border border-[#F0D9B5] dark:border-[#785B38] bg-[#FFF6E8] dark:bg-[#2B2219] px-3 py-2 text-xs text-[#8A5A1F] dark:text-[#F0C882]">{t('drive.move.instructions', { name: moving.name })}</p>}
        {view.kind === 'list' && <>
          <Crumbs path={folder} onOpen={go} />
          <label className="flex items-center gap-1.5 rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#141A2C] px-3 shadow-[inset_0_1px_2px_rgba(90,70,50,0.03)]"><Search className="h-3.5 w-3.5 text-[#9A887C] dark:text-[#8E98B8]" aria-hidden="true" />
            <input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('drive.filter')} aria-label={t('drive.filter')} spellCheck={false} className="min-h-9 min-w-0 flex-1 bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-[#9A887C] dark:placeholder:text-[#7E89A8] outline-none sm:text-xs" /></label>
        </>}
      </header>
      <div ref={pullRef} data-drive-body className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 text-sm">
        <PullIndicator pull={pull} refreshing={refreshing} />
        {accounts.error ? <Status error={accounts.error} onRetry={accounts.reload} />
          : accounts.data && !accounts.data.accounts.length ? <p className="px-2 py-6 text-center text-sm text-[#7D6D61]">{t('drive.account.missing')}</p>
          : view.kind === 'list' ? <>
            <Status loading={listing.loading && !listing.data} error={listing.error} onRetry={listing.reload} />
            {!listing.error && listing.data && <DriveRows entries={entries} onOpen={open} onMenu={moving ? undefined : setMenu} />}
          </>
          : view.kind === 'card' ? <FileCard entry={view.entry} onBack={() => setView({ kind: 'list' })} onCopyLink={() => act.link(view.entry, view.path)} onOpenLink={() => act.openLink(view.entry, view.path)} />
          : <TextPane call={call} account={account!} entry={view.entry} folder={view.path} desktop={desktop} onBack={() => setView({ kind: 'list' })} onCopyLink={() => act.link(view.entry, view.path)} onReveal={() => void act.reveal(view.entry, view.path)} />}
      </div>
      {moving && view.kind === 'list' && <footer className="flex shrink-0 gap-2 border-t border-[#E5DAC9] bg-[#F5EFE6] px-3 py-2">
        <button type="button" onClick={() => void move()} className="min-h-9 flex-1 rounded-full bg-[#7A9580] px-4 text-xs font-bold text-white">{t('drive.move.here')}</button>
        <button type="button" onClick={() => setMoving(undefined)} className={drivePill}>{t('drive.cancel')}</button></footer>}
      {notice && <p role="status" data-drive-notice className="pointer-events-none absolute inset-x-6 bottom-16 z-40 rounded-full bg-[#4A3E36]/90 px-4 py-2 text-center text-xs text-white">{notice}</p>}
      {menu && <MenuSheet entry={menu} desktop={desktop} onClose={() => setMenu(undefined)}
        onCopyLink={() => { act.link(menu); setMenu(undefined); }} onCopyPath={() => { void act.path(menu); setMenu(undefined); }} onReveal={() => { void act.reveal(menu); setMenu(undefined); }}
        onMove={() => { setMoving({ name: menu.name, from: folder, account: account! }); setMenu(undefined); }} />}
    </section>
  </div>;
}

function TextPane({ call, account, entry, folder, desktop, onBack, onCopyLink, onReveal }: {
  call: GhCall; account: string; entry: DriveEntry; folder: string; desktop: boolean; onBack: () => void; onCopyLink: () => void; onReveal: () => void;
}) {
  const { t } = useT();
  const target = join(folder, entry.name);
  const data = useLoad(() => call<DriveText>('read', { account, path: target }), [account, target]);
  const [file, setFile] = useState<DriveText>();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  useEffect(() => { if (data.data) setFile(data.data); }, [data.data]);
  if (!file) return <div><button type="button" onClick={onBack} className={drivePill}>{t('drive.back')}</button><Status loading={data.loading} error={data.error} onRetry={data.reload} /></div>;
  const save = async () => {
    setSaving(true); setError(undefined);
    try {
      const saved = await call<{ mtimeMs: number; size: number }>('write', { account, path: target, text: draft, base: { mtimeMs: file.mtimeMs, size: file.size } });
      setFile({ ...file, text: draft, mtimeMs: saved.mtimeMs, size: saved.size }); setEditing(false);
    } catch (failure) { setError(message(failure)); } finally { setSaving(false); }
  };
  return <TextView name={entry.name} file={file} editing={editing} draft={draft} onDraft={setDraft} onEdit={() => { setDraft(file.text); setError(undefined); setEditing(true); }} onSave={() => void save()}
    onCancel={() => setEditing(false)} onBack={onBack} onCopyLink={onCopyLink} onReveal={desktop ? onReveal : undefined} saving={saving} error={error} />;
}
