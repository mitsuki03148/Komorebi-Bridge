import { useT } from '../../i18n/useLang';
import { t as translateCurrent } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, Copy, ExternalLink, File as FileIcon, Folder, Lock, MessageSquare, Send } from 'lucide-react';
import { Markdown } from '../Markdown';
import { copyText } from '../../utils/roomUi';
import { blobLink, commitLink, compareLink, issueLink, lineSelection, parsePatch, type LineRange } from '../../utils/githubLinks';

export interface GhIssue { number: number; title: string; state: string; author: string; labels: { name: string; color: string }[]; comments: number; createdAt: string; updatedAt: string; body: string }
export interface GhComment { id: number; author: string; body: string; createdAt: string }
export interface GhFile { filename: string; status: string; additions: number; deletions: number; previous?: string; patch?: string }
export interface GhCommitBrief { sha: string; message: string; author: string; date: string }
export interface GhCommit extends GhCommitBrief { stats: { additions: number; deletions: number; total: number }; files: GhFile[]; parents: string[] }
export interface GhEntry { name: string; path: string; type: string; size: number }
export interface GhFileContent { kind: 'file'; name: string; path: string; size: number; sha: string; text?: string; binary: boolean; tooLarge: boolean }

export const ago = (iso: string, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return translateCurrent('github.relative.minutes', { count: minutes });
  if (minutes < 1440) return translateCurrent('github.relative.hours', { count: Math.round(minutes / 60) });
  if (minutes < 43_200) return translateCurrent('github.relative.days', { count: Math.round(minutes / 1440) });
  return iso.slice(0, 10);
};

const buttonClass = 'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] px-3 text-[11px] font-semibold text-[#6E5D52] dark:text-[#C5CDE3] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95 disabled:opacity-50';

/** Copies a link and says so for a moment; the link is also the button's tooltip. */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button type="button" data-copy-link={url} title={url} className={buttonClass}
    onClick={() => void copyText(url).then(ok => { setDone(ok); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1_800); })}>
    {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}{done ? t('github.copy.done') : (label ?? t('github.copy.link'))}
  </button>;
}

export const OpenOnGitHub = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />GitHub</a>
);

export function Back({ onBack, children }: { onBack: () => void; children?: ReactNode }) {
  const { t } = useT();
  return <button type="button" onClick={onBack} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#DEC9B8] bg-white/95 px-3 py-1 text-xs font-bold text-[#4A3E36] shadow-2xs transition hover:border-[#D48BA5] hover:bg-[#FFF5F8] active:scale-95 dark:border-[#4A5682] dark:bg-[#252E4C] dark:text-[#F0F3FC] dark:hover:border-[#EFA4B2]/70 dark:hover:bg-[#2F3A5E] cursor-pointer"><ChevronLeft className="h-4 w-4 text-[#C4668A] dark:text-[#EFA4B2]" strokeWidth={2.4} aria-hidden="true" />{children ?? t('github.back')}</button>;
}

function Labels({ labels }: { labels: { name: string; color: string }[] }) {
  return <>{labels.map(label => <span key={label.name} className="rounded-full border px-1.5 py-px text-[10px] font-semibold text-[#5C4D43] dark:text-[#ECE7DF]" style={{ borderColor: `#${label.color}`, backgroundColor: `#${label.color}22` }}>{label.name}</span>)}</>;
}

const stateBadge = (state: string, t: ReturnType<typeof useT>['t']) => <span data-issue-state={state} className={`rounded-full px-2 py-px text-[10px] font-bold ${state === 'open' ? 'bg-[#E3F2E5] dark:bg-[#20332C] text-[#3E7A4A] dark:text-[#96C7A3]' : 'bg-[#EEE6F4] dark:bg-[#2C2440] text-[#6B4E8A] dark:text-[#C5B0E6]'}`}>{state === 'open' ? t('github.issues.open') : t('github.issues.closed')}</span>;

