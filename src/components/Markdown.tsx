import { useT } from '../i18n/useLang';
import { t as translateNow } from '../i18n';
import { memo, useContext, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, FileText } from 'lucide-react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText } from '../utils/roomUi';
import { FileOpenContext } from '../utils/fileOpen';
import { GitHubOpenContext } from '../utils/githubOpen';
import { parseGitHubUrl } from '../utils/githubUrl';
import { fileLocation, linkFilePaths } from '../utils/filePaths';
import { googleLabel, rewriteCitations } from '../utils/googleLinks';

export type MarkdownVariant = 'chat' | 'doc';

const safeHref = (href: string | undefined) => (href && /^(?:https?:\/\/|mailto:)/i.test(href) ? href : undefined);

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: HastNode[] };

/** The plain text inside a parsed Markdown node, e.g. the code in a fenced block. */
export function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(hastText).join('');
}

function languageOf(node: HastNode | undefined) {
  const classes = node?.children?.find(child => child.tagName === 'code')?.properties?.className;
  const match = Array.isArray(classes) ? classes.map(String).find(name => name.startsWith('language-')) : undefined;
  return match?.slice('language-'.length);
}

/** A dark code block with its language and a copy button above the code, so the button stays put while the code scrolls. */
function CodeBlock({ code, language, children, doc }: { code: string; language?: string; children: ReactNode; doc?: boolean }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => void copyText(code).then(ok => {
    setCopied(ok);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1_800);
  });
  return (
    <div className={`${doc ? 'my-3' : 'my-2'} overflow-hidden rounded-xl border border-[#4F433C] bg-[#382F2A]`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#4F433C] pl-3 pr-1 text-[10px] text-[#BFAE9F]">
        <span className="truncate font-mono">{language ?? t('markdown.code')}</span>
        <button type="button" onClick={copy} aria-label={copied ? t('markdown.copied') : t('markdown.copy.code')}
          className="flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold text-[#F2E4D6] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#E3A7BA]">
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? t('markdown.copied') : t('markdown.copy')}
        </button>
      </div>
      <pre className={`overflow-x-auto whitespace-pre p-3 font-mono ${doc ? 'text-[12px] leading-[1.65]' : 'p-2.5 text-[11px] leading-relaxed'} text-[#F9EFE4] select-text [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit`}>{children}</pre>
    </div>
  );
}

const fileButtonClass = 'inline-flex max-w-full items-center gap-1 rounded border border-[#E8DDD0]/70 dark:border-[#364062] bg-[#F3ECE1] dark:bg-[#252D48] px-1.5 py-0.5 align-baseline font-mono text-[0.9em] text-[#7A3452] dark:text-[#F4B4C2] underline decoration-dotted underline-offset-2 hover:bg-[#EBDDD0] dark:hover:bg-[#2E3858]';

/** A link to a file in the reader. The label is the link text when there is one, else the file name. */
function FileButton({ path, shown, children }: { path: string; shown: string; children?: ReactNode }) {
  const open = useContext(FileOpenContext);
  return (
    <button type="button" data-open-file={path} title={shown} onClick={() => open?.(path)} className={fileButtonClass}>
      <FileText className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{children ?? shown.split('/').pop()}</span>
    </button>
  );
}

const decoded = (value: string | undefined) => {
  if (!value) return '';
  try { return decodeURIComponent(value); } catch { return value; }
};

/** A link. A GitHub link the panel can show opens in the panel (the address stays, so a long press still copies it); the others open in the browser. */
function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
  const open = useContext(GitHubOpenContext);
  const openFile = useContext(FileOpenContext);
  // A Mac file path written as a Markdown link, e.g. [Handoff](</Volumes/…/HANDOFF.md:716>), opens in the reader like a path in code.
  const place = openFile ? fileLocation(decoded(href), openFile.videoSupported) : undefined;
  if (place) return <FileButton path={place.path} shown={decoded(href)}>{children}</FileButton>;
  const url = safeHref(href);
  // Anything that is not a web or mail link (file paths, javascript:) stays plain text.
  if (!url) return <span>{children}</span>;
  const target = open ? parseGitHubUrl(url) : undefined;
  // A bare Google address shows as a short chip; the address stays in the link and in the tooltip.
  const plain = typeof children === 'string' ? children : Array.isArray(children) && children.every(child => typeof child === 'string') ? children.join('') : undefined;
  const google = plain === url ? googleLabel(url) : undefined;
  if (google) return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url} data-google-link
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#F3ECE1] dark:bg-[#27304D] px-2 py-0.5 align-baseline text-[0.92em] text-[#A65772] dark:text-[#EFA4B2] hover:bg-[#EBDDD0] dark:hover:bg-[#323C5E]">
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{google}</span>
    </a>
  );
  const className = 'text-[#A65772] dark:text-[#EFA4B2] underline decoration-[#E3C4CC] dark:decoration-[#7A5468] underline-offset-2 break-all';
  if (open && target) return <a href={url} data-github-target={target.kind} rel="noopener noreferrer" className={className} onClick={event => { event.preventDefault(); open(target); }}>{children}</a>;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

