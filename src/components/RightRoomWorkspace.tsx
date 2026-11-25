import { CopyTurnButton } from './CopyTurnButton';
import { ModelEffortPicker } from './ModelEffortPicker';
import { RejectReason } from './RejectReason';
import { ApprovalSeal, ComposerActionButton, GuildActionButton, ScrollToLatestButton } from './GuildActions';
import { useT } from '../i18n/useLang';
import { quotaHint } from '../data/initialGuildData';
import React, { Fragment, useEffect, useState } from 'react';
import {
  X,
  ShieldAlert,
  CheckCircle2,
  Minimize2,
  FlaskConical,
  Eye,
  GitBranch,
  TerminalSquare,
  Folder,
  Copy,
  Check,
} from 'lucide-react';
import { CharacterProfile, TerminalRoom } from '../types/guild';
import { PermissionButton } from './PermissionButton';
import { DaySeparator, MessageBubble } from './MessageBubble';
import { ControlBar } from './ControlBar';
import { bubbleRuns } from '../utils/bubbleRuns';
import {
  matchSlashCommands,
  CLISlashCommandItem,
} from '../data/cliCommands';
import { GUILD_HALL_BANNER, GUILD_HALL_NIGHT_BANNER } from '../data/initialGuildData';
import { useTheme } from '../utils/theme';
import { QuestionCard } from './QuestionCard';
import { WorkingIndicator } from './WorkingIndicator';
import { MessageImages } from './ImagePreviews';
import { Markdown } from './Markdown';
import { HistoryNote } from './HistoryNote';
import { WorktreeLayer } from './WorktreePanel';
import type { GhCall } from './github/GitHubPanel';
import { useAutosize } from '../utils/useAutosize';
import { useConversationScroll } from '../utils/useConversationScroll';
import { approvalChoiceLabel } from '../utils/approvalChoices';
import { composerBlock, composerHint, hasResetVouchers, roomCapabilities, roomStatusLabel, useEscape } from '../utils/roomUi';

interface RightRoomWorkspaceProps {
  /** Asks the Mac for this room's folder (changes and files, read only); undefined when the Bridge cannot. */
  worktreeCall?: GhCall;
  /** The microphone button for the message box. */
  voiceButton?: React.ReactNode;
  /** Whether the room starts without asking for approval, and how to change it (when the Bridge can remember it). */
  autoMode?: boolean;
  onMode?: (auto: boolean) => void;
  room: TerminalRoom;
  character: CharacterProfile;
  onApprove: (roomId: string, source: 'desktop' | 'mobile_app') => void;
  onAdditionalApproval: (roomId: string, decision: string) => void;
  onInterrupt: (roomId: string) => void;
  onReject: (roomId: string, reason: string, source: 'desktop' | 'mobile_app') => void;
  onSendPrompt: (roomId: string, promptText: string, fromMobile?: boolean) => void;
  /** Answers a waiting question inside the CLI itself; false when that is not possible and a message should be sent instead. */
  onAnswerDirect?: (roomId: string, detail?: { choice?: number; choices?: number[]; text?: string; answers?: { choice?: number; choices?: number[]; text?: string }[] }) => boolean;
  onSubmitDraft: (roomId: string, promptText: string) => void;
  attachmentPicker: React.ReactNode;
  attachmentPreview: React.ReactNode;
  hasAttachment: boolean;
  promptInput: string;
  setPromptInput: React.Dispatch<React.SetStateAction<string>>;
  sending?: boolean;
  approving?: boolean;
  actionMessage?: string;
  actionError?: boolean;
  onRunCompact: (roomId: string, fromMobile?: boolean) => void;
  /** Elapsed time of the current CLI turn, shown while it works. */
  workingElapsed?: string;
  workingStalled?: string;
  onShowTerminal?: () => void;
  terminal: React.ReactNode;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  controls: React.ReactNode;
  onRedeemResetVoucher: (modelId: CharacterProfile['id'], roomId: string) => void;
  /** Loads older messages; absent when the Bridge cannot. */
  onLoadHistory?: (roomId: string) => void;
}

