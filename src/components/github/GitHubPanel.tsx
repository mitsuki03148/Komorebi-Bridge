import { useT } from '../../i18n/useLang';
import { t as translateCurrent } from '../../i18n';
import { PullIndicator } from '../PullIndicator';
import { usePullToRefresh } from '../../utils/pullRefresh';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, CircleDot, Code2, GitBranch, GitCommitHorizontal, Github, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { focusScope } from '../../utils/focusScope';
import { useEscape } from '../../utils/roomUi';
import { SearchPicker, type PickItem } from './SearchPicker';
import { Back, CommitDetail, CommitRows, CompareDetail, DirRows, FileDetail, IssueDetail, IssueRows, PrivateMark, ago, type GhComment, type GhCommit, type GhCommitBrief, type GhEntry, type GhFile, type GhFileContent, type GhIssue } from './views';
import type { LineRange } from '../../utils/githubLinks';
import { ghKeys, ghPrefs } from '../../utils/ghPrefs';
import { resolveRefPath, type GhTarget } from '../../utils/githubUrl';
import { useConfirm } from '../ConfirmDialog';

export type GhCall = <T>(op: string, params?: Record<string, unknown>) => Promise<T>;
interface RepoInfo { fullName: string; private: boolean; defaultBranch: string; pushedAt: string; description: string; archived: boolean; openIssues: number }
interface Branch { name: string; sha: string; isDefault: boolean }
type Tab = 'issues' | 'code' | 'commits';

const store = ghPrefs;
const message = (error: unknown) => (error instanceof Error ? error.message : translateCurrent('github.error.generic'));

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
  loading ? <p role="status" className="flex items-center gap-1.5 px-2 py-4 text-xs text-[#7D6D61] dark:text-[#A4AECC]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('github.loading')}</p>
    : error ? <p role="alert" className="px-2 py-4 text-xs text-[#A94D5A] dark:text-[#F09AA6]">{error}{onRetry && <button type="button" onClick={onRetry} className="ml-2 underline">{t('github.retry')}</button>}</p> : null
  );
};

function IssuesTab({ call, repo, refresh, initialIssue, focusComment }: { call: GhCall; repo: string; refresh: number; initialIssue?: number; focusComment?: number }) {
  const { t } = useT();
  const [owner, name] = repo.split('/');
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [query, setQuery] = useState(''), [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState<GhIssue[]>([]);
  const [selected, setSelected] = useState<number | undefined>(initialIssue);
  const list = useLoad(() => call<{ issues: GhIssue[] }>('issues', { repo, state, query: submitted, page: 1 }), [repo, state, submitted, refresh]);
  useEffect(() => { setPage(1); setMore([]); }, [repo, state, submitted]);
  const loadMore = async () => { const next = page + 1; const result = await call<{ issues: GhIssue[] }>('issues', { repo, state, query: submitted, page: next }); setMore(current => [...current, ...result.issues]); setPage(next); };
  if (selected !== undefined) return <IssueView call={call} repo={repo} number={selected} focusComment={selected === initialIssue ? focusComment : undefined} onBack={() => setSelected(undefined)} />;
  const issues = [...(list.data?.issues ?? []), ...more];
  return <div>
    <form onSubmit={event => { event.preventDefault(); setSubmitted(query.trim()); }} className="mb-2 flex flex-wrap items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[#E6DCD0] dark:border-[#364062] bg-white dark:bg-[#141A2C] px-3"><Search className="h-3.5 w-3.5 text-[#9A887C] dark:text-[#8E98B8]" aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('github.issues.search.placeholder', { owner, repo: name })} aria-label={t('github.issues.search.aria')} className="min-h-9 min-w-0 flex-1 bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-[#9A887C] dark:placeholder:text-[#7E89A8] outline-none sm:text-xs" /></label>
      <div role="group" aria-label={t('github.issues.status')} className="flex gap-1">{(['open', 'closed', 'all'] as const).map(value => (
        <button key={value} type="button" aria-pressed={state === value} onClick={() => setState(value)} className={`min-h-8 rounded-full px-2.5 text-[11px] font-semibold ${state === value ? 'bg-[#7A9580] text-white' : 'bg-white dark:bg-[#1E253D] text-[#6E5D52] dark:text-[#B5BED6] border border-[#E2D6C5] dark:border-[#364062]'}`}>{value === 'open' ? t('github.issues.open') : value === 'closed' ? t('github.issues.closed') : t('github.issues.all')}</button>))}</div>
    </form>
    <Status loading={list.loading && !issues.length} error={list.error} onRetry={list.reload} />
    {!list.loading && !list.error && <IssueRows issues={issues} onOpen={setSelected} />}
    {!list.loading && !list.error && issues.length >= 30 * page && <button type="button" onClick={() => void loadMore()} className="mt-2 w-full rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] py-2 text-xs font-semibold text-[#6E5D52] dark:text-[#C5CDE3]">{t('github.more')}</button>}
  </div>;
}

