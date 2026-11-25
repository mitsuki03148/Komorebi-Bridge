import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from './i18n/useLang';
import { translateServerNotice } from './i18n/serverNotice';
import { localizeCharacters } from './i18n/characterName';
import {
  Settings2, QrCode, Sparkles, X,
  Minimize2, AlertTriangle, FlaskConical, Github, Cloud, Inbox as InboxIcon, Archive, TerminalSquare, Users, Copy, Crown, Pencil, ArrowRightLeft, LogOut, Plus, Search, ShieldCheck,
} from 'lucide-react';
import { GUILD_HALL_BANNER, GUILD_HALL_NIGHT_BANNER, INITIAL_CHARACTERS, quotaHint } from './data/initialGuildData';
import { useTheme } from './utils/theme';
import { roleAccent } from './utils/roleAccent';
import { applyOrder } from './utils/reorder';
import { groupRecipientId } from './utils/groupRecipient';
import { useDragReorder } from './utils/useDragReorder';
import { useGroupSwipe } from './utils/useGroupSwipe';
import { burstPetals } from './utils/petals';
import { GroupSwipeHint } from './components/GroupSwipeHint';
import { FileViewer, type FileVideo, type FileView } from './components/FileViewer';
import { GitHubPanel } from './components/github/GitHubPanel';
import { DrivePanel } from './components/drive/DrivePanel';
import { InboxPanel } from './components/InboxPanel';
import { displayName } from './brand';
import { WorktreeLayer } from './components/WorktreePanel';
import { GhClient } from './utils/ghClient';
import { GitHubOpenContext } from './utils/githubOpen';
import type { GhTarget } from './utils/githubUrl';
import { FileOpenContext } from './utils/fileOpen';
import { videoPath } from './utils/filePaths';
import { CLAUDE_USAGE_URL } from './data/cliCommands';
import type { CLIModelId, GroupChat, TerminalRoom } from './types/guild';
import type { ClientEvent, LaunchModes, FileTriggerItem } from './types/bridge';
import type { StorageUsage } from '../bridge/storage-usage';
import type { InboxAlertScan } from '../bridge/inbox-alerts';
import { PendingAges } from './utils/pendingAge';
import { PermissionButton } from './components/PermissionButton';
import { DaySeparator, MessageBubble } from './components/MessageBubble';
import { VoiceButton } from './components/VoiceButton';
import { appendDictation, createTranscriber, type Transcriber } from './utils/voice';
import { ControlBar } from './components/ControlBar';
import { benchWakeAsLine, bubbleRuns, isBenchDelivery } from './utils/bubbleRuns';
import { roomAutoMode } from './utils/launchMode';
import { LiveTerminal, LiveTerminalControls } from './components/LiveTerminal';
import { SlashCommandMenu } from './components/SlashCommandMenu';
import { AttachmentPicker } from './components/AttachmentPicker';
import { isImageAttachment, maxAttachments, maxFiles, readBlobBase64, requireFileUploadSupport, selectionCountIssue } from './utils/fileAttachments';
import { prepareFileUpload } from './utils/prepareFileUpload';
import { QuestionCard } from './components/QuestionCard';
import { ApprovalDiff } from './components/ApprovalDiff';
import { GroupChatView, GroupCreateModal } from './components/GroupChat';
import { GroupMemberRoleAction, GroupMemberRoleEditor } from './components/GroupMemberRoleEditor';
import { normalizeRoleDirection, type GroupRoleChoice } from './types/groupRoles';
import { beginRoleEditorSave, advanceRoleEditorSave, interruptRoleEditorSave, type RoleEditorSave } from './utils/roleEditorSave';
import { GroupBoardDialog, GroupBoardMenuItem } from './components/GroupBoardMenu';
import { FileTriggerDialog } from './components/FileTriggerDialog';
import { FileTriggerBanner } from './components/FileTriggerBanner';
import type { FileListing } from './components/FilePicker';
import { GroupRoomSidebar, type BenchFlow } from './components/GroupRoomSidebar';
import { prepareImage, type ImageSize } from './utils/prepareImage';
import { CopyTurnButton } from './components/CopyTurnButton';
import { ModelEffortPicker } from './components/ModelEffortPicker';
import { RejectReason } from './components/RejectReason';
import { EmptyRoomState } from './components/EmptyRoomState';
import { GuildHallHome, MobileGroupScrollDrawer } from './components/GuildHallHome';
import { ApprovalSeal, ComposerActionButton, GuildActionButton, ScrollToLatestButton } from './components/GuildActions';
import { useBridge } from './utils/useBridge';
import { LeftCharacterMenu } from './components/LeftCharacterMenu';
import { isRoomPinned, orderPinnedRooms, RoomPinAction, RoomPinBadge } from './components/RoomPin';
import { RightRoomWorkspace } from './components/RightRoomWorkspace';
import { WorkingIndicator, WorkingSpark } from './components/WorkingIndicator';
import { RoleCard } from './components/RoleCard';
import { usePushNotifications } from './utils/usePush';
import { Markdown } from './components/Markdown';
import { HistoryNote } from './components/HistoryNote';
import { useAutosize } from './utils/useAutosize';
import { RoomAlerts } from './components/RoomAlerts';
import { ImagePreviewProvider, MessageImages, useImagePreviews } from './components/ImagePreviews';
import { SettingsModal, TailscaleQrModal, restartConfirmOptions } from './components/SettingsModals';
import { beginRestartAttempt } from './utils/bridgeRestart';
import { useAwaitingReply, useNow, useRoomAttention, workState } from './utils/roomAttention';
import { mergeReadMarks, type ReadMarks } from './utils/attentionDiff';
import { CharacterSpriteAnimator } from './components/CharacterSpriteAnimator';
import { MoveRoomModal, NewRoomModal, RoomMoveAction, UsageCalibrationModal } from './components/GuildModals';
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog';
import { playGuildChime, unlockGuildAudio } from './utils/soundPlayer';
import { displayRoom } from './utils/transcriptText';
import { useConversationScroll } from './utils/useConversationScroll';
import { approvalChoiceConfirmation, approvalChoiceLabel } from './utils/approvalChoices';
import { focusScope } from './utils/focusScope';
import { atPromptOnlyBlock, composerBlock, composerHint, copyText, hasResetVouchers, readPreference, roomCapabilities, useEscape, writePreference } from './utils/roomUi';

type RoomAction = Extract<ClientEvent, { type: 'INPUT' | 'APPROVAL' }>;
type ActionFeedback = { type: RoomAction['type']; state: 'pending' | 'success' | 'error'; message: string };
export default function App() {
  return (
    <ConfirmProvider>
      <GuildApp />
    </ConfirmProvider>
  );
}

