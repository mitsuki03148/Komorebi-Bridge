import { useT } from '../i18n/useLang';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApprovalDiff } from './ApprovalDiff';
import { ArrowLeft, Minimize2, MoreHorizontal, TerminalSquare, Users, X } from 'lucide-react';
import { GUILD_HALL_BANNER, GUILD_HALL_NIGHT_BANNER } from '../data/initialGuildData';
import { useTheme } from '../utils/theme';
import { PermissionButton } from './PermissionButton';
import { DaySeparator, MessageBubble } from './MessageBubble';
import { ControlBar } from './ControlBar';
import { benchWakeAsLine, bubbleRuns, isBenchDelivery } from '../utils/bubbleRuns';
import { roleAccent } from '../utils/roleAccent';
import type { CharacterProfile, CLIModelId, TerminalRoom } from '../types/guild';
import { CopyTurnButton } from './CopyTurnButton';
import { ComposerActionButton, GuildActionButton, ScrollToLatestButton } from './GuildActions';
import { RejectReason } from './RejectReason';
import { QuestionCard } from './QuestionCard';
import { ModelEffortPicker } from './ModelEffortPicker';
import { LiveTerminal } from './LiveTerminal';
import { SlashCommandMenu } from './SlashCommandMenu';
import { approvalChoiceLabel } from '../utils/approvalChoices';
import { composerBlock, composerHint, groupPromptCanResume, useEscape } from '../utils/roomUi';

/** The same rule the Bridge applies to a group name. */
const groupNamePattern = /^[\p{L}\p{N}][\p{L}\p{N} _.()\-]{0,79}$/u;
import { WorkingIndicator } from './WorkingIndicator';
import { MessageImages } from './ImagePreviews';
import { Markdown } from './Markdown';
import { HistoryNote } from './HistoryNote';
import { GroupBoardMenuItem } from './GroupBoardMenu';
import { GroupMemberRoleAction, memberRoleLabel } from './GroupMemberRoleEditor';
import type { GroupMemberRole } from '../types/groupRoles';
import { useAutosize } from '../utils/useAutosize';
import { focusScope } from '../utils/focusScope';
import { WorktreeLayer } from './WorktreePanel';
import type { GhCall } from './github/GitHubPanel';
import { nearBottom, ownMessageJump, useStayAtBottom } from '../utils/scrollFollow';

const roles: CLIModelId[] = ['AGY', 'CODEX', 'CLAUDE'];

