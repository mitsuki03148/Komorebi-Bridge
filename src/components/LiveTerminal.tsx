import { useT } from '../i18n/useLang';
import { controlButtonClass } from './ControlBar';
import { leastScroll, menuHint, placement, scrollAfterUpdate, selectionLabel, wasAtEnd, type Placement } from '../utils/terminalScroll';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, TerminalSquare } from 'lucide-react';
import type { TerminalRoom, TerminalStyleRun } from '../types/guild';

export function TerminalScreenText({ text, styles = [] }: { text: string; styles?: TerminalStyleRun[] }) {
  const fragments = [];
  let cursor = 0;
  for (const run of styles) {
    fragments.push(text.slice(cursor, run.start));
    fragments.push(<span key={run.start} data-terminal-highlight={run.background ? '' : undefined} style={{
      color: run.foreground, backgroundColor: run.background, fontWeight: run.bold ? 700 : undefined,
      textDecoration: run.underline ? 'underline' : undefined,
    }}>{text.slice(run.start, run.end)}</span>);
    cursor = run.end;
  }
  fragments.push(text.slice(cursor));
  return fragments;
}

function terminalStyles(room: TerminalRoom): TerminalStyleRun[] {
  const styles = room.screenStyles ?? [];
  if (room.modelId !== 'CLAUDE' || !room.menu || !room.screen) return styles;
  const selected = [...room.screen.matchAll(/^[ \t]*(?:\(selected\)[ \t]*\S|[›❯][ \t]+\S)[^\n]*/gm)];
  const additions = selected.flatMap(match => {
    const start = match.index;
    const end = start + match[0].length;
    if (styles.some(style => style.start < end && style.end > start && style.background)) return [];
    if (styles.some(style => style.start < end && style.end > start)) return [];
    return [{ start, end, foreground: 'var(--terminal-bg)', background: 'var(--terminal-accent)', bold: true }];
  });
  return [...styles, ...additions].sort((a, b) => a.start - b.start);
}