function GuildApp() {
  const { t, lang } = useT();
  const { isDark } = useTheme();
  const confirm = useConfirm();
  const [rawCharacters, setCharacters] = useState(INITIAL_CHARACTERS);
  const characters = useMemo(() => localizeCharacters(rawCharacters, lang), [rawCharacters, lang]);
  const [allRooms, setRooms] = useState<TerminalRoom[]>([]);
  const [archivedKeys, setArchivedKeys] = useState<string[]>([]);
  const [pinSupported, setPinSupported] = useState(false);
  // What the Founder has read, held by the Bridge so every device agrees; `ready` once it has said what it holds on this connection.
  const [readMarksSupported, setReadMarksSupported] = useState(false);
  const [sharedReadMarks, setSharedReadMarks] = useState<ReadMarks>({});
  const [readMarksReady, setReadMarksReady] = useState(false);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [protectedKeys, setProtectedKeys] = useState<string[]>([]);
  const [protectionSupported, setProtectionSupported] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveSupported, setArchiveSupported] = useState(false);
  const [deleteArchivedSupported, setDeleteArchivedSupported] = useState(false);
  const [idleCloseSupported, setIdleCloseSupported] = useState(false);
  const [selectedArchived, setSelectedArchived] = useState<string[]>([]);
  const [renameSupported, setRenameSupported] = useState(false);
  const [renameRoomId, setRenameRoomId] = useState<string | null>(null);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  /** Rooms taken over by another room (old → new, by session id or room id), and the room whose successor is being picked. */
  const [successors, setSuccessors] = useState<Record<string, string>>({});
  const [pickingSuccessor, setPickingSuccessor] = useState(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressingEl = useRef<HTMLElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const clearPressing = () => {
    clearTimeout(touchTimer.current);
    clearTimeout(pressHintTimer.current);
    if (pressingEl.current) { delete pressingEl.current.dataset.pressing; pressingEl.current = null; }
  };
  useEffect(() => () => clearPressing(), []);
  useEffect(() => {
    const resetTopScroll = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    const onFocusOut = () => setTimeout(resetTopScroll, 50);
    window.addEventListener('focusout', onFocusOut);
    return () => window.removeEventListener('focusout', onFocusOut);
  }, []);
  const isArchived = (room: TerminalRoom) => archivedKeys.includes(room.id) ||
    Boolean(room.sessionId && archivedKeys.includes(`session-${room.modelId.toLowerCase()}-${room.sessionId}`));
  const rooms = allRooms.filter(room => !isArchived(room));
  const awaiting = useAwaitingReply(allRooms);
  const archivedRooms = allRooms.filter(isArchived);
  const menuRoom = allRooms.find(room => room.id === menuRoomId);
  useEffect(() => { setPickingSuccessor(false); }, [menuRoomId]);
  const renameRoom = allRooms.find(room => room.id === renameRoomId);
  const roomIdFromTarget = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-room-id]')?.dataset.roomId : undefined;
  const roomActions = {
    onContextMenu: (event: React.MouseEvent) => {
      const id = roomIdFromTarget(event.target);
      if (!id) return;
      event.preventDefault();
      clearPressing();
      navigator.vibrate?.(16);
      setMenuRoomId(id);
    },
    onTouchStart: (event: React.TouchEvent) => {
      const targetEl = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-room-id]') : null;
      const id = targetEl?.dataset.roomId;
      if (!id || event.touches.length !== 1) return;
      longPressed.current = false;
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      clearPressing();
      pressHintTimer.current = setTimeout(() => {
        if (targetEl) { targetEl.dataset.pressing = 'true'; pressingEl.current = targetEl; }
      }, 100);
      touchTimer.current = setTimeout(() => {
        longPressed.current = true;
        clearPressing();
        navigator.vibrate?.(16);
        setMenuRoomId(id);
      }, 480);
    },
    onTouchMove: (event: React.TouchEvent) => {
      const start = touchStart.current;
      if (start && event.touches[0] && Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 10) {
        clearPressing();
      }
    },
    onTouchEnd: () => {
      clearPressing();
      touchStart.current = null;
    },
    onTouchCancel: () => {
      clearPressing();
      touchStart.current = null;
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (longPressed.current) {
        event.preventDefault();
        event.stopPropagation();
        longPressed.current = false;
      }
    },
  };
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [mobileRole, setMobileRole] = useState<CLIModelId | null>(null);
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [pickedRecipient, setPickedRecipient] = useState<{ groupId: string; roomId: string }>();
  const [groupsSupported, setGroupsSupported] = useState(false);
  const [groupBoardSupported, setGroupBoardSupported] = useState(false);
  const [inboxSupported, setInboxSupported] = useState(false);
  const [fileTriggersSupported, setFileTriggersSupported] = useState(false);
  const [fileTriggerGroupId, setFileTriggerGroupId] = useState<string>();
  const [fileTriggerItems, setFileTriggerItems] = useState<Record<string, FileTriggerItem[]>>({});
  const [fileTriggerHint, setFileTriggerHint] = useState<string>();
  const [fileTriggerIntegrity, setFileTriggerIntegrity] = useState<Record<string, { integrity: 'ok' | 'stale' | 'invalid'; stalePaths?: string[]; staleDigest?: string; staleHint?: string }>>({});
  const fileTriggerGroup = groups.find(group => group.id === fileTriggerGroupId);
  const editFileTriggers = (groupId: string) => {
    setGroupMenuId(null);
    setBoardBrowse(undefined);
    setFileTriggerGroupId(groupId);
    setFileTriggerHint(undefined);
    send({ type: 'FILE_TRIGGERS_GET', groupId });
  };
  const [restartSupported, setRestartSupported] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string>();
  const restartInstance = useRef<string | undefined>(undefined);
  const restartAttempt = useRef<ReturnType<typeof beginRestartAttempt> | undefined>(undefined);
  const restartConfirming = useRef(false);
  useEffect(() => () => { restartAttempt.current?.cancel(); }, []);
  const [groupMemberRolesSupported, setGroupMemberRolesSupported] = useState(false);
  const [roleDirectionSupported, setRoleDirectionSupported] = useState(false);
  const [roleEditor, setRoleEditor] = useState<{ groupId: string; roomId: string; pending?: string; pendingKind?: 'role' | 'direction'; error?: 'invalid' | 'missing' | 'repair' | 'failed' | 'conflict' }>();
  const roleSaveRef = useRef<RoleEditorSave | undefined>(undefined);
  const roleRequestId = () => globalThis.crypto?.randomUUID?.() ?? `role-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const editedGroup = groups.find(group => group.id === roleEditor?.groupId);
  const editedMember = editedGroup?.members.find(member => member.roomId === roleEditor?.roomId);
  // The crown is the lead's seat: it has its own direction and needs no role.
  const editedIsLead = Boolean(editedGroup && editedMember && editedGroup.orchestratorRoomId === editedMember.roomId);
  const editedRole = editedIsLead ? { key: 'orchestrator', label: t('group.memberRole.orchestrator'), ...(editedGroup?.orchestratorDirection ? { direction: editedGroup.orchestratorDirection } : {}) } : editedMember?.role;
  const editMemberRole = (groupId: string, roomId: string) => {
    setMenuRoomId(null);
    setRoleEditor({ groupId, roomId });
  };
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null);
  const groupMenu = groups.find(group => group.id === groupMenuId);
  useEscape(Boolean(groupMenuId), () => setGroupMenuId(null));
  const [boardEdit, setBoardEdit] = useState<{ groupId: string; fromMenu: boolean }>();
  const boardGroup = groups.find(group => group.id === boardEdit?.groupId);
  const [boardBrowse, setBoardBrowse] = useState<{ requestId: string; path: string; listing?: FileListing }>();
  const boardBrowseSeq = useRef(0);
  const editGroupBoard = (groupId: string, fromMenu: boolean) => {
    setBoardBrowse(undefined);
    setBoardEdit({ groupId, fromMenu });
    setGroupMenuId(null);
  };
  const browseBoardFolder = (path: string) => {
    const requestId = `board-${++boardBrowseSeq.current}`;
    const sent = send({ type: 'LIST_DIRS', path, files: true, requestId });
    setBoardBrowse({ requestId, path, listing: sent ? undefined : { path, parent: null, dirs: [], files: [], error: t('connection.unavailable') } });
  };
  useEffect(() => {
    if ((!boardEdit && !fileTriggerGroupId) || !boardBrowse || boardBrowse.listing) return;
    const timeout = setTimeout(() => {
      setBoardBrowse(current => current === boardBrowse ? { ...current, listing: { path: current.path, parent: null, dirs: [], files: [], error: t('connection.timeout') } } : current);
    }, 8_000);
    return () => clearTimeout(timeout);
  }, [boardEdit, fileTriggerGroupId, boardBrowse, t]);
  const groupTouch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const groupTouchStart = useRef<{ x: number; y: number } | null>(null);
  const groupLongPressed = useRef(false);
  useEffect(() => () => clearTimeout(groupTouch.current), []);
  const openGroupMenu = (id: string) => {
    setGroupDropdownOpen(false);
    setGroupMenuId(id);
  };
  const groupActions = {
    onContextMenu: (event: React.MouseEvent) => {
      const id = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-group-id]')?.dataset.groupId : undefined;
      if (!id) return;
      event.preventDefault();
      clearTimeout(groupTouch.current);
      openGroupMenu(id);
    },
    onTouchStart: (event: React.TouchEvent) => {
      const id = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-group-id]')?.dataset.groupId : undefined;
      if (!id || event.touches.length !== 1 || (event.target instanceof Element && event.target.closest('[data-drag-ignore]'))) return;
      groupLongPressed.current = false;
      groupTouchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      clearTimeout(groupTouch.current);
      groupTouch.current = setTimeout(() => { groupLongPressed.current = true; openGroupMenu(id); }, 600);
    },
    onTouchMove: (event: React.TouchEvent) => {
      const start = groupTouchStart.current, touch = event.touches[0];
      if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) clearTimeout(groupTouch.current);
    },
    onTouchEnd: () => { clearTimeout(groupTouch.current); groupTouchStart.current = null; },
    onTouchCancel: () => { clearTimeout(groupTouch.current); groupTouchStart.current = null; },
    onClickCapture: (event: React.MouseEvent) => {
      if (!groupLongPressed.current) return;
      groupLongPressed.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState<string>();
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!groupDropdownOpen) return;
    const pointer = (event: PointerEvent) => {
      if (groupDropdownOpen && !groupDropdownRef.current?.contains(event.target as Node)) setGroupDropdownOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGroupDropdownOpen(false);
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [groupDropdownOpen]);
  const [tailscaleUrl, setTailscaleUrl] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  /** Where a new room starts (Settings); an older Bridge does not send it. */
  const [defaultFolder, setDefaultFolder] = useState<string>();
  /** A file open in the reader: its path, then the text, video link or error. */
  const [readerFile, setReaderFile] = useState<{ path: string; file?: FileView; video?: FileVideo; error?: string }>();
  const [videoSupported, setVideoSupported] = useState(false);
  const [worktreeSupported, setWorktreeSupported] = useState(false);
  const openFile = Object.assign((path: string) => {
    const video = videoPath(path);
    if (video && !videoSupported) return;
    if (send(video ? { type: 'MEDIA_LINK', path } : { type: 'READ_FILE', path })) setReaderFile({ path });
  }, { videoSupported });
  const [folderListing, setFolderListing] = useState<{ path: string; parent: string | null; dirs: string[] }>();
  const [fixedRoomDirectorySupported, setFixedRoomDirectorySupported] = useState(false);
  const [agyAutoSupported, setAgyAutoSupported] = useState(false);
  const [roomLaunchOptionsSupported, setRoomLaunchOptionsSupported] = useState(false);
  const [launchModes, setLaunchModes] = useState<LaunchModes | null>(null);
  const [autoCompactSupported, setAutoCompactSupported] = useState(false);
  const [autoCompactAll, setAutoCompactAll] = useState<boolean | undefined>(undefined);
  const [transcribeSupported, setTranscribeSupported] = useState(false);
  const transcriberRef = useRef<Transcriber | undefined>(undefined);
  const ghRef = useRef<GhClient | undefined>(undefined);
  const driveRef = useRef<GhClient | undefined>(undefined);
  const inboxRef = useRef<GhClient | undefined>(undefined);
  const worktreeRef = useRef<GhClient | undefined>(undefined);
  const [driveOpen, setDriveOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxPendingFirst, setInboxPendingFirst] = useState(() => new URLSearchParams(location.search).get('inbox') === 'pending');
  const [inboxAlerts, setInboxAlerts] = useState<InboxAlertScan>();
  const pendingAges = useRef(new PendingAges());
  const [pendingSince, setPendingSince] = useState<Record<string, number>>({});
  const [ghOpen, setGhOpen] = useState(false);
  /** Where a GitHub link in a message pointed to; the panel opens there. */
  const [ghTarget, setGhTarget] = useState<GhTarget>();
  const openGitHubTarget = (target: GhTarget) => { setGhTarget(target); setGhOpen(true); };
  const [roomPresenceSupported, setRoomPresenceSupported] = useState(false);
  const [roomViewStartSupported, setRoomViewStartSupported] = useState(false);
  const [attachmentSupported, setAttachmentSupported] = useState(false);
  const [fileUploadSupported, setFileUploadSupported] = useState(false);
  const [terminalKeySupported, setTerminalKeySupported] = useState(false);
  const [questionAnswerSupported, setQuestionAnswerSupported] = useState(false);
  // Tickets that just went from one member of a group to another; each shows a heart for a couple of seconds.
  const [benchFlows, setBenchFlows] = useState<BenchFlow[]>([]);
  const [imagePreviewSupported, setImagePreviewSupported] = useState(false);
  const [historyPagingSupported, setHistoryPagingSupported] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string>();
  // A tapped notification opens its room: by a link on a cold start, or by a message from the service worker.
  const [roomToOpen, setRoomToOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('room'));
  const [terminalRoomId, setTerminalRoomId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Record<string, File[] | undefined>>({});
  const [attachmentSizes, setAttachmentSizes] = useState<Record<string, ImageSize>>({});
  const [preparingAttachment, setPreparingAttachment] = useState<string | null>(null);
  const [pairingInput, setPairingInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [newRoomModalOpen, setNewRoomModalOpen] = useState(false);
  const [newRoomModalModel, setNewRoomModalModel] = useState<CLIModelId>('AGY');
  const [usageModalOpen, setUsageModalOpen] = useState(false);
  const [streetMobileView, setStreetMobileView] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, ActionFeedback>>({});
  const actionSequence = useRef(0);
  const pendingActions = useRef(new Map<string, {
    id: string; type: RoomAction['type']; timer: ReturnType<typeof setTimeout>; accepted?: () => void;
  }>());
  const [soundEnabled, setSoundEnabledState] = useState(() => readPreference('komorebi-sound', true));
  const setSoundEnabled = (value: boolean) => { unlockGuildAudio(value); setSoundEnabledState(value); writePreference('komorebi-sound', value); };
  useEffect(() => {
    const unlock = () => unlockGuildAudio(soundEnabled);
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [soundEnabled]);
  const [toasts, setToasts] = useState<{ id: number; message: string; roomId?: string }[]>([]);
  const toastSeq = useRef(0);
  const [dismissedApprovals, setDismissedApprovals] = useState<string[]>([]);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [moveRoomTargetId, setMoveRoomTargetId] = useState<string | null>(null);
  const [movingRoom, setMovingRoom] = useState(false);
  const moveRoomTarget = allRooms.find(room => room.id === moveRoomTargetId);
  const [restoreRoomId, setRestoreRoomId] = useState<string | null>(null);

  /** A toast with a roomId can be tapped to open that room. */
  const showToast = (message: string, duration = 4_000, roomId?: string) => {
    const id = ++toastSeq.current;
    setToasts(current => [...current.filter(item => item.message !== message), { id, message, roomId }].slice(-3));
    setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), duration);
  };
  const upsert = (room: TerminalRoom) => {
    const visible = displayRoom(room);
    setPendingSince(pendingAges.current.update(visible));
    setRooms(current => current.some(item => item.id === visible.id) ? current.map(item => item.id === visible.id ? visible : item) : [visible, ...current]);
  };
  const changeDraft = (roomId: string, change: React.SetStateAction<string>) => {
    setDrafts(current => ({
      ...current, [roomId]: typeof change === 'function' ? change(current[roomId] ?? '') : change,
    }));
  };
  const finishAction = (roomId: string, ok: boolean, message: string) => {
    const pending = pendingActions.current.get(roomId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingActions.current.delete(roomId);
    const next: ActionFeedback = { type: pending.type, state: ok ? 'success' : 'error', message };
    if (!ok && pending.type === 'INPUT') awaiting.cancel(roomId);
    setFeedback(current => ({ ...current, [roomId]: next }));
    if (ok) {
      pending.accepted?.();
      setTimeout(() => setFeedback(current => {
        if (current[roomId] !== next) return current;
        const { [roomId]: _done, ...rest } = current;
        return rest;
      }), 4_000);
    }
  };

  const bridge = useBridge(event => {
    if (event.type === 'SNAPSHOT') {
      setPendingSince(pendingAges.current.reset(event.rooms));
      // A new connection starts from what the Bridge holds, so a report that was lost while offline is sent again.
      setReadMarksSupported(event.readMarksSupported === true);
      setSharedReadMarks({});
      setReadMarksReady(false);
      const oldAttempt = restartAttempt.current;
      if (oldAttempt?.observe(event.restartInstanceId)) {
        restartAttempt.current = undefined;
        setRestartPending(false);
        setRestartMessage(undefined);
        showToast(t('settings.restart.success'));
      }
      restartInstance.current = event.restartInstanceId;
      setRestartSupported(event.restartSupported === true && typeof event.restartInstanceId === 'string');
      setRooms(event.rooms.map(displayRoom));
      setArchivedKeys(event.archivedKeys ?? []);
      setPinSupported(event.pinSupported === true);
      setPinnedKeys(event.pinSupported === true ? event.pinnedKeys ?? [] : []);
      setProtectionSupported(Array.isArray(event.protectedKeys));
      setProtectedKeys(event.protectedKeys ?? []);
      setArchiveSupported(Array.isArray(event.archivedKeys));
      setDeleteArchivedSupported(event.deleteArchivedSupported === true);
      setIdleCloseSupported(event.idleCloseSupported === true);
      setWorkspaceRoot(event.workspaceRoot ?? '');
      setDefaultFolder(event.defaultFolder);
      setFixedRoomDirectorySupported(event.fixedRoomDirectorySupported === true);
      setAgyAutoSupported(event.agyAutoSupported === true);
      setRoomLaunchOptionsSupported(event.roomLaunchOptionsSupported === true);
      setLaunchModes(event.launchModesSupported === true && event.launchModes ? event.launchModes : null);
      setAutoCompactSupported(event.autoCompactSupported === true);
      setAutoCompactAll(typeof event.autoCompactAll === 'boolean' ? event.autoCompactAll : undefined);
      setTranscribeSupported(event.transcribeSupported === true);
      setRoomPresenceSupported(event.roomPresenceSupported === true);
      setRoomViewStartSupported(event.roomViewStartSupported === true);
      setAttachmentSupported(event.attachmentSupported === true);
      setFileUploadSupported(event.fileUploadSupported === true);
      setTerminalKeySupported(event.terminalKeySupported === true);
      setQuestionAnswerSupported(event.questionAnswerSupported === true);
      setImagePreviewSupported(event.imagePreviewSupported === true);
      setVideoSupported(event.videoSupported === true);
      setWorktreeSupported(event.worktreeSupported === true);
      setHistoryPagingSupported(event.historyPagingSupported === true);
      setPushPublicKey(event.pushPublicKey);
      setGroups(event.groups ?? []);
      setSuccessors(event.successors ?? {});
      setGroupsSupported(Array.isArray(event.groups));
      setGroupBoardSupported(event.groupBoardSupported === true);
      setInboxSupported(event.inboxSupported === true);
      if (!event.inboxSupported) setInboxAlerts(undefined);
      setFileTriggersSupported(event.fileTriggersSupported === true);
      setGroupMemberRolesSupported(event.groupMemberRolesSupported === true);
      setRoleDirectionSupported(event.roleDirectionSupported === true);
      if (event.groupMemberRolesNeedRepair) showToast(t('group.memberRole.repair'), 10_000);
      setRenameSupported(event.renameSupported === true);
      setCharacters(event.characters);
      setTailscaleUrl(event.tailscaleUrl);
      setPairingInput('');
    } else if (event.type === 'FILE_TRIGGERS_STATE') {
      setFileTriggerItems(current => ({ ...current, [event.groupId]: event.items }));
      setFileTriggerHint(event.confirmationHint);
      setFileTriggerIntegrity(current => ({ ...current, [event.groupId]: { integrity: event.integrity ?? 'ok', stalePaths: event.stalePaths, staleDigest: event.staleDigest, staleHint: event.staleHint } }));
    } else if (event.type === 'PINS') {
      setPinnedKeys(event.pinnedKeys);
    } else if (event.type === 'PROTECTED_ROOMS') {
      setProtectedKeys(event.protectedKeys);
    } else if (event.type === 'STORAGE_USAGE') {
      setStorageUsage(event.data);
    } else if (event.type === 'GROUP') {
      setGroups(current => current.some(group => group.id === event.group.id) ? current.map(group => group.id === event.group.id ? event.group : group) : [...current, event.group]);
      if (event.select) {
        setSelectedGroupId(event.group.id);
        setSelectedRoomId('');
        setGroupCreating(false);
        setGroupCreateOpen(false);
      }
    } else if (event.type === 'SUCCESSORS') {
      setSuccessors(event.successors);
    } else if (event.type === 'DEFAULT_FOLDER') {
      setDefaultFolder(event.path);
    } else if (event.type === 'FILE') {
      setReaderFile(current => current?.path === event.path
        ? { path: event.path, ...(event.error ? { error: event.error } : { file: { text: event.text ?? '', truncated: event.truncated === true, size: event.size ?? 0 } }) }
        : current);
    } else if (event.type === 'MEDIA_LINK_RESULT') {
      setReaderFile(current => current?.path === event.path ? { path: event.path, ...('error' in event
        ? { error: event.error }
        : /^\/media\/[a-f0-9]{32}$/.test(event.url)
          ? { video: { url: event.url, expiresAt: event.expiresAt } }
          : { error: t('file.video.failed') }) } : current);
    } else if (event.type === 'DIRS') {
      if (event.files !== undefined) {
        const listing: FileListing = { path: event.path, parent: event.parent, dirs: event.dirs, files: event.files, error: event.error };
        setBoardBrowse(current => current && current.requestId === event.requestId ? { ...current, listing } : current);
      } else setFolderListing({ path: event.path, parent: event.parent, dirs: event.dirs });
    } else if (event.type === 'READ_MARKS') {
      setSharedReadMarks(current => mergeReadMarks(current, event.marks));
      setReadMarksReady(true);
    } else if (event.type === 'GROUPS_ORDER') {
      setGroups(current => applyOrder(current, event.groupIds));
    } else if (event.type === 'BRIDGE_RESTART_NOTICE') {
      showToast(t('settings.restart.notice'));
    } else if (event.type === 'BRIDGE_RESTART_RESULT') {
      if (!event.ok && restartAttempt.current) {
        restartAttempt.current.cancel();
        restartAttempt.current = undefined;
        setRestartPending(false);
        const message = t(`settings.restart.${event.code}`);
        setRestartMessage(message);
        showToast(message, 7_000);
      }
    } else if (event.type === 'GROUP_MEMBER_ROLE_RESULT') {
      const current = roleSaveRef.current;
      if (current?.status === 'pending' && current.event.requestId === event.requestId) {
        const next = advanceRoleEditorSave(current, event, roleRequestId());
        roleSaveRef.current = next;
        if (next.status === 'pending') {
          if (bridge.send(next.event)) {
            setRoleEditor(editor => editor && editor.groupId === next.groupId && editor.roomId === next.roomId
              ? { ...editor, pending: next.event.requestId, pendingKind: 'direction', error: undefined } : editor);
          } else {
            roleSaveRef.current = interruptRoleEditorSave(next);
            setRoleEditor(editor => editor && editor.groupId === next.groupId && editor.roomId === next.roomId
              ? { ...editor, pending: undefined, pendingKind: undefined, error: 'failed' } : editor);
          }
        } else if (next.status === 'done') {
          roleSaveRef.current = undefined;
          setRoleEditor(editor => editor && editor.groupId === next.groupId && editor.roomId === next.roomId ? undefined : editor);
          showToast(t('group.memberRole.saved'));
        } else {
          setRoleEditor(editor => editor && editor.groupId === next.groupId && editor.roomId === next.roomId
            ? { ...editor, pending: undefined, pendingKind: undefined, error: event.ok ? 'failed' : event.code } : editor);
        }
      }
    } else if (event.type === 'GROUP_MEMBER_ROLE_WARNING') {
      showToast(t('group.memberRole.conflict'));
    } else if (event.type === 'GROUP_REMOVED') {
      setGroups(current => current.filter(group => group.id !== event.groupId));
      setSelectedGroupId(current => current === event.groupId ? null : current);
      setGroupMenuId(current => current === event.groupId ? null : current);
      setBoardEdit(current => current?.groupId === event.groupId ? undefined : current);
      showToast(t('group.deleted'));
    } else if (event.type === 'IDLE_ROOMS_RESULT') {
      const { candidates, busy, tickets } = event;
      if (!candidates.length) {
        showToast(t('idle.none', { busy, tickets }));
      } else {
        const names = candidates.map(room => room.name).join('、');
        void confirm({
          title: t('idle.confirm.title'),
          message: t('idle.confirm', { count: candidates.length, names, busy, tickets }),
          confirmLabel: t('idle.confirm.action'),
        }).then(ok => { if (ok) send({ type: 'CLOSE_IDLE', roomIds: candidates.map(room => room.roomId) }); });
      }
    } else if (event.type === 'CLOSE_IDLE_RESULT') {
      showToast(t('idle.result', { closed: event.closed.length, skipped: event.skipped.length }));
    } else if (event.type === 'ARCHIVED') {
      setArchiveSupported(true);
      setArchivedKeys(event.archivedKeys);
    } else if (event.type === 'MOVE_ROOM_RESULT') {
      setMovingRoom(false);
      if (event.ok) {
        setMoveRoomTargetId(null);
        if (event.roomId && event.newRoomId) {
          setSelectedRoomId(current => current === event.roomId ? event.newRoomId! : current);
          setPickedRecipient(current => current && current.roomId === event.roomId ? { groupId: current.groupId, roomId: event.newRoomId! } : current);
        }
      }
    } else if (event.type === 'ROOM') {
      upsert(event.room);
      if (event.select) {
        setSelectedGroupId(null);
        setSelectedRoomId(event.room.id);
        setMobileRole(event.room.modelId);
        setNewRoomModalOpen(false);
        setCreatingRoom(false);
      }
    } else if (event.type === 'SYNC_UPDATE') {
      setCharacters(current => ({ ...current, [event.character.id]: event.character }));
      if (event.room) upsert(event.room);
    } else if (event.type === 'BENCH_FLOW') {
      const flow: BenchFlow = { id: event.ticket, from: event.fromRoomId, to: event.toRoomId, kind: event.kind };
      setBenchFlows(current => [...current.filter(item => !(item.id === flow.id && item.kind === flow.kind)), flow]);
      setTimeout(() => setBenchFlows(current => current.filter(item => item !== flow)), 2400);
    } else if (event.type === 'ROOM_REMOVED') {
      setPendingSince(pendingAges.current.remove(event.roomId));
      setRooms(current => current.filter(room => room.id !== event.roomId));
      setSelectedArchived(current => current.filter(id => id !== event.roomId));
      const replacement = event.replacementRoomId;
      if (replacement) {
        setSelectedRoomId(current => current === event.roomId ? replacement : current);
        setPickedRecipient(current => current?.roomId === event.roomId ? { ...current, roomId: replacement } : current);
      }
    } else if (event.type === 'ATTENTION') {
      showToast(translateServerNotice(event.message, t), 12_000, event.roomId);
      playGuildChime('approve', soundEnabled);
    } else if (event.type === 'GH_RESULT') {
      ghRef.current?.handle(event);
    } else if (event.type === 'INBOX_RESULT') {
      inboxRef.current?.handle(event);
    } else if (event.type === 'INBOX_ALERTS') {
      setInboxAlerts(event.data);
    } else if (event.type === 'WORKTREE_RESULT') {
      worktreeRef.current?.handle(event);
    } else if (event.type === 'DRIVE_RESULT') {
      driveRef.current?.handle(event);
    } else if (event.type === 'TRANSCRIBE_RESULT') {
      transcriberRef.current?.receive(event);
    } else if (event.type === 'LAUNCH_MODES') {
      setLaunchModes(event.launchModes);
    } else if (event.type === 'AUTO_COMPACT_ALL') {
      setAutoCompactAll(event.enabled);
    } else if (event.type === 'PUSH_RESULT') {
      pushControl.receive(event);
    } else if (event.type === 'IMAGE_PREVIEW') {
      imagePreviews.receive(event);
    } else if (event.type === 'ACTION_RESULT') {
      const match = [...pendingActions.current].find(([, action]) => action.id === event.requestId);
      if (match) finishAction(match[0], event.ok, event.message);
    } else if (event.type === 'NETWORK') setTailscaleUrl(event.tailscaleUrl);
    else if (event.type === 'NOTICE' || event.type === 'ERROR') {
      const displayMessage = translateServerNotice(event.message, t);
      if (event.type === 'ERROR') {
        if (groupCreating) setGroupCreateError(displayMessage);
        setGroupCreating(false);
        setCreatingRoom(false);
      }
      showToast(displayMessage, event.type === 'ERROR' ? 7_000 : 4_000);
    }
  });
  const imagePreviews = useImagePreviews(imagePreviewSupported, event => bridge.send(event));
  const pushControl = usePushNotifications(pushPublicKey, bridge.send, bridge.state === 'connected');
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'komorebi-open-room' && typeof event.data.roomId === 'string') setRoomToOpen(event.data.roomId);
      if (event.data?.type === 'komorebi-open-inbox') { setInboxPendingFirst(true); setInboxOpen(true); }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => { if (inboxPendingFirst) setInboxOpen(true); }, [inboxPendingFirst]);
  useEffect(() => {
    if (bridge.state === 'connected') return;
    if (roleSaveRef.current) roleSaveRef.current = interruptRoleEditorSave(roleSaveRef.current);
    setRoleEditor(current => current?.pending ? { ...current, pending: undefined, pendingKind: undefined, error: 'failed' } : current);
    setGroupCreating(false);
    setCreatingRoom(false);
    for (const roomId of pendingActions.current.keys()) {
      finishAction(roomId, false, t('connection.unconfirmed'));
    }
  }, [bridge.state]);

  const send = (event: ClientEvent) => {
    if (bridge.state === 'connected' && bridge.send(event)) return true;
    showToast(t('connection.unavailable'));
    return false;
  };
  /** The lead's old role (such as 統括) comes off in one tap; its direction moves to the lead's seat on the Bridge. */
  const clearLeadRole = () => {
    if (!groupMemberRolesSupported || !roleEditor || roleEditor.pending || roleSaveRef.current?.status === 'pending' || !editedMember?.role) return;
    const { groupId, roomId } = roleEditor;
    const next = beginRoleEditorSave({ groupId, roomId, currentRole: editedMember.role, choice: null, directionSupported: false }, roleRequestId());
    roleSaveRef.current = next;
    if (next.status !== 'pending') { roleSaveRef.current = undefined; return; }
    if (send(next.event)) setRoleEditor({ groupId, roomId, pending: next.event.requestId, pendingKind: 'role' });
    else { roleSaveRef.current = interruptRoleEditorSave(next); setRoleEditor({ groupId, roomId, error: 'failed' }); }
  };
  const saveMemberRole = (role: GroupRoleChoice, direction?: string) => {
    if (!groupMemberRolesSupported || !roleEditor || roleEditor.pending || roleSaveRef.current?.status === 'pending' || !editedMember) return;
    const { groupId, roomId } = roleEditor;
    if (editedIsLead) {
      const normalized = normalizeRoleDirection(direction ?? '');
      if (normalized === undefined) { setRoleEditor({ groupId, roomId, error: 'invalid' }); return; }
      if (normalized === (editedGroup?.orchestratorDirection ?? '')) { setRoleEditor(undefined); return; }
      const lead: RoleEditorSave = { status: 'pending', groupId, roomId, choice: null, direction: normalized, target: null, roleSaved: false, nextDirection: false,
        event: { type: 'GROUP_SET_ORCHESTRATOR_DIRECTION', groupId, direction: normalized, requestId: roleRequestId() } };
      roleSaveRef.current = lead;
      if (send(lead.event)) setRoleEditor({ groupId, roomId, pending: lead.event.requestId, pendingKind: 'direction' });
      else { roleSaveRef.current = interruptRoleEditorSave(lead); setRoleEditor({ groupId, roomId, error: 'failed' }); }
      return;
    }
    const next = beginRoleEditorSave({ groupId, roomId, currentRole: editedMember.role, choice: role, direction, directionSupported: roleDirectionSupported }, roleRequestId());
    roleSaveRef.current = next;
    if (next.status === 'done') { roleSaveRef.current = undefined; setRoleEditor(undefined); return; }
    if (next.status === 'error') { setRoleEditor({ groupId, roomId, error: 'invalid' }); return; }
    if (send(next.event)) setRoleEditor({ groupId, roomId, pending: next.event.requestId, pendingKind: next.event.type === 'GROUP_SET_MEMBER_ROLE' ? 'role' : 'direction' });
    else { roleSaveRef.current = interruptRoleEditorSave(next); setRoleEditor({ groupId, roomId, error: 'failed' }); }
  };
  // Hold a group and drag it to a new spot. The same order is shown on every list.
  const suppressNextGroupClick = () => { groupLongPressed.current = true; setTimeout(() => { groupLongPressed.current = false; }, 400); };
  const { dragProps: groupDrag, draggingId: draggingGroupId, dragOffsetY: groupDragOffsetY } = useDragReorder({
    ids: groups.map(group => group.id),
    enabled: groupDropdownOpen,
    onPreview: ids => setGroups(current => applyOrder(current, ids)),
    onDrop: (ids, changed) => { suppressNextGroupClick(); if (changed) send({ type: 'GROUP_REORDER', groupIds: ids }); },
    onHold: id => { suppressNextGroupClick(); openGroupMenu(id); },
    onLift: () => { clearTimeout(groupTouch.current); try { navigator.vibrate?.(10); } catch { /* ignore */ } },
  });
  const draggingRow = (id: string) => {
    if (draggingGroupId === id) {
      return ' relative z-30 bg-white/95 dark:bg-[#2A3359]/95 shadow-[0_14px_30px_-8px_rgba(74,62,54,0.34),0_4px_10px_-2px_rgba(74,62,54,0.14)] dark:shadow-[0_16px_34px_-8px_rgba(0,0,0,0.72)] ring-1 ring-[#D9828B]/50 dark:ring-[#9AA3D6]/55';
    }
    return draggingGroupId ? ' opacity-75 transition-[transform,opacity] duration-150 ease-out' : '';
  };
  // Recordings go to the Mac to be written out as text; if the connection drops, anything waiting is told.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  // The GitHub panel asks the Mac for GitHub data; if the connection drops, anything waiting is told.
  if (!ghRef.current) ghRef.current = new GhClient(event => bridgeRef.current.state === 'connected' && bridgeRef.current.send(event));
  if (!driveRef.current) driveRef.current = new GhClient(event => bridgeRef.current.state === 'connected' && bridgeRef.current.send(event), 90_000, 'DRIVE');
  if (!inboxRef.current) inboxRef.current = new GhClient(event => bridgeRef.current.state === 'connected' && bridgeRef.current.send(event), 30_000, 'INBOX');
  if (!worktreeRef.current) worktreeRef.current = new GhClient(event => bridgeRef.current.state === 'connected' && bridgeRef.current.send(event), 30_000, 'WORKTREE');
  useEffect(() => { if (bridge.state !== 'connected') { ghRef.current?.rejectAll(t('connection.retry')); driveRef.current?.rejectAll(t('connection.retry')); inboxRef.current?.rejectAll(t('connection.retry')); worktreeRef.current?.rejectAll(t('connection.retry')); } }, [bridge.state]);
  if (!transcriberRef.current) transcriberRef.current = createTranscriber(event => bridgeRef.current.state === 'connected' && bridgeRef.current.send(event));
  const transcriber = transcriberRef.current;
  useEffect(() => { if (bridge.state !== 'connected') transcriber.fail(); }, [bridge.state]);
  const interrupt = (roomId: string) => { awaiting.cancel(roomId); send({ type: 'INTERRUPT', roomId }); };
  const sendAction = (event: RoomAction, accepted?: () => void, encodedUpload?: string) => {
    const roomId = event.roomId;
    if (pendingActions.current.has(roomId)) return;
    const id = String(++actionSequence.current);
    const sent = event.type === 'INPUT' && encodedUpload
      ? bridgeRef.current.sendFiles({ ...event, requestId: id }, encodedUpload)
      : send({ ...event, requestId: id }) ? 'sent' : 'unavailable';
    if (sent !== 'sent') {
      const message = sent === 'unsupported' ? t('attachment.files.bridge') : t('connection.unavailable');
      if (encodedUpload) showToast(message);
      setFeedback(current => ({ ...current, [roomId]: { type: event.type, state: 'error', message } }));
      return;
    }
    // A natural-language prompt shows the bloom from the moment it is sent until a reply arrives.
    const room = allRooms.find(item => item.id === roomId);
    if (event.type === 'INPUT' && room && !/^\s*(?:\/|[1-9yn]\s*$)/i.test(event.text)) awaiting.start(room);
    const timer = setTimeout(() => finishAction(roomId, false, t('connection.timeout')), 35_000);
    pendingActions.current.set(roomId, { id, type: event.type, timer, accepted });
    setFeedback(current => ({
      ...current,
      [roomId]: { type: event.type, state: 'pending', message: event.type === 'APPROVAL' ? t('approval.submitting') : t('connection.awaiting') },
    }));
  };
  const deleteArchived = async (ids: string[]) => {
    if (!deleteArchivedSupported) {
      showToast(t('archive.restart'));
      return;
    }
    if (!ids.length) return;
    const ok = await confirm({
      title: t('confirm.title.archive'),
      message: t('archive.confirm', { count: ids.length }),
      confirmLabel: t('confirm.action.delete'),
      tone: 'danger',
    });
    if (ok && send({ type: 'DELETE_ARCHIVED', roomIds: ids })) setSelectedArchived([]);
  };
  const selectedRoom = rooms.find(room => room.id === selectedRoomId);
  // Older messages are asked for one room at a time; an older Bridge cannot, so no loader is offered.
  const loadHistory = historyPagingSupported ? (roomIds: string[]) => { for (const roomId of roomIds) bridge.send({ type: 'HISTORY_MORE', roomId }); } : undefined;
  const mobileScroll = useConversationScroll(streetMobileView ? selectedRoom?.id : undefined, selectedRoom?.logs.map(entry => `${entry.id}:${entry.text.length}`).join('|') ?? '', selectedRoom?.logs[0]?.id, selectedRoom?.logs.at(-1));
  const selectedGroup = groups.find(group => group.id === selectedGroupId);
  const autoCompactRoom = selectedGroup ? allRooms.find(room => room.id === selectedGroup.orchestratorRoomId) : selectedRoom;
  // On the phone, pull the group view sideways and hold to preview another group; letting go over the line switches (see utils/groupSwipe.ts).
  const groupSwipe = useGroupSwipe({
    enabled: streetMobileView,
    ids: groups.map(group => group.id),
    currentId: selectedGroup?.id,
    onSwitch: id => { const group = groups.find(item => item.id === id); if (group) selectGroup(group); },
  });
  /** Takes a room out of a group; the last member cannot leave an empty group behind, so that asks to delete the group instead. */
  const removeFromGroup = async (group: GroupChat, roomId: string): Promise<boolean> => {
    const room = allRooms.find(item => item.id === roomId);
    if (group.members.length <= 1) {
      const ok = await confirm({
        title: t('confirm.title.group.delete'),
        message: t('group.remove.last.confirm', { room: room?.roomName ?? t('room.this'), group: group.name }),
        confirmLabel: t('confirm.action.delete'),
        tone: 'danger',
      });
      if (!ok) return false;
      return send({ type: 'GROUP_DELETE', groupId: group.id });
    }
    const ok = await confirm({
      title: t('confirm.title.group.remove'),
      message: t('group.remove.confirm', { room: room?.roomName ?? t('room.this') }),
      confirmLabel: t('confirm.action.remove'),
      tone: 'danger',
    });
    if (!ok) return false;
    return send({ type: 'GROUP_REMOVE_MEMBER', groupId: group.id, roomId });
  };
  // A room opened from a group's member list is handled as a member of it: it leaves the group, it is not archived.
  const menuGroup = menuRoom ? groups.find(group => group.id === selectedGroupId && group.members.some(member => member.roomId === menuRoom.id)) : undefined;
  // A group opens addressed to its orchestrator; picking another member holds until the user goes into a different group.
  const pickedRecipientId = pickedRecipient && pickedRecipient.groupId === selectedGroup?.id ? pickedRecipient.roomId : null;
  const groupRecipient = groupRecipientId(selectedGroup, pickedRecipientId);
  const setGroupRecipientId = (roomId: string) => {
    if (selectedGroup) setPickedRecipient({ groupId: selectedGroup.id, roomId });
  };
  const wakeGroupMember = (roomId: string) => {
    if (!selectedGroup) return;
    setGroupRecipientId(roomId);
    if (bridge.state === 'connected' && roomPresenceSupported) {
      bridge.send({ type: 'VIEW_GROUP', groupId: selectedGroup.id, selectedRoomId: roomId, wakeSelected: true });
    }
  };
  // Fetch the active group state even when settings are closed; subsequent changes arrive by broadcast.
  useEffect(() => {
    if (selectedGroup?.id && fileTriggersSupported && bridge.state === 'connected') {
      bridge.send({ type: 'FILE_TRIGGERS_GET', groupId: selectedGroup.id });
    }
  }, [selectedGroup?.id, fileTriggersSupported, bridge.state, bridge.send]);
  // Establish the group visit before its member buttons can be activated.
  useLayoutEffect(() => {
    if (bridge.state === 'connected' && roomPresenceSupported) {
      if (selectedGroup) bridge.send({ type: 'VIEW_GROUP', groupId: selectedGroup.id, selectedRoomId: groupRecipient });
    }
  }, [bridge.state, bridge.send, roomPresenceSupported, selectedGroup?.id, groupRecipient]);
  useEffect(() => {
    if (!selectedGroup && bridge.state === 'connected' && roomPresenceSupported) {
      bridge.send({ type: 'VIEW_ROOM', roomId: selectedRoom?.id ?? null });
    }
  }, [bridge.state, bridge.send, roomPresenceSupported, selectedRoom?.id, selectedGroup?.id]);
  const selectedCharacter = characters[selectedRoom?.modelId ?? mobileRole ?? 'AGY'];
  const mobileInput = selectedRoom ? drafts[selectedRoom.id] ?? '' : '';
  const mobileComposerRef = useAutosize(mobileInput);
  const roomFeedback = selectedRoom ? feedback[selectedRoom.id] : undefined;
  const actionPending = roomFeedback?.state === 'pending' || preparingAttachment === selectedRoom?.id;
  // A send that the Bridge takes at once leaves no status line behind: "waiting" shows only after 400ms, and a plain send's success never does.
  // The same rule serves a single room and every member of a group.
  const pendingRoomKey = Object.keys(feedback).filter(id => feedback[id]?.state === 'pending').sort().join(',');
  const [slowRooms, setSlowRooms] = useState<Record<string, true>>({});
  useEffect(() => {
    const ids = pendingRoomKey ? pendingRoomKey.split(',') : [];
    setSlowRooms(current => Object.fromEntries(Object.entries(current).filter(([id]) => ids.includes(id))));
    const timers = ids.map(id => setTimeout(() => setSlowRooms(current => ({ ...current, [id]: true })), 400));
    return () => timers.forEach(clearTimeout);
  }, [pendingRoomKey]);
  const visibleFeedback = (roomId: string) => {
    const item = feedback[roomId];
    const raw = item && (item.state === 'error' || (item.state === 'pending' && slowRooms[roomId]) || (item.state === 'success' && item.type !== 'INPUT')) ? item.message : undefined;
    return raw ? translateServerNotice(raw, t) : undefined;
  };
  const feedbackMessage = selectedRoom ? visibleFeedback(selectedRoom.id) : undefined;
  const mobileBlocked = selectedRoom ? composerBlock(selectedRoom) : undefined;
  const mobileHint = selectedRoom ? composerHint(selectedRoom) : undefined;
  const mobileCapabilities = selectedRoom ? roomCapabilities(selectedRoom, actionPending) : undefined;
  const attachmentControl = (mode: 'button' | 'preview', roomId = selectedRoom?.id) => roomId && <AttachmentPicker mode={mode} files={attachments[roomId] ?? []} supported={attachmentSupported}
    fileUploadSupported={fileUploadSupported} preparing={preparingAttachment === roomId}
    size={attachmentSizes[roomId] ?? 'medium'} onSize={size => setAttachmentSizes(current => ({ ...current, [roomId]: size }))}
    disabled={feedback[roomId]?.state === 'pending' || preparingAttachment === roomId} onError={showToast} onChange={files => setAttachments(current => ({ ...current, [roomId]: files.length ? files : undefined }))} />;
  const voiceControl = (roomId = selectedRoom?.id) => {
    if (!roomId) return undefined;
    const targetRoom = rooms.find(item => item.id === roomId) ?? selectedRoom;
    return <VoiceButton supported={transcribeSupported} transcriber={transcriber} role={targetRoom?.modelId}
      disabled={feedback[roomId]?.state === 'pending'} onText={text => changeDraft(roomId, current => appendDictation(current, text))} onError={message => showToast(message)} />;
  };
  const selectRoom = (roomId: string) => {
    const room = rooms.find(item => item.id === roomId);
    if (!room) return;
    setSelectedGroupId(null);
    setSelectedRoomId(room.id);
    setMobileRole(room.modelId);
    if (roomViewStartSupported) {
      send({ type: 'VIEW_ROOM', roomId: room.id, open: true });
      return;
    }
    if (room.live) return;
    if (!room.repoPath || (room.sessionId && !room.resumable)) {
      showToast(t('room.agy.directory'));
      return;
    }
    send({ type: 'START', roomId: room.id });
  };
  const pendingCount = allRooms.reduce((count, room) => count + Number(Boolean(room.pendingApproval)) + Number(Boolean(room.pendingQuestion)), 0) + (inboxAlerts?.alerts.length ?? 0);
  useEffect(() => {
    if (!roomToOpen || !rooms.some(room => room.id === roomToOpen)) return;
    selectRoom(roomToOpen);
    setRoomToOpen(null);
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, [roomToOpen, rooms]);
  useEffect(() => {
    // Restore through the normal room-entry flow once the Bridge confirms it is no longer archived.
    if (restoreRoomId && rooms.some(room => room.id === restoreRoomId)) {
      setRestoreRoomId(null);
      selectRoom(restoreRoomId);
    }
  }, [restoreRoomId, rooms]);
  const selectGroup = (group: GroupChat) => {
    if (group.id !== selectedGroupId) setPickedRecipient(undefined);
    setSelectedGroupId(group.id);
    setSelectedRoomId('');
    setGroupDropdownOpen(false);
  };
  /** A Codex, Claude or AGY room with a question open is answered inside the CLI; any other room just gets a message. */
  const answerQuestionDirectly = (roomId: string, detail?: { choice?: number; choices?: number[]; text?: string; answers?: { choice?: number; choices?: number[]; text?: string }[] }) => {
    const target = allRooms.find(item => item.id === roomId);
    // One question, with listed answers or only a box to type in.
    const single = target?.pendingQuestion?.questions.length === 1;
    // Codex keeps the question in its own answer screen; Claude (screen-reader mode) and AGY show a numbered question list.
    const queued = Boolean(target && !target.ready && (target.modelId === 'CLAUDE'
      ? /Select with numbers \[1-\d+\]\. Then Enter to submit or Escape to cancel:/.test((target.screen ?? '').split('\n').slice(-16).join('\n'))
      : target.modelId === 'AGY'
        ? /Question\s+\d+\/\d+:[\s\S]*(?:↑\/↓ Navigate\s*·[^\n]*\besc Skip\b|\benter Submit\s*·\s*esc Back\b)/i.test(target.screen ?? '')
        : /⇧←\s*to answer|enter submit/.test(target.screen ?? '')));
    // Claude and AGY take a card with several questions: all answers go in one event, so the CLI never holds a half-answered set.
    const several = (target?.modelId === 'CLAUDE' || target?.modelId === 'AGY') &&
      (target.pendingQuestion?.questions.length ?? 0) > 1 &&
      detail?.answers?.length === target.pendingQuestion!.questions.length;
    if (!questionAnswerSupported || (target?.modelId !== 'CODEX' && target?.modelId !== 'CLAUDE' && target?.modelId !== 'AGY') || !(single || several) || !queued || !detail) return false;
    // The answer names the question the person was looking at, so a late answer never lands on the next one.
    return send({ type: 'ANSWER_QUESTION', roomId, questionId: target.pendingQuestion!.id, ...detail });
  };
  const handleSendPrompt = (roomId: string, text: string, _fromMobile?: boolean, accepted?: () => void, groupId?: string) => {
    const room = allRooms.find(room => room.id === roomId);
    const busy = room && atPromptOnlyBlock(room, text);
    if (busy) { showToast(busy); return; }
    if (room?.modelId === 'CLAUDE' && text.trim() === '/limit-reset') {
      window.open(CLAUDE_USAGE_URL, '_blank', 'noopener,noreferrer');
      accepted?.();
      return;
    }
    const menuId = /^[1-9]$/.test(text.trim()) || (room?.menu?.yesNo && /^[yn]$/i.test(text.trim())) ? room?.menu?.id : undefined;
    sendAction({ type: 'INPUT', roomId, text, groupId, menuId }, () => {
      accepted?.();
      if (text.trim() === '/compact') playGuildChime('compact', soundEnabled);
    });
  };
  const sendWithAttachment = async (roomId: string, text: string, accepted: () => void, groupId?: string) => {
    const files = attachments[roomId];
    if (!files?.length) {
      handleSendPrompt(roomId, text, undefined, accepted, groupId);
      return;
    }
    if (!requireFileUploadSupport(files, fileUploadSupported)) { showToast(t('attachment.files.bridge')); return; }
    const issue = selectionCountIssue(files);
    if (issue) {
      showToast(issue === 'files' ? t('attachment.files.toomany', { count: maxFiles }) : t('attachment.toomany', { count: maxAttachments }));
      return;
    }
    const generic = files.filter(file => !isImageAttachment(file));
    if (text.trim().startsWith('/')) { showToast(t('attachment.prompt.required')); return; }
    if (preparingAttachment) return;
    setPreparingAttachment(roomId);
    try {
      const prepared: { mime: string; data: string }[] = [];
      for (const file of files.filter(isImageAttachment)) {
        const image = await prepareImage(file, attachmentSizes[roomId] ?? 'medium');
        const data = await readBlobBase64(image).catch(() => { throw new Error(t('attachment.read.retry')); });
        prepared.push({ mime: image.type, data });
      }
      const encoded = generic.length ? await prepareFileUpload(generic, prepared).catch(() => { throw new Error(t('attachment.files.failed')); }) : undefined;
      const prompt = text.trim() || (generic.length ? t('attachment.files.prompt') : (prepared.length > 1 ? `請看看這 ${prepared.length} 張圖片。` : '請看看這張圖片。'));
      sendAction({ type: 'INPUT', roomId, text: prompt, groupId, ...(encoded ? {} : { attachments: prepared }) }, () => {
        accepted();
        setAttachments(current => current[roomId] === files ? { ...current, [roomId]: undefined } : current);
      }, encoded);
    } catch (error) { showToast(error instanceof Error ? error.message : t('attachment.read.failed')); }
    finally { setPreparingAttachment(null); }
  };
  const submitDraft = (roomId: string, text: string) => {
    const original = drafts[roomId] ?? '';
    void sendWithAttachment(roomId, text, () => changeDraft(roomId, current => current === original ? '' : current));
  };
  const handleRedeemResetVoucher = (modelId: CLIModelId, roomId?: string) => {
    if (modelId === 'CLAUDE') {
      window.open(CLAUDE_USAGE_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    const room = roomId ? rooms.find(item => item.id === roomId) : rooms.find(item => item.modelId === modelId && item.live);
    if (room) {
      setSelectedRoomId(room.id);
      setUsageModalOpen(false);
      handleSendPrompt(room.id, '/usage');
    } else showToast(t('room.open.first'));
  };
  /** `accepted` runs when the Bridge has taken the decision, and not when it failed. */
  const handleDecision = async (roomId: string, decision: string, accepted?: () => void) => {
    const room = rooms.find(room => room.id === roomId);
    const approval = room?.pendingApproval;
    if (decision !== 'approve' && decision !== 'reject') {
      const choice = approval?.additionalChoices?.find(item => item.id === decision);
      const cli = room?.modelId === 'CODEX' ? 'Codex' : room?.modelId === 'AGY' ? 'AGY' : 'Claude';
      if (!choice) return;
      const ok = await confirm({
        title: t('confirm.title.approval'),
        message: approvalChoiceConfirmation(choice, cli),
        confirmLabel: t('confirm.action.confirm'),
        tone: 'warn',
      });
      if (!ok) return;
    }
    if (approval?.id) sendAction({ type: 'APPROVAL', roomId, approvalId: approval.id, decision }, () => {
      if (decision !== 'reject') playGuildChime('approve', soundEnabled);
      accepted?.();
    });
  };
  /** The group's side list on a wide screen; on the phone it is a row of members under the group header (the plus there adds a member). */
  const renderGroupSidebar = (onAddMember?: () => void) => selectedGroup && (
<div {...groupActions} className="contents [&_aside]:bg-white/35 dark:[&_aside]:bg-[#111626]/52 [&_aside[data-member-strip]]:!bg-[#FBF8F3]/68 dark:[&_aside[data-member-strip]]:!bg-[#101524]/45 [&_aside[data-member-strip]]:backdrop-blur-md dark:[&_aside[data-member-strip]]:backdrop-blur-xl dark:[&_aside[data-member-strip]]:backdrop-saturate-150 [&_aside]:border-r-[#E6DCD0]/50 dark:[&_aside]:border-r-[#6C7BA8]/25 [&_aside]:shadow-[6px_0_18px_-16px_rgba(90,70,50,0.3)]" style={{ WebkitTouchCallout: 'none' }}><div {...roomActions} className="contents"><GroupRoomSidebar onAddMember={onAddMember} groups={groups} rooms={allRooms} characters={characters} selectedGroupId={selectedGroup.id}
          selectedRoomId={groupRecipient} compact={streetMobileView} working={working} flows={benchFlows} showMemberRoles={groupMemberRolesSupported} protectedKeys={protectedKeys}
          onSelectGroup={selectGroup} onSelectRoom={wakeGroupMember} /></div></div>
  );
  const handleRunCompact = (roomId: string, _fromMobile?: boolean) => handleSendPrompt(roomId, '/compact');
  const viewedIds = selectedGroup ? selectedGroup.members.map(member => member.roomId) : selectedRoom ? [selectedRoom.id] : [];
  // A group keeps every member open, but only the addressed member's approval and question cards are on screen: the others must still call out.
  const cardIds = selectedGroup ? (groupRecipient ? [groupRecipient] : []) : selectedRoom ? [selectedRoom.id] : [];
  const attention = useRoomAttention(rooms, viewedIds, ({ room, kind }) => {
    const name = `${characters[room.modelId].characterName} · ${room.roomName}`;
    const message = kind === 'approval' ? t('notification.approval', { name }) : kind === 'question' ? t('notification.question', { name }) : t('notification.done', { name });
    playGuildChime(kind === 'done' ? 'poke' : 'approve', soundEnabled);
    const watching = (kind === 'done' ? viewedIds : cardIds).includes(room.id) && !document.hidden;
    // A waiting approval or question has its own bubble that stays until it is handled; only finished work needs a toast.
    // (A question used to get both, and the Founder saw two cards for one question.)
    if (!watching && kind === 'done') showToast(message, 15_000, room.id);
  }, readMarksSupported ? {
    ready: readMarksReady, marks: sharedReadMarks,
    send: diff => { setSharedReadMarks(current => mergeReadMarks(current, diff)); bridge.send({ type: 'READ_MARKS_SET', marks: diff }); },
  } : undefined);
  const approvalAlerts = rooms
    .filter(room => room.pendingApproval && !cardIds.includes(room.id) && !dismissedApprovals.includes(room.pendingApproval.id))
    .map(room => ({ roomId: room.id, approvalId: room.pendingApproval!.id, label: t('notification.room.approval', { character: characters[room.modelId].characterName, room: room.roomName }) }));
  // A question waits like an approval does: its bubble stays until the question is answered or the bubble is closed.
  const questionAlerts = rooms
    .filter(room => room.pendingQuestion && !cardIds.includes(room.id) && !dismissedApprovals.includes(`q:${room.pendingQuestion.id}`))
    .map(room => ({ roomId: room.id, approvalId: `q:${room.pendingQuestion!.id}`, kind: 'question' as const, label: t('notification.room.question', { character: characters[room.modelId].characterName, room: room.roomName }) }));
  const workingNow = useNow(30_000, Object.keys(attention.workingSince).length > 0 || rooms.some(room => awaiting.since(room.id) !== undefined));
  const stateOf = (roomId: string) => workState(roomId, attention, workingNow, awaiting.since(roomId), allRooms.find(room => room.id === roomId));
  const selectedWork = selectedRoom ? stateOf(selectedRoom.id) : undefined;
  const working = Object.fromEntries(rooms.flatMap(room => {
    const state = stateOf(room.id);
    return state ? [[room.id, state.stalled ? 'stalled' : 'working'] as const] : [];
  })) as Record<string, 'working' | 'stalled'>;
  const requestBridgeRestart = async () => {
    if (restartConfirming.current || restartAttempt.current || !restartSupported || !restartInstance.current || bridge.state !== 'connected') return;
    restartConfirming.current = true;
    const accepted = await confirm(restartConfirmOptions(t, Object.keys(working).length));
    restartConfirming.current = false;
    const instance = restartInstance.current;
    if (!accepted || restartAttempt.current || !instance || bridge.state !== 'connected') return;
    setRestartMessage(undefined);
    restartAttempt.current = beginRestartAttempt(instance, () => {
      restartAttempt.current = undefined;
      setRestartPending(false);
      const message = t('settings.restart.timeout');
      setRestartMessage(message);
      showToast(message, 7_000);
    });
    setRestartPending(true);
    if (!send({ type: 'BRIDGE_RESTART' })) {
      restartAttempt.current.cancel();
      restartAttempt.current = undefined;
      setRestartPending(false);
      setRestartMessage(t('settings.restart.failed'));
    }
  };
  const showTerminal = (roomId: string) => setTerminalRoomId(roomId);
  const roomOrder = (['AGY', 'CODEX', 'CLAUDE'] as CLIModelId[]).flatMap(id => orderPinnedRooms(rooms.filter(room => room.modelId === id), pinnedKeys));
  useEffect(() => {
    if (streetMobileView) return;
    // Option+1–9 jumps to the Nth room in the left list (browser tab shortcuts keep ⌘1–9).
    const key = (event: KeyboardEvent) => {
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (!digit || !event.altKey || event.metaKey || event.ctrlKey) return;
      const room = roomOrder[Number(digit) - 1];
      if (!room) return;
      event.preventDefault();
      selectRoom(room.id);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const liveTerminal = selectedRoom && (selectedRoom.menu || terminalRoomId === selectedRoom.id) && (
    <LiveTerminal room={selectedRoom} compact={streetMobileView} forceOpen={terminalRoomId === selectedRoom.id}
      onManualKey={terminalKeySupported ? key => send({ type: 'TERMINAL_KEY', roomId: selectedRoom.id, screen: selectedRoom.screen ?? '', screenId: selectedRoom.screenId, key }) : undefined}
      onMenu={key => {
        if (selectedRoom.menu) send({ type: 'MENU', roomId: selectedRoom.id, menuId: selectedRoom.menu.id, key });
      }}
    />
  );

  const liveControls = selectedRoom && (
    <LiveTerminalControls room={selectedRoom}
      onStart={() => send({ type: 'START', roomId: selectedRoom.id })}
      onClose={() => send({ type: 'CLOSE', roomId: selectedRoom.id })}
      onRemote={() => handleSendPrompt(selectedRoom.id, selectedRoom.modelId === 'AGY' && selectedRoom.remoteStatus === 'on' ? '/rc off' : '/rc')}
      compact={streetMobileView}
    />
  );

  const roleTouch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const roleTouchStart = useRef<{ x: number; y: number } | null>(null);
  const roleLongPressed = useRef(false);
  useEffect(() => () => clearTimeout(roleTouch.current), []);
  /** Phone only: a long press on a character card opens the new-room dialog for that character. */
  const openRoleRoom = (modelId: CLIModelId) => { setNewRoomModalModel(modelId); setNewRoomModalOpen(true); };
  /** The room row on the phone: a plus to open a room for this character, and (only when there are many) a search. */
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [roomQuery, setRoomQuery] = useState('');
  useEffect(() => { setRoomSearchOpen(false); setRoomQuery(''); }, [mobileRole]);
  const roomSearchThreshold = 8;
  const mobileRooms = rooms.filter(room => room.modelId === mobileRole);
  const mobileRoomSearch = roomQuery.trim().toLowerCase();
  const filteredMobileRooms = mobileRooms.filter(room => room.roomName.toLowerCase().includes(mobileRoomSearch));
  const mobileNavigation = (<>
            {/* 3 Character Quick Switcher Strip (Larger Chibi Avatar + Name & % cleanly contained inside box) */}
            <div className="px-3 py-2 bg-white/35 border-b border-[#E6DCD0]/50 grid grid-cols-3 gap-2 shrink-0 dark:bg-[#161C30]/55 dark:border-[#2E3654]/60 [&_.guild-selection]:bg-white/50 dark:[&_.guild-selection]:bg-[#1C233B]/65 [&_.guild-selection]:backdrop-blur-0 [&_.guild-selection[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--selection-surface)_70%,transparent)]">
              {(['AGY', 'CODEX', 'CLAUDE'] as CLIModelId[]).map((m) => {
                const c = characters[m];
                const mRooms = rooms.filter((r) => r.modelId === m);
                const hasWait = mRooms.some((r) => r.status === 'waiting_approval');
                const roleWork = mRooms.some(r => working[r.id] === 'stalled') ? 'stalled' : mRooms.some(r => working[r.id]) ? 'working' : undefined;
                return (
                  <div key={m} data-role-longpress className="contents" style={{ WebkitTouchCallout: 'none' }}
                    onTouchStart={event => {
                      if (event.touches.length !== 1) return;
                      const cardEl = event.currentTarget.querySelector<HTMLElement>('[data-cli]');
                      roleLongPressed.current = false;
                      roleTouchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
                      clearTimeout(roleTouch.current);
                      pressHintTimer.current = setTimeout(() => {
                        if (cardEl) { cardEl.dataset.pressing = 'true'; pressingEl.current = cardEl; }
                      }, 100);
                      roleTouch.current = setTimeout(() => {
                        roleLongPressed.current = true;
                        clearPressing();
                        openRoleRoom(m);
                      }, 480);
                    }}
                    onTouchMove={event => {
                      const start = roleTouchStart.current, touch = event.touches[0];
                      if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) { clearTimeout(roleTouch.current); clearPressing(); }
                    }}
                    onTouchEnd={() => { clearTimeout(roleTouch.current); clearPressing(); roleTouchStart.current = null; }}
                    onTouchCancel={() => { clearTimeout(roleTouch.current); clearPressing(); roleTouchStart.current = null; }}
                    onClickCapture={event => { if (roleLongPressed.current) { event.preventDefault(); event.stopPropagation(); roleLongPressed.current = false; } }}>
                  <RoleCard
                    key={m}
                    character={c}
                    modelId={m}
                    active={mobileRole === m}
                    waiting={hasWait}
                    work={roleWork}
                    unread={mRooms.some(room => attention.unread[room.id])}
                    onSelect={() => {
                      setMobileRole(m);
                      if (selectedRoom?.modelId !== m) setSelectedRoomId('');
                    }}
                  />
                  </div>
                );
              })}
            </div>

            {/* Room Bubbles Horizontal Pill Bar (shown once a character is picked) */}
            {mobileRole && <div {...roomActions} style={{ WebkitTouchCallout: 'none' }} className="px-2.5 py-1.5 bg-white/35 border-b border-[#E6DCD0]/50 flex items-center gap-1.5 overflow-x-auto shrink-0 dark:bg-[#161C30]/55 dark:border-[#2E3654]/60 [&_.guild-selection]:bg-white/50 dark:[&_.guild-selection]:bg-[#1C233B]/65 [&_.guild-selection[aria-current=true]]:bg-[color-mix(in_srgb,var(--selection-surface)_70%,transparent)]">
              <button type="button" data-room-add aria-label={t('room.create.for', { name: characters[mobileRole].characterName })} title={t('room.create.for', { name: characters[mobileRole].characterName })} onClick={() => openRoleRoom(mobileRole)}
                className="sticky left-0 z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-[#FBF8F3] dark:bg-[#1D243C] text-[#8C6D58] dark:text-[#B5BED6] shadow-[6px_0_8px_-4px_rgba(251,248,243,0.95)] dark:shadow-[6px_0_8px_-4px_rgba(18,22,36,0.9)] active:scale-95"><Plus size={14} aria-hidden="true" /></button>
              {mobileRooms.length > roomSearchThreshold && (roomSearchOpen
                ? <div data-room-search className="flex min-w-[9rem] shrink-0 items-center gap-1 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-2">
                    <Search size={12} className="shrink-0 text-[#A39284] dark:text-[#8E98B8]" aria-hidden="true" />
                    <input type="search" autoFocus aria-label={t('room.search.label')} value={roomQuery} onChange={event => setRoomQuery(event.target.value)} placeholder={t('room.search.placeholder')} className="min-w-0 flex-1 bg-transparent py-0.5 text-[16px] text-[#4A3E36] dark:text-[#ECE7DF] outline-none placeholder:text-[11px] placeholder:text-[#A39284] dark:placeholder:text-[#7E89A8]" />
                    <button type="button" aria-label={t('room.search.close')} onClick={() => { setRoomSearchOpen(false); setRoomQuery(''); }} className="flex h-5 w-5 shrink-0 items-center justify-center text-[#A39284] dark:text-[#8E98B8]"><X size={12} aria-hidden="true" /></button>
                  </div>
                : <button type="button" data-room-search-open aria-label={t('room.search.label')} onClick={() => setRoomSearchOpen(true)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white/70 dark:bg-[#1E253D]/80 text-[#8C6D58] dark:text-[#B5BED6] active:scale-95"><Search size={13} aria-hidden="true" /></button>)}
              {orderPinnedRooms(filteredMobileRooms, pinnedKeys).map((r) => {
                const active = r.id === selectedRoom?.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-room-id={r.id}
                    data-cli={r.modelId}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectRoom(r.id)}
                    className="guild-selection max-w-[min(65vw,15rem)] px-2.5 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] text-[#6E5D52] dark:text-[#C5CDE3]"
                  >
                    {working[r.id] && <WorkingSpark stalled={working[r.id] === 'stalled'} background={Boolean(r.backgroundTasks)} />}
                    <span className="min-w-0 truncate">{r.roomName}</span>
                    {isRoomPinned(r, pinnedKeys) && <RoomPinBadge />}
                    {isRoomPinned(r, protectedKeys) && <ShieldCheck size={12} aria-label={t('room.protect.badge')} className="shrink-0 text-[#4E7A55] dark:text-[#96C7A3]" />}
                    {groups.some(group => group.orchestratorRoomId === r.id) && <Crown size={12} aria-label={t('group.sidebar.leader')} className="shrink-0 text-[#B88A2A]" />}
                    {r.status === 'waiting_approval' && <AlertTriangle aria-label={t('approval.waiting')} className="h-3 w-3 shrink-0 text-[#D68631]" />}
                    {attention.unread[r.id] && !active && <span aria-label={t('room.reply.new')} className="h-1.5 w-1.5 rounded-full bg-[#D9828B]" />}
                  </button>
                );
              })}
            </div>}

  </>);

  return (
    <ImagePreviewProvider value={imagePreviews}>
    <FileOpenContext.Provider value={openFile}>
    <GitHubOpenContext.Provider value={openGitHubTarget}>
    <div className="h-dvh w-full overflow-hidden flex flex-col bg-[#FBF8F3] dark:bg-[#121624] text-[#4A3E36] dark:text-[#ECE7DF] relative">
      {/* Subtle Sunlit / Starry Night Komorebi Botanical Background Scrim */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-20">
        <img
          src={isDark ? GUILD_HALL_NIGHT_BANNER : GUILD_HALL_BANNER}
          alt="Komorebi Background"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </div>

      <RoomAlerts approvals={[...approvalAlerts, ...questionAlerts]} toasts={toasts}
        onOpenRoom={selectRoom}
        onDismissApproval={approvalId => setDismissedApprovals(current => [...current, approvalId])}
        onCloseToast={id => setToasts(current => current.filter(item => item.id !== id))} />

      {/* Minimalist Komorebi Top Bar: "木漏れ日" on Left, Circular Icon Buttons on Right */}
      <header className="relative z-40 sticky top-0 flex items-center justify-between gap-1.5 px-2.5 sm:gap-4 sm:px-5 py-1 border-b border-[#E6DCD0]/60 bg-white/45 dark:border-[#2C3450]/70 dark:bg-[#151B2E]/72 shadow-[0_6px_18px_-14px_rgba(90,70,50,0.3)] dark:shadow-[0_6px_18px_-14px_rgba(0,0,0,0.6)] shrink-0 select-none" style={{ position: 'sticky', top: 0 }}>
        <button type="button" onClick={() => { setSelectedGroupId(null); setSelectedRoomId(''); setMobileRole(null); }}
          className="flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pr-1 transition-transform active:scale-[0.97] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069] sm:shrink-0 sm:gap-2 sm:pr-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E2D6C5]/80 bg-[#FFFDF9]/85 p-0.5 shadow-2xs dark:border-[#6C7BA8]/35 dark:bg-[#1D243C]/85" aria-hidden="true">
            <img src="/avatars/komorebi-crest.webp" alt="" draggable={false} className="h-full w-full object-contain dark:brightness-110" />
          </span>
          <span className="truncate text-[13.5px] font-bold tracking-[0.06em] text-[#4A3E36] dark:text-[#F2EDE4] font-display sm:text-base sm:tracking-[0.12em]">{displayName()}</span>
        </button>

        {/* Right: Cohesive Frosted Toolbar Capsule (Matching 木漏れ日 Top-Right Icons) */}
        <div role="toolbar" aria-label={t('topbar.toolbar')} className="guild-liquid-glass flex items-center gap-0.5 rounded-full border border-[#E2D6C5]/85 dark:border-[#343D5E]/85 p-0.5 shrink-0">
          <button type="button" onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setDriveOpen(true); }} aria-label="Drive" title={t('topbar.drive.title')}
            className="guild-tap w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]">
            <Cloud className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button type="button" onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setGhTarget(undefined); setGhOpen(true); }} aria-label="GitHub" title="GitHub（repo、issues、code、commits）"
            className="guild-tap w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]">
            <Github className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <div ref={groupDropdownRef} className="relative shrink-0" data-group-dropdown>
            <button
              type="button"
              onClick={event => { if (!groupDropdownOpen) burstPetals(event.currentTarget, { count: 3 }); setGroupDropdownOpen(open => !open); }}
              aria-expanded={groupDropdownOpen}
              aria-label={t('topbar.group.count', { count: groups.length })}
              title={selectedGroup ? t('topbar.group.current', { name: selectedGroup.name }) : t('topbar.group.choose')}
              className={`guild-tap flex w-7 h-7 sm:w-8 sm:h-8 rounded-full items-center justify-center shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069] ${
                selectedGroup
                  ? 'bg-[#E6E9F7] dark:bg-[#272D4F] text-[#4D557E] dark:text-[#C5CBFA] ring-1 ring-[#9AA3D6]/70'
                  : 'hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6]'
              }`}
            >
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
            </button>
            {groupDropdownOpen && (
              <div role="menu" aria-label={t('topbar.group.menu')} className="guild-pop-in origin-top-right absolute right-0 top-full z-50 mt-2 w-60 max-w-[85vw] space-y-1 rounded-2xl border border-[#E2D6C5] dark:border-[#343D5E] bg-[#FFFCF7] dark:bg-[#192036] p-2 shadow-xl">
                <div className="flex items-center justify-between px-2 py-1 text-xs font-bold text-[#6E5D52] dark:text-[#B5BED6]">
                  <span>{t('topbar.group.label')}</span>
                  {selectedGroup && (
                    <button type="button" onClick={() => { setSelectedGroupId(null); setGroupDropdownOpen(false); }}
                      className="rounded-full bg-[#F3ECE1] dark:bg-[#27304D] px-2 py-0.5 text-[11px] font-semibold text-[#6E5D52] dark:text-[#C5CDE3] hover:bg-[#E8DEC8] dark:hover:bg-[#313C60]">
                      {t('topbar.group.personal')}
                    </button>
                  )}
                </div>
                <div {...groupActions} {...groupDrag} style={{ WebkitTouchCallout: 'none' }} className="relative max-h-56 select-none space-y-1 overflow-y-auto overflow-x-hidden px-1 py-1">
                  {groups.map(group => {
                    const active = selectedGroup?.id === group.id;
                    const lifted = draggingGroupId === group.id;
                    return (
                      <div key={group.id} data-group-id={group.id}
                        style={lifted ? { transform: `translate3d(0, ${groupDragOffsetY}px, 0) scale(1.035)` } : undefined}
                        className={`flex min-w-0 items-center rounded-xl border ${lifted ? '' : 'transition-shadow'} ${active ? 'border-[#9AA3D6] dark:border-[#8488C4] bg-[#EEF0FA] dark:bg-[#262D50]' : 'border-transparent hover:bg-[#F5EFE6] dark:hover:bg-[#222947]'}${draggingRow(group.id)}`}>
                        <button type="button" onClick={() => selectGroup(group)} className="min-w-0 flex-1 px-2.5 py-2 text-left text-xs">
                          <span className="block truncate font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{group.name}</span>
                          <span className="block text-[10px] text-[#7D6D61] dark:text-[#98A3C2]">{t('topbar.group.members', { count: group.members.length })}</span>
                        </button>
                        <button type="button" data-drag-ignore aria-label={t('topbar.group.manage', { name: group.name })} onClick={() => openGroupMenu(group.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6E5D52] dark:text-[#A4AECC] hover:bg-white/80 dark:hover:bg-[#2E375C]">⋯</button>
                      </div>
                    );
                  })}
                  {!groups.length && <p className="px-2.5 py-2 text-xs text-[#7D6D61] dark:text-[#98A3C2]">{t('topbar.group.empty')}</p>}
                </div>
                <button type="button" disabled={!groupsSupported} onClick={() => { setGroupDropdownOpen(false); setGroupCreateError(undefined); setGroupCreateOpen(true); }}
                  className="mt-1 min-h-9 w-full rounded-xl bg-[#A65772] dark:bg-[#C2707D] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 cursor-pointer">
                  {t('topbar.group.create')}
                </button>
              </div>
            )}
          </div>

          <button type="button" onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setInboxPendingFirst(!inboxSupported); setInboxOpen(true); }} aria-label={t('inbox.pendingCount', { count: pendingCount })} title={inboxSupported ? t('topbar.inbox.title') : t('inbox.pending')}
            className="guild-tap relative flex w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] items-center justify-center shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]">
            <InboxIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
            {pendingCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#C86475] dark:bg-[#D9828B] px-1 text-[9.5px] font-bold leading-none text-white ring-2 ring-[#FBF8F3] dark:ring-[#121624] tabular-nums">{pendingCount}</span>}
          </button>

          <button type="button" onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setArchiveOpen(true); }}
            aria-label={t('topbar.archive.count', { count: archivedRooms.length })} title={t('topbar.archive.title')}
            className="guild-tap flex w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] items-center justify-center shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]">
            <Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
          </button>

          <button
            onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setUsageModalOpen(true); }}
            title={t('topbar.quota')}
            className="guild-tap w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#FCE8EB]/85 dark:hover:bg-[#312338] text-[#D9828B] dark:text-[#EFA4B2] flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]"
          >
            <FlaskConical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            type="button"
            onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setQrOpen(true); }}
            aria-label={t('topbar.tailscale')}
            title={t('topbar.tailscale')}
            className="guild-tap hidden sm:flex w-8 h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]"
          >
            <QrCode className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={event => { burstPetals(event.currentTarget, { count: 3 }); setSettingsOpen(true); }}
            aria-label={t('topbar.settings')}
            title={t('topbar.settings.title')}
            className="guild-tap w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-[#F3ECE1]/85 dark:hover:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer focus-visible:outline-2 focus-visible:outline-[#965069]"
          >
            <Settings2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

        </div>
      </header>

      {/* Main Content Area */}
      {bridge.everConnected && bridge.state === 'connecting' && (
        <div role="status" className="relative z-30 shrink-0 bg-[#FCEFD9] dark:bg-[#2F261A] px-4 py-1.5 text-center text-xs font-semibold text-[#7A542E] dark:text-[#F0C882]">
          {t('connection.reconnecting')}
        </div>
      )}
      {bridge.state === 'pair' || !bridge.everConnected ? (
        <div className="relative z-10 flex flex-1 items-center justify-center p-4">
          {bridge.state === 'pair' ? (
            <form name="komorebi-pairing" action="/" method="post" className="space-y-3 rounded-2xl bg-white dark:bg-[#1A2036] dark:border dark:border-[#343D5E] p-5 shadow-md" onSubmit={event => {
              event.preventDefault();
              bridge.pair(pairingInput);
            }}>
              <label className="block font-semibold" htmlFor="pairing-key">{t('pairing.label')}</label>
              {bridge.pairError && <p role="alert" className="max-w-xs text-sm text-[#9F4856] dark:text-[#F09AA6]">{bridge.pairError}</p>}
              {/* A username field lets Safari save the code to iCloud Keychain and autofill it later. */}
              <input type="text" name="username" autoComplete="username" value="Komorebi Bridge" readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
              <input id="pairing-key" name="password" type="password" required value={pairingInput} onChange={event => setPairingInput(event.target.value)}
                autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="current-password" className="w-full rounded-xl border border-[#E2D6C5] dark:border-[#343D5E] dark:bg-[#141A2C] p-2 text-base" />
              <p className="max-w-xs text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('pairing.hint')}</p>
              <button className="rounded-full bg-[#4A3E36] dark:bg-[#D88B96] px-4 py-2 text-white">{t('pairing.submit')}</button>
            </form>
          ) : <p role="status">{t('connection.connecting')}</p>}
        </div>
      ) : selectedGroup ? (
        <div {...groupSwipe.handlers} className={`relative z-10 flex min-h-0 flex-1 overflow-hidden ${streetMobileView ? 'flex-col' : ''}`}>
        {streetMobileView && <GroupSwipeHint preview={groupSwipe.preview} groups={groups} currentId={selectedGroup.id} />}
        <div
          style={streetMobileView ? {
            transform: groupSwipe.dragX ? `translate3d(${groupSwipe.dragX}px, 0, 0)` : undefined,
            transition: groupSwipe.dragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          } : undefined}
          className={`flex min-h-0 min-w-0 flex-1 ${streetMobileView ? 'flex-col' : ''}`}
        >
        <div
          key={selectedGroup.id}
          className={`flex min-h-0 min-w-0 flex-1 ${streetMobileView ? 'flex-col' : ''} ${groupSwipe.enterDirection === 'next' ? 'guild-swipe-next' : groupSwipe.enterDirection === 'previous' ? 'guild-swipe-prev' : ''}`}
        >
        {!streetMobileView && renderGroupSidebar()}
        <GroupChatView key={selectedGroup.id} name={selectedGroup.name} characters={characters}
          boardPath={selectedGroup.boardPath} onChooseBoard={groupBoardSupported ? () => editGroupBoard(selectedGroup.id, false) : undefined}
          onFileTriggers={fileTriggersSupported ? () => editFileTriggers(selectedGroup.id) : undefined}
          triggerBanner={fileTriggersSupported && <FileTriggerBanner
            stale={fileTriggerIntegrity[selectedGroup.id]?.integrity === 'stale'}
            offline={fileTriggerItems[selectedGroup.id]?.find(item => item.enabled && item.status === 'offline')}
            onReview={() => editFileTriggers(selectedGroup.id)}
            onResume={item => { if (item.offlineToken) send({ type: 'FILE_TRIGGERS_RESUME', groupId: selectedGroup.id, id: item.id, offlineToken: item.offlineToken }); }} />}
          worktreeCall={worktreeSupported ? worktreeRef.current?.call : undefined}
          orchestratorRoomId={selectedGroup.orchestratorRoomId}
          onSetOrchestrator={roomId => send({ type: 'GROUP_SET_ORCHESTRATOR', groupId: selectedGroup.id, roomId })}
          onEditMemberRole={groupMemberRolesSupported ? roomId => editMemberRole(selectedGroup.id, roomId) : undefined}
          memberStrip={streetMobileView ? ({ onAdd }) => renderGroupSidebar(onAdd) : undefined}
          recipientId={groupRecipient}
          members={selectedGroup.members.map(member => ({ ...member, room: allRooms.find(room => room.id === member.roomId) }))}
          availableRooms={rooms.filter(room => Boolean(room.sessionId && room.resumable))}
          drafts={drafts}
          workingState={stateOf}
          autoModeOf={launchModes ? roomId => { const member = allRooms.find(room => room.id === roomId); return member ? roomAutoMode(member, launchModes) : undefined; } : undefined}
          onMode={launchModes ? (roomId, auto) => send({ type: 'SET_ROOM_MODE', roomId, auto }) : undefined}
          onLoadHistory={loadHistory}
          onDraft={changeDraft}
          onBack={() => { setSelectedGroupId(null); if (streetMobileView) { setSelectedRoomId(''); setMobileRole(null); } }}
          onSend={(roomId, text, accepted) => { void sendWithAttachment(roomId, text, accepted, selectedGroup.id); }}
          onCommand={(roomId, text, accepted) => handleSendPrompt(roomId, text, undefined, accepted, selectedGroup.id)}
          onDecision={handleDecision}
          onInterrupt={interrupt}
          onMenu={(roomId, menuId, key) => send({ type: 'MENU', roomId, menuId, key })}
          onManualKey={terminalKeySupported ? (roomId, screen, screenId, key) => send({ type: 'TERMINAL_KEY', roomId, screen, screenId, key }) : undefined}
          onAnswerDirect={answerQuestionDirectly}
          onStart={async roomId => {
            const room = allRooms.find(item => item.id === roomId);
            if (room?.sessionId) {
              const ok = await confirm({
                title: t('confirm.title.resume'),
                message: t('room.resume.confirm'),
                confirmLabel: t('confirm.action.resume'),
                tone: 'warn',
              });
              if (!ok) return;
            }
            send({ type: 'START', roomId });
          }}
          onRetryMember={roomId => send({ type: 'GROUP_RESTORE_MEMBER', groupId: selectedGroup.id, roomId })}
          onOpenRoom={selectRoom}
          onSelectRecipient={setGroupRecipientId}
          onAddMember={modelId => send({ type: 'GROUP_ADD', groupId: selectedGroup.id, modelId })}
          onAddExisting={roomId => send({ type: 'GROUP_ADD_EXISTING', groupId: selectedGroup.id, roomId })}
          onRemoveMember={roomId => { void removeFromGroup(selectedGroup, roomId); }}
          attachmentPicker={roomId => attachmentControl('button', roomId)}
          voiceButton={roomId => voiceControl(roomId)}
          attachmentPreview={roomId => attachmentControl('preview', roomId)}
          hasAttachment={roomId => Boolean(attachments[roomId]?.length)}
          pendingRoomIds={[...Object.keys(feedback).filter(id => feedback[id]?.state === 'pending'), ...(preparingAttachment ? [preparingAttachment] : [])]}
          errors={Object.fromEntries(Object.entries(feedback).filter(([, value]) => value.state === 'error').map(([id, value]) => [id, value.message]))}
          statuses={Object.fromEntries(Object.keys(feedback).filter(id => feedback[id]?.state !== 'error').flatMap(id => { const message = visibleFeedback(id); return message ? [[id, message]] : []; }))}
        />
        </div>
        </div>
        </div>
      ) : !selectedRoom ? (
        streetMobileView ? (
          <div className="relative z-10 flex-1 min-h-0 overflow-hidden p-0 sm:p-2 flex items-center justify-center">
            <div className="w-full sm:w-[390px] h-full sm:max-h-[792px] min-h-0 sm:rounded-[38px] sm:border-[5px] border-[#DFD3C3] bg-transparent sm:shadow-2xl flex flex-col overflow-hidden relative">
              {mobileNavigation}
              {mobileRole ? (
                <div key={mobileRole} className="guild-pane-in relative flex-1 min-h-0 flex flex-col">
                  <EmptyRoomState modelId={mobileRole} character={characters[mobileRole]}
                    working={rooms.some(room => room.modelId === mobileRole && Boolean(working[room.id]))}
                    rooms={rooms} pinnedKeys={pinnedKeys} onSelectRoom={selectRoom} workingRooms={working} />
                  <MobileGroupScrollDrawer groups={groups} working={working} onSelectGroup={selectGroup} />
                </div>
              ) : (
                <main className="guild-pane-in flex-1 min-h-0 flex flex-col" aria-label={t('guild.hall.label')}>
                  <GuildHallHome characters={characters} rooms={rooms} working={working} groups={groups} onSelectGroup={selectGroup} />
                </main>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="relative z-10 flex-1 flex overflow-hidden min-h-0">
              <div {...roomActions} style={{ WebkitTouchCallout: 'none' }} className="contents">
                <LeftCharacterMenu characters={characters} rooms={rooms} pinnedKeys={pinnedKeys} protectedKeys={protectedKeys} selectedRoomId="" onSelectRoom={selectRoom} unread={attention.unread} working={working}
                  onOpenNewRoomModal={m => { setNewRoomModalModel(m); setNewRoomModalOpen(true); }}
                  onOpenUsageModal={() => setUsageModalOpen(true)} onPokeCharacter={() => playGuildChime('poke', soundEnabled)}
                  groups={groups} onSelectGroup={selectGroup} />
              </div>
              <main className="guild-pane-in flex min-w-0 flex-1 flex-col" aria-label={t('guild.hall.label')}><GuildHallHome characters={characters} rooms={rooms} working={working} /></main>
            </div>
          </>
        )
      ) : !streetMobileView ? (
        <>
          {/* Upper 81% Space: 30% Left 3-Character Menu + 70% Right Unobstructed Komorebi Terminal */}
          <div className="relative z-10 flex-1 flex overflow-hidden min-h-0">
            <div {...roomActions} style={{ WebkitTouchCallout: 'none' }} className="contents">
            <LeftCharacterMenu
              characters={characters}
              rooms={rooms}
              pinnedKeys={pinnedKeys}
              protectedKeys={protectedKeys}
              selectedRoomId={selectedRoom.id}
              onSelectRoom={selectRoom}
              unread={attention.unread} working={working}
              onOpenNewRoomModal={(m) => {
                setNewRoomModalModel(m);
                setNewRoomModalOpen(true);
              }}
              onOpenUsageModal={() => setUsageModalOpen(true)}
              onPokeCharacter={() => playGuildChime('poke', soundEnabled)}
              groups={groups} onSelectGroup={selectGroup}
            />
            </div>

            <div key={selectedRoom.id} className="guild-pane-in flex min-w-0 flex-1 min-h-0">
            <RightRoomWorkspace
              room={selectedRoom}
              character={selectedCharacter}
              onApprove={roomId => handleDecision(roomId, 'approve')}
              onAdditionalApproval={(roomId, decision) => handleDecision(roomId, decision)}
              onInterrupt={interrupt}
              onReject={(roomId, reason) => handleDecision(roomId, 'reject', reason ? () => handleSendPrompt(roomId, reason) : undefined)}
              onSendPrompt={handleSendPrompt}
              onAnswerDirect={answerQuestionDirectly}
              onSubmitDraft={submitDraft}
              attachmentPicker={attachmentControl('button')}
              voiceButton={voiceControl()}
              attachmentPreview={attachmentControl('preview')}
              hasAttachment={Boolean(attachments[selectedRoom.id]?.length)}
              promptInput={mobileInput}
              setPromptInput={change => changeDraft(selectedRoom.id, change)}
              sending={preparingAttachment === selectedRoom.id || (actionPending && roomFeedback?.type === 'INPUT')}
              approving={actionPending && roomFeedback?.type === 'APPROVAL'}
              actionMessage={roomFeedback?.message}
              actionError={roomFeedback?.state === 'error'}
              onRunCompact={handleRunCompact}
              onRedeemResetVoucher={handleRedeemResetVoucher}
              onLoadHistory={loadHistory && (roomId => loadHistory([roomId]))}
              workingElapsed={selectedWork?.elapsed}
              workingStalled={selectedWork?.stalled}
              onShowTerminal={() => showTerminal(selectedRoom.id)}
              terminal={liveTerminal}
              terminalOpen={terminalRoomId === selectedRoom.id}
              onToggleTerminal={() => setTerminalRoomId(current => current === selectedRoom.id ? null : selectedRoom.id)}
              controls={liveControls}
              autoMode={launchModes ? roomAutoMode(selectedRoom, launchModes) : undefined}
              onMode={launchModes ? auto => send({ type: 'SET_ROOM_MODE', roomId: selectedRoom.id, auto }) : undefined}
              worktreeCall={worktreeSupported ? worktreeRef.current?.call : undefined}
            />
            </div>
          </div>

        </>
      ) : (
        /* iPhone 17 (6.3" 19.5:9 Aspect Ratio) Optimized Street Mobile Mode */
        <div className="relative z-10 flex-1 min-h-0 overflow-hidden p-0 sm:p-2 flex items-center justify-center">
          <div className="w-full sm:w-[390px] h-full sm:max-h-[792px] min-h-0 sm:rounded-[38px] sm:border-[5px] border-[#DFD3C3] bg-transparent sm:shadow-2xl flex flex-col overflow-hidden relative">
            {mobileNavigation}
            {worktreeSupported && worktreeRef.current && selectedRoom.repoPath && <WorktreeLayer roomId={selectedRoom.id} call={worktreeRef.current.call} />}

            {/* Active Character Live Sprite + Scrollable Room Stream on iPhone 17 (min-h-0 keeps Composer pinned!) */}
            <div ref={mobileScroll.ref} onScroll={mobileScroll.onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2 relative">
              <div key={selectedRoom.id} className="guild-pane-in space-y-1.5">
                <HistoryNote truncated={selectedRoom.historyTruncated} count={selectedRoom.logs.length} onLoadMore={loadHistory && (() => loadHistory([selectedRoom.id]))} />
                {bubbleRuns(selectedRoom.logs.filter(entry => !isBenchDelivery(entry)).map(entry => ({ entry: benchWakeAsLine(entry), key: selectedRoom.id }))).map(item => (
                  <Fragment key={item.entry.id}>
                    {item.day && <DaySeparator label={item.day} />}
                    <MessageBubble entry={item.entry} modelId={selectedRoom.modelId} name={selectedCharacter.characterName} roomId={selectedRoom.id} header={item.header} count={item.count} />
                  </Fragment>
                ))}
              </div>
              {selectedWork && <WorkingIndicator modelId={selectedRoom.modelId} name={selectedCharacter.characterName} elapsed={selectedWork.elapsed}
                stalled={selectedWork.stalled} background={Boolean(selectedRoom.backgroundTasks)} onShowTerminal={() => showTerminal(selectedRoom.id)} />}
            </div>

            {(selectedRoom.menu || terminalRoomId === selectedRoom.id) && (
              <div className="shrink-0 px-3 pb-1" aria-label={t('terminal.live.label')}>
                {liveTerminal}
              </div>
            )}

            <div className="shrink-0 px-3">
              {selectedRoom.pendingQuestion && <div className="mb-2"><QuestionCard pending={selectedRoom.pendingQuestion} name={selectedCharacter.characterName} disabled={actionPending} onAnswer={(text, detail) => { if (!answerQuestionDirectly(selectedRoom.id, detail)) handleSendPrompt(selectedRoom.id, text, true); }} /></div>}
              {selectedRoom.pendingApproval && (
                <div className="guild-approval p-2.5 space-y-2 max-h-[30dvh] overflow-y-auto">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#754B29]">
                    <ApprovalSeal />
                    <span>{selectedRoom.pendingApproval.title}</span>
                  </div>
                  <p className="text-[11px] text-[#7D6D61]">{selectedRoom.pendingApproval.reason}</p>
                  <pre className="p-2 rounded-xl bg-[#382F2A] font-mono text-[10px] text-[#F9EFE4] overflow-auto max-h-24 whitespace-pre-wrap break-all">
                    {selectedRoom.pendingApproval.commandOrFile}
                  </pre>
                  <ApprovalDiff lines={selectedRoom.pendingApproval.diffLines} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <GuildActionButton kind="approve" disabled={actionPending}
                      onClick={() => handleDecision(selectedRoom.id, 'approve')}
                    >
                      {actionPending && roomFeedback?.type === 'APPROVAL' ? t('approval.pending') : t('approval.accept')}
                    </GuildActionButton>
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={() => handleDecision(selectedRoom.id, 'reject')}
                      className="py-1.5 rounded-full bg-[#FCE8EB] text-[#C85A68] border border-[#F3C6CD] font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t('approval.reject')}</span>
                    </button>
                  </div>
                  <RejectReason disabled={actionPending} onSubmit={reason => {
                    const roomId = selectedRoom.id;
                    // The reason follows as a message once the Bridge has taken the reject, never before and never after a failure.
                    handleDecision(roomId, 'reject', () => handleSendPrompt(roomId, reason));
                  }} />
                  {selectedRoom.pendingApproval.additionalChoices?.map(choice => <button key={choice.id} type="button" disabled={actionPending}
                    onClick={() => handleDecision(selectedRoom.id, choice.id)}
                    className="w-full rounded-xl border border-[#D8B17E] bg-white px-3 py-2 text-left text-xs text-[#704A24]">
                    {approvalChoiceLabel(choice)}
                  </button>)}
                  <p className="text-[10px] text-[#7D6D61]">{t('approval.numeric.hint')}</p>
                  <button type="button" onClick={() => setTerminalRoomId(current => current === selectedRoom.id ? null : selectedRoom.id)}
                    className="text-[10px] font-semibold text-[#8D6B72] underline">{terminalRoomId === selectedRoom.id ? t('terminal.hide') : t('terminal.view')}</button>
                </div>
              )}

            </div>

            {/* Pinned Bottom iPhone 17 Composer (with "/" Command Autocomplete + Embedded Send Button) + Clickable Model Popover + Full Low/Med/High/Max Effort + Home Indicator */}
            <div className="shrink-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-[#F7F2E9]/50 dark:bg-[#161C30]/78 border-t border-[#E6DCD0] dark:border-[#2E3654] space-y-1.5 relative">
              {mobileScroll.visible && <ScrollToLatestButton onClick={mobileScroll.goToBottom} newMessages={mobileScroll.newMessages} />}
              {!actionPending && !mobileBlocked && <SlashCommandMenu modelId={selectedRoom.modelId} draft={mobileInput} onSelect={item => {
                if (item.immediateExecute) handleSendPrompt(selectedRoom.id, item.cmd, true, () => {
                  changeDraft(selectedRoom.id, current => current === mobileInput ? '' : current);
                });
                else changeDraft(selectedRoom.id, item.cmd + ' ');
              }} />}

              {attachmentControl('preview')}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if ((!mobileInput.trim() && !attachments[selectedRoom.id]?.length) || actionPending || mobileBlocked) return;
                  submitDraft(selectedRoom.id, mobileInput.trim());
                }}
                className="guild-composer-glass flex items-end rounded-[1.75rem] border border-[#DFD3C3] dark:border-[#343D5E] pl-1.5 pr-1 py-0.5 focus-within:border-[#D9828B] dark:focus-within:border-[#7C86B8] gap-1.5"
              >
                {attachmentControl('button')}
                <textarea
                  name="streetInput"
                  ref={mobileComposerRef}
                  rows={1}
                  value={mobileInput}
                  onChange={(e) => changeDraft(selectedRoom.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={t('composer.placeholder', { name: selectedCharacter.characterName })}
                  className="flex-1 resize-none overflow-y-auto bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder-[#A39284] dark:placeholder-[#7E89A8] placeholder:text-[13px] focus:outline-none pb-[7px] pt-[9px] min-w-0"
                />
                {voiceControl()}
                <ComposerActionButton
                  running={Boolean(selectedRoom.live && (!selectedRoom.ready || selectedRoom.status !== 'idle' || selectedWork))}
                  hasDraft={Boolean(mobileInput.trim() || attachments[selectedRoom.id]?.length)}
                  blocked={mobileBlocked}
                  pending={actionPending}
                  role={selectedRoom.modelId}
                  onStop={() => interrupt(selectedRoom.id)}
                  title={actionPending ? t('composer.sending') : mobileBlocked ?? t('composer.send')}
                />
              </form>
              {(feedbackMessage || mobileHint) && <p role="status" className={`w-fit max-w-full rounded-full bg-white/55 dark:bg-[#1D243B]/80 px-3 py-1 text-[11px] shadow-[inset_0_0_0_1px_rgba(232,220,210,0.7)] dark:shadow-[inset_0_0_0_1px_rgba(54,64,98,0.7)] ${roomFeedback?.state === 'error' ? 'text-[#8D3F48] dark:text-[#F09AA6]' : feedbackMessage ? 'text-[#3F694A] dark:text-[#96C7A3]' : 'text-[#8C7A6E] dark:text-[#A4AECC]'}`}>{feedbackMessage ?? mobileHint}</p>}

              <ControlBar room={selectedRoom} character={selectedCharacter} mobile onCommand={handleSendPrompt} settingsDisabled={!mobileCapabilities?.settings}
                compact={{ disabled: !mobileCapabilities?.compact, title: mobileCapabilities?.reason ? `/compact · ${mobileCapabilities.reason}` : '/compact', onRun: () => handleRunCompact(selectedRoom.id, true) }}
                terminal={{ open: terminalRoomId === selectedRoom.id, onToggle: () => setTerminalRoomId(current => current === selectedRoom.id ? null : selectedRoom.id) }}
                shield={{ disabled: !selectedRoom.live || actionPending, autoMode: launchModes ? roomAutoMode(selectedRoom, launchModes) : undefined,
                  onMode: launchModes ? auto => send({ type: 'SET_ROOM_MODE', roomId: selectedRoom.id, auto }) : undefined,
                  onPermissions: () => handleSendPrompt(selectedRoom.id, '/permissions') }}
                cli={liveControls}
                quota={!hasResetVouchers(selectedCharacter) ? undefined : { label: '×' + selectedCharacter.hp5h.resetVouchers,
                  title: quotaHint(selectedCharacter), onClick: () => handleRedeemResetVoucher(selectedCharacter.id, selectedRoom.id) }} />
            </div>
          </div>
        </div>
      )}

      {menuRoom && (() => {
        const accent = roleAccent[menuRoom.modelId];
        const char = characters[menuRoom.modelId];
        const key = menuRoom.sessionId ?? menuRoom.id;
        const heirKey = successors[key];
        const heir = heirKey ? allRooms.find(room => (room.sessionId ?? room.id) === heirKey) : undefined;
        const showSingleGrid = !menuGroup && !heirKey && !pickingSuccessor;
        const pinned = isRoomPinned(menuRoom, pinnedKeys);
        const openRename = () => {
          if (!renameSupported) {
            showToast(t('room.rename.restart'));
            return;
          }
          setRenameValue(menuRoom.roomName);
          setRenameRoomId(menuRoom.id);
          setMenuRoomId(null);
        };
        const runArchive = () => {
          if (!archiveSupported) {
            showToast(t('room.archive.restart'));
            return;
          }
          if (send({ type: 'ARCHIVE', roomId: menuRoom.id, archived: true })) setMenuRoomId(null);
        };
        return (
          <div className="guild-backdrop-in fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-[#3A2E27]/28 dark:bg-[#090C16]/68 p-4 backdrop-blur-xs" onClick={() => setMenuRoomId(null)}>
            <div ref={focusScope} role="dialog" aria-modal="true" aria-label={t('room.menu.label')} onClick={event => event.stopPropagation()}
              className="guild-sheet-in w-full max-w-sm space-y-3 rounded-[28px] border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FFFDF9]/96 dark:bg-[#171D31]/96 p-4 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_22px_50px_-12px_rgba(74,62,54,0.28)] backdrop-blur-md">
              {/* Role-tinted frosted header card */}
              <div data-role-card={menuRoom.modelId} className="flex items-center justify-between gap-2.5 rounded-2xl border px-3.5 py-3"
                style={{ backgroundColor: accent.wash, borderColor: `${accent.stripe}55` }}>
                <div className="flex min-w-0 items-center gap-3">
                  <img src={char.avatarUrl} alt=""
                    className="h-11 w-11 shrink-0 rounded-full border-2 bg-white dark:bg-[#1E253D] object-cover shadow-2xs"
                    style={{ borderColor: accent.stripe }} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent.stripe }} />
                      <span className="text-base leading-tight font-extrabold" style={{ color: accent.name }}>{char.characterName}</span>
                    </div>
                    <h2 className="mt-0.5 truncate text-xs font-normal text-[#7D6D61] dark:text-[#A4AECC]">{menuRoom.roomName}</h2>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {menuGroup && (() => {
                    const lead = menuGroup.orchestratorRoomId === menuRoom.id;
                    return <button type="button" data-orchestrator-toggle aria-pressed={lead} aria-label={lead ? t('group.leader.unset') : t('group.leader.set')} title={lead ? t('group.leader.unset.title') : t('group.leader.set.title')}
                      onClick={() => send({ type: 'GROUP_SET_ORCHESTRATOR', groupId: menuGroup.id, roomId: lead ? null : menuRoom.id })}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border transition active:scale-95 ${lead ? 'border-[#E8C766] dark:border-[#8F7434] bg-[#FFF3CC] dark:bg-[#2F2715] text-[#C9931A] dark:text-[#F5D26B] shadow-[0_0_10px_rgba(232,199,102,0.7)]' : 'border-[#E6DCD0] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#B9AB9E] dark:text-[#8E98B8] hover:bg-white dark:hover:bg-[#2B3554]'}`}>
                      <Crown size={15} fill={lead ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>;
                  })()}
                  <button type="button" aria-label={t('common.close')} onClick={() => setMenuRoomId(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E6DCD0]/80 dark:border-[#364062] bg-white/80 dark:bg-[#232B45] text-[#8C7A6E] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95">
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Compact Session ID banner */}
              <div data-session-banner className="flex items-center gap-2 rounded-2xl border border-[#EAE0D3] dark:border-[#2E3654] bg-[#FAF5EE]/85 dark:bg-[#141A2C] px-3.5 py-2 text-[11px] text-[#6E5D52] dark:text-[#A4AECC]">
                <div className="min-w-0 flex-1">
                  <div className="text-[9.5px] font-bold tracking-wider text-[#9A8778] dark:text-[#8E98B8] uppercase">Session ID</div>
                  <code className="mt-0.5 block font-mono text-[11px] text-[#5A4A40] dark:text-[#C5CDE3] break-all select-text">{menuRoom.sessionId ?? t('room.session.wait')}</code>
                </div>
                {menuRoom.sessionId && <button type="button" aria-label={t('room.session.copy')} title={t('room.session.copy')} onClick={() => {
                  const id = menuRoom.sessionId!;
                  void copyText(id).then(ok => showToast(ok ? t('room.session.copied') : t('room.session.copy.failed')));
                }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E6DCD0] dark:border-[#364062] bg-white dark:bg-[#232B45] text-[#8C6D58] dark:text-[#C5CDE3] shadow-2xs transition hover:bg-[#F3ECE1] dark:hover:bg-[#2B3554] active:scale-95"><Copy size={16} aria-hidden="true" /></button>}
              </div>

              {menuGroup && groupMemberRolesSupported && <GroupMemberRoleAction
                role={menuGroup.orchestratorRoomId === menuRoom.id ? { key: 'orchestrator', label: t('group.memberRole.orchestrator') } : menuGroup.members.find(member => member.roomId === menuRoom.id)?.role}
                onEdit={() => editMemberRole(menuGroup.id, menuRoom.id)} />}
              <RoomPinAction supported={pinSupported && !isArchived(menuRoom)} pinned={pinned} onToggle={() => {
                if (send({ type: 'PIN_ROOM', roomId: menuRoom.id, pinned: !pinned })) setMenuRoomId(null);
              }} />
              {protectionSupported && (() => {
                const roomProtected = isRoomPinned(menuRoom, protectedKeys);
                return <button type="button" onClick={() => {
                  if (send({ type: 'PROTECT_ROOM', roomId: menuRoom.id, protected: !roomProtected })) setMenuRoomId(null);
                }} className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99] cursor-pointer">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${roomProtected
                    ? 'bg-[#E6F2E8] dark:bg-[#20332C] text-[#4E7A55] dark:text-[#96C7A3]'
                    : 'bg-[#F7F1E8] dark:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6]'}`}>
                    <ShieldCheck size={14} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t(roomProtected ? 'room.protect.remove' : 'room.protect.add')}</span>
                </button>;
              })()}
              <RoomMoveAction room={menuRoom} onMove={() => {
                if (isRoomPinned(menuRoom, protectedKeys)) { showToast(t('room.protect.moveBlocked')); return; }
                const roomBusy = Boolean(working[menuRoom.id] || menuRoom.pendingApproval || menuRoom.pendingQuestion || menuRoom.menu || (menuRoom.live && (!menuRoom.ready || menuRoom.status !== 'idle')));
                if (roomBusy) {
                  showToast(t('room.move.busy'));
                  return;
                }
                if (!menuRoom.sessionId || menuRoom.resumable === false) {
                  showToast(t('room.move.noSession'));
                  return;
                }
                setMoveRoomTargetId(menuRoom.id);
                setMenuRoomId(null);
              }} />
              {/* Action cards: 2-column refined cards for single mode; stacked icon-pill cards for group mode */}
              {showSingleGrid ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <button type="button" onClick={openRename}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#E6DCD0] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3 py-3.5 text-center shadow-2xs transition hover:border-[#D7C7B5] dark:hover:border-[#495582] hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.98]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${accent.stripe}26`, color: accent.name }}>
                      <Pencil size={16} aria-hidden="true" />
                    </span>
                    <span className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('common.rename')}</span>
                    <span className="text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">{t('room.rename.detail')}</span>
                  </button>
                  <button type="button" onClick={runArchive}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#E3D6C7] dark:border-[#343D5E] bg-[#F7F1E8] dark:bg-[#1C2236] px-3 py-3.5 text-center shadow-2xs transition hover:border-[#D4C3AF] dark:hover:border-[#495582] hover:bg-[#EFE7DA] dark:hover:bg-[#242B45] active:scale-[0.98]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 dark:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6] shadow-2xs">
                      <Archive size={16} aria-hidden="true" />
                    </span>
                    <span className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('room.archive')}</span>
                    <span className="text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">{menuRoom.live ? t('room.archive.live.short') : t('room.archive.off.short')}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button type="button" onClick={openRename}
                    className="flex w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2.5 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${accent.stripe}26`, color: accent.name }}>
                      <Pencil size={15} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('common.rename')}</span>
                      <span className="block text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">{t('room.rename.display.detail')}</span>
                    </div>
                  </button>
                  {(menuGroup || heirKey) && (() => {
                    if (pickingSuccessor) {
                      const options = rooms.filter(room => room.id !== menuRoom.id);
                      return <div data-successor-picker className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FBF8F3] dark:bg-[#141A2C] p-2">
                        <p className="px-2 py-1 text-[11px] leading-snug text-[#7D6D61] dark:text-[#A4AECC]">{t('room.successor.instruction', { room: menuRoom.roomName })}</p>
                        {options.map(room => <button key={room.id} type="button" onClick={() => { if (send({ type: 'SET_SUCCESSOR', roomId: menuRoom.id, successorRoomId: room.id })) { setPickingSuccessor(false); setMenuRoomId(null); } }}
                          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-medium text-[#4A3E36] dark:text-[#ECE7DF] transition hover:bg-white dark:hover:bg-[#232B47]">
                          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: roleAccent[room.modelId].stripe }} />
                          <span className="truncate"><strong style={{ color: roleAccent[room.modelId].name }}>{characters[room.modelId].characterName}</strong> · {room.roomName}</span>
                        </button>)}
                        {!options.length && <p className="px-2 py-2 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('room.successor.empty')}</p>}
                        <button type="button" onClick={() => setPickingSuccessor(false)} className="block min-h-9 w-full rounded-xl px-2.5 text-left text-xs font-semibold text-[#7D6D61] dark:text-[#A4AECC] hover:bg-white dark:hover:bg-[#232B47]">{t('common.back')}</button>
                      </div>;
                    }
                    return heirKey
                      ? <div data-successor-note className="space-y-2 rounded-2xl border border-[#EFE2B8] dark:border-[#6E5934] bg-[#FFF8E2] dark:bg-[#2C2519] px-3.5 py-2.5 text-xs text-[#8A6A1F] dark:text-[#F0C882]">
                          <p>{t('room.successor.current', { room: heir?.roomName ?? t('room.successor.other') })}</p>
                          <button type="button" onClick={() => { if (send({ type: 'SET_SUCCESSOR', roomId: menuRoom.id, successorRoomId: null })) setMenuRoomId(null); }} className="min-h-8 rounded-full border border-[#E8D9A8] dark:border-[#6E5934] bg-white dark:bg-[#232B45] dark:text-[#ECE7DF] px-3 font-semibold shadow-2xs transition hover:bg-[#FFFDF9] dark:hover:bg-[#2B3554]">{t('room.successor.cancel')}</button>
                        </div>
                      : <button type="button" onClick={() => setPickingSuccessor(true)} className="flex w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2.5 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99]">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F5EFE6] dark:bg-[#27304D] text-[#8C6D58] dark:text-[#B5BED6]">
                            <ArrowRightLeft size={15} aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('room.successor.choose')}</span>
                            <span className="block text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">{t('room.successor.detail')}</span>
                          </div>
                        </button>;
                  })()}
                  {menuGroup
                    ? <button type="button" data-remove-from-group onClick={async () => { if (await removeFromGroup(menuGroup, menuRoom.id)) setMenuRoomId(null); }} className="flex w-full items-center gap-3 rounded-2xl border border-[#E8C5C9] dark:border-[#5C3240] bg-[#FFF5F6] dark:bg-[#2C1A23] px-3.5 py-2.5 text-left shadow-2xs transition hover:bg-[#FDECEF] dark:hover:bg-[#38212C] active:scale-[0.99]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#3A232E] text-[#A54A59] dark:text-[#F09AA6]">
                          <LogOut size={15} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-[#A54A59] dark:text-[#F5B0BA]">{t('group.member.remove')}</span>
                          <span className="block text-[10.5px] text-[#B8727D] dark:text-[#D995A0]">{t('group.member.keep')}</span>
                        </div>
                      </button>
                    : <button type="button" onClick={runArchive} className="flex w-full items-center gap-3 rounded-2xl border border-[#DDD0C1] dark:border-[#343D5E] bg-[#F5EFE6] dark:bg-[#1C2236] px-3.5 py-2.5 text-left shadow-2xs transition hover:bg-[#ECE3D6] dark:hover:bg-[#242B45] active:scale-[0.99]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6]">
                          <Archive size={15} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-[#5A4A40] dark:text-[#ECE7DF]">{t('room.archive')}</span>
                          <span className="block text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">{menuRoom.live ? t('room.archive.live') : t('room.archive.off')}</span>
                        </div>
                      </button>}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {renameRoom && (
        <div className="guild-backdrop-in fixed inset-0 z-[80] flex items-start justify-center bg-black/30 dark:bg-[#090C16]/68 p-4 pt-[12dvh] sm:items-center sm:pt-4" onClick={() => setRenameRoomId(null)}>
          <form ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="rename-room-title"
            onClick={event => event.stopPropagation()}
            onSubmit={event => {
              event.preventDefault();
              const name = renameValue.trim();
              if (!name) return;
              if (send({ type: 'RENAME', roomId: renameRoom.id, name })) setRenameRoomId(null);
            }}
            className="guild-sheet-in w-full max-w-sm space-y-3 rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-transparent dark:border-[#313958] p-5 shadow-xl">
            <h2 id="rename-room-title" className="text-[15px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF]">{t('room.rename.title')}</h2>
            <label htmlFor="rename-room-input" className="block text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('room.name.label')}</label>
            <input id="rename-room-input" autoFocus required maxLength={80} value={renameValue}
              onChange={event => setRenameValue(event.target.value)}
              className="w-full rounded-xl border border-[#DFD3C3] dark:border-[#343D5E] bg-white dark:bg-[#141A2C] px-3 py-3 text-base text-[#4A3E36] dark:text-[#ECE7DF] focus:outline-[#689B73]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setRenameRoomId(null)} className="flex-1 rounded-xl bg-[#F3ECE1] dark:bg-[#27304D] px-4 py-3 text-sm text-[#4A3E36] dark:text-[#ECE7DF]">{t('common.cancel')}</button>
              <button type="submit" disabled={!renameValue.trim()} className="flex-1 rounded-xl bg-[#4A3E36] dark:bg-[#D88B96] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{t('common.save')}</button>
            </div>
          </form>
        </div>
      )}
      {archiveOpen && (
        <div className="guild-backdrop-in fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/30 dark:bg-[#090C16]/68 p-4" onClick={() => setArchiveOpen(false)}>
          <div ref={focusScope} role="dialog" aria-modal="true" aria-label={t('archive.title')} onClick={event => event.stopPropagation()}
            className="guild-sheet-in w-full max-w-md max-h-[75dvh] overflow-y-auto rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-transparent dark:border-[#313958] text-[#4A3E36] dark:text-[#ECE7DF] p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 flex-1 text-[15px] sm:text-base font-bold leading-snug">{t('archive.title')}</h2>
              <button type="button" onClick={() => setArchiveOpen(false)} aria-label={t('common.close')} className="shrink-0 p-2 text-[#6E5D52] dark:text-[#B5BED6]"><X className="w-5 h-5" /></button>
            </div>
            <button type="button" onClick={() => {
              if (!idleCloseSupported) showToast(t('idle.restart'));
              else send({ type: 'IDLE_ROOMS' });
            }} className="mt-3 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-3 py-2 text-xs text-[#4A3E36] dark:text-[#ECE7DF]">{t('idle.button')}</button>
            {archivedRooms.length > 0 && <>
              <p className="mt-2 text-xs leading-relaxed text-[#7D6D61] dark:text-[#A4AECC]">{t('archive.detail')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => {
                  // Each room is restored by its own Bridge event; the list empties as the confirmations arrive.
                  let sent = 0;
                  for (const room of archivedRooms) if (send({ type: 'ARCHIVE', roomId: room.id, archived: false })) sent++;
                  setSelectedArchived([]);
                  if (sent) showToast(t('archive.restore.all', { count: sent }));
                }} className="rounded-full bg-[#E6F2E8] dark:bg-[#20332C] dark:text-[#A7D3B1] px-3 py-2 text-xs font-bold">{t('archive.restore.all', { count: archivedRooms.length })}</button>
                <button type="button" onClick={() => setSelectedArchived(archivedRooms.filter(room => !room.live && !isRoomPinned(room, protectedKeys)).map(room => room.id))}
                  className="rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] px-3 py-2 text-xs text-[#4A3E36] dark:text-[#ECE7DF]">{t('archive.select.deletable')}</button>
                <button type="button" disabled={!selectedArchived.some(id => archivedRooms.some(room => room.id === id && !room.live && !isRoomPinned(room, protectedKeys)))} onClick={() => { void deleteArchived(selectedArchived.filter(id => archivedRooms.some(room => room.id === id && !room.live && !isRoomPinned(room, protectedKeys)))); }}
                  className="rounded-full bg-[#D9828B] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{t('archive.delete.selected', { count: selectedArchived.length })}</button>
                <button type="button" onClick={() => { void deleteArchived(archivedRooms.filter(room => !room.live && !isRoomPinned(room, protectedKeys)).map(room => room.id)); }}
                  disabled={!archivedRooms.some(room => !room.live && !isRoomPinned(room, protectedKeys))} className="rounded-full border border-[#D9828B] px-3 py-2 text-xs text-[#A94D5A] dark:text-[#F09AA6] disabled:opacity-40">{t('archive.delete.all')}</button>
              </div>
            </>}
            {archivedRooms.length === 0 ? <p className="py-4 text-sm text-[#7D6D61] dark:text-[#A4AECC]">{t('archive.empty')}</p> :
              <ul className="mt-3 space-y-2">{archivedRooms.map(room => (
                <li key={room.id} className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-[#1E253D] border border-transparent dark:border-[#2E3654] p-3">
                  <input type="checkbox" disabled={room.live || isRoomPinned(room, protectedKeys)} checked={selectedArchived.includes(room.id) && !isRoomPinned(room, protectedKeys)}
                    aria-label={t('archive.select.room', { name: characters[room.modelId].characterName, room: room.roomName })}
                    onChange={event => setSelectedArchived(current => event.target.checked ? [...current, room.id] : current.filter(id => id !== room.id))}
                    className="h-5 w-5 shrink-0 accent-[#D9828B] disabled:opacity-40" />
                  <span className="min-w-0 truncate text-sm">{characters[room.modelId].characterName} · {room.roomName}{room.live ? t('archive.running') : ''}</span>
                  {protectionSupported && (() => {
                    const roomProtected = isRoomPinned(room, protectedKeys);
                    return <button type="button" aria-label={t(roomProtected ? 'room.protect.remove' : 'room.protect.add')} title={t(roomProtected ? 'room.protect.remove' : 'room.protect.add')} onClick={() => send({ type: 'PROTECT_ROOM', roomId: room.id, protected: !roomProtected })}
                      className={`shrink-0 rounded-full border p-2 transition active:scale-95 cursor-pointer ${roomProtected
                        ? 'border-[#B5D1B8] dark:border-[#3D5E52] bg-[#E6F2E8] dark:bg-[#20332C] text-[#4E7A55] dark:text-[#96C7A3]'
                        : 'border-[#E5D7C6] dark:border-[#364062] bg-[#FAF5EE] dark:bg-[#232B45] text-[#8C7A6E] dark:text-[#A4AECC] hover:bg-[#F3ECE1] dark:hover:bg-[#2B3554]'}`}>
                      <ShieldCheck size={14} fill={roomProtected ? 'currentColor' : 'none'} />
                    </button>;
                  })()}
                  <button type="button" onClick={() => {
                    if (send({ type: 'ARCHIVE', roomId: room.id, archived: false })) {
                      setSelectedArchived(current => current.filter(id => id !== room.id));
                      setRestoreRoomId(room.id);
                      setArchiveOpen(false);
                    }
                  }} className="shrink-0 rounded-full bg-[#E6F2E8] dark:bg-[#20332C] dark:text-[#A7D3B1] px-3 py-2 text-xs font-bold">{t('archive.restore')}</button>
                </li>
              ))}</ul>}
          </div>
        </div>
      )}

      {/* Modals */}
      {groupMenuId && groupMenu && <div className="guild-backdrop-in fixed inset-0 z-[90] flex items-end justify-center bg-black/30 dark:bg-[#090C16]/68 p-4 sm:items-center" onClick={event => { if (event.target === event.currentTarget) setGroupMenuId(null); }}>
        <div ref={focusScope} role="dialog" aria-modal="true" aria-label={t('group.menu.label')} className="guild-sheet-in max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-transparent dark:border-[#313958] text-[#4A3E36] dark:text-[#ECE7DF] p-5 shadow-xl">
          <h2 className="font-bold">{groupMenu.name}</h2>
          <p className="text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('group.delete.detail')}</p>
          <button type="button" data-group-rename onClick={() => {
            const group = groups.find(item => item.id === groupMenuId);
            if (!group) return;
            setRenameGroupValue(group.name);
            setRenameGroupId(group.id);
            setGroupMenuId(null);
          }} className="min-h-11 w-full rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.rename')}</button>
          {fileTriggersSupported && <button type="button" onClick={() => editFileTriggers(groupMenu.id)} className="min-h-11 w-full rounded-full border border-[#E2D6C5] bg-white font-bold dark:border-[#364062] dark:bg-[#1E253D]">{t('fileTrigger.menu')}</button>}
          {groupBoardSupported && <GroupBoardMenuItem path={groupMenu.boardPath}
            onEdit={() => editGroupBoard(groupMenuId, true)} onOpen={() => setGroupMenuId(null)} />}
          <button type="button" onClick={async () => {
            const group = groups.find(item => item.id === groupMenuId);
            if (!group) return;
            const ok = await confirm({
              title: t('confirm.title.group.delete'),
              message: t('group.delete.confirm', { name: group.name }),
              confirmLabel: t('confirm.action.delete'),
              tone: 'danger',
            });
            if (ok && send({ type: 'GROUP_DELETE', groupId: group.id })) setGroupMenuId(null);
          }} className="min-h-11 w-full rounded-full border border-[#E5C9C9] dark:border-[#5C3240] bg-white dark:bg-[#2C1A23] font-bold text-[#9F4856] dark:text-[#F09AA6]">{t('group.delete')}</button>
          <button type="button" onClick={() => setGroupMenuId(null)} className="min-h-11 w-full rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#1E253D] text-[#4A3E36] dark:text-[#ECE7DF]">{t('common.cancel')}</button>
        </div>
      </div>}
      {fileTriggerGroup && <FileTriggerDialog key={fileTriggerGroup.id} name={fileTriggerGroup.name} root={workspaceRoot}
        onReset={async () => {
          const ok = await confirm({ title: t('fileTrigger.reset'), message: t('fileTrigger.resetConfirm'), confirmLabel: t('fileTrigger.reset'), tone: 'danger' });
          if (ok) send({ type: 'FILE_TRIGGERS_RESET', groupId: fileTriggerGroup.id });
        }}
        integrity={fileTriggerIntegrity[fileTriggerGroup.id]} onConfirmStale={digest => send({ type: 'FILE_TRIGGERS_CONFIRM', groupId: fileTriggerGroup.id, digest })}
        confirmationHint={fileTriggerHint} onSaveHint={hint => send({ type: 'FILE_TRIGGERS_SET_HINT', groupId: fileTriggerGroup.id, hint })}
        items={fileTriggerItems[fileTriggerGroup.id]} listing={boardBrowse?.listing && { ...boardBrowse.listing, parent: boardBrowse.listing.path === workspaceRoot ? null : boardBrowse.listing.parent }}
        onBrowse={path => { if (path === workspaceRoot || path.startsWith(workspaceRoot.replace(/\/$/, '') + '/')) browseBoardFolder(path); }}
        onClose={() => setFileTriggerGroupId(undefined)}
        onAdd={(path, kind) => send({ type: 'FILE_TRIGGERS_ADD', groupId: fileTriggerGroup.id, path, kind })}
        onResumeOffline={(id, offlineToken) => send({ type: 'FILE_TRIGGERS_RESUME', groupId: fileTriggerGroup.id, id, offlineToken })}
        onEnable={(id, enabled) => send({ type: 'FILE_TRIGGERS_SET_ENABLED', groupId: fileTriggerGroup.id, id, enabled })}
        onRemove={async id => {
          const ok = await confirm({ title: t('fileTrigger.remove'), message: t('fileTrigger.removeConfirm'), confirmLabel: t('fileTrigger.remove'), tone: 'danger' });
          if (ok) send({ type: 'FILE_TRIGGERS_REMOVE', groupId: fileTriggerGroup.id, id });
        }} />}
      {boardGroup && <GroupBoardDialog key={boardGroup.id} name={boardGroup.name} path={boardGroup.boardPath} boardRoot={workspaceRoot}
        listing={boardBrowse?.listing} onBrowse={browseBoardFolder}
        onCancel={() => { setBoardEdit(undefined); if (boardEdit?.fromMenu) setGroupMenuId(boardGroup.id); }}
        onSave={path => { if (send({ type: 'GROUP_SET_BOARD', groupId: boardGroup.id, path })) setBoardEdit(undefined); }} />}
      {renameGroupId && groups.find(group => group.id === renameGroupId) && (
        <div className="guild-backdrop-in fixed inset-0 z-[95] flex items-start justify-center bg-black/30 dark:bg-[#090C16]/68 p-4 pt-[12dvh] sm:items-center sm:pt-4" onClick={() => setRenameGroupId(null)}>
          <form ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="rename-group-title" onClick={event => event.stopPropagation()}
            onSubmit={event => {
              event.preventDefault();
              const name = renameGroupValue.trim();
              if (!name) return;
              if (send({ type: 'GROUP_RENAME', groupId: renameGroupId, name })) setRenameGroupId(null);
            }}
            className="guild-sheet-in w-full max-w-sm space-y-3 rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-transparent dark:border-[#313958] p-5 shadow-xl">
            <h2 id="rename-group-title" className="text-[15px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.rename.title')}</h2>
            <input aria-label={t('group.name')} autoFocus required maxLength={80} value={renameGroupValue} onChange={event => setRenameGroupValue(event.target.value)}
              className="w-full rounded-xl border border-[#DFD3C3] bg-white px-3 py-3 text-base text-[#4A3E36] focus:outline-[#689B73]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setRenameGroupId(null)} className="flex-1 rounded-xl bg-[#F3ECE1] px-4 py-3 text-sm">{t('common.cancel')}</button>
              <button type="submit" disabled={!renameGroupValue.trim()} className="flex-1 rounded-xl bg-[#4A3E36] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{t('common.save')}</button>
            </div>
          </form>
        </div>
      )}
      {groupCreateOpen && <GroupCreateModal characters={characters} availableRooms={rooms.filter(room => Boolean(room.sessionId && room.resumable))} busy={groupCreating} error={groupCreateError} onClose={() => setGroupCreateOpen(false)} onCreate={(name, modelIds, existingRoomIds) => {
        setGroupCreateError(undefined);
        if (send({ type: 'GROUP_CREATE', name, modelIds, existingRoomIds })) setGroupCreating(true);
      }} />}
      {inboxOpen && inboxRef.current && <InboxPanel inboxEnabled={inboxSupported} call={inboxRef.current.call} mediaSupported={videoSupported} onOpen={openFile} onClose={() => { setInboxOpen(false); setInboxPendingFirst(false); }} rooms={allRooms} alerts={inboxAlerts} pendingSince={pendingSince} connected={bridge.state === 'connected'} initialPending={inboxPendingFirst} onRoom={id => { setInboxOpen(false); setInboxPendingFirst(false); selectRoom(id); }} />}
      {driveOpen && driveRef.current && <DrivePanel call={driveRef.current.call} desktop={!streetMobileView} onClose={() => setDriveOpen(false)} />}
      {ghOpen && ghRef.current && <GitHubPanel key={JSON.stringify(ghTarget)} call={ghRef.current.call} target={ghTarget} onClose={() => setGhOpen(false)} />}
      {groupMemberRolesSupported && roleEditor && <GroupMemberRoleEditor
        key={`${roleEditor.groupId}/${roleEditor.roomId}`}
        roomName={allRooms.find(room => room.id === roleEditor.roomId)?.roomName ?? roleEditor.roomId}
        role={editedRole} leadRole={editedIsLead ? editedMember?.role : undefined} onClearLeadRole={clearLeadRole} pending={Boolean(roleEditor.pending)} directionSupported={roleDirectionSupported}
        error={roleEditor.error === 'conflict' ? t('group.memberRole.directionConflict') : roleEditor.error ? t(`group.memberRole.${roleEditor.error}`) : !editedMember ? t('group.memberRole.missing') : undefined}
        onSave={saveMemberRole} onClose={() => { if (!roleSaveRef.current || roleSaveRef.current.status !== 'pending') { roleSaveRef.current = undefined; setRoleEditor(undefined); } }} />}
      {readerFile && <FileViewer path={readerFile.path} file={readerFile.file} video={readerFile.video} error={readerFile.error}
        onReveal={streetMobileView ? undefined : () => { send({ type: 'REVEAL_FILE', path: readerFile.path }); }} onClose={() => setReaderFile(undefined)} />}
      {settingsOpen && <SettingsModal characters={characters}
        storage={protectionSupported ? { data: storageUsage, request: days => { setStorageUsage(undefined); send({ type: 'STORAGE_USAGE', days }); } } : undefined}
        soundEnabled={soundEnabled} onSound={value => { setSoundEnabled(value); if (value) playGuildChime('poke', true); }} push={pushControl}
        launchModes={launchModes} onDefaultMode={(modelId, auto) => send({ type: 'SET_DEFAULT_MODE', modelId, auto })} voiceSupported={transcribeSupported}
        autoCompact={autoCompactSupported ? { room: autoCompactRoom, disabled: bridge.state !== 'connected', onChange: (roomId, enabled) => send({ type: 'SET_AUTO_COMPACT', roomId, enabled }),
          ...(autoCompactAll !== undefined ? { all: { enabled: autoCompactAll, onChange: enabled => send({ type: 'SET_AUTO_COMPACT_ALL', enabled }) } } : {}) } : undefined}
        phonePreview={streetMobileView} onPhonePreview={setStreetMobileView} onClose={() => setSettingsOpen(false)}
        restartSupported={restartSupported} restartPending={restartPending} restartMessage={restartMessage} onRestart={() => { void requestBridgeRestart(); }} />}
      {qrOpen && <TailscaleQrModal tailscaleUrl={tailscaleUrl} onClose={() => setQrOpen(false)} />}

      <NewRoomModal key={newRoomModalModel + String(newRoomModalOpen)}
        isOpen={newRoomModalOpen}
        initialModelId={newRoomModalModel}
        workspaceRoot={defaultFolder ?? workspaceRoot}
        folderListing={folderListing}
        onBrowseFolder={path => send({ type: 'LIST_DIRS', path })}
        fixedRoomDirectorySupported={fixedRoomDirectorySupported}
        agyAutoSupported={agyAutoSupported}
        roomLaunchOptionsSupported={roomLaunchOptionsSupported}
        launchDefaults={launchModes?.defaults}
        characters={characters}
        busy={creatingRoom}
        onClose={() => { if (!creatingRoom) setNewRoomModalOpen(false); }}
        onCreateRoom={(modelId, roomName, repoPath, remote, agyAuto, fullAccess) => {
          if (creatingRoom) return;
          if (send({ type: 'CREATE', modelId, roomName, repoPath, remote, agyAuto, fullAccess })) setCreatingRoom(true);
        }}
      />

      {moveRoomTarget && (
        <MoveRoomModal
          key={moveRoomTarget.id}
          isOpen={Boolean(moveRoomTarget)}
          modelId={moveRoomTarget.modelId}
          roomName={`${characters[moveRoomTarget.modelId].characterName} · ${moveRoomTarget.roomName}`}
          currentFolder={moveRoomTarget.repoPath}
          workspaceRoot={defaultFolder ?? workspaceRoot}
          folderListing={folderListing}
          onBrowseFolder={path => send({ type: 'LIST_DIRS', path })}
          busy={movingRoom}
          onClose={() => { if (!movingRoom) setMoveRoomTargetId(null); }}
          onMoveRoom={(folder, copyMemory) => {
            if (movingRoom) return;
            if (send({ type: 'MOVE_ROOM', roomId: moveRoomTarget.id, folder, copyMemory })) setMovingRoom(true);
          }}
        />
      )}

      <UsageCalibrationModal
        isOpen={usageModalOpen}
        characters={characters}
        onClose={() => setUsageModalOpen(false)}
      />

    </div>
    </GitHubOpenContext.Provider>
    </FileOpenContext.Provider>
    </ImagePreviewProvider>
  );
}