function IssueView({ call, repo, number, focusComment, onBack }: { call: GhCall; repo: string; number: number; focusComment?: number; onBack: () => void }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [owner, name] = repo.split('/');
  const data = useLoad(() => call<{ issue: GhIssue; comments: GhComment[] }>('issue', { repo, number }), [repo, number]);
  const [extra, setExtra] = useState<GhComment[]>([]);
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState<string>();
  useEffect(() => { setExtra([]); setDraft(''); setError(undefined); }, [repo, number]);
  // A link to one comment scrolls to it once the issue is on screen.
  useEffect(() => { if (focusComment && data.data) document.querySelector(`[data-comment="${focusComment}"]`)?.scrollIntoView({ block: 'center' }); }, [focusComment, data.data]);
  if (!data.data) return <div><Back onBack={onBack}>{t('github.nav.issues')}</Back><Status loading={data.loading} error={data.error} onRetry={data.reload} /></div>;
  const send = async () => {
    const ok = await confirm({
      title: t('confirm.title.comment'),
      message: t('github.issues.comment.confirm', { repo, number }),
      confirmLabel: t('confirm.action.post'),
      tone: 'default',
    });
    if (!ok) return;
    setSending(true); setError(undefined);
    try {
      const made = await call<{ id: number; author: string; body: string; createdAt: string }>('comment', { repo, number, body: draft });
      setExtra(current => [...current, { id: made.id, author: made.author, body: made.body, createdAt: made.createdAt }]); setDraft('');
    } catch (failure) { setError(message(failure)); } finally { setSending(false); }
  };
  return <IssueDetail owner={owner} repo={name} issue={data.data.issue} comments={[...data.data.comments, ...extra]} draft={draft} onDraft={setDraft} onSend={() => void send()} sending={sending} error={error} onBack={onBack} />;
}

function CodeTab({ call, repo, branch, initialPath = '', initialLines }: { call: GhCall; repo: string; branch: Branch; initialPath?: string; initialLines?: LineRange }) {
  const { t } = useT();
  const [owner, name] = repo.split('/');
  const [path, setPath] = useState(initialPath);
  const [lines, setLines] = useState<LineRange | undefined>(initialLines);
  const [query, setQuery] = useState(''), [found, setFound] = useState<{ name: string; path: string }[]>();
  const [searchError, setSearchError] = useState<string>();
  const node = useLoad(() => call<{ kind: 'dir'; entries: GhEntry[] } | (GhFileContent & { kind: 'file' }) | { kind: 'other' }>('tree', { repo, ref: branch.name, path }), [repo, branch.name, path]);
  const open = (entry: { path: string; type?: string }) => { setPath(entry.path); setLines(undefined); setFound(undefined); };
  const crumbs = path ? path.split('/') : [];
  const search = async (event: React.FormEvent) => {
    event.preventDefault(); setSearchError(undefined);
    if (!query.trim()) { setFound(undefined); return; }
    try { setFound((await call<{ items: { name: string; path: string }[] }>('searchCode', { repo, query })).items); } catch (failure) { setSearchError(message(failure)); }
  };
  return <div>
    <form onSubmit={event => void search(event)} className="mb-2 flex items-center gap-1.5 rounded-full border border-[#E6DCD0] dark:border-[#364062] bg-white dark:bg-[#141A2C] px-3"><Search className="h-3.5 w-3.5 text-[#9A887C] dark:text-[#8E98B8]" aria-hidden="true" />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('github.code.search.placeholder', { owner, repo: name })} aria-label={t('github.code.search.aria')} className="min-h-9 min-w-0 flex-1 bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-[#9A887C] dark:placeholder:text-[#7E89A8] outline-none sm:text-xs" /></form>
    {searchError && <p role="alert" className="mb-2 text-xs text-[#A94D5A] dark:text-[#F09AA6]">{searchError}</p>}
    {found ? <div><Back onBack={() => setFound(undefined)}>{t('github.code.back')}</Back><DirRows entries={found.map(item => ({ name: item.path, path: item.path, type: 'file', size: 0 }))} onOpen={open} /></div> : <>
      <nav aria-label={t('github.code.path')} className="mb-2 flex items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 font-mono text-xs text-[#7D6D61] dark:text-[#A4AECC]">
        <button type="button" onClick={() => open({ path: '' })} className="shrink-0 rounded-full px-2 py-0.5 font-semibold hover:bg-white/80 dark:hover:bg-[#27304D]">{name}</button>
        {crumbs.map((part, index) => {
          const last = index === crumbs.length - 1;
          return <span key={index} className="inline-flex shrink-0 items-center gap-0.5">
            <ChevronRight className="h-3 w-3 text-[#B8A89B] dark:text-[#697496]" aria-hidden="true" />
            <button type="button" onClick={() => open({ path: crumbs.slice(0, index + 1).join('/') })} className={`rounded-full px-2 py-0.5 transition hover:bg-white/80 dark:hover:bg-[#27304D] ${last ? 'font-semibold text-[#4A3E36] dark:text-[#ECE7DF]' : ''}`}>{part}</button>
          </span>;
        })}
      </nav>
      <Status loading={node.loading && !node.data} error={node.error} onRetry={node.reload} />
      {node.data?.kind === 'dir' && <DirRows entries={node.data.entries} onOpen={open} />}
      {node.data?.kind === 'file' && <FileDetail owner={owner} repo={name} sha={branch.sha} file={node.data} lines={lines} onLines={setLines} />}
      {node.data?.kind === 'other' && <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.code.unavailable')}</p>}
    </>}
  </div>;
}