export function LiveTerminalControls({ room, onStart, onClose, onRemote, compact = false }: {
  room: TerminalRoom;
  onStart: () => void;
  onClose: () => void;
  onRemote: () => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [room.id, room.live]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const remote = room.remoteStatus === 'on' ? 'ON' : room.remoteStatus === 'connecting' ? t('terminal.remote.connecting') : room.remoteStatus === 'unknown' ? t('terminal.remote.unknown') : 'OFF';
  // In a popover the actions are outlined buttons; inline beside the other controls they are quiet like them.
  const pill = compact ? 'rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-3 py-1.5 text-[#4A3E36] dark:text-[#ECE7DF]' : 'rounded-full px-2.5 py-1.5 hover:bg-white/80 dark:hover:bg-[#232B45]';
  const actions = (
    <>
      {room.modelId !== 'CODEX' && (
        <button type="button" onClick={() => { setOpen(false); onRemote(); }} disabled={!room.ready}
          className={`${pill} disabled:opacity-50`}>
          Remote Control · {remote}
        </button>
      )}
      <button type="button" aria-label={t('terminal.close.cli')} onClick={() => { setOpen(false); onClose(); }} className={`${pill}`}>{t('terminal.close')}</button>
      {room.remoteControl.sessionUrl && <a href={room.remoteControl.sessionUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={`${pill} underline`}>{t('terminal.remote.open')}</a>}
    </>
  );
  // On the phone Remote Control is just typing /rc, so unless there is a remote link to open, a menu holding one button is a detour: end it directly.
  if (compact && room.live && !room.remoteControl.sessionUrl) return (
    <button type="button" aria-label={t('terminal.close.cli')} onClick={onClose} className={controlButtonClass}>{t('terminal.close')}</button>
  );
  if (compact && room.live) return (
    <div ref={root} className="relative shrink-0 text-[10px] font-semibold">
      <button type="button" aria-label={t('terminal.control')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}
        className={controlButtonClass}>CLI</button>
      {open && <div role="dialog" aria-label={t('terminal.control')} className="absolute bottom-full right-0 z-50 mb-2 flex min-w-max flex-col gap-1 rounded-2xl border border-[#DFD3C3] dark:border-[#343D5E] bg-[#FFFDF9] dark:bg-[#171D31] p-2 shadow-xl">{actions}</div>}
    </div>
  );
  if (compact) return room.repoPath && (!room.sessionId || room.resumable) ? (
    <button type="button" onClick={onStart} className="min-h-8 shrink-0 rounded-full bg-[#4A3E36] px-2 text-[10px] font-semibold text-white">{room.sessionId ? t('terminal.resume') : t('terminal.start')}</button>
  ) : <span className="text-[10px] leading-tight">{t('terminal.legacy.short')}</span>;
  return (
    <div aria-label={t('terminal.control')} className="flex items-center gap-2 overflow-x-auto whitespace-nowrap py-1 text-[11px] font-semibold">
      {room.live ? actions : room.repoPath && (!room.sessionId || room.resumable) ? (
        <button type="button" onClick={onStart} className="rounded-full bg-[#4A3E36] px-3 py-1.5 text-white">
          {room.sessionId ? t('terminal.resume') : t('terminal.start.cli')}
        </button>
      ) : <span>{t('terminal.legacy.long')}</span>}
    </div>
  );
}

export function LiveTerminal({ room, onMenu, onManualKey, forceOpen = false, compact = false }: {
  room: TerminalRoom;
  onMenu: (key: string) => void;
  onManualKey?: (key: string) => void;
  forceOpen?: boolean;
  compact?: boolean;
}) {
  const { t } = useT();
  const screenRef = useRef<HTMLPreElement>(null);
  const previouslyExpanded = useRef(false);
  const lastMenuId = useRef<string | undefined>(undefined);
  const atEnd = useRef(true);
  const [offscreen, setOffscreen] = useState<Placement>('visible');
  const [selected, setSelected] = useState('');
  const panelId = useId();
  const [dismissed, setDismissed] = useState(false);
  // A question the room asks has its own card. The card answers it, so the terminal's menu stays closed unless it is opened by hand.
  const attention = room.menu && !room.pendingQuestion ? 'menu' : 'none';
  const expanded = forceOpen || (attention === 'menu' && !dismissed);
  const hasScreen = Boolean(room.screen);
  useEffect(() => {
    setDismissed(false);
  }, [room.id, attention]);
  const highlightBox = () => {
    const active = screenRef.current?.querySelector<HTMLElement>('[data-terminal-highlight]');
    return active ? { top: active.offsetTop, bottom: active.offsetTop + active.offsetHeight } : undefined;
  };
  const measure = () => {
    const element = screenRef.current;
    const box = room.menu ? highlightBox() : undefined;
    setOffscreen(element && box ? placement(box.top, box.bottom, element.scrollTop, element.clientHeight) : 'visible');
    // What is picked right now, read from the highlighted row, so it can be told even when that row is out of view.
    setSelected(room.menu ? selectionLabel(element?.querySelector<HTMLElement>('[data-terminal-highlight]')?.textContent ?? '') : '');
  };
  useEffect(() => {
    const element = screenRef.current;
    const opening = expanded && !previouslyExpanded.current;
    previouslyExpanded.current = expanded;
    const newMenu = room.menu?.id !== lastMenuId.current;
    lastMenuId.current = room.menu?.id;
    if (!element || !expanded) return;
    // The panel holds still while the options of one menu are stepped through: only the highlight moves.
    element.scrollTop = scrollAfterUpdate({
      opening, newMenu, menuOpen: Boolean(room.menu), atEnd: atEnd.current, current: element.scrollTop,
      viewport: element.clientHeight, scrollHeight: element.scrollHeight, highlight: room.menu ? highlightBox() : undefined,
    });
    atEnd.current = wasAtEnd(element.scrollHeight, element.scrollTop, element.clientHeight);
    measure();
  }, [room.id, room.menu?.id, room.screenId, room.pendingApproval?.id, hasScreen, expanded]);
  const showHighlight = () => {
    const element = screenRef.current;
    const box = highlightBox();
    if (!element || !box) return;
    element.scrollTop = leastScroll(box.top, box.bottom, element.scrollTop, element.clientHeight);
    measure();
  };

  // Only offer ←/→ when the CLI screen itself advertises horizontal navigation.
  const horizontal = /[←→]|\b(?:left|right)\b/i.test(room.screen ?? '');
  const menuKeys = [
    ['up', '↑'], ['down', '↓'], ...(horizontal ? [['left', '←'], ['right', '→']] : []),
    ...(room.menu?.confirm ? [['enter', t('terminal.confirm')]] : []),
    ...(room.menu?.title === '權限設定' ? [['tab', 'Tab']] : []),
    ...(room.modelId === 'AGY' && room.menu?.title === '工作階段選單' ? [['tab', t('terminal.switch')]] : []),
    ['escape', 'Esc'],
  ];
  if (room.menu?.confirm) menuKeys.unshift(...(room.menu.numberKeys ?? []).map(key => [key, key]));
  if (room.menu?.yesNo) {
    // The review of a question card: y sends the answers, n drops them.
    const review = room.menu.title === '提交答案';
    menuKeys.unshift(['y', t(review ? 'terminal.submitAnswers' : 'terminal.yes')], ['n', t(review ? 'terminal.cancel' : 'terminal.back')]);
  }
  const showManualKeys = expanded && hasScreen && room.live && !room.menu && !room.pendingApproval;
  const manualKeyClass = 'min-h-10 min-w-10 rounded-lg border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-2 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF] hover:bg-[#FAF5EE] dark:hover:bg-[#2B3554] disabled:opacity-45';
  if (attention === 'none' && !forceOpen) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-[#FBF8F3] dark:bg-[#171D31] p-2">
      {!forceOpen && <button type="button" aria-expanded={expanded} aria-controls={panelId}
        onClick={() => setDismissed(expanded)}
        className="flex min-h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-xs font-semibold text-[#6E5D52] dark:text-[#C5CDE3] hover:bg-[#F3ECE1] dark:hover:bg-[#232B45] focus-visible:outline-2 focus-visible:outline-[#965069]">
        <TerminalSquare className="h-4 w-4 text-[#8D6B72] dark:text-[#EFA4B2]" aria-hidden="true" />
        <span className="flex-1">{expanded ? t('terminal.collapse') : t('terminal.show')}</span>
        {attention === 'menu' && <span className="text-[#9B5B29] dark:text-[#F0C882]">{t('terminal.menu.attention')}</span>}
        {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </button>}
      <div id={panelId} hidden={!expanded} className="space-y-2">
      {room.screen && (
        <figure className="guild-terminal rounded-xl p-2.5" data-cli={room.modelId}>
          <figcaption className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[11px]">
            <span>{t('terminal.live')}</span>
            {room.menu && <span className="truncate opacity-80">{menuHint(menuKeys.map(([key]) => key))}</span>}
          </figcaption>
          <pre ref={screenRef} aria-label={t('terminal.screen')} tabIndex={0}
            onScroll={event => { const element = event.currentTarget; atEnd.current = wasAtEnd(element.scrollHeight, element.scrollTop, element.clientHeight); measure(); }}
            className={`max-h-[24dvh] relative overflow-auto font-mono text-[11px] leading-relaxed select-text`}>
            <TerminalScreenText text={room.screen} styles={terminalStyles(room)} />
          </pre>
          {room.menu && (
            <p aria-live="polite" className="mt-1 truncate rounded-lg bg-white/10 px-2 py-1 font-mono text-[11px] text-[#F2E4D6]">
              {selected ? t('terminal.selected', { selected }) : t('terminal.select.prompt')}
            </p>
          )}
          {room.menu && offscreen !== 'visible' && (
            <button type="button" onClick={showHighlight} className="mt-1 w-full rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-[#F2E4D6] hover:bg-white/20">
              {offscreen === 'below' ? t('terminal.selected.below') : t('terminal.selected.above')}
            </button>
          )}
        </figure>
      )}
      {expanded && !hasScreen && <p role="status" className="px-2 py-1 text-xs text-[#6E5D52] dark:text-[#A4AECC]">{t('terminal.screen.empty')}</p>}
      {room.menu && (
        <div className="flex flex-wrap items-center gap-1" aria-label={room.menu.title}>
          {menuKeys.map(([key, label]) => (
            <button key={key} type="button" onClick={() => onMenu(key)}
              aria-label={{ up: t('terminal.up'), down: t('terminal.down'), left: t('terminal.left'), right: t('terminal.right') }[key] ?? label}
              className="min-h-9 min-w-9 rounded-lg border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-2 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF] hover:bg-[#FAF5EE] dark:hover:bg-[#2B3554]">
              {label}
            </button>
          ))}
        </div>
      )}
      {showManualKeys && onManualKey && (
        <div className="flex flex-wrap items-center gap-1" aria-label={t('terminal.manual.keys')}>
          <button type="button" onClick={() => onManualKey('ctrl-u')} className={manualKeyClass}>{t('terminal.manual.clear')}</button>
          <button type="button" onClick={() => onManualKey('escape')} disabled={room.ready}
            aria-label={t('terminal.manual.interrupt')} title={t('terminal.manual.interrupt')} className={manualKeyClass}>Esc</button>
          <button type="button" onClick={() => onManualKey('enter')} disabled={room.ready} className={manualKeyClass}>Enter</button>
          {!room.ready && [['up','↑'],['down','↓'],['left','←'],['right','→'],['shift-left','⇧←'],['tab','Tab'], ...'123456789'.split('').map(n => [n,n])]
            .map(([key,label]) => <button key={key} type="button" onClick={() => onManualKey(key)} className={manualKeyClass}>{label}</button>)}
        </div>
      )}
      {showManualKeys && !onManualKey && <p className="text-xs text-[#8D3F48] dark:text-[#F09AA6]">{t('terminal.manual.unsupported')}</p>}
      </div>
    </section>
  );
}