export function IssueRows({ issues, onOpen, now }: { issues: GhIssue[]; onOpen: (number: number) => void; now?: number }) {
  const { t } = useT();
  if (!issues.length) return <p className="px-2 py-8 text-center text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.issues.empty')}</p>;
  return <ul className="space-y-1.5">{issues.map(issue => (
    <li key={issue.number}><button type="button" data-issue-row={issue.number} onClick={() => onOpen(issue.number)} className="block w-full rounded-2xl border border-[#EDE3D5]/90 dark:border-[#2E3654] bg-white/75 dark:bg-[#1E253D]/90 px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(90,70,50,0.03)] transition hover:bg-white dark:hover:bg-[#242C48]">
      <div className="flex items-start gap-2">{stateBadge(issue.state, t)}<span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] break-words">{issue.title}</span></div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">
        <span>#{issue.number}</span><span>{issue.author}</span><span>{ago(issue.updatedAt, now)}</span>
        {issue.comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" aria-hidden="true" />{issue.comments}</span>}
        <Labels labels={issue.labels} />
      </div>
    </button></li>
  ))}</ul>;
}

export function IssueDetail({ owner, repo, issue, comments, draft, onDraft, onSend, sending, error, onBack, now }: {
  owner: string; repo: string; issue: GhIssue; comments: GhComment[]; draft: string; onDraft: (text: string) => void; onSend: () => void;
  sending?: boolean; error?: string; onBack: () => void; now?: number;
}) {
  const { t } = useT();
  const url = issueLink(owner, repo, issue.number);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Back onBack={onBack}>{t('github.nav.issues')}</Back><CopyLink url={url} /><OpenOnGitHub url={url} /></div>
    <div>
      <h4 className="text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] break-words">{issue.title} <span className="font-normal text-[#8C7A6E] dark:text-[#98A3C2]">#{issue.number}</span></h4>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]">{stateBadge(issue.state, t)}<span>{issue.author}</span><span>{ago(issue.createdAt, now)}</span><Labels labels={issue.labels} /></div>
    </div>
    <div className="rounded-2xl border border-[#E8DDD0] dark:border-[#2E3654] bg-white/85 dark:bg-[#1E253D] px-4 py-4 shadow-2xs select-text sm:px-5"><Markdown variant="doc" text={issue.body.trim() ? issue.body : t('github.issues.nobody')} /></div>
    {comments.map(comment => (
      <article key={comment.id} data-comment={comment.id} className="rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-[#FFFCF7] dark:bg-[#192036] p-3 text-sm select-text">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]"><span className="font-semibold text-[#6E5D52] dark:text-[#C5CDE3]">{comment.author}</span><span>{ago(comment.createdAt, now)}</span><span className="ml-auto"><CopyLink url={issueLink(owner, repo, issue.number, comment.id)} label={t('github.copy.shortlink')} /></span></div>
        <Markdown text={comment.body} />
      </article>
    ))}
    <form data-reply onSubmit={event => { event.preventDefault(); onSend(); }} className="space-y-2 rounded-2xl border border-[#E2D6C5] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3">
      <label className="block text-[11px] font-semibold text-[#7D6D61] dark:text-[#A4AECC]" htmlFor="gh-reply">{t('github.issues.comment.label')}</label>
      <textarea id="gh-reply" value={draft} onChange={event => onDraft(event.target.value)} rows={4} placeholder={t('github.issues.comment.placeholder')} className="w-full resize-y rounded-xl border border-[#E6DCD0] dark:border-[#343D5E] bg-[#FBF8F3] dark:bg-[#141A2C] p-2 text-base text-[#4A3E36] dark:text-[#ECE7DF] sm:text-sm" />
      {error && <p role="alert" className="text-xs text-[#A94D5A]">{error}</p>}
      <button type="submit" disabled={sending || !draft.trim()} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#7A9580] px-4 text-xs font-bold text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" aria-hidden="true" />{sending ? t('github.issues.comment.sending') : t('github.issues.comment.send')}</button>
    </form>
  </div>;
}

const statusMark: Record<string, string> = { added: '＋', removed: '－', modified: '～', renamed: '→', copied: '⧉' };