function CommitsTab({ call, repo, branch, branches, refresh, initialSha, initialBase }: { call: GhCall; repo: string; branch: Branch; branches: Branch[]; refresh: number; initialSha?: string; initialBase?: string }) {
  const { t } = useT();
  const [owner, name] = repo.split('/');
  const [page, setPage] = useState(1);
  const [extra, setExtra] = useState<GhCommitBrief[]>([]);
  const [sha, setSha] = useState<string | undefined>(initialSha), [base, setBase] = useState<string | undefined>(initialBase);
  const list = useLoad(() => call<{ commits: GhCommitBrief[] }>('commits', { repo, ref: branch.name, page: 1 }), [repo, branch.name, refresh]);
  const commit = useLoad(() => sha ? call<GhCommit>('commit', { repo, sha }) : Promise.resolve(undefined), [repo, sha]);
  const compare = useLoad(() => base ? call<{ aheadBy: number; behindBy: number; files: GhFile[]; commits: GhCommitBrief[] }>('compare', { repo, base, head: branch.name }) : Promise.resolve(undefined), [repo, base, branch.name]);
  const loadMore = async () => { const next = page + 1; const result = await call<{ commits: GhCommitBrief[] }>('commits', { repo, ref: branch.name, page: next }); setExtra(current => [...current, ...result.commits]); setPage(next); };
  if (sha) return commit.data ? <CommitDetail owner={owner} repo={name} commit={commit.data} onBack={() => setSha(undefined)} /> : <div><Back onBack={() => setSha(undefined)}>{t('github.nav.commits')}</Back><Status loading={commit.loading} error={commit.error} onRetry={commit.reload} /></div>;
  if (base) return <div><Back onBack={() => setBase(undefined)}>{t('github.nav.commits')}</Back>
    {compare.data ? <CompareDetail owner={owner} repo={name} base={base} head={branch.name} aheadBy={compare.data.aheadBy} behindBy={compare.data.behindBy} files={compare.data.files} commits={compare.data.commits} onOpenCommit={setSha} /> : <Status loading={compare.loading} error={compare.error} onRetry={compare.reload} />}</div>;
  const commits = [...(list.data?.commits ?? []), ...extra];
  const items: PickItem[] = branches.filter(item => item.name !== branch.name).map(item => ({ key: item.name, label: item.name, mark: item.isDefault ? <span className="text-[10px] text-[#7A9580]">{t('github.branch.default')}</span> : undefined }));
  return <div>
    <div className="mb-2 flex items-center gap-2"><span className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('github.compare.label')}</span><div className="w-44"><SearchPicker value="" placeholder={t('github.branch.search')} emptyLabel={t('github.branch.select')} items={items} onPick={setBase} /></div></div>
    <Status loading={list.loading && !commits.length} error={list.error} onRetry={list.reload} />
    {!list.error && <CommitRows commits={commits} onOpen={setSha} />}
    {!list.loading && commits.length >= 30 * page && <button type="button" onClick={() => void loadMore()} className="mt-2 w-full rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] py-2 text-xs font-semibold text-[#6E5D52] dark:text-[#C5CDE3]">{t('github.more')}</button>}
  </div>;
}