export const RightRoomWorkspace: React.FC<RightRoomWorkspaceProps> = ({
  room,
  worktreeCall,
  voiceButton,
  autoMode,
  onMode,
  character,
  onApprove,
  onAdditionalApproval,
  onInterrupt,
  onReject,
  onSendPrompt,
  onAnswerDirect,
  onSubmitDraft,
  attachmentPicker,
  attachmentPreview,
  hasAttachment,
  promptInput,
  setPromptInput,
  sending,
  approving,
  actionMessage,
  actionError,
  onRunCompact,
  onRedeemResetVoucher,
  workingElapsed,
  onLoadHistory,
  workingStalled,
  onShowTerminal,
  terminal,
  terminalOpen,
  onToggleTerminal,
  controls,
}) => {
  const { t } = useT();
  const [activePopup, setActivePopup] = useState<'none' | 'approve'>('none');
  const composerRef = useAutosize(promptInput);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const actionPending = sending || approving;
  const blocked = composerBlock(room);
  const hint = composerHint(room);
  const capabilities = roomCapabilities(room, actionPending);

  const conversationScroll = useConversationScroll(room.id, room.logs.map(entry => `${entry.id}:${entry.text.length}`).join('|'), room.logs[0]?.id, room.logs.at(-1));

  // Filter active CLI's slash commands when user types "/"
  const trimmedStart = promptInput.trimStart();
  const isTypingSlash = trimmedStart.startsWith('/');
  const matchingSlashCommands = matchSlashCommands(room.modelId, promptInput);
  const slashOpen = !actionPending && !slashDismissed && isTypingSlash && matchingSlashCommands.length > 0;
  useEscape(activePopup !== 'none', () => setActivePopup('none'));
  // The window shows the pending approval; once it is answered (here or in the CLI) there is nothing left to show.
  const hasApproval = Boolean(room.pendingApproval);
  useEffect(() => { if (!hasApproval) setActivePopup('none'); }, [hasApproval]);

  const handleSelectSlashCommand = (item: CLISlashCommandItem) => {
    if (item.immediateExecute) {
      if (blocked) return;
      onSubmitDraft(room.id, item.cmd);
      setSlashIndex(0);
    } else {
      setPromptInput(`${item.cmd} `);
      setSlashIndex(0);
    }
  };


  const handleDesktopSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!promptInput.trim() && !hasAttachment) || actionPending || blocked) return;
    onSubmitDraft(room.id, promptInput.trim());
    setSlashIndex(0);
  };

  const accentBadge =
    room.modelId === 'AGY'
      ? 'bg-[#FCE8EB] text-[#C85A68] border-[#F3C6CD]'
      : room.modelId === 'CODEX'
      ? 'bg-[#E6F2E8] text-[#4E7A55] border-[#C5DEC8]'
      : 'bg-[#E8F0F8] text-[#4F729B] border-[#C6D7EA]';

  const { isDark } = useTheme();
  const shortPath = room.repoPath ? room.repoPath.split('/').filter(Boolean).slice(-2).join('/') : '';

  return (
    <main className="flex-1 h-full flex flex-col bg-[#FBF8F3] dark:bg-[#121624] overflow-hidden select-none relative">
      {/* Komorebi Sunlit / Starry Night Botanical Conservatory & Library Room Background */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <img
          src={isDark ? GUILD_HALL_NIGHT_BANNER : GUILD_HALL_BANNER}
          alt={t('workspace.background')}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-35 dark:opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FBF8F3]/85 via-[#FBF8F3]/70 to-[#FBF8F3]/90 dark:from-[#121624]/82 dark:via-[#151B2E]/64 dark:to-[#121624]/90" />
      </div>

      {/* Slim Minimalist 1-Line Frosted-Glass Room Header floating over the scrollable stream */}
      <div className="absolute top-0 inset-x-0 z-30 px-5 py-2 border-b border-[#E6DCD0]/70 dark:border-[#6C7BA8]/25 bg-[#FBF8F3]/62 dark:bg-[#101524]/50 backdrop-blur-md dark:backdrop-blur-xl dark:backdrop-saturate-150 shadow-[0_6px_18px_-14px_rgba(90,70,50,0.22)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_-12px_rgba(0,0,0,0.65)] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-bold font-display border ${accentBadge} shrink-0`}
          >
            {character.characterName}
          </span>
          <h2 className="text-sm font-normal text-[#4A3E36] dark:text-[#ECE7DF] truncate">
            {room.roomName}
          </h2>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F3ECE1] dark:bg-[#1E253D] border border-[#E5DAC9] dark:border-[#343D5E] text-[11px] font-mono text-[#7D6D61] dark:text-[#A4AECC] truncate">
            <GitBranch className="w-3 h-3 text-[#8AA88E] dark:text-[#96BD9F]" />
            <span>{room.gitBranch}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 min-w-0 shrink text-[11px] text-[#6E5D52] dark:text-[#A4AECC]">
          {room.repoPath && <span className="inline-flex min-w-0 items-center gap-1 font-mono" title={room.repoPath}>
            <Folder className="h-3 w-3 shrink-0 text-[#A38F7E]" aria-hidden="true" /><span className="truncate">{shortPath}</span>
            <CopyValueButton value={room.repoPath} label={t('workspace.path.copy')} />
          </span>}
          <span className="inline-flex items-center gap-0.5 font-mono" title={room.sessionId ? `Session ID ${room.sessionId}` : t('workspace.session.waiting')}>
            <span className="text-[#9A8778]">ID</span> {room.sessionId ? room.sessionId.slice(0, 8) : t('workspace.session.pending')}
            {room.sessionId && <CopyValueButton value={room.sessionId} label={t('workspace.session.copy')} />}
          </span>
          <span className={`shrink-0 font-bold ${workingStalled ? 'text-[#B8741F]' : 'text-[#5E8C68]'}`}>{workingStalled ? t('workspace.stalled', { elapsed: workingStalled }) : `${roomStatusLabel(room)}${workingElapsed ? ` · ${workingElapsed}` : ''}`}</span>
        </div>
      </div>

      {/* Spacious Full-Width Terminal Stream over Soft Komorebi Room */}
      <div ref={conversationScroll.ref} onScroll={conversationScroll.onScroll} className="relative z-10 flex-1 overflow-y-auto px-6 pt-14 pb-4 space-y-2.5 select-text font-sans text-sm">
        <HistoryNote truncated={room.historyTruncated} count={room.logs.length} onLoadMore={onLoadHistory && (() => onLoadHistory(room.id))} />
        {bubbleRuns(room.logs.map(entry => ({ entry, key: room.id }))).map(item => (
          <Fragment key={item.entry.id}>
            {item.day && <DaySeparator label={item.day} />}
            <MessageBubble entry={item.entry} modelId={room.modelId} name={character.characterName} roomId={room.id} header={item.header} count={item.count} />
          </Fragment>
        ))}
        {workingElapsed !== undefined && <WorkingIndicator modelId={room.modelId} name={character.characterName} elapsed={workingElapsed}
          stalled={workingStalled} background={Boolean(room.backgroundTasks)} onShowTerminal={onShowTerminal} />}
      </div>

      {terminal && <div className="relative z-10 shrink-0 px-5" aria-label={t('workspace.terminal')}>{terminal}</div>}

      <div className="relative z-10 shrink-0 px-5">
        {room.pendingQuestion && <div className="mb-2"><QuestionCard pending={room.pendingQuestion} name={character.characterName} disabled={sending} onAnswer={(text, detail) => { if (!onAnswerDirect?.(room.id, detail)) onSendPrompt(room.id, text); }} /></div>}
        {/* Clean Inline Approval Card inside Terminal (Icon-Focused) */}
        {room.pendingApproval && (
          <div className="guild-approval p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <ApprovalSeal />
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#754B29]">{room.pendingApproval.title}</div>
                <p className="mt-0.5 text-xs text-[#7D6D61] font-sans">
                  {t('workspace.approval.hint', { reason: room.pendingApproval.reason })}
                </p>
              </div>
            </div>
            <pre className="order-last basis-full max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#382F2A] p-2.5 font-mono text-[11px] text-[#F9EFE4]">{room.pendingApproval.commandOrFile}</pre>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {room.pendingApproval.additionalChoices?.map(choice => <button key={choice.id} type="button" disabled={actionPending}
                onClick={() => onAdditionalApproval(room.id, choice.id)} title={approvalChoiceLabel(choice)}
                className="max-w-56 truncate px-3 py-1.5 rounded-full bg-white border border-[#D8B17E] text-[#704A24] text-xs">
                {approvalChoiceLabel(choice)}
              </button>)}
              {room.pendingApproval.diffLines.length > 0 && <button
                type="button"
                onClick={() => setActivePopup('approve')}
                title={t('workspace.diff.details')}
                className="w-8 h-8 rounded-full bg-white hover:bg-[#F5EFE6] text-[#6E5D52] border border-[#E2D5C4] flex items-center justify-center cursor-pointer"
              >
                <Eye className="w-4 h-4" />
              </button>}
              <GuildActionButton kind="approve" disabled={actionPending}
                onClick={() => onApprove(room.id, 'desktop')}
              >
                {approving ? t('workspace.submitting') : t('workspace.approve')}
              </GuildActionButton>
              <button
                type="button"
                disabled={actionPending}
                onClick={() => onReject(room.id, '', 'desktop')}
                title={t('workspace.reject.title')}
                className="w-8 h-8 rounded-full bg-[#FCE8EB] hover:bg-[#F8D3D8] text-[#C85A68] border border-[#F3C6CD] flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <RejectReason className="order-last basis-full text-right" disabled={actionPending} onSubmit={reason => onReject(room.id, reason, 'desktop')} />
          </div>
        )}
      </div>

      {/* Bottom Composer + Compact Icon Control Bar Below Composer */}
      <div className="relative z-10 px-5 py-2.5 bg-[#F7F2E9]/50 dark:bg-[#101524]/50 border-t border-[#E6DCD0] dark:border-[#6C7BA8]/25 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_-8px_24px_-12px_rgba(0,0,0,0.65)] shrink-0 space-y-2">
        {conversationScroll.visible && <ScrollToLatestButton onClick={conversationScroll.goToBottom} newMessages={conversationScroll.newMessages} />}
        {/* Live CLI "/" Slash Command Autocomplete Palette (Synchronized with Terminal) */}
        {slashOpen && (
          <div className="absolute bottom-full left-5 right-5 mb-2 rounded-2xl bg-[#FFFDF9]/98 border border-[#DFD3C3] shadow-2xl overflow-hidden z-50 backdrop-blur-md dark:bg-[#171D31]/97 dark:border-[#343D5E]">
            <div className="px-3.5 py-1.5 bg-[#F5EFE6] border-b border-[#E5DAC9] flex items-center justify-between text-[11px] dark:bg-[#1C233A] dark:border-[#2C3450]">
              <span className="font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
                {t('workspace.slash.title', { name: character.characterName, cli: character.cliToolName })}
              </span>
              <span className="font-mono text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]">
                {t('workspace.slash.help')}
              </span>
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-[#F3ECE1] dark:divide-[#262E4A]">
              {matchingSlashCommands.map((item, idx) => {
                const isActive = idx === slashIndex % matchingSlashCommands.length;
                return (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => handleSelectSlashCommand(item)}
                    className={`w-full px-3.5 py-2 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isActive ? 'bg-[#FFF5F6] dark:bg-[#2A2238]' : 'hover:bg-[#F7F2E9] dark:hover:bg-[#232B47]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-2 py-0.5 rounded-lg bg-[#382F2A] text-[#F9EFE4] font-mono text-xs font-bold shrink-0 dark:bg-[#2B3352] dark:text-[#F4E9DA]">
                        {item.cmd}
                      </span>
                      {item.argsHint && (
                        <span className="font-mono text-[11px] text-[#C85A68] shrink-0 dark:text-[#EFA4B2]">
                          {item.argsHint}
                        </span>
                      )}
                      <span className="text-xs text-[#5C4D43] truncate dark:text-[#C5CDE3]">
                        {item.desc}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-[#F3ECE1] border border-[#E2D6C5] text-[10px] font-mono text-[#6E5D52] shrink-0 dark:bg-[#232B45] dark:border-[#364062] dark:text-[#B5BED6]">
                      {item.tag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 1: Composer Input with "/" Trigger & Embedded Send Button Inside */}
        {attachmentPreview}
        <form
          onSubmit={handleDesktopSubmit}
          className="guild-composer-glass flex items-end rounded-[1.75rem] border border-[#DFD3C3] dark:border-[#343D5E] pl-2 pr-1.5 py-1 focus-within:border-[#D9828B] dark:focus-within:border-[#7C86B8] gap-1.5"
        >
          {attachmentPicker}
          <textarea
            ref={composerRef}
            rows={1}
            value={promptInput}
            onChange={(e) => {
              setPromptInput(e.target.value);
              setSlashIndex(0);
              setSlashDismissed(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
                return;
              }
              if (slashOpen) {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSlashDismissed(true);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % matchingSlashCommands.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSlashIndex(
                    (i) =>
                      (i - 1 + matchingSlashCommands.length) %
                      matchingSlashCommands.length
                  );
                } else if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const chosen =
                    matchingSlashCommands[
                      slashIndex % matchingSlashCommands.length
                    ];
                  if (chosen) handleSelectSlashCommand(chosen);
                }
              }
            }}
            placeholder={t('workspace.composer.placeholder', { name: character.characterName })}
            className="min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder-[#A39284] dark:placeholder-[#7E89A8] placeholder:text-[13px] focus:outline-none pb-[5px] pt-[11px]"
          />
          {voiceButton}
          <ComposerActionButton
            running={Boolean(room.live && (!room.ready || room.status !== 'idle' || workingElapsed !== undefined))}
            hasDraft={Boolean(promptInput.trim() || hasAttachment)}
            blocked={blocked}
            pending={actionPending}
            role={room.modelId}
            onStop={() => onInterrupt(room.id)}
            title={sending ? t('workspace.sending') : blocked ?? t('workspace.send')}
          />
        </form>
        <p role="status" className={`min-h-4 px-1 text-[11px] ${actionError ? 'text-[#8D3F48] dark:text-[#F09AA6]' : actionMessage ? 'text-[#3F694A] dark:text-[#96C7A3]' : 'text-[#8C7A6E] dark:text-[#98A3C2]'}`}>{actionMessage ?? hint}</p>

        <ControlBar room={room} character={character} onCommand={onSendPrompt} settingsDisabled={!capabilities.settings}
          compact={{ disabled: !capabilities.compact, title: capabilities.reason ? `/compact · ${capabilities.reason}` : t('workspace.compact'), onRun: () => onRunCompact(room.id, false) }}
          terminal={{ open: terminalOpen, onToggle: onToggleTerminal }}
          shield={{ disabled: !room.live || actionPending, autoMode, onMode, onPermissions: () => onSendPrompt(room.id, '/permissions') }}
          cli={controls}
          quota={!hasResetVouchers(character) ? undefined : { label: '×' + character.hp5h.resetVouchers, title: quotaHint(character), onClick: () => onRedeemResetVoucher(character.id, room.id) }} />
      </div>

      {/* =====================================================================
          POP-UP MODAL 1: Approve / Reject & Full Unified Diff Pop-up
         ===================================================================== */}
      {activePopup === 'approve' && (
        <div
          onClick={() => setActivePopup('none')}
          className="fixed inset-0 z-50 bg-[#4A3E36]/40 backdrop-blur-xs flex items-center justify-center p-4 dark:bg-[#090C16]/68"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-h-[90dvh] overflow-y-auto max-w-2xl rounded-3xl bg-[#FBF8F3] border border-[#E2D6C5] shadow-2xl overflow-hidden dark:bg-[#171D31] dark:border-[#313958]"
          >
            <div className="px-4 py-3.5 sm:px-6 sm:py-4 bg-[#F5EFE6] border-b border-[#E5DAC9] flex items-center justify-between gap-2 dark:bg-[#1C233A] dark:border-[#2C3450]">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14.5px] sm:text-base font-bold leading-snug text-[#4A3E36] font-display dark:text-[#ECE7DF]">
                    {t('workspace.approval.title', { name: character.characterName, id: character.id })}
                  </h3>
                  <p className="truncate text-xs text-[#7D6D61] dark:text-[#A4AECC]">
                    {room.roomName} · {room.repoPath}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActivePopup('none')}
                className="w-8 h-8 shrink-0 rounded-full bg-white border border-[#E2D6C5] text-[#7D6D61] hover:text-[#4A3E36] flex items-center justify-center cursor-pointer dark:bg-[#232B45] dark:border-[#364062] dark:text-[#B5BED6] dark:hover:text-[#ECE7DF]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {room.pendingApproval ? (
                <>
                  <div>
                    <div className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
                      {room.pendingApproval.title}
                    </div>
                    <p className="mt-1 text-xs text-[#7D6D61] dark:text-[#A4AECC]">
                      {room.pendingApproval.reason}
                    </p>
                  </div>

                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[#4A3E36] bg-[#2B231F] p-3 font-mono text-xs text-[#DFD3C3]">{room.pendingApproval.commandOrFile}</pre>
                  {room.pendingApproval.diffLines.length > 0 && <div className="rounded-2xl overflow-hidden border border-[#E2D6C5] bg-[#362D28] font-mono text-xs">
                    <div className="px-3.5 py-2 bg-[#2B231F] border-b border-[#4A3E36] text-[#DFD3C3]">Diff</div>
                    <div className="p-3 space-y-1 max-h-60 overflow-y-auto">
                      {room.pendingApproval.diffLines.map((line, idx) => (
                        <div
                          key={idx}
                          className={`px-2.5 py-0.5 rounded flex items-center gap-3 ${
                            line.type === 'add'
                              ? 'bg-emerald-500/20 text-emerald-200'
                              : line.type === 'del'
                              ? 'bg-rose-500/20 text-rose-200'
                              : 'text-[#C8B7A6]'
                          }`}
                        >
                          <span className="w-6 text-right opacity-60 tabular-nums">
                            {line.lineNum}
                          </span>
                          <span className="w-3 font-bold">
                            {line.type === 'add'
                              ? '+'
                              : line.type === 'del'
                              ? '-'
                              : ' '}
                          </span>
                          <span className="whitespace-pre">{line.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>}

                  <div className="flex flex-wrap items-center gap-2.5 pt-2">
                    <GuildActionButton kind="approve" disabled={actionPending} onClick={() => onApprove(room.id, 'desktop')}>
                      {approving ? t('workspace.submitting') : t('workspace.approve')}
                    </GuildActionButton>
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => onReject(room.id, '', 'desktop')}
                      className="px-4 py-2 rounded-full bg-[#FCE8EB] hover:bg-[#F8D3D8] text-[#C85A68] border border-[#F3C6CD] font-semibold text-xs flex items-center gap-1.5 cursor-pointer dark:bg-[#3A2433] dark:hover:bg-[#46293C] dark:text-[#F4B4C2] dark:border-[#5C3245]"
                    >
                      <X className="w-4 h-4" />
                      <span>{t('workspace.reject')}</span>
                    </button>
                    {room.pendingApproval.additionalChoices?.map(choice => <button key={choice.id} type="button" disabled={actionPending}
                      onClick={() => onAdditionalApproval(room.id, choice.id)}
                      className="px-4 py-2 rounded-full bg-white border border-[#D8B17E] text-[#704A24] text-xs text-left dark:bg-[#2B241D] dark:border-[#785B38] dark:text-[#F0C882]">{approvalChoiceLabel(choice)}</button>)}
                  </div>
                  <RejectReason disabled={actionPending} onSubmit={reason => onReject(room.id, reason, 'desktop')} />

                </>
              ) : (
                <div className="py-6 text-center space-y-3">
                  <CheckCircle2 className="w-9 h-9 text-[#689B73] mx-auto dark:text-[#96BD9F]" />
                  <div className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
                    {t('workspace.approval.empty')}
                  </div>

                </div>
              )}
              {actionMessage && <p role="status" className={`text-xs ${actionError ? 'text-[#8D3F48] dark:text-[#F09AA6]' : 'text-[#3F694A] dark:text-[#96C7A3]'}`}>{actionMessage}</p>}
            </div>
          </div>
        </div>
      )}

      {worktreeCall && room.repoPath && <WorktreeLayer roomId={room.id} call={worktreeCall} />}
    </main>
  );
};

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" aria-label={copied ? t('workspace.copied') : label} title={copied ? t('workspace.copied') : label}
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8C7A6E] hover:bg-[#F3ECE1] dark:text-[#98A3C2] dark:hover:bg-[#27304D]">
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