export function DiffView({ files }: { files: GhFile[] }) {
  const { t } = useT();
  if (!files.length) return <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.diff.nofiles')}</p>;
  return <div className="space-y-2">{files.map(file => {
    const rows = parsePatch(file.patch);
    return <details key={file.filename} open={files.length <= 4} data-diff-file={file.filename} className="overflow-hidden rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#161B2E]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 bg-[#F7F2E9] dark:bg-[#1E253D] px-2.5 py-1.5 text-xs">
        <span aria-hidden="true">{statusMark[file.status] ?? '·'}</span>
        <span className="min-w-0 flex-1 break-all font-mono font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{file.previous ? `${file.previous} → ` : ''}{file.filename}</span>
        <span className="font-mono text-[#3E7A4A] dark:text-[#86C994]">+{file.additions}</span><span className="font-mono text-[#A94D5A] dark:text-[#F09AA6]">−{file.deletions}</span>
      </summary>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full border-collapse font-mono text-[11px] leading-snug select-text"><tbody>{rows.map((row, index) => (
        <tr key={index} data-diff={row.kind} className={row.kind === 'add' ? 'bg-[#E6F4E8] dark:bg-[#193024]' : row.kind === 'del' ? 'bg-[#FBE8EA] dark:bg-[#361D26]' : row.kind === 'hunk' ? 'bg-[#EEF0FA] dark:bg-[#222845] text-[#6A6F96] dark:text-[#A6ACE0]' : ''}>
          <td className="w-9 select-none pr-1 text-right text-[#B3A396] dark:text-[#6E7899]">{row.oldLine ?? ''}</td>
          <td className="w-9 select-none pr-1 text-right text-[#B3A396] dark:text-[#6E7899]">{row.newLine ?? ''}</td>
          <td className="whitespace-pre pl-1 pr-3">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}{row.text}</td>
        </tr>))}</tbody></table></div>
        : <p className="px-3 py-2 text-xs text-[#8C7A6E] dark:text-[#98A3C2]">{file.additions + file.deletions === 0 ? t('github.diff.nochanges') : t('github.diff.toolarge')}</p>}
    </details>;
  })}</div>;
}

export function CommitRows({ commits, onOpen, now }: { commits: GhCommitBrief[]; onOpen: (sha: string) => void; now?: number }) {
  const { t } = useT();
  if (!commits.length) return <p className="px-2 py-8 text-center text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.commits.empty')}</p>;
  return <ul className="space-y-1.5">{commits.map(commit => (
    <li key={commit.sha}><button type="button" data-commit-row={commit.sha.slice(0, 7)} onClick={() => onOpen(commit.sha)} className="block w-full rounded-2xl border border-[#EDE3D5]/90 dark:border-[#2E3654] bg-white/75 dark:bg-[#1E253D]/90 px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(90,70,50,0.03)] transition hover:bg-white dark:hover:bg-[#242C48]">
      <div className="text-[13.5px] font-semibold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] break-words">{commit.message.split('\n')[0]}</div>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]"><span className="rounded bg-[#F3ECE1] dark:bg-[#262E4B] px-1.5 py-px font-mono text-[#7A3452] dark:text-[#F4B4C2]">{commit.sha.slice(0, 7)}</span><span>{commit.author}</span><span>{ago(commit.date, now)}</span></div>
    </button></li>
  ))}</ul>;
}

export function CommitDetail({ owner, repo, commit, onBack }: { owner: string; repo: string; commit: GhCommit; onBack: () => void }) {
  const { t } = useT();
  const url = commitLink(owner, repo, commit.sha);
  const [title, ...rest] = commit.message.split('\n');
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Back onBack={onBack}>{t('github.nav.commits')}</Back><CopyLink url={url} /><OpenOnGitHub url={url} /></div>
    <div><h4 className="text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] break-words">{title}</h4>
      {rest.join('\n').trim() && <div className="mt-1 text-sm select-text"><Markdown text={rest.join('\n').trim()} /></div>}
      <p className="mt-1 text-[11px] text-[#8C7A6E] dark:text-[#98A3C2]"><span className="font-mono">{commit.sha.slice(0, 7)}</span> · {commit.author} · {ago(commit.date)} · <span className="text-[#3E7A4A] dark:text-[#86C994]">+{commit.stats.additions}</span> <span className="text-[#A94D5A] dark:text-[#F09AA6]">−{commit.stats.deletions}</span> · {t('github.commit.files', { count: commit.files.length })}</p></div>
    <DiffView files={commit.files} />
  </div>;
}

export function CompareDetail({ owner, repo, base, head, aheadBy, behindBy, files, commits, onOpenCommit }: {
  owner: string; repo: string; base: string; head: string; aheadBy: number; behindBy: number; files: GhFile[]; commits: GhCommitBrief[]; onOpenCommit: (sha: string) => void;
}) {
  const { t } = useT();
  const url = compareLink(owner, repo, base, head);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-[#6E5D52] dark:text-[#C5CDE3]">{base} ← {head}</span><CopyLink url={url} /><OpenOnGitHub url={url} /></div>
    <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('github.compare.summary', { ahead: aheadBy, behind: behindBy, count: files.length })}</p>
    <CommitRows commits={commits} onOpen={onOpenCommit} />
    <DiffView files={files} />
  </div>;
}