/** Inline code. Supported Mac file paths become buttons when the app provides a reader. */
function InlineCode({ children, className }: { children?: ReactNode; className?: string }) {
  const open = useContext(FileOpenContext);
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every(child => typeof child === 'string') ? children.join('') : undefined;
  const place = open && !className && text !== undefined ? fileLocation(text, open.videoSupported) : undefined;
  if (place && text !== undefined) {
    return (
      <button type="button" data-open-file={place.path} title={text} onClick={() => open?.(place.path)}
        className="inline-flex max-w-full items-center gap-1 rounded border border-[#E8DDD0]/70 dark:border-[#364062] bg-[#F3ECE1] dark:bg-[#252D48] px-1.5 py-0.5 align-baseline font-mono text-[0.9em] text-[#7A3452] dark:text-[#F4B4C2] underline decoration-dotted underline-offset-2 hover:bg-[#EBDDD0] dark:hover:bg-[#303A5C]">
        <FileText className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{text.split('/').pop()}</span>
      </button>
    );
  }
  return <code className={`rounded border border-[#E8DDD0]/70 dark:border-[#364062] bg-[#F3ECE1] dark:bg-[#252D48] px-1 py-0.5 font-mono text-[0.9em] text-[#7A3452] dark:text-[#F4B4C2] ${className ?? ''}`}>{children}</code>;
}

