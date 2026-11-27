// Contents
// Set bubble defaults
// Separate message days
// Show user text and Bridge notes
// Fold long agent replies
// Render a message

import { useT } from '../i18n/useLang';
import { localizePartyLabel, localizeWorkbenchLabel } from '../i18n/characterName';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CLIModelId, TerminalLogEntry } from '../types/guild';
import { handoffTag } from '../utils/bubbleRuns';
import { noteLines, splitBridgeNote } from '../utils/bridgeNote';
import { roleAccent } from '../utils/roleAccent';
import { CopyTurnButton } from './CopyTurnButton';
import { MessageImages } from './ImagePreviews';
import { QuestCard } from './QuestCard';
import { StepsChecklistCard } from './StepsChecklistCard';
import { parseFileQuest } from '../utils/questNotice';
import { Markdown } from './Markdown';
import { SeparatorFloralBud } from './BotanicalAccents';

// Set bubble defaults
// User and agent bubbles share a shadow, and handoff notes use their own folding limit.
const soft = 'shadow-[0_1px_2px_rgba(90,70,50,0.05),0_2px_8px_rgba(90,70,50,0.03)]';
const handoffFold = 260;

// Separate message days
// The timeline uses the same date divider in group and single rooms.
/** A quiet date line between messages from different days, drawn with two soft hand-penned tapered ink strokes and tiny botanical buds. */
export function DaySeparator({ label }: { label: string }) {
  return <div role="separator" className="flex items-center gap-2 py-1.5 text-[11px] text-[#A39284] dark:text-[#8E98B8]" aria-label={label}>
    <svg viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true" className="h-2 flex-1 text-[#DECFC2] dark:text-[#333D5E]">
      <path d="M2 4.5 Q 52 2.4, 118 4.2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.85" />
    </svg>
    <SeparatorFloralBud />
    <span className="font-display tracking-wide">{label}</span>
    <SeparatorFloralBud flip />
    <svg viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true" className="h-2 flex-1 text-[#DECFC2] dark:text-[#333D5E]">
      <path d="M2 4.2 Q 68 5.8, 118 3.6" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.85" />
    </svg>
  </div>;
}

// Show user text and Bridge notes
// The Bridge roster can expand independently of the user's message.
/** The Founder's own words, with the roster Bridge added after them folded into a small note. */
function UserText({ text }: { text: string }) {
  const { t } = useT();
  const { main, note } = splitBridgeNote(text);
  return <>
    {main && <p className="whitespace-pre-wrap break-words leading-[1.65] text-[#3F342D] dark:text-[#F0EAE0]">{main}</p>}
    {note && <details className="group mt-2 rounded-lg border border-[#E2D3C1]/70 dark:border-[#493F3A] bg-white/40 dark:bg-[#1E1A18]/75 px-2 py-1 text-[11.5px] text-[#8C7A6E] dark:text-[#C5B6A6]">
      <summary className="cursor-pointer list-none font-semibold">{t('chat.bridgeNote')} <span className="font-normal opacity-70 group-open:hidden">{t('chat.expand')}</span></summary>
      <ul className="mt-1 space-y-0.5 break-words leading-relaxed">{noteLines(note).map((line, index) => <li key={index}>{line}</li>)}</ul>
    </details>}
  </>;
}

// Fold long agent replies
// Mount an interactive preview until the user opens the full reply.
/** A reply this long is shown folded, with a way to read it all and a way back to its first line. */
export const longReplyChars = 1500;
export const longReplyLines = 28;
const isLongReply = (text: string) => text.length > longReplyChars || text.split('\n').length > longReplyLines;

/**
 * The folded view shows this much as real, working content; nothing is hidden behind it, so its links and text stay usable.
 */
export const foldPreviewChars = 900;
export function foldPreview(text: string) {
  if (text.length <= foldPreviewChars) return text;
  const head = text.slice(0, foldPreviewChars);
  const paragraph = head.lastIndexOf('\n\n');
  const line = head.lastIndexOf('\n');
  const cut = paragraph >= foldPreviewChars * 0.4 ? paragraph : line >= foldPreviewChars * 0.4 ? line : foldPreviewChars;
  let preview = head.slice(0, cut).trimEnd();
  if ((preview.match(/^```/gm) ?? []).length % 2 === 1) preview += '\n```';
  return preview;
}

function FoldedReply({ text, render }: { text: string; render: (text: string) => ReactNode }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const toTop = () => box.current?.closest('article')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // Folding takes the focus back to the button that opens it again, so it never rests on something that has just gone.
  useEffect(() => { if (!open && refocus.current) { refocus.current = false; expand.current?.focus(); } }, [open]);
  const button = 'rounded-full border border-[#E2D3C1] dark:border-[#364062] bg-white/80 dark:bg-[#1E253D] px-3 py-1 text-[11px] font-semibold text-[#8C6D58] dark:text-[#C5CDE3]';
  return <div ref={box} data-long-reply={open ? 'open' : 'folded'}>
    <div data-fold-body className={open ? '' : '[mask-image:linear-gradient(to_bottom,black_80%,transparent)]'}>
      {render(open ? text : foldPreview(text))}
    </div>
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {open
        ? <><button type="button" aria-expanded="true" className={button} onClick={() => { refocus.current = true; setOpen(false); toTop(); }}>{t('chat.fold')}</button><button type="button" className={button} onClick={toTop}>{t('chat.top')}</button></>
        : <button type="button" ref={expand} aria-expanded="false" className={button} onClick={() => setOpen(true)}>{t('chat.expand.all')}</button>}
    </div>
  </div>;
}

function LongReply({ text, render }: { text: string; render: (text: string) => ReactNode }) {
  return isLongReply(text) ? <FoldedReply text={text} render={render} /> : <>{render(text)}</>;
}

// Render a message
// Single and group rooms share this bubble, with the speaker and time at the start of each message run.
export function MessageBubble({ entry, modelId, name, roomId, header = true, addressee, count, onNameClick }: {
  entry: TerminalLogEntry;
  /** The role this room belongs to (whose colour the agent's side uses). */
  modelId: CLIModelId;
  /** Who speaks on the agent's side: the character, plus the room's name in a group. */
  name: string;
  roomId?: string;
  header?: boolean;
  /** In a group, who a message from the user is for. */
  addressee?: string;
  /** A system line that came several times in a row. */
  count?: number;
  /** In a group, a tap on the speaker's name addresses the next message to them. */
  onNameClick?: () => void;
}) {
  const { t, lang } = useT();
  const accent = roleAccent[modelId];
  const time = <span className="tabular-nums">{entry.timestamp}</span>;

  if (entry.sender === 'system') {
    return <div className="mx-auto flex w-fit max-w-[92%] items-baseline gap-1.5 rounded-full bg-white/40 px-2.5 py-0.5 text-[10px] text-[#A39284] dark:bg-[#1E253D]/75 dark:text-[#98A3C2]">
      <span className="min-w-0 break-words">{name} · {localizeWorkbenchLabel(entry.text, lang)}{count ? ` ×${count}` : ''}</span><span className="shrink-0 opacity-70">{time}</span>
    </div>;
  }

  // The Bridge's file-trigger notice is for the agent; the Founder sees it as a quest card.
  const quest = entry.sender === 'user' ? parseFileQuest(entry.text) : undefined;
  if (quest) return <QuestCard quest={quest} time={entry.timestamp} />;

  // AGY `update_steps` checklist: shown as an inline stationery card updated in place per turn.
  if (entry.steps?.length) return <StepsChecklistCard steps={entry.steps} name={name} time={entry.timestamp} />;

  const handoff = entry.sender === 'user' ? entry.text.match(handoffTag) : null;
  if (handoff) {
    // Another agent speaking to this one: shown as that, in a quiet bubble, and folded when long, instead of as the user's own words.
    const body = entry.text.slice(handoff[0].length).trim();
    const folded = body.length > handoffFold;
    return <article data-sender="handoff" className="relative mr-auto max-w-[88%] rounded-xl border border-[#E6DBC8] dark:border-[#4A3F32] border-l-[3px] border-l-[#CBB9A4] dark:border-l-[#C9A26B] bg-[#FAF6EF] dark:bg-[#231F1B] px-3 py-2 text-[13px] shadow-[0_1px_2px_rgba(90,70,50,0.04)]">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-[#9A887C] dark:text-[#BCA98E]">
        <span className="min-w-0 break-all"><span className="font-semibold text-[#8C7A6E] dark:text-[#E2C9A2]">{localizeWorkbenchLabel(localizePartyLabel(handoff[1], lang), lang)} → {name}</span><span className="ml-1.5 rounded-full bg-[#EEE6DC] dark:bg-[#352D24] px-1.5 py-px text-[10px] font-semibold text-[#8C7A6E] dark:text-[#DEC49E]">{t('chat.handoff')}</span><span className="ml-1.5">{time}</span></span>
        <span className="-my-2 -mr-1.5 shrink-0 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100"><CopyTurnButton entry={entry} /></span>
      </div>
      {folded
        ? <details className="group"><summary className="cursor-pointer list-none whitespace-pre-wrap break-words leading-relaxed text-[#5C4E44] dark:text-[#E6DDD0]">{body.slice(0, 120).replace(/\s+/g, ' ')}… <span className="font-semibold text-[#8C7A6E] dark:text-[#DEC49E] group-open:hidden">{t('chat.expand')}</span></summary>
            <div className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-[#5C4E44] dark:text-[#E6DDD0]">{body}</div></details>
        : <p className="whitespace-pre-wrap break-words leading-relaxed text-[#5C4E44] dark:text-[#E6DDD0]">{body}</p>}
    </article>;
  }

  const isUser = entry.sender === 'user';
  const style: CSSProperties | undefined = isUser ? undefined : { borderLeftColor: accent.stripe, backgroundColor: accent.wash };
  return <article data-sender={entry.sender} data-role={isUser ? undefined : modelId} style={style}
    className={`relative rounded-2xl border p-3 text-sm ${soft} ${isUser
      ? 'ml-auto max-w-[85%] border-[#E2D3C1] dark:border-[#493F3A] bg-[#F7EFE4] dark:bg-[#282321] dark:text-[#ECE7DF]'
      : 'guild-agent-bubble mr-auto max-w-[88%] border-[#E8DCD2] border-l-[3px] pl-3.5'}`}>
    {!isUser && (
      <svg aria-hidden="true" viewBox="0 0 8 100" preserveAspectRatio="none"
        style={{ color: accent.stripe }}
        className="guild-agent-brush pointer-events-none absolute top-2.5 bottom-2.5 left-[2.5px] w-[5px] h-[calc(100%-20px)]">
        <path d="M3.2 1.5 C 1.4 18, 4.8 46, 2.5 76 C 1.8 87, 3.4 95, 2.8 98.5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" opacity="0.88" />
        <path d="M5.1 6 C 3.8 28, 6.2 58, 4.3 89" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.38" />
      </svg>
    )}
    {header
      ? <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-[#9A887C] dark:text-[#98A3C2]">
          <span className="min-w-0 break-all">
            {!isUser && onNameClick
              ? <button type="button" onClick={onNameClick} title={t('chat.reply', { name })} data-address-name className="font-semibold cursor-pointer hover:opacity-80" style={{ color: accent.name }}>{name}</button>
              : <span className="font-semibold" style={{ color: isUser ? undefined : accent.name }}><span className={isUser ? 'text-[#8C6D58] dark:text-[#D6BFA8]' : undefined}>{isUser ? (addressee ? `Me → ${addressee}` : 'Me') : name}</span></span>}
            <span className="ml-1.5">{time}</span>
            {entry.question && <span className={`ml-1.5 rounded-full px-1.5 py-px text-[10px] font-semibold ${entry.question === 'open' ? 'bg-[#F8E5EA] dark:bg-[#3A2433] text-[#A65772] dark:text-[#EFA4B2]' : 'bg-[#EEE6DC] dark:bg-[#27304D] text-[#8C7A6E] dark:text-[#A4AECC]'}`}>{entry.question === 'open' ? t('chat.question.pending') : t('chat.question.answered')}</span>}
          </span>
          <span className="-my-2 -mr-1.5 shrink-0 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100"><CopyTurnButton entry={entry} /></span>
        </div>
      // A run's later bubbles carry the copy button inside the bubble's top-right corner; text wraps around it and the bubble keeps the same width as the first one.
      : <span data-copy-inside className="float-right -mr-1.5 -mt-1.5 ml-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-40"><CopyTurnButton entry={entry} /></span>}
    <div>
      {entry.sender === 'agent'
        ? <LongReply text={entry.text} render={shown => <Markdown text={shown} className="leading-[1.65] text-[#3F342D] dark:text-[#EAE5DC]" />} />
        : <UserText text={entry.text} />}
      {entry.codeBlock && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-[#4F433C] bg-[#382F2A] p-2.5 font-mono text-[11px] text-[#F9EFE4]">{entry.codeBlock}</pre>}
      <MessageImages roomId={roomId} text={entry.text} codeBlock={entry.codeBlock} images={entry.images} />
    </div>
  </article>;
}