export function DirRows({ entries, onOpen }: { entries: GhEntry[]; onOpen: (entry: GhEntry) => void }) {
  const { t } = useT();
  if (!entries.length) return <p className="px-2 py-8 text-center text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.directory.empty')}</p>;
  return <ul className="space-y-1.5">{entries.map(entry => {
    const isMd = /\.(?:md|markdown)$/i.test(entry.name);
    const icon = entry.type === 'dir'
      ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#EBF4EC] dark:bg-[#20332C] text-[#5A8D66] dark:text-[#96C7A3]"><Folder className="h-3.5 w-3.5" aria-hidden="true" /></span>
      : isMd
        ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#FCEEF2] dark:bg-[#312338] text-[#C4668A] dark:text-[#EFA4B2]"><FileIcon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#F4EDE4] dark:bg-[#252D48] text-[#8C7A6E] dark:text-[#A4AECC]"><FileIcon className="h-3.5 w-3.5" aria-hidden="true" /></span>;
    return <li key={entry.path}><button type="button" data-entry={entry.type} onClick={() => onOpen(entry)} className="flex w-full items-center gap-2.5 rounded-2xl border border-[#EDE3D5]/90 dark:border-[#2E3654] bg-white/75 dark:bg-[#1E253D]/90 px-2.5 py-2 text-left text-sm shadow-[0_1px_2px_rgba(90,70,50,0.03)] transition hover:bg-white dark:hover:bg-[#242C48]">
      {icon}
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[#4A3E36] dark:text-[#ECE7DF]">{entry.name}</span>
      {entry.type === 'file' && <span className="shrink-0 text-[10px] text-[#B3A396] dark:text-[#7E89A8]">{entry.size > 1024 ? `${Math.round(entry.size / 1024)} KB` : `${entry.size} B`}</span>}
    </button></li>;
  })}</ul>;
}

/** A file at one commit: Markdown as a page, anything else as numbered lines you can tap to pick a range for a permalink. */
export function FileDetail({ owner, repo, sha, file, lines, onLines }: {
  owner: string; repo: string; sha: string; file: GhFileContent; lines?: LineRange; onLines: (range: LineRange | undefined) => void;
}) {
  const { t } = useT();
  const [raw, setRaw] = useState(false);
  const isMarkdown = /\.(?:md|markdown)$/i.test(file.path) && !raw;
  const url = blobLink(owner, repo, sha, file.path, lines);
  const text = file.text ?? '';
  const rows = text.split('\n');
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{file.path}</span>
      {/\.(?:md|markdown)$/i.test(file.path) && <button type="button" onClick={() => setRaw(!raw)} className={buttonClass}>{raw ? t('github.file.formatted') : t('github.file.raw')}</button>}
      <CopyLink url={url} label={lines ? t('github.file.copyline') : t('github.file.copypermalink')} /><OpenOnGitHub url={url} />
    </div>
    {file.binary ? <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.file.binary')}</p>
      : file.tooLarge || file.text === undefined ? <p className="text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('github.file.large', { size: Math.round(file.size / 1024) })}</p>
      : isMarkdown ? <div className="rounded-2xl border border-[#E8DDD0] dark:border-[#2E3654] bg-white/85 dark:bg-[#1E253D] px-4 py-4 shadow-2xs select-text sm:px-6 sm:py-5"><Markdown variant="doc" text={text} /></div>
      : <div className="overflow-x-auto rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#141A2C]"><table className="w-full border-collapse font-mono text-[11px] leading-snug"><tbody>{rows.map((row, index) => {
          const number = index + 1, picked = lines && number >= lines.start && number <= lines.end;
          return <tr key={number} data-line={number} data-selected={picked ? 'true' : undefined} className={picked ? 'bg-[#FFF3C4] dark:bg-[#3A3220]' : ''}>
            <td className="w-10 select-none pr-2 text-right text-[#B3A396] dark:text-[#6E7899]"><button type="button" aria-label={t('github.file.selectline', { number })} className="w-full text-right" onClick={() => onLines(lineSelection(lines, number, true) as LineRange | undefined)}>{number}</button></td>
            <td className="whitespace-pre pr-3 select-text">{row}</td></tr>;
        })}</tbody></table></div>}
  </div>;
}

export const PrivateMark = () => {
  const { t } = useT();
  return <Lock className="h-3 w-3 shrink-0 text-[#B3A396]" aria-label={t('github.repo.private')} />;
};
