// Contents
// Shared panel controls
// Load worktree data
// Show diffs and files
// Choose a worktree
// Open and close the room panel

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, FileText, Folder, GitCompare, Image as ImageIcon, RefreshCw, Search, X } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { RepoWorktree, RepoWorktrees, WorktreeDiffMode } from '../types/bridge';
import { useEscape } from '../utils/roomUi';
import { Markdown } from './Markdown';
import type { GhCall } from './github/GitHubPanel';

// Shared panel controls
// Keep the display helpers, button styles, and edge gesture distances together for the panel views.
const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95';
const row = 'flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition hover:bg-[#F5EFE6] dark:hover:bg-[#222947] focus-visible:outline-2 focus-visible:outline-[#965069]';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const child = (path: string, name: string) => path ? `${path}/${name}` : name;
const openAt = 70;
/** Less finger travel than this is a tap, not a pull. */
const tapSlop = 8;

// Load worktree data
// The diff, file browser, and picker use the same loading and error states.
export interface WorktreeListing { path: string; dirs: string[]; files: { name: string; size: number; kind: 'text' | 'image' | 'other' }[]; truncated: boolean }
export type WorktreeFile =
  | { path: string; kind: 'text'; text: string; truncated: boolean; size: number }
  | { path: string; kind: 'image'; dataUrl: string; size: number }
  | { path: string; kind: 'binary'; size: number };
export interface DiffFile { path: string; status: 'added' | 'deleted' | 'modified' | 'renamed'; add: number; del: number; binary: boolean; truncated: boolean; patch: string }
export interface WorktreeDiff { mode: WorktreeDiffMode; subject?: string; files: DiffFile[]; truncated: boolean }

type Load<T> = { data?: T; error?: string; loading: boolean };