/** A popup for reading GitHub: pick a repo and a branch at the top, then Issues, Code or Commits. Read only, except for replying on an issue. */
const isSha = (value: string) => /^[0-9a-f]{7,40}$/i.test(value);
const tabFor = (target?: GhTarget): Tab | undefined => !target ? undefined : target.kind === 'issue' || target.kind === 'issues' ? 'issues' : target.kind === 'commit' || target.kind === 'commits' || target.kind === 'compare' ? 'commits' : target.kind === 'blob' || target.kind === 'tree' ? 'code' : undefined;

export function GitHubPanel({ call, onClose, target }: { call: GhCall; onClose: () => void; target?: GhTarget }) {
  const { t } = useT();
  useEscape(true, onClose);
  const [repo, setRepo] = useState<string | undefined>(() => target?.repo ?? store.get(ghKeys.repo));
  const [tab, setTab] = useState<Tab>(() => tabFor(target) ?? ((store.get(ghKeys.tab) as Tab) || 'issues'));
  const repos = useLoad(() => call<{ repos: RepoInfo[] }>('repos'), []);
  const branches = useLoad(() => repo ? call<{ branches: Branch[]; defaultBranch: string }>('branches', { repo }) : Promise.resolve(undefined), [repo]);
  const [branchName, setBranchName] = useState<string>();
  useEffect(() => { setBranchName(repo ? store.get(ghKeys.branch(repo)) : undefined); }, [repo]);
  // A link can name the ref it points at (a branch, a commit id or a tag); it is used instead of the picked branch.
  const linked = useMemo(() => {
    if (!target || !branches.data) return undefined;
    const names = branches.data.branches.map(item => item.name);
    if (target.kind === 'blob' || target.kind === 'tree' || target.kind === 'commits') return { ...resolveRefPath(target.rest, names) };
    if (target.kind === 'compare') return { ref: target.head, path: '' };
    return undefined;
  }, [target, branches.data]);
  const known = linked && branches.data?.branches.find(item => item.name === linked.ref);
  const tagSha = useLoad(() => linked && !known && !isSha(linked.ref) && repo ? call<{ commits: { sha: string }[] }>('commits', { repo, ref: linked.ref, page: 1 }).then(result => result.commits[0]?.sha ?? '') : Promise.resolve(undefined), [repo, linked?.ref, Boolean(known)]);
  const branch: Branch | undefined = useMemo(() => {
    if (linked && !known) return isSha(linked.ref) ? { name: linked.ref, sha: linked.ref, isDefault: false } : tagSha.data ? { name: linked.ref, sha: tagSha.data, isDefault: false } : undefined;
    return known ?? branches.data?.branches.find(item => item.name === branchName) ?? branches.data?.branches.find(item => item.isDefault) ?? branches.data?.branches[0];
  }, [linked, known, tagSha.data, branches.data, branchName]);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshAll = useCallback(() => { repos.reload(); branches.reload(); setRefreshTick(value => value + 1); }, [repos, branches]);
  const { ref: pullRef, pull, refreshing } = usePullToRefresh(refreshAll, tab !== 'code');
  const pickRepo = useCallback((key: string) => { setRepo(key); store.set(ghKeys.repo, key); }, []);
  const pickTab = (next: Tab) => { setTab(next); store.set(ghKeys.tab, next); };
  const repoItems: PickItem[] = (repos.data?.repos ?? []).map(item => ({ key: item.fullName, label: item.fullName, sub: item.description || t('github.repo.updated', { time: ago(item.pushedAt) }), mark: item.private ? <PrivateMark /> : undefined }));
  const branchItems: PickItem[] = (branches.data?.branches ?? []).map(item => ({ key: item.name, label: item.name, mark: item.isDefault ? <span className="text-[10px] text-[#7A9580]">{t('github.branch.default')}</span> : undefined }));
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'issues', label: t('github.nav.issues'), icon: <CircleDot className="h-3.5 w-3.5" aria-hidden="true" /> },
    { id: 'code', label: t('github.nav.code'), icon: <Code2 className="h-3.5 w-3.5" aria-hidden="true" /> },
    { id: 'commits', label: t('github.nav.commits'), icon: <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> },
  ];
  return <div onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#3A2E27]/30 dark:bg-[#090C16]/68 p-2 backdrop-blur-xs sm:p-3">
    <section ref={focusScope} role="dialog" aria-modal="true" aria-label="GitHub" className="guild-dialog-in flex h-[94dvh] w-full min-w-0 max-w-3xl flex-col overflow-hidden overflow-x-hidden rounded-[26px] border border-[#E5D7C6] dark:border-[#313958] bg-[#FFFCF7]/96 dark:bg-[#171D31]/96 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_22px_50px_-12px_rgba(74,62,54,0.28)] backdrop-blur-md">
      <header className="shrink-0 space-y-2 border-b border-[#EADFD1]/80 dark:border-[#2C3450] bg-[#F7F1E8]/80 dark:bg-[#1C233A]/90 px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#D5CCE6]/80 dark:border-[#3E3A63] bg-[#F1EDF9] dark:bg-[#252240] text-[#6B5A8E] dark:text-[#BEB4E8]">
            <Github className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="flex-1 font-display text-[15px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">GitHub</h3>
          <button type="button" aria-label={t('github.refresh')} onClick={refreshAll} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" aria-label={t('github.close')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
          <SearchPicker value={repo ?? ''} emptyLabel="<repo>" placeholder={t('github.repo.search')} items={repoItems} onPick={pickRepo} loading={repos.loading} initiallyOpen={!repo} title={t('github.repo.select')} />
          <SearchPicker icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-[#689B73] dark:text-[#96BD9F]" aria-hidden="true" />} value={branch?.name ?? ''} emptyLabel="<branch>" placeholder={t('github.branch.search')} items={branchItems} loading={branches.loading}
            onPick={key => { setBranchName(key); if (repo) store.set(ghKeys.branch(repo), key); }} emptyText={t('github.branch.empty')} title={t('github.branch.selectsearch')} />
        </div>
        <div role="tablist" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-[#EDE3D6]/75 dark:bg-[#141A2C] p-0.5">{tabs.map(item => <button key={item.id} role="tab" type="button" aria-selected={tab === item.id} onClick={() => pickTab(item.id)}
          className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition ${tab === item.id ? 'bg-white dark:bg-[#262F4F] text-[#4A3E36] dark:text-[#ECE7DF] shadow-2xs' : 'text-[#7D6D61] dark:text-[#8E98B8] hover:text-[#4A3E36] dark:hover:text-[#ECE7DF]'}`}>{item.icon}{item.label}</button>)}</div>
      </header>
      <div ref={pullRef} data-gh-body className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 text-sm">
        <PullIndicator pull={pull} refreshing={refreshing} />
        {repos.error && <Status error={repos.error} onRetry={repos.reload} />}
        {!repo ? <p className="px-2 py-6 text-center text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.repo.required')}</p>
          : branches.error ? <Status error={branches.error} onRetry={branches.reload} />
          : tab === 'issues' ? <IssuesTab key={`${repo}`} call={call} repo={repo} refresh={refreshTick} initialIssue={target?.kind === 'issue' ? target.number : undefined} focusComment={target?.kind === 'issue' ? target.commentId : undefined} />
          : !branch ? <Status loading={branches.loading} />
          : tab === 'code' ? <CodeTab key={`${repo}:${branch.name}`} call={call} repo={repo} branch={branch} initialPath={linked?.path} initialLines={target?.kind === 'blob' ? target.lines : undefined} />
          : <CommitsTab key={`${repo}:${branch.name}`} call={call} repo={repo} branch={branch} refresh={refreshTick} branches={branches.data?.branches ?? []} initialSha={target?.kind === 'commit' ? target.sha : undefined} initialBase={target?.kind === 'compare' ? target.base : undefined} />}
      </div>
    </section>
  </div>;
}