function makeComponents(variant: MarkdownVariant): Components {
  const doc = variant === 'doc';
  return {
    p: ({ children }) => <p className={`${doc ? 'my-2.5' : 'my-1.5'} whitespace-pre-wrap break-words first:mt-0 last:mb-0`}>{children}</p>,
    h1: ({ children }) => doc
      ? <h3 className="guild-sketch-h1 mt-6 mb-3 pb-2 font-display text-[19px] font-bold tracking-tight text-[#3A2E27] dark:text-[#F4EFE7] first:mt-0">{children}</h3>
      : <h3 className="mt-3 mb-1 text-base font-bold first:mt-0">{children}</h3>,
    h2: ({ children }) => doc
      ? <h4 className="mt-5 mb-2 flex items-center gap-2 font-display text-[16.5px] font-bold text-[#4A3E36] dark:text-[#ECE7DF] first:mt-0">
          <svg viewBox="0 0 8 22" aria-hidden="true" className="h-[18px] w-2 shrink-0 text-[#D995A5] dark:text-[#EFA4B2]">
            <path d="M4.6 1.5 C 2.1 5.5, 1.8 14.5, 4.1 20.2 C 5.3 15.8, 5.8 7.2, 4.6 1.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{children}</span>
        </h4>
      : <h4 className="mt-3 mb-1 text-[15px] font-bold first:mt-0">{children}</h4>,
    h3: ({ children }) => doc
      ? <h5 className="mt-4 mb-1.5 font-display text-[15px] font-semibold text-[#5C4B41] dark:text-[#D5DCEE] first:mt-0">{children}</h5>
      : <h5 className="mt-2.5 mb-1 text-sm font-bold first:mt-0">{children}</h5>,
    h4: ({ children }) => <h6 className={`${doc ? 'mt-3.5 mb-1 text-[14.5px]' : 'mt-2 mb-0.5 text-sm'} font-semibold first:mt-0`}>{children}</h6>,
    h5: ({ children }) => <h6 className={`${doc ? 'mt-3.5 mb-1 text-[14.5px]' : 'mt-2 mb-0.5 text-sm'} font-semibold first:mt-0`}>{children}</h6>,
    h6: ({ children }) => <h6 className={`${doc ? 'mt-3.5 mb-1 text-[14.5px]' : 'mt-2 mb-0.5 text-sm'} font-semibold first:mt-0`}>{children}</h6>,
    strong: ({ children }) => <strong className="font-bold text-[#3A2E27] dark:text-[#FAF6EE]">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="opacity-70">{children}</del>,
    ul: ({ children }) => <ul className={`${doc ? 'my-2.5 space-y-1.5' : 'my-1.5 space-y-0.5'} ml-5 list-disc`}>{children}</ul>,
    ol: ({ children }) => <ol className={`${doc ? 'my-2.5 space-y-1.5' : 'my-1.5 space-y-0.5'} ml-5 list-decimal`}>{children}</ol>,
    // No pre-wrap here: the newlines Markdown leaves between nested lists would show as blank lines.
    li: ({ children, className }) => <li className={`break-words pl-0.5 marker:text-[#B89A8A] dark:marker:text-[#8E98B8] [&>ol]:my-1 [&>ul]:my-1 ${className?.includes('task-list-item') ? 'list-none -ml-5' : ''}`}>{children}</li>,
    input: props => <input {...props} disabled className="mr-1.5 translate-y-px accent-[#D9828B]" />,
    blockquote: ({ children }) => doc
      ? <blockquote className="my-3 rounded-r-xl border-l-[3px] border-[#DFB5C0] dark:border-[#7A5468] bg-[#FAF3F0]/80 dark:bg-[#232A44]/75 py-2 pl-3.5 pr-3 text-[#63534A] dark:text-[#C5CDE3]">{children}</blockquote>
      : <blockquote className="my-2 border-l-[3px] border-[#E3C4CC] dark:border-[#7A5468] pl-3 text-[#6E5D52] dark:text-[#B5BED6]">{children}</blockquote>,
    hr: () => <hr className={`guild-sketch-hr ${doc ? 'my-5' : 'my-3'} border-0 h-2`} />,
    a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
    // Remote images would make the browser fetch from the web; images the agent saved are shown by their path instead.
    img: ({ alt }) => <span className="text-[#8C7A6E] dark:text-[#98A3C2]">{alt ? translateNow('markdown.image.alt', { alt }) : translateNow('markdown.image')}</span>,
    code: ({ children, className }) => <InlineCode className={className}>{children}</InlineCode>,
    pre: ({ node, children }: ComponentPropsWithoutRef<'pre'> & ExtraProps) => (
      <CodeBlock doc={doc} code={hastText(node as HastNode | undefined).replace(/\n$/, '')} language={languageOf(node as HastNode | undefined)}>{children}</CodeBlock>
    ),
    table: ({ children }) => doc
      ? <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white/80 dark:bg-[#192038]/80"><table className="min-w-full border-collapse text-[12.5px] [&_tbody_tr:nth-child(even)]:bg-[#FCF9F4] dark:[&_tbody_tr:nth-child(even)]:bg-[#1E2642]">{children}</table></div>
      : <div className="my-2 max-w-full overflow-x-auto"><table className="min-w-full border-collapse text-[12px]">{children}</table></div>,
    th: ({ children }) => doc
      ? <th className="border-b border-r border-[#E6DCD0] dark:border-[#2E3654] last:border-r-0 bg-[#F4EDE3] dark:bg-[#222A46] px-3 py-1.5 text-left font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{children}</th>
      : <th className="border border-[#E6DCD0] dark:border-[#2E3654] bg-[#F7F2E9] dark:bg-[#222A46] px-2 py-1 text-left font-bold">{children}</th>,
    td: ({ children }) => doc
      ? <td className="border-t border-r border-[#EFE6DA] dark:border-[#28314D] last:border-r-0 px-3 py-1.5 align-top">{children}</td>
      : <td className="border border-[#E6DCD0] dark:border-[#28314D] px-2 py-1 align-top">{children}</td>,
  };
}

const chatComponents = makeComponents('chat');
const docComponents = makeComponents('doc');

/**
 * Renders an agent message as Markdown. Raw HTML is shown as text, not run, and links are limited to
 * web and mail addresses. A message with no Markdown symbols reads the same as plain text.
 * Use variant="doc" in document readers for wider line spacing, softer headings, and a comfortable 65ch measure.
 */
export const Markdown = memo(function Markdown({ text, className = '', variant = 'chat' }: { text: string; className?: string; variant?: MarkdownVariant }): ReactNode {
  useT();
  const open = useContext(FileOpenContext);
  const canOpen = Boolean(open);
  const canPlayVideo = open?.videoSupported === true;
  const source = useMemo(() => { const cited = rewriteCitations(text); return canOpen ? linkFilePaths(cited, canPlayVideo) : cited; }, [canOpen, canPlayVideo, text]);
  const docClass = variant === 'doc' ? 'mx-auto max-w-[65ch] text-[15px] leading-[1.78] text-[#3E332C] dark:text-[#EAE4DA]' : '';
  return (
    <div className={`markdown-body ${docClass} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={variant === 'doc' ? docComponents : chatComponents}>{source}</ReactMarkdown>
    </div>
  );
});