/** One request to the Mac: the latest answer wins, and an old one arriving late is dropped. */
function useLoad<T>(call: GhCall, op: string, params: Record<string, unknown> | undefined, tick: number, fallback: string): Load<T> {
  const key = JSON.stringify(params ?? null);
  const [state, setState] = useState<Load<T> & { key: string }>({ key, loading: true });
  useEffect(() => {
    if (!params) { setState({ key, loading: false }); return; }
    let live = true;
    setState(current => ({ key, data: current.key === key ? current.data : undefined, loading: true }));
    call<T>(op, params).then(
      data => { if (live) setState({ key, data, loading: false }); },
      error => { if (live) setState({ key, error: error instanceof Error ? error.message : fallback, loading: false }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, op, key, tick]);
  return state.key === key ? state : { loading: Boolean(params) };
}

// Show diffs and files
// Both views read from the selected worktree and reload when the user refreshes the panel.
type WorktreeViewProps = { call: GhCall; roomId: string; worktree?: string; tick: number };

function DiffView({ call, roomId, worktree, tick, initialMode }: WorktreeViewProps & { initialMode: WorktreeDiffMode }) {
  const { t } = useT();
  const [mode, setMode] = useState(initialMode);
  const state = useLoad<WorktreeDiff>(call, 'diff', { roomId, worktree, mode }, tick, t('worktree.error'));
  const diff = state.data;
  return <div className="space-y-2.5 pt-3">
    <div role="group" aria-label={t('worktree.mode')} className="flex flex-wrap gap-1.5">
      {(['branch', 'work', 'commit'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${mode === value ? 'border-[#D48BA5] bg-[#FCE8F0] text-[#6D324B] dark:border-[#EFA4B2]/70 dark:bg-[#3A2438] dark:text-[#FADCE4]' : 'border-[#E5D7C6] bg-white/80 text-[#7D6D61] dark:border-[#364062] dark:bg-[#232B45] dark:text-[#B5BED6]'}`}>
        {t(`worktree.mode.${value}`)}
      </button>)}
    </div>
    {diff?.subject && <p className="truncate font-mono text-[11px] text-[#7D6D61] dark:text-[#A4AECC]" title={diff.subject}>{diff.subject}</p>}
    {state.error ? <p role="alert" className="text-sm text-[#A94D5A] dark:text-[#F09AA6]">{state.error}</p>
      : !diff ? <p role="status" className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.loading')}</p>
      : mode === 'branch' && (diff.mode !== 'branch' || !diff.subject)
        ? <p role="status" className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t(diff.mode !== 'branch' ? 'worktree.branch.restart' : 'worktree.branch.noBase')}</p>
      : !diff.files.length ? <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t(`worktree.empty.${mode}`)}</p>
      : <>
        <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.summary', { count: diff.files.length, add: diff.files.reduce((n, f) => n + f.add, 0), del: diff.files.reduce((n, f) => n + f.del, 0) })}</p>
        {diff.files.map(file => <details key={file.path} open={diff.files.length <= 3} className="rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white/80 dark:bg-[#141A2C]">
          <summary className="flex min-h-10 cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-[12px]">
            <span className="shrink-0 rounded-full bg-[#F3ECE1] px-2 py-0.5 text-[10px] font-semibold text-[#6E5D52] dark:bg-[#232B45] dark:text-[#B5BED6]">{t(`worktree.status.${file.status}`)}</span>
            <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>
            <span className="shrink-0 font-mono text-[11px]"><span className="text-[#4E7A55] dark:text-[#8FC79A]">+{file.add}</span> <span className="text-[#B0525F] dark:text-[#F09AA6]">−{file.del}</span></span>
          </summary>
          {file.binary ? <p className="px-3 pb-2.5 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.binary')}</p>
            : <div className="max-h-[60dvh] overflow-auto border-t border-[#EADFD1] dark:border-[#2C3450] bg-[#362D28] py-1 font-mono text-[11px] leading-[1.55]">
              {file.patch.split('\n').map((line, index) => <div key={index} className={`min-w-max whitespace-pre px-2.5 ${line.startsWith('+') ? 'bg-emerald-500/20 text-emerald-200' : line.startsWith('-') ? 'bg-rose-500/20 text-rose-200' : line.startsWith('@@') ? 'text-[#9FB3D9]' : 'text-[#C8B7A6]'}`}>{line || ' '}</div>)}
              {file.truncated && <p className="px-2.5 py-1 font-sans text-[11px] text-[#F0C882]">{t('worktree.patch.cut')}</p>}
            </div>}
        </details>)}
        {diff.truncated && <p className="rounded-xl border border-[#F0D9B5] bg-[#FFF6E8] px-3 py-2 text-xs text-[#8A5A1F] dark:border-[#785B38] dark:bg-[#2B2219] dark:text-[#F0C882]">{t(mode === 'branch' ? 'worktree.branch.truncated' : 'worktree.truncated')}</p>}
      </>}
  </div>;
}

function FilesView({ call, roomId, worktree, tick }: WorktreeViewProps) {
  const { t } = useT();
  const [path, setPath] = useState('');
  const [open, setOpen] = useState<string>();
  const list = useLoad<WorktreeListing>(call, 'list', { roomId, worktree, path }, tick, t('worktree.error'));
  const file = useLoad<WorktreeFile>(call, 'read', open ? { roomId, worktree, path: open } : undefined, tick, t('worktree.error'));
  const listing = list.data;
  const crumbs = path.split('/').filter(Boolean);
  if (open) {
    const name = open.split('/').pop() || open;
    const data = file.data;
    return <div className="space-y-2.5">
      <div className="sticky top-0 z-20 -mx-3.5 space-y-1.5 border-b border-[#EADFD1]/85 bg-[#FFFCF7]/95 px-3.5 py-2.5 backdrop-blur-md dark:border-[#2C3450] dark:bg-[#171D31]/95">
        <button type="button" onClick={() => setOpen(undefined)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#DEC9B8] bg-white/95 px-3.5 py-1.5 text-xs font-bold text-[#4A3E36] shadow-2xs transition hover:border-[#D48BA5] hover:bg-[#FFF5F8] active:scale-95 dark:border-[#4A5682] dark:bg-[#252E4C] dark:text-[#F0F3FC] dark:hover:border-[#EFA4B2]/70 dark:hover:bg-[#2F3A5E] cursor-pointer"><ChevronLeft className="h-4 w-4 text-[#C4668A] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />{t('worktree.back')}</button>
        <p className="break-all font-mono text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{open}</p>
      </div>
      {file.error ? <p role="alert" className="text-sm text-[#A94D5A] dark:text-[#F09AA6]">{file.error}</p>
        : !data ? <p role="status" className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.loading')}</p>
        : data.kind === 'image' ? <img src={data.dataUrl} alt={name} className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-2xl bg-[#241E1C]/5 object-contain" />
        : data.kind === 'binary' ? <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.binaryFile', { size: size(data.size) })}</p>
        : <>
          {data.truncated && <p className="rounded-xl border border-[#F0D9B5] bg-[#FFF6E8] px-3 py-2 text-xs text-[#8A5A1F] dark:border-[#785B38] dark:bg-[#2B2219] dark:text-[#F0C882]">{t('file.truncated', { size: Math.round(data.size / 1024), shown: Math.round(data.text.length / 1024) })}</p>}
          {/\.(?:md|markdown)$/i.test(open) ? <Markdown variant="doc" text={data.text} />
            : <pre className="overflow-x-auto whitespace-pre rounded-2xl border border-[#E6DCD0] bg-white/80 p-3 font-mono text-[12px] leading-[1.6] dark:border-[#2E3654] dark:bg-[#141A2C]">{data.text}</pre>}
        </>}
    </div>;
  }
  return <div className="space-y-1 pt-2">
    <p className="flex flex-wrap items-center gap-0.5 font-mono text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">
      <button type="button" onClick={() => setPath('')} className="rounded px-1 py-1 hover:bg-[#F5EFE6] dark:hover:bg-[#222947]">{t('worktree.root')}</button>
      {crumbs.map((name, index) => <span key={index} className="inline-flex items-center gap-0.5"><ChevronRight className="h-3 w-3" aria-hidden="true" />
        <button type="button" onClick={() => setPath(crumbs.slice(0, index + 1).join('/'))} className="rounded px-1 py-1 hover:bg-[#F5EFE6] dark:hover:bg-[#222947]">{name}</button></span>)}
    </p>
    {list.error ? <p role="alert" className="text-sm text-[#A94D5A] dark:text-[#F09AA6]">{list.error}</p>
      : !listing ? <p role="status" className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.loading')}</p>
      : <>
        {crumbs.length > 0 && <button type="button" onClick={() => setPath(crumbs.slice(0, -1).join('/'))} className={`${row} font-semibold text-[#7D6D61] dark:text-[#A4AECC]`}><ChevronUp className="h-4 w-4" aria-hidden="true" />{t('worktree.up')}</button>}
        {listing.dirs.map(name => <button key={`d:${name}`} type="button" onClick={() => setPath(child(path, name))} className={row}>
          <Folder className="h-4 w-4 shrink-0 text-[#689B73] dark:text-[#96BD9F]" aria-hidden="true" /><span className="min-w-0 break-all">{name}</span></button>)}
        {listing.files.map(item => item.kind === 'other'
          ? <div key={`f:${item.name}`} className={`${row} cursor-default opacity-55 hover:bg-transparent dark:hover:bg-transparent`}><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 break-all">{item.name}</span><span className="shrink-0 font-mono text-[10px]">{size(item.size)}</span></div>
          : <button key={`f:${item.name}`} type="button" onClick={() => setOpen(child(path, item.name))} className={row}>
            {item.kind === 'image' ? <ImageIcon className="h-4 w-4 shrink-0 text-[#C4668A] dark:text-[#EFA4B2]" aria-hidden="true" /> : <FileText className="h-4 w-4 shrink-0 text-[#8C6D58] dark:text-[#D6BFA8]" aria-hidden="true" />}
            <span className="min-w-0 flex-1 break-all">{item.name}</span><span className="shrink-0 font-mono text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]">{size(item.size)}</span></button>)}
        {!listing.dirs.length && !listing.files.length && <p className="px-2 py-1 text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.empty.folder')}</p>}
        {listing.truncated && <p className="px-2 py-1 text-xs text-[#8A5A1F] dark:text-[#F0C882]">{t('worktree.list.truncated')}</p>}
      </>}
  </div>;
}

// Choose a worktree
// Keep the saved choice per room and let the user search linked worktrees.
const worktreeStorageKey = (roomId: string) => `komorebi.worktree.${roomId}`;
const folderName = (path: string) => path.split('/').pop() || path;

function savedWorktree(roomId: string): string {
  try { return localStorage.getItem(worktreeStorageKey(roomId)) ?? 'auto'; }
  catch { return 'auto'; }
}

function WorktreeSearch({ call, roomId, tick, entries, selection, onPick }: {
  call: GhCall;
  roomId: string;
  tick: number;
  entries: RepoWorktree[];
  selection: string;
  onPick: (value: string, entry?: RepoWorktree) => void;
}) {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const term = input.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(term), 180);
    return () => window.clearTimeout(timer);
  }, [term]);
  const matches = useLoad<RepoWorktrees>(call, 'worktrees', query ? { roomId, query } : undefined, tick, t('worktree.error'));
  const results = term ? matches.data?.entries ?? [] : entries;
  const branchName = (entry: RepoWorktree) => entry.branch ?? t('worktree.picker.detached', { head: entry.head });
  return <div className="space-y-2 px-3.5 py-2.5" onPointerDown={event => event.stopPropagation()}>
    <input type="search" autoFocus maxLength={200} value={input} onChange={event => setInput(event.target.value)}
      aria-label={t('worktree.picker.search')} placeholder={t('worktree.picker.placeholder')}
      className="min-h-10 w-full rounded-xl border border-[#E5D7C6] bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-[#965069] dark:border-[#364062] dark:bg-[#232B45]" />
    <button type="button" className={row} aria-pressed={selection === 'auto'} onClick={() => onPick('auto')}>{t('worktree.picker.follow')}</button>
    {term && (term !== query || matches.loading) ? <p role="status">{t('worktree.loading')}</p>
      : term && matches.error ? <p role="alert">{t('worktree.error')}</p>
      : !results.length ? <p role="status">{t('worktree.picker.noMatches')}</p>
      : results.map(entry => {
        const value = entry.isRoom ? '' : entry.path;
        return <button key={entry.path} type="button" disabled={!entry.exists} aria-pressed={value === selection}
          className={`${row} disabled:opacity-50 aria-pressed:bg-[#FCE8F0] dark:aria-pressed:bg-[#3A2438]`} onClick={() => onPick(value, entry)}>
          <span className="min-w-0">
            <span className="block truncate font-mono" title={branchName(entry)}>{branchName(entry)}</span>
            <span className="block truncate text-[11px] text-[#7D6D61] dark:text-[#A4AECC]" title={entry.path}>
              {folderName(entry.path)}{entry.isRoom ? ` · ${t('worktree.picker.room')}` : ''}
              {!entry.exists ? ` · ${t('worktree.picker.missing')}` : ''}
            </span>
          </span>
        </button>;
      })}
  </div>;
}

// Open and close the room panel
// Keep panel gestures, keyboard dismissal, and the selected room and tab in the enclosing layer.
/** A block that scrolls sideways on its own (a long code line) keeps its own horizontal drag. */
const scrollsSideways = (target: EventTarget | null, stop: Element) => {
  for (let node = target instanceof Element ? target : null; node && node !== stop; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1 && /(?:auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
};

/**
 * A layer over one room that slides in from the right edge: what changed in the room's folder (Diff) and a way to read its files.
 * Read only. Pull the edge tab out to the left to open it (or tap it). Swipe right anywhere on the layer, press Esc or tap × to close.
 */
export function WorktreeLayer({ roomId, call, choices, initialDiffMode = 'work' }: { roomId: string; call: GhCall; /** In a group: the member rooms to choose from. */ choices?: { id: string; label: string }[];
  initialDiffMode?: WorktreeDiffMode }) {
  const { t } = useT();
  const [open, setPanelOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pull, setPull] = useState(0);
  const [pullClose, setPullClose] = useState(0);
  const [tab, setTab] = useState<'diff' | 'files'>('diff');
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<string>();
  const setOpen = (value: boolean) => {
    if (!value) {
      setSearching(false);
      setPicked(undefined);
    }
    setPanelOpen(value);
  };
  const [preference, setPreference] = useState<{ roomId: string; value: string; entry?: RepoWorktree }>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const start = useRef<number | undefined>(undefined);
  const travel = useRef(0);
  const swipe = useRef<{ x: number; y: number; lock?: 'x' | 'y' } | undefined>(undefined);
  const closeSearch = () => { setSearching(false); searchButton.current?.focus(); };
  useEscape(open, () => { if (searching) closeSearch(); else setOpen(false); });
  useEffect(() => { setOpen(false); setTab('diff'); }, [roomId]);
  const active = choices?.some(choice => choice.id === picked) ? picked! : roomId;
  const currentPreference = preference?.roomId === active ? preference : undefined;
  // A selection from search already has its entry. Recheck the saved path on open or refresh.
  const savedPath = useMemo(() => savedWorktree(active), [active, open, tick]);
  const preferred = currentPreference?.value ?? savedPath;
  const worktrees = useLoad<RepoWorktrees>(call, 'worktrees', open ? { roomId: active, worktree: savedPath } : undefined, tick, t('worktree.error'));
  const entries = worktrees.data?.entries ?? [];
  const pickedWorktree = entries.find(entry => entry.path === preferred && entry.exists && !entry.isRoom)
    ?? (savedPath !== preferred && currentPreference?.entry?.path === preferred ? currentPreference.entry : undefined);
  const suggestedWorktree = entries.find(entry => entry.path === worktrees.data?.suggestedWorktree && entry.exists);
  const selectedWorktree = preferred === 'auto' ? suggestedWorktree : pickedWorktree;
  const roomWorktree = entries.find(entry => entry.isRoom);
  const visibleWorktree = selectedWorktree ?? roomWorktree;
  const viewTitle = preferred === 'auto' && suggestedWorktree && worktrees.data?.suggestedTitle
    ? worktrees.data.suggestedTitle : visibleWorktree ? folderName(visibleWorktree.path) : t('worktree.picker.room');
  const viewProps = { call, roomId: active, worktree: selectedWorktree?.isRoom ? undefined : selectedWorktree?.path, tick };
  const pickWorktree = (value: string, entry?: RepoWorktree) => {
    setPreference({ roomId: active, value, entry });
    try { localStorage.setItem(worktreeStorageKey(active), value); } catch { /* the choice still works this time */ }
    closeSearch();
  };
  const width = typeof window === 'undefined' ? 400 : window.innerWidth;
  const drag = (event: React.PointerEvent, onMove: (dx: number) => void) => {
    if (start.current === undefined) return;
    travel.current = Math.max(travel.current, Math.abs(event.clientX - start.current));
    onMove(event.clientX - start.current);
  };
  const begin = (event: React.PointerEvent) => { start.current = event.clientX; travel.current = 0; event.currentTarget.setPointerCapture?.(event.pointerId); };
  const finish = useCallback((commit: () => void) => { start.current = undefined; commit(); setPull(0); setPullClose(0); }, []);
  const shown = open || pull > 0;
  const offset = open ? Math.max(0, pullClose) : Math.max(0, width - pull);
  return <>
    {!open && <button type="button" data-no-swipe aria-label={t('worktree.open')} title={t('worktree.open')}
      onPointerDown={begin} onPointerMove={event => drag(event, dx => setPull(Math.max(0, -dx)))}
      onPointerUp={() => finish(() => { if (pull > openAt || travel.current < tapSlop) setOpen(true); })} onPointerCancel={() => finish(() => undefined)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}
      className="group absolute right-0 top-1/2 z-20 flex h-[4.5rem] w-5 -translate-y-1/2 touch-none flex-col items-center justify-center gap-1.5 rounded-l-full border border-r-0 border-white/75 bg-white/30 pl-0.5 text-[#7D6558] shadow-[-4px_4px_14px_-6px_rgba(90,70,50,0.22),inset_1px_1px_0_rgba(255,255,255,0.85)] backdrop-blur-md backdrop-saturate-150 transition hover:w-6 hover:bg-white/48 hover:text-[#6D324B] dark:border-[#7B8EC2]/35 dark:bg-[#182038]/34 dark:text-[#C5D0EC] dark:shadow-[-4px_4px_16px_-6px_rgba(0,0,0,0.55),inset_1px_1px_0_rgba(255,255,255,0.16)] dark:hover:bg-[#1E2846]/52 cursor-pointer">
      <GitCompare className="h-3 w-3 shrink-0 text-[#B85C74] dark:text-[#EFA4B2]" aria-hidden="true" />
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[#C4A898]/70 dark:bg-[#7B8EC2]/60" />
      <Folder className="h-3 w-3 shrink-0 text-[#638C6D] dark:text-[#9AD0A6]" aria-hidden="true" />
    </button>}
    {shown && <section role="dialog" aria-label={t('worktree.title')} data-no-swipe data-worktree
      style={{ transform: `translate3d(${offset}px,0,0)`, transition: start.current === undefined && !swipe.current ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none' }}
      onTouchStart={event => {
        const touch = event.touches[0];
        swipe.current = event.touches.length === 1 && !scrollsSideways(event.target, event.currentTarget) ? { x: touch.clientX, y: touch.clientY } : undefined;
      }}
      onTouchMove={event => {
        const state = swipe.current;
        if (!state) return;
        const dx = event.touches[0].clientX - state.x;
        const dy = event.touches[0].clientY - state.y;
        if (!state.lock && Math.hypot(dx, dy) > 10) state.lock = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
        if (state.lock === 'x') setPullClose(Math.max(0, dx));
      }}
      onTouchEnd={() => { const state = swipe.current; swipe.current = undefined; if (state?.lock === 'x' && pullClose > openAt) setOpen(false); setPullClose(0); }}
      onTouchCancel={() => { swipe.current = undefined; setPullClose(0); }}
      className="absolute inset-0 z-40 flex min-w-0 flex-col overflow-hidden bg-[#FFFCF7]/97 text-[#4A3E36] shadow-[-12px_0_30px_-12px_rgba(74,62,54,0.35)] backdrop-blur-md dark:bg-[#171D31]/97 dark:text-[#ECE7DF]">
      <header className="shrink-0 touch-pan-y space-y-2 border-b pt-[max(0.625rem,env(safe-area-inset-top))] border-[#EADFD1]/80 bg-[#F7F1E8]/80 px-3.5 py-2.5 dark:border-[#2C3450] dark:bg-[#1C233A]/90">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#EBC5CA]/80 bg-[#FCEEF2] text-[#C4668A] dark:border-[#59354B] dark:bg-[#312338] dark:text-[#EFA4B2]"><GitCompare className="h-4 w-4" aria-hidden="true" /></span>
          <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{t('worktree.title')}</h3>
          <button type="button" aria-label={t('worktree.refresh')} title={t('worktree.refresh')} onPointerDown={event => event.stopPropagation()} onClick={() => setTick(value => value + 1)} className={iconButton}><RefreshCw className="h-4 w-4" /></button>
          <button type="button" aria-label={t('worktree.close')} onPointerDown={event => event.stopPropagation()} onClick={() => setOpen(false)} className={iconButton}><X className="h-4 w-4" /></button>
        </div>
        <div role="tablist" aria-label={t('worktree.title')} className="flex gap-1.5" onPointerDown={event => event.stopPropagation()}>
          {(['diff', 'files'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
            className={`min-h-9 flex-1 rounded-full border px-3 text-[13px] font-semibold transition ${tab === value ? 'border-[#D48BA5] bg-[#FCE8F0] text-[#6D324B] dark:border-[#EFA4B2]/70 dark:bg-[#3A2438] dark:text-[#FADCE4]' : 'border-[#E5D7C6] bg-white/80 text-[#7D6D61] dark:border-[#364062] dark:bg-[#232B45] dark:text-[#B5BED6]'}`}>
            {t(value === 'diff' ? 'worktree.tab.diff' : 'worktree.tab.files')}
          </button>)}
        </div>
        {choices && choices.length > 1 && <div role="group" aria-label={t('worktree.room')} className="flex gap-1.5 overflow-x-auto" onPointerDown={event => event.stopPropagation()}>
          {choices.map(choice => <button key={choice.id} type="button" aria-pressed={active === choice.id} onClick={() => { setSearching(false); setPicked(choice.id); }}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${active === choice.id ? 'border-[#8FB79A] bg-[#E6F2E8] text-[#3F6B4A] dark:border-[#96BD9F]/70 dark:bg-[#1F3327] dark:text-[#BFE0C8]' : 'border-[#E5D7C6] bg-white/80 text-[#7D6D61] dark:border-[#364062] dark:bg-[#232B45] dark:text-[#B5BED6]'}`}>{choice.label}</button>)}
        </div>}
        {entries.length > 0 && <div className="flex items-center gap-2 rounded-xl border border-[#E5D7C6] bg-white/80 pl-2.5 pr-1 dark:border-[#364062] dark:bg-[#232B45]">
          <p className="min-w-0 flex-1 truncate py-1.5 text-xs font-semibold" title={visibleWorktree?.path}>{t('worktree.picker.viewing', { name: viewTitle })}</p>
          <button ref={searchButton} type="button" aria-expanded={searching} title={t(searching ? 'worktree.close' : 'worktree.picker.search')}
            aria-label={t(searching ? 'worktree.close' : 'worktree.picker.search')} onPointerDown={event => event.stopPropagation()}
            onClick={() => { if (searching) closeSearch(); else setSearching(true); }} className={iconButton}>
            {searching ? <X className="h-4 w-4" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>}
      </header>
      <div hidden={searching} className="min-h-0 flex-1 touch-pan-y select-text overflow-y-auto overscroll-contain px-3.5 pb-3">
        {open && (!worktrees.data && worktrees.loading
          ? <p role="status" className="pt-3 text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('worktree.loading')}</p>
          : tab === 'diff' ? <DiffView key={active} {...viewProps} initialMode={initialDiffMode} />
          : <FilesView key={JSON.stringify([active, viewProps.worktree])} {...viewProps} />)}
      </div>
      {open && searching && <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">
        <WorktreeSearch key={active} call={call} roomId={active} tick={tick} entries={entries}
          selection={preferred === 'auto' ? 'auto' : pickedWorktree?.path ?? ''} onPick={pickWorktree} />
      </div>}
    </section>}
  </>;
}