export function GroupCreateModal({ characters, availableRooms = [], onCreate, onClose, busy = false, error }: {
  characters: Record<CLIModelId, CharacterProfile>;
  availableRooms?: TerminalRoom[];
  onCreate: (name: string, models: CLIModelId[], existingRoomIds: string[]) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [roomQuery, setRoomQuery] = useState('');
  const [selected, setSelected] = useState<CLIModelId[]>([]);
  const [chosenRooms, setChosenRooms] = useState<string[]>([]);
  const selectedRooms = chosenRooms.filter(roomId => availableRooms.some(room => room.id === roomId));
  const total = selected.length + selectedRooms.length;
  const visibleRooms = availableRooms.filter(room => [characters[room.modelId].characterName, room.roomName, room.sessionId ?? '', room.id]
    .some(value => value.toLocaleLowerCase().includes(roomQuery.trim().toLocaleLowerCase())));
  useEscape(!busy, onClose);
  const [nameProblem, setNameProblem] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  return <div onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }} className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#4A3E36]/40 dark:bg-[#090C16]/68 p-4 backdrop-blur-xs">
    <section ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="group-create-title" className="guild-dialog-in w-full max-w-md rounded-3xl border border-[#E2D6C5] dark:border-[#313958] bg-[#FBF8F3] dark:bg-[#171D31] text-[#4A3E36] dark:text-[#ECE7DF] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[#E5DAC9] dark:border-[#2C3450] px-5 py-4">
        <h2 id="group-create-title" className="flex items-center gap-2 font-display text-[15px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF]"><Users size={19} className="shrink-0" />{' '}{t('group.create.title')}</h2>
        <button type="button" aria-label={t('group.close')} onClick={onClose} disabled={busy} className="flex h-10 w-10 items-center justify-center rounded-full text-[#7D6D61] dark:text-[#B5BED6] hover:bg-white dark:hover:bg-[#232B45]"><X size={18} /></button>
      </div>
      <form className="max-h-[80dvh] space-y-4 overflow-y-auto p-5" onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || total < 2 || total > 8 || busy) return;
        if (!groupNamePattern.test(name.trim())) { setNameProblem(true); nameInput.current?.focus(); return; }
        onCreate(name.trim(), selected, selectedRooms);
      }}>
        <label className="block text-sm font-semibold text-[#5C4D43] dark:text-[#B5BED6]">{t('group.create.name')}
          <input ref={nameInput} autoFocus value={name} maxLength={80} aria-invalid={nameProblem} aria-describedby={nameProblem ? 'group-name-problem' : undefined} onChange={event => { setName(event.target.value); setNameProblem(false); }} placeholder={t('group.create.example')} className="mt-2 w-full rounded-xl border border-[#DFD3C3] dark:border-[#343D5E] bg-white dark:bg-[#141A2C] px-3 py-2 text-base text-[#4A3E36] dark:text-[#ECE7DF] outline-none focus:border-[#D9828B]" />
        </label>
        {nameProblem && <p id="group-name-problem" role="alert" className="-mt-2 text-sm text-[#9F4856] dark:text-[#F09AA6]">{t('group.create.nameInvalid')}</p>}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-[#5C4D43] dark:text-[#B5BED6]">{t('group.create.new')}</legend>
          <p className="mb-2 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('group.create.hint')}</p>
          <div className="grid grid-cols-3 gap-2">{roles.map(id => {
            const character = characters[id], count = selected.filter(item => item === id).length;
            return <div key={id} className={`flex min-h-20 flex-col items-center justify-center rounded-2xl border p-2 text-sm font-semibold ${count ? 'border-[#D9828B] dark:border-[#EFA4B2] bg-[#FFF1F3] dark:bg-[#312338] text-[#754B55] dark:text-[#FADCE4]' : 'border-[#E5DAC9] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] text-[#6E5D52] dark:text-[#B5BED6]'}`}>
              <img src={character.avatarUrl} alt="" className="h-10 w-10 rounded-full object-contain" />{character.characterName}
              <div className="flex items-center gap-2"><button type="button" aria-label={t('group.create.decrease', { name: character.characterName })} disabled={!count || busy} onClick={() => setSelected(current => { const copy = [...current]; copy.splice(copy.lastIndexOf(id), 1); return copy; })} className="h-9 w-9 rounded-full bg-white dark:bg-[#27304D] disabled:opacity-40">−</button>
                <span aria-label={t('group.create.count', { name: character.characterName, count })}>{count}</span>
                <button type="button" aria-label={t('group.create.increase', { name: character.characterName })} disabled={total >= 8 || busy} onClick={() => setSelected(current => [...current, id])} className="h-9 w-9 rounded-full bg-white dark:bg-[#27304D] disabled:opacity-40">＋</button></div>
            </div>;
          })}</div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-[#5C4D43] dark:text-[#B5BED6]">{t('group.create.existing')}</legend>
          {availableRooms.length === 0 ? <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('group.create.empty')}</p> : <>
            <label className="sr-only" htmlFor="group-room-search">{t('group.create.search')}</label>
            <input id="group-room-search" type="search" value={roomQuery} onChange={event => setRoomQuery(event.target.value)} placeholder={t('group.create.searchplaceholder')} className="mb-2 min-h-11 w-full rounded-xl border border-[#DFD3C3] dark:border-[#343D5E] bg-white dark:bg-[#141A2C] px-3 text-base text-[#4A3E36] dark:text-[#ECE7DF] outline-none focus:border-[#D9828B]" />
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[#E5DAC9] dark:border-[#2E3654] bg-white dark:bg-[#141A2C] p-2">
              {!visibleRooms.length && <p className="p-2 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('group.search.empty')}</p>}
              {visibleRooms.map(room => {
                const checked = selectedRooms.includes(room.id);
                return <label key={room.id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg p-2 text-xs text-[#5C4D43] dark:text-[#C5CDE3] ${checked ? 'bg-[#FFF0F3] dark:bg-[#312338]' : 'hover:bg-[#F7F2E9] dark:hover:bg-[#1E253D]'}`}>
                  <input type="checkbox" checked={checked} disabled={busy || (!checked && total >= 8)} onChange={() => setChosenRooms(current => checked ? current.filter(id => id !== room.id) : [...current, room.id])} className="mt-1 h-4 w-4 accent-[#A65772]" />
                  <span className="min-w-0 break-all"><strong>{characters[room.modelId].characterName} · {room.roomName}</strong><br />{t('group.room.identity', { session: room.sessionId ?? t('group.room.unconfirmed'), room: room.id.slice(0, 8) })}</span>
                </label>;
              })}
            </div></>}
        </fieldset>
        <p className="text-xs leading-relaxed text-[#7D6D61]">{t('group.create.selected', { count: total })}</p>
        {error && <p role="alert" className="text-sm text-[#9F4856]">{error}</p>}
        <button type="submit" disabled={!name.trim() || total < 2 || total > 8 || busy} className="min-h-11 w-full rounded-full bg-[#A65772] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? t('group.create.busy') : t('group.create.submit')}</button>
      </form>
    </section>
  </div>;
}

type GroupMember = { roomId: string; modelId: CLIModelId; role?: GroupMemberRole; room?: TerminalRoom };
type Decision = string;

function timeValue(timestamp: string) {
  const match = timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  if (match[4]) hour = (hour % 12) + (match[4].toUpperCase() === 'PM' ? 12 : 0);
  return hour * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function timelineHasUndated(members: GroupMember[]) {
  return members.some(member => member.room?.logs.some(entry => !entry.createdAt || !Number.isFinite(Date.parse(entry.createdAt))));
}

export function orderGroupTimeline(members: GroupMember[]) {
  const hasDatedEntries = members.some(member => member.room?.logs.some(entry =>
    entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))));
  return members.flatMap(member => {
    const logs = member.room?.logs ?? [];
    const times = logs.map(entry => {
      if (entry.createdAt) {
        const time = Date.parse(entry.createdAt);
        if (Number.isFinite(time)) return time;
      }
      return hasDatedEntries ? undefined : timeValue(entry.timestamp);
    });
    return logs.map((entry, index) => {
      const previous = times.slice(0, index).findLast(value => value !== undefined);
      const next = times.slice(index + 1).find(value => value !== undefined);
      return { entry, member, index, time: times[index] ?? previous ?? next ?? -1 };
    });
  }).sort((a, b) => a.time - b.time || a.index - b.index);
}

export function GroupChatView({ worktreeCall, orchestratorRoomId, onSetOrchestrator, onEditMemberRole, name, boardPath, onChooseBoard, onFileTriggers, triggerBanner, members, characters, recipientId, availableRooms = [], drafts: sharedDrafts, onDraft, workingState, onLoadHistory, onBack, onSend, onCommand, onSelectRecipient, memberStrip, autoModeOf, onMode, onDecision, onInterrupt, onMenu, onManualKey, onAnswerDirect, onStart, onRetryMember, onOpenRoom, onAddMember, onAddExisting, onRemoveMember, attachmentPicker, voiceButton, attachmentPreview, hasAttachment, pendingRoomIds = [], error, errors, statuses }: {
  /** Asks the Mac for a member room's folder (changes and files, read only); undefined when the Bridge cannot. */
  worktreeCall?: GhCall;
  name: string;
  boardPath?: string;
  onChooseBoard?: () => void;
  onFileTriggers?: () => void;
  triggerBanner?: ReactNode;
  recipientId?: string;
  members: GroupMember[];
  characters: Record<CLIModelId, CharacterProfile>;
  availableRooms?: TerminalRoom[];
  /** Drafts live in the app, keyed by room, so they survive leaving the group. */
  drafts?: Record<string, string>;
  /** Elapsed time for a member room while its CLI works. */
  workingState?: (roomId: string) => { elapsed: string; stalled?: string } | undefined;
  /** Loads older messages for these rooms; absent when the Bridge cannot. */
  onLoadHistory?: (roomIds: string[]) => void;
  onDraft?: (roomId: string, change: (current: string) => string) => void;
  onBack: () => void;
  onSend: (roomId: string, text: string, accepted: () => void) => void;
  onCommand?: (roomId: string, text: string, accepted?: () => void) => void;
  /** Whether a member room runs without asking for approval (undefined when the Bridge cannot say), and how to change it. */
  autoModeOf?: (roomId: string) => boolean | undefined;
  onMode?: (roomId: string, auto: boolean) => void;
  /** `accepted` runs when the Bridge has taken the decision. */
  onDecision: (roomId: string, decision: Decision, accepted?: () => void) => void;
  onInterrupt?: (roomId: string) => void;
  onMenu: (roomId: string, menuId: string, key: string) => void;
  onManualKey?: (roomId: string, screen: string, screenId: string | undefined, key: string) => void;
  /** Answers a waiting question inside the CLI itself; false when that is not possible and a message should be sent instead. */
  onAnswerDirect?: (roomId: string, detail?: { choice?: number; choices?: number[]; text?: string; answers?: { choice?: number; choices?: number[]; text?: string }[] }) => boolean;
  onStart?: (roomId: string) => void;
  onRetryMember?: (roomId: string) => void;
  onOpenRoom?: (roomId: string) => void;
  /** Address the next message to this member (a tap on a speaker's name). */
  onSelectRecipient?: (roomId: string) => void;
  /** The phone's row of members, drawn right under the header; `onAdd` opens the add-member menu (absent when nobody can be added). */
  memberStrip?: (controls: { onAdd?: () => void }) => ReactNode;
  onAddMember?: (modelId: CLIModelId) => void;
  onAddExisting?: (roomId: string) => void;
  onRemoveMember?: (roomId: string) => void;
  /** The member that leads the group now (where reports go when nobody says otherwise), and a way to name another. */
  orchestratorRoomId?: string;
  onSetOrchestrator?: (roomId: string) => void;
  onEditMemberRole?: (roomId: string) => void;
  attachmentPicker?: (roomId: string) => ReactNode;
  voiceButton?: (roomId: string) => ReactNode;
  attachmentPreview?: (roomId: string) => ReactNode;
  hasAttachment?: (roomId: string) => boolean;
  pendingRoomIds?: string[];
  error?: string;
  errors?: Record<string, string | undefined>;
  statuses?: Record<string, string | undefined>;
}) {
  const { t } = useT();
  const [localDrafts, setLocalDrafts] = useState<Record<string, string>>({});
  const drafts = sharedDrafts ?? localDrafts;
  const updateDraft = (id: string, change: (current: string) => string) => onDraft
    ? onDraft(id, change) : setLocalDrafts(current => ({ ...current, [id]: change(current[id] ?? '') }));
  const [inviteQuery, setInviteQuery] = useState('');
  const [terminalRoomId, setTerminalRoomId] = useState<string | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const dismissingOutside = useRef(false);
  const following = useRef(true);
  const selected = members.find(member => member.roomId === recipientId) ?? members[0];
  const room = selected?.room;
  /** Members other than the addressed one that wait for an answer or an approval: their cards are not on screen. */
  const waiting = members.filter(member => member.roomId !== selected?.roomId && member.room && (member.room.pendingApproval || member.room.pendingQuestion));
  const draft = selected ? drafts[selected.roomId] ?? '' : '';
  const composerRef = useAutosize(draft);
  const pending = Boolean(room && pendingRoomIds.includes(room.id));
  const canResumeOnSend = room && groupPromptCanResume(room, draft);
  const blocked = room ? (canResumeOnSend ? undefined : composerBlock(room)) : t('group.room.unready');
  const hint = room && !canResumeOnSend ? composerHint(room) : undefined;
  const hasUndated = timelineHasUndated(members);
  const availableExisting = availableRooms.filter(candidate => !members.some(member => member.roomId === candidate.id));
  const canAddMember = Boolean((onAddMember || (onAddExisting && availableExisting.length > 0)) && members.length < 8);
  const matchingExisting = availableExisting.filter(candidate => [characters[candidate.modelId].characterName, candidate.roomName, candidate.sessionId ?? '', candidate.id]
    .some(value => value.toLocaleLowerCase().includes(inviteQuery.trim().toLocaleLowerCase())));
  const timeline = useMemo(() => orderGroupTimeline(members), [members]);
  const membersById = useMemo(() => new Map(members.map(member => [member.roomId, member])), [members]);
  const timelineVersion = timeline.map(({ entry }) => `${entry.id}:${entry.text.length}`).join('|');
  // When older messages are loaded above, keep what the reader is looking at where it is.
  const firstShown = timeline[0] ? `${timeline[0].member.roomId}:${timeline[0].entry.id}` : undefined;
  const anchor = useRef<{ height: number; first?: string; prepended: boolean }>({ height: 0, prepended: false });
  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    if (anchor.current.first && firstShown && firstShown !== anchor.current.first && !following.current) {
      element.scrollTop += element.scrollHeight - anchor.current.height;
      anchor.current.prepended = true;
    }
    anchor.current.first = firstShown;
    anchor.current.height = element.scrollHeight;
  }, [firstShown, timelineVersion]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const openDetails = [...(viewRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-group-popover][open]') ?? [])];
      dismissingOutside.current = openDetails.some(details => !details.contains(event.target as Node));
      openDetails.forEach(details => {
        if (!details.contains(event.target as Node)) details.open = false;
      });
    };
    const blockDismissClick = (event: MouseEvent) => {
      if (!dismissingOutside.current) return;
      dismissingOutside.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const cancelPointer = () => { dismissingOutside.current = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closing with Escape hands the focus back to the button that opened the menu.
      viewRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-group-popover][open]').forEach(details => {
        details.open = false;
        details.querySelector<HTMLElement>(':scope > summary')?.focus();
      });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('click', blockDismissClick, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('pointercancel', cancelPointer); document.removeEventListener('click', blockDismissClick, true); document.removeEventListener('keydown', escape); };
  }, []);
  const latestEntry = timeline.at(-1)?.entry;
  const lastLatest = useRef<string | undefined>(undefined);
  useStayAtBottom(timelineRef, following);
  useEffect(() => {
    const element = timelineRef.current;
    // What the user just sent takes them to the bottom, even from further up.
    if (lastLatest.current !== undefined && ownMessageJump(lastLatest.current, latestEntry)) following.current = true;
    lastLatest.current = latestEntry?.id;
    if (element && following.current) element.scrollTop = element.scrollHeight;
    else if (element && anchor.current.prepended) anchor.current.prepended = false;
    else if (element) setNewMessages(true);
  }, [timelineVersion]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!room || (!text && !hasAttachment?.(room.id)) || blocked || pending) return;
    onSend(room.id, text, () => clearSubmittedDraft(room.id));
  };
  const setDraft = (id: string, value: string) => updateDraft(id, () => value);
  const { isDark } = useTheme();
  const clearSubmittedDraft = (id: string) => { const sent = draft; updateDraft(id, current => current === sent ? '' : current); };
  return <section ref={viewRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#FBF8F3] dark:bg-[#121624]" aria-label={t('group.label', { name })}>
    {/* The same sunlit / starry night conservatory background as a single room. */}
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <img src={isDark ? GUILD_HALL_NIGHT_BANNER : GUILD_HALL_BANNER} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-35 dark:opacity-45" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#FBF8F3]/85 via-[#FBF8F3]/70 to-[#FBF8F3]/90 dark:from-[#121624]/82 dark:via-[#151B2E]/64 dark:to-[#121624]/90" />
    </div>
    <div className="absolute top-0 inset-x-0 z-30">
    <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-[#E6DCD0]/60 bg-[#FBF8F3]/62 backdrop-blur-md dark:border-[#6C7BA8]/25 dark:bg-[#101524]/50 dark:backdrop-blur-xl dark:backdrop-saturate-150 px-3 py-1.5 shadow-[0_6px_18px_-14px_rgba(90,70,50,0.22)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_-12px_rgba(0,0,0,0.65)] sm:px-5 sm:py-1.5">
      {/* One line everywhere: back, name, who is addressed and how they are doing, then the options. */}
      <div className="contents">
        <button type="button" onClick={onBack} aria-label={t('group.leave')} title={t('group.leave')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#6E5D52] dark:text-[#C5CDE3] transition-[transform,background-color] duration-150 ease-out hover:bg-[#E8DDD0]/50 dark:hover:bg-white/10 active:scale-[0.88] active:bg-[#DFD2C3]/70 dark:active:bg-white/15 cursor-pointer"><ArrowLeft size={18} /></button>
        <div className="flex min-w-0 max-w-[38%] shrink-0 items-baseline leading-tight"><h2 className="truncate font-normal text-[#4A3E36] dark:text-[#ECE7DF]">{name}</h2></div>
        {waiting.length > 0 && <details data-group-popover data-waiting-list className="relative shrink-0 self-center order-last">
          <summary aria-label={t('group.waiting.count', { count: waiting.length })} title={t('group.waiting.other')} className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-full border border-[#E8D2A0] dark:border-[#785B38] bg-[#FFF6DC] dark:bg-[#2C241A] px-2.5 text-xs font-bold text-[#8A6A1F] dark:text-[#F0C882] shadow-2xs [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#C98A2B] dark:bg-[#F0C882]" />{t('group.waiting.count', { count: waiting.length })}</summary>
          <div className="absolute right-0 z-20 mt-2 w-[17rem] max-w-[calc(100vw-1.5rem)] space-y-1 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FFFDF9]/97 dark:bg-[#171D31]/96 p-2 text-sm text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_18px_40px_-12px_rgba(90,70,50,0.35)]">
            {waiting.map(member => <button key={member.roomId} type="button" data-waiting-item={member.roomId}
              onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onSelectRecipient?.(member.roomId); }}
              className="flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left hover:bg-[#F7F2E9] dark:hover:bg-[#232B47]">
              <span className="max-w-full truncate font-semibold">{characters[member.modelId].characterName} · {member.room?.roomName ?? member.roomId.slice(0, 8)}</span>
              <span className="text-xs text-[#8A6A1F] dark:text-[#F0C882]">{member.room?.pendingApproval ? t('group.waiting.approval') : t('group.waiting.answer')}</span>
            </button>)}
          </div>
        </details>}
        {(canAddMember || selected || onChooseBoard || onFileTriggers) && <details ref={optionsRef} data-group-popover className="relative shrink-0 self-center order-last">
          <summary aria-label={t('group.options')} title={t('group.options')} className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-[#6E5D52] dark:text-[#C5CDE3] transition-[transform,background-color] duration-150 ease-out hover:bg-[#E8DDD0]/50 dark:hover:bg-white/10 active:scale-[0.88] active:bg-[#DFD2C3]/70 dark:active:bg-white/15 [&::-webkit-details-marker]:hidden"><MoreHorizontal size={18} aria-hidden="true" /></summary>
          <div className="absolute right-0 z-20 mt-2 flex max-h-[72dvh] w-[19.5rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3.5 overflow-y-auto rounded-3xl border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FFFDF9]/96 dark:bg-[#171D31]/94 p-3.5 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_18px_40px_-12px_rgba(92,75,64,0.22),0_4px_12px_rgba(92,75,64,0.08)] backdrop-blur-md">
            {canAddMember && <section aria-label={t('group.invite.title')} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-[#6E5D52] dark:text-[#B5BED6]">
                  <Users size={13} aria-hidden="true" className="text-[#8C7A6E]" />
                  <span>{t('group.invite.title')}</span>
                </span>
                <button type="button" aria-label={t('group.invite.close')}
                  onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#8C7A6E] transition hover:bg-[#F3ECE2] hover:text-[#4A3E36]">
                  <X size={14} />
                </button>
              </div>
              {onAddMember && <div className="space-y-1.5">
                <span className="block px-1 text-[11px] font-bold text-[#8C7A6E] dark:text-[#98A3C2]">{t('group.invite.new')}</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {roles.map(id => (
                    <button key={id} type="button" data-role-card={id}
                      onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onAddMember(id); }}
                      className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold shadow-2xs transition hover:brightness-[0.98] active:scale-[0.98]"
                      style={{ backgroundColor: roleAccent[id].wash, borderColor: `${roleAccent[id].stripe}80`, color: roleAccent[id].name }}>
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: roleAccent[id].stripe }} />
                      <span>{characters[id].characterName}</span>
                    </button>
                  ))}
                </div>
              </div>}
              {onAddExisting && availableExisting.length > 0 && <div className="space-y-1.5">
                <span className="block px-1 text-[11px] font-bold text-[#8C7A6E] dark:text-[#98A3C2]">{t('group.invite.existing')}</span>
                <input type="search" aria-label={t('group.invite.search.aria')} value={inviteQuery} onChange={event => setInviteQuery(event.target.value)} placeholder={t('group.invite.search.placeholder')}
                  className="min-h-9 w-full rounded-xl border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FBF8F3] dark:bg-[#141A2C] px-3 text-base sm:text-sm text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-[#A39286] dark:placeholder:text-[#7E89A8] focus:border-[#C46F7F] focus:outline-none" />
                {!matchingExisting.length && <p className="px-2 py-1.5 text-xs text-[#8C7A6E] dark:text-[#98A3C2]">{t('group.search.empty')}</p>}
                <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
                  {matchingExisting.map(candidate => (
                    <button key={candidate.id} type="button"
                      onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onAddExisting(candidate.id); }}
                      className="flex min-h-9 w-full items-center gap-2 rounded-xl border border-transparent px-2.5 py-1.5 text-left text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF] transition hover:border-[#EAE0D3] dark:hover:border-[#364062] hover:bg-[#FAF5EE] dark:hover:bg-[#232B47]">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: roleAccent[candidate.modelId].stripe }} />
                      <span className="truncate"><strong className="font-bold" style={{ color: roleAccent[candidate.modelId].name }}>{characters[candidate.modelId].characterName}</strong> · {candidate.roomName}</span>
                    </button>
                  ))}
                </div>
              </div>}
            </section>}
            {selected && <section aria-label={t('group.details')} className="space-y-2.5 border-t border-[#EDE3D6] dark:border-[#2E3654] pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-extrabold tracking-wide text-[#6E5D52] dark:text-[#B5BED6]">{t('group.details')}</span>
                {!canAddMember && <button type="button" aria-label={t('group.details.close')}
                  onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#8C7A6E] dark:text-[#98A3C2] transition hover:bg-[#F3ECE2] dark:hover:bg-[#27304D] hover:text-[#4A3E36] dark:hover:text-[#ECE7DF]">
                  <X size={14} />
                </button>}
              </div>
              <div data-role-card={selected.modelId} className="flex items-center justify-between gap-2 rounded-2xl border px-3 py-2"
                style={{ backgroundColor: roleAccent[selected.modelId].wash, borderColor: `${roleAccent[selected.modelId].stripe}66` }}>
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: roleAccent[selected.modelId].stripe }} />
                  <span className="truncate text-xs font-bold" style={{ color: roleAccent[selected.modelId].name }}>
                    {characters[selected.modelId].characterName} · {room?.roomName ?? t('group.room.label')}
                  </span>
                </div>
                {room && onOpenRoom && (
                  <button type="button" onClick={() => onOpenRoom(room.id)}
                    className="shrink-0 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-2.5 py-1 text-[11px] font-bold text-[#5A4A40] dark:text-[#ECE7DF] shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#2B3554]">
                    {t('group.details.open')}
                  </button>
                )}
              </div>
              <GroupMemberRoleAction role={selected.roomId === orchestratorRoomId ? { key: 'orchestrator', label: t('group.memberRole.orchestrator') } : selected.role} onEdit={onEditMemberRole ? () => {
                if (optionsRef.current) {
                  optionsRef.current.open = false;
                  optionsRef.current.querySelector('summary')?.focus();
                }
                onEditMemberRole(selected.roomId);
              } : undefined} />
              {selected.roomId === orchestratorRoomId && (
                <p data-orchestrator-note className="rounded-2xl border border-[#EFE2B8] dark:border-[#6E5934] bg-[#FFF8E2] dark:bg-[#2C2519] px-3 py-2 text-[11px] leading-relaxed font-semibold text-[#8A6A1F] dark:text-[#F0C882]">
                  {t('group.details.leader')}
                </p>
              )}
            </section>}
            {onFileTriggers && <button type="button" onClick={() => { if (optionsRef.current) optionsRef.current.open = false; onFileTriggers(); }}
              className="min-h-10 rounded-xl border border-[#E2D6C5] bg-white px-3 text-left text-xs font-semibold dark:border-[#364062] dark:bg-[#232B45]">{t('fileTrigger.menu')}</button>}
            {onChooseBoard && <GroupBoardMenuItem compact path={boardPath}
              onEdit={() => { if (optionsRef.current) optionsRef.current.open = false; onChooseBoard(); }}
              onOpen={() => { if (optionsRef.current) optionsRef.current.open = false; }} />}
          </div>
        </details>}
      </div>
      {selected && (() => {
        const isWorking = Boolean(room && workingState?.(room.id));
        const isWaiting = Boolean(room?.pendingApproval || room?.pendingQuestion);
        const isLive = Boolean(room?.live);
        const assignment = selected.role
          ? memberRoleLabel(selected.role, t)
          : selected.roomId === orchestratorRoomId
            ? t('group.memberRole.orchestrator')
            : '';
        const roleLabel = assignment || characters[selected.modelId].characterName;
        const statusSummary = `${characters[selected.modelId].characterName} · ${room?.roomName ?? t('group.room.label')}${assignment ? ` · ${assignment}` : ''} · ${room?.pendingApproval ? t('group.waiting.approval') : room?.currentActionSummary ?? t('group.room.startfailure')}`;
        return <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-[#7D6D61] dark:text-[#A4AECC]">
          <span data-recipient-role={selected.modelId}
            className="flex h-6 max-w-full w-fit min-w-0 items-center gap-1.5 rounded-full border px-2.5 shadow-[0_2px_8px_-3px_rgba(160,110,125,0.22),inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-[0_2px_8px_-3px_rgba(0,0,0,0.5)]"
            style={{
              backgroundColor: `${roleAccent[selected.modelId].wash}E0`,
              borderColor: `${roleAccent[selected.modelId].stripe}75`,
              color: roleAccent[selected.modelId].name,
            }}
            title={statusSummary} aria-label={statusSummary}>
            {/* Left: Delicate 5-petal sakura blossom (spins gently when working, dims when CLI session is off) */}
            <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
              <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 shrink-0 ${isWorking ? 'guild-flower-spin' : ''}`}
                style={{ opacity: isWorking || isLive ? 0.96 : 0.42 }} aria-hidden="true">
                {[0, 72, 144, 216, 288].map(angle => (
                  <ellipse key={angle} cx="10" cy="5.2" rx="3" ry="4.4" transform={`rotate(${angle} 10 10)`} fill={roleAccent[selected.modelId].stripe} />
                ))}
                <circle cx="10" cy="10" r="2.1" fill="#FBE9A8" />
              </svg>
            </span>
            {/* Middle: Active member's group role/assignment (or character name when unassigned) */}
            <span className="max-w-[7.5rem] truncate font-display text-[11px] font-bold tracking-wide sm:max-w-[14rem]">
              {roleLabel}
            </span>
            {/* Right: Shoujo jewel dot showing CLI state (waiting / working / live / offline) */}
            {isWaiting ? (
              <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D97706] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D97706]" />
              </span>
            ) : isWorking ? (
              <svg viewBox="0 0 16 16" className="guild-star-twinkle h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <path d="M8 1 C8.7 5.5 10.5 7.3 15 8 C10.5 8.7 8.7 10.5 8 15 C7.3 10.5 5.5 8.7 1 8 C5.5 7.3 7.3 5.5 8 1 Z" fill={roleAccent[selected.modelId].stripe} />
              </svg>
            ) : isLive ? (
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_5px_currentColor]" style={{ backgroundColor: roleAccent[selected.modelId].stripe }} />
            ) : (
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full border border-current opacity-55" />
            )}
            <span className="sr-only">{statusSummary}</span>
          </span>
          {room && !room.live && onStart && <button type="button" onClick={() => onStart(room.id)} className="min-h-8 shrink-0 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-2.5 text-[11px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{room.sessionId ? t('group.room.resume') : t('group.room.start')}</button>}
          {!room && onRetryMember && <button type="button" onClick={() => onRetryMember(selected.roomId)} className="min-h-8 shrink-0 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-2.5 text-[11px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.retry')}</button>}
        </div>;
      })()}
    </header>
    {memberStrip?.({ onAdd: canAddMember ? () => { if (optionsRef.current) optionsRef.current.open = true; } : undefined })}
    </div>
    <div ref={timelineRef} onScroll={event => {
      const element = event.currentTarget;
      anchor.current.height = element.scrollHeight;
      following.current = nearBottom(element);
      setAwayFromLatest(!following.current);
      if (following.current) setNewMessages(false);
    }} className={`relative z-10 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 sm:px-5 sm:pb-5 ${memberStrip ? 'pt-[7.25rem]' : 'pt-[4.25rem]'}`} aria-label={t('group.conversation')}>
      <HistoryNote truncated={members.some(member => member.room?.historyTruncated)} count={timeline.length}
        onLoadMore={onLoadHistory && (() => onLoadHistory(members.filter(member => member.room?.historyTruncated).map(member => member.roomId)))} />
      {hasUndated && <p className="text-center text-[11px] text-[#8C7A6E]">{t('group.timeline.undated')}</p>}
      {!timeline.length && <p className="py-8 text-center text-sm text-[#8C7A6E]">{t('group.timeline.waiting')}</p>}
      {bubbleRuns(timeline.filter(({ entry }) => !isBenchDelivery(entry)).map(({ entry, member }) => ({ entry: benchWakeAsLine(entry), key: member.roomId }))).map(item => {
        const member = membersById.get(item.key);
        if (!member) return null;
        const roleTag = member.role
          ? memberRoleLabel(member.role, t)
          : member.roomId === orchestratorRoomId
            ? t('group.memberRole.orchestrator')
            : '';
        // Show "Character · Role" whenever the member has a group role (or is the crowned lead); otherwise disambiguate duplicate characters by room name.
        const who = roleTag
          ? `${characters[member.modelId].characterName} · ${roleTag}`
          : members.filter(other => other.modelId === member.modelId).length > 1
            ? `${characters[member.modelId].characterName} · ${member.room?.roomName ?? member.roomId.slice(0, 8)}`
            : characters[member.modelId].characterName;
        return <Fragment key={`${item.key}:${item.entry.id}`}>
          {item.day && <DaySeparator label={item.day} />}
          <MessageBubble entry={item.entry} modelId={member.modelId} name={who} addressee={who} roomId={member.room?.id} header={item.header} count={item.count}
            onNameClick={onSelectRecipient && member.roomId !== selected?.roomId ? () => onSelectRecipient(member.roomId) : undefined} />
        </Fragment>;
      })}
      {room && selected && workingState?.(room.id) && (() => {
        const selectedRoleTag = selected.role
          ? memberRoleLabel(selected.role, t)
          : selected.roomId === orchestratorRoomId
            ? t('group.memberRole.orchestrator')
            : '';
        return <WorkingIndicator modelId={selected.modelId} name={`${characters[selected.modelId].characterName} · ${selectedRoleTag || room.roomName}`}
          elapsed={workingState(room.id)!.elapsed} stalled={workingState(room.id)!.stalled} background={Boolean(room.backgroundTasks)} onShowTerminal={() => setTerminalRoomId(room.id)} />;
      })()}
    </div>
    <div className="relative z-10 shrink-0 space-y-2 border-t border-[#E6DCD0] bg-[#F7F2E9]/50 p-3 sm:px-5 dark:border-[#6C7BA8]/25 dark:bg-[#101524]/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_-8px_24px_-12px_rgba(0,0,0,0.65)]">
      {(awayFromLatest || newMessages) && <ScrollToLatestButton newMessages={newMessages} onClick={() => {
        const element = timelineRef.current;
        if (element) element.scrollTop = element.scrollHeight;
        following.current = true;
        setNewMessages(false);
        setAwayFromLatest(false);
      }} />}
      {room && (terminalRoomId === room.id || room.menu) && <div>
        <LiveTerminal room={room} compact forceOpen={terminalRoomId === room.id}
          onMenu={key => { if (room.menu) onMenu(room.id, room.menu.id, key); }}
          onManualKey={onManualKey ? key => onManualKey(room.id, room.screen ?? '', room.screenId, key) : undefined} />
      </div>}
      {room?.pendingQuestion && selected && <QuestionCard pending={room.pendingQuestion} name={characters[selected.modelId].characterName} disabled={pending} onAnswer={(text, detail) => { if (!onAnswerDirect?.(room.id, detail)) onSend(room.id, text, () => {}); }} />}
      {room?.pendingApproval && <div data-group-approval className="guild-approval max-h-[34dvh] space-y-2 overflow-y-auto p-3 text-xs">
        <strong className="text-[#4A3E36] dark:text-[#F5D6A3]">{selected && characters[selected.modelId].characterName} · {room.pendingApproval.title}</strong>
        <p className="text-[#7D6D61] dark:text-[#C5CDE3]">{t('group.approval.hint', { reason: room.pendingApproval.reason })}</p>
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#382F2A] p-2 text-[#F9EFE4]">{room.pendingApproval.commandOrFile}</pre>
        <ApprovalDiff lines={room.pendingApproval.diffLines} />
        <div className="flex flex-wrap gap-2"><GuildActionButton kind="approve" disabled={pending} onClick={() => onDecision(room.id, 'approve')} />
          <button type="button" disabled={pending} onClick={() => onDecision(room.id, 'reject')} className="min-h-10 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-4 text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.reject')}</button>
          {room.pendingApproval.additionalChoices?.map(choice => <button key={choice.id} type="button" disabled={pending} onClick={() => onDecision(room.id, choice.id)} className="min-h-10 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-4 text-left text-[#4A3E36] dark:text-[#ECE7DF]">{approvalChoiceLabel(choice)}</button>)}
        </div>
        <RejectReason disabled={pending} onSubmit={reason => { const id = room.id; onDecision(id, 'reject', () => onCommand?.(id, reason)); }} />
      </div>}
      {(room && errors ? errors[room.id] : error) && <p role="status" className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{room && errors ? errors[room.id] : error}</p>}
      {room && statuses?.[room.id] && <p role="status" className="text-xs text-[#50785A] dark:text-[#96C7A3]">{statuses[room.id]}</p>}
      {room && !statuses?.[room.id] && !errors?.[room.id] && hint && <p role="status" className="w-fit max-w-full rounded-full bg-white/55 dark:bg-[#1D243B]/80 px-3 py-1 text-[11px] text-[#8C7A6E] dark:text-[#A4AECC] shadow-[inset_0_0_0_1px_rgba(232,220,210,0.7)] dark:shadow-[inset_0_0_0_1px_rgba(54,64,98,0.7)]">{hint}</p>}
      {room && attachmentPreview?.(room.id)}
      {triggerBanner}
      <form onSubmit={submit} className="guild-composer-glass relative z-10 flex items-end gap-1 rounded-[1.75rem] border border-[#DFD3C3] dark:border-[#343D5E] p-1 pl-2 focus-within:border-[#D9828B] dark:focus-within:border-[#7C86B8]">
        {room?.live && !pending && !blocked && onCommand && <SlashCommandMenu modelId={room.modelId} draft={draft} onSelect={item => {
          if (item.immediateExecute) onCommand(room.id, item.cmd, () => clearSubmittedDraft(room.id));
          else setDraft(room.id, item.cmd + ' ');
        }} />}
        {room && attachmentPicker?.(room.id)}
        <textarea ref={composerRef} rows={1} value={draft} onChange={event => { if (selected) setDraft(selected.roomId, event.target.value); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} placeholder={t('group.composer.placeholder', { name: selected ? characters[selected.modelId].characterName : t('group.member') })} aria-label={t('group.message')} className="min-w-0 flex-1 resize-none overflow-y-auto bg-transparent pb-1.5 pt-2.5 text-base text-[#4A3E36] dark:text-[#ECE7DF] outline-none placeholder:text-[13px] placeholder:text-[#A39284] dark:placeholder:text-[#7E89A8]" />
        {room && voiceButton?.(room.id)}
        <ComposerActionButton
          running={Boolean(room?.live && (!room.ready || room.status !== 'idle' || workingState?.(room.id)))}
          canInterrupt={Boolean(onInterrupt)}
          hasDraft={Boolean(draft.trim() || (room && hasAttachment?.(room.id)))}
          blocked={blocked}
          pending={pending}
          role={selected?.modelId}
          onStop={() => { if (room) onInterrupt?.(room.id); }}
          title={pending ? t('group.sending') : blocked ?? t('group.send')}
        />
      </form>
      {room && selected && onCommand && <fieldset disabled={!room.live || pending} className="flex flex-wrap gap-2 disabled:opacity-50" aria-label={t('group.session.settings')}>
        <ControlBar room={room} character={characters[selected.modelId]} mobile onCommand={(id, command) => onCommand(id, command)}
          compact={{ disabled: !room.ready || Boolean(room.pendingApproval) || pending, title: '/compact', onRun: () => onCommand(room.id, '/compact') }}
          terminal={{ open: terminalRoomId === room.id, onToggle: () => setTerminalRoomId(current => current === room.id ? null : room.id) }}
          shield={{ disabled: !room.live || pending, autoMode: autoModeOf?.(room.id), onMode: onMode && (auto => onMode(room.id, auto)), onPermissions: () => onCommand(room.id, '/permissions') }} />
      </fieldset>}
    </div>
    {worktreeCall && (() => {
      const choices = members.filter(member => member.room?.repoPath).map(member => ({ id: member.roomId, label: `${characters[member.modelId].characterName} · ${member.room!.roomName}` }));
      const worktreeRoomId = choices.find(choice => choice.id === orchestratorRoomId)?.id ?? choices[0]?.id;
      return worktreeRoomId ? <WorktreeLayer roomId={worktreeRoomId} call={worktreeCall} choices={choices} initialDiffMode="branch" /> : null;
    })()}
  </section>;
}
