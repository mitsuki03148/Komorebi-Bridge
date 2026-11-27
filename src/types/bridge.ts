// Contents
// - Describe launch modes and terminal keys
// - Route workbench tickets and record handoffs
// - Describe file triggers and worktrees
// - Receive requests from clients
// - Send state and results to clients

import type { GroupRoleChoice } from './groupRoles';
import type { FileUpload } from '../utils/fileAttachments';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from './guild';

// Describe launch modes and terminal keys
// The CLI and Bridge use these types for approval settings and named terminal inputs.
/** Whether CLIs start without asking for approval: a default per CLI, and the choice made for individual rooms. */
export type LaunchModes = { defaults: Record<CLIModelId, boolean>; rooms: Record<string, boolean> };

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'shift-left' | 'shift-right' | 'enter' | 'escape' | 'tab' | 'ctrl-u';

// Route workbench tickets and record handoffs
// The receipt records how a room was selected, and the wake record pins that recipient.
/** One `komorebi-room send` and how it ended (the message itself is never kept). code: 0 sent, 1 failed, 2 bad usage, 3 stopped by a rule. */
export interface HandoffEntry { at: string; from?: string; to: string; code: number; ms: number; note: string }

export type RoleRouteRule = {
  quota: 'both-at-least-40' | 'best-lower-quota' | 'not-compared';
  workload: 'idle-and-empty' | 'idle' | 'empty' | 'busy-with-work';
  rotated: boolean;
};

export type RoleRouteReceipt = { roleKey: string; groupId: string; selectedRoomId: string; rule: RoleRouteRule; hp: number | null; mp: number | null };

export type BenchRoutingError = 'ROLE_UNKNOWN' | 'ROLE_GROUP_REQUIRED' | 'ROLE_GROUP_INVALID' | 'ROLE_NO_ELIGIBLE' | 'ROLE_NEW_TASK_ONLY' | 'ROLE_NOT_SUPPORTED';

/** Separate from legacy ping so an old CLI cannot accidentally follow a successor for a fixed ticket. */
export type FixedBenchWake = { ticket: number; roomId: string; wakeId: string };

// Describe file triggers and worktrees
// These types give the group and repo panels the data returned by the Bridge.
export type FileTriggerStatus = 'disabled' | 'monitoring' | 'waiting-leader' | 'waiting' | 'offline' | 'gap' | 'error';
export type FileTriggerItem = { id: string; path: string; kind: 'file' | 'directory'; enabled: boolean; status: FileTriggerStatus; offlineToken?: string };

export interface RepoWorktree {
  path: string;
  branch: string | null;
  head: string;
  exists: boolean;
  isRoom: boolean;
}

export interface RepoWorktrees {
  entries: RepoWorktree[];
  suggestedWorktree?: string;
  suggestedTitle?: string;
}

export type WorktreeDiffMode = 'branch' | 'work' | 'commit';

// Receive requests from clients
// Each request identifies the action and includes the inputs the Bridge needs.
export type ClientEvent =
  | { type: 'AUTH'; key: string }
  | { type: 'BRIDGE_RESTART' }
  | { type: 'VIEW_ROOM'; roomId: string | null; open?: boolean }
  | { type: 'DRAFT_ROOMS'; roomIds: string[] }
  | { type: 'VIEW_GROUP'; groupId: string; selectedRoomId?: string; wakeSelected?: true }
  | { type: 'GROUP_CREATE'; name: string; modelIds: CLIModelId[]; existingRoomIds?: string[] }
  | { type: 'GROUP_ADD'; groupId: string; modelId: CLIModelId }
  | { type: 'GROUP_ADD_EXISTING'; groupId: string; roomId: string }
  | { type: 'GROUP_REMOVE_MEMBER'; groupId: string; roomId: string }
  | { type: 'GROUP_DELETE'; groupId: string }
  | { type: 'GROUP_RENAME'; groupId: string; name: string }
  | { type: 'FILE_TRIGGERS_GET'; groupId: string }
  | { type: 'FILE_TRIGGERS_RESUME'; groupId: string; id: string; offlineToken: string }
  | { type: 'FILE_TRIGGERS_RESET'; groupId: string }
  | { type: 'FILE_TRIGGERS_CONFIRM'; groupId: string; digest: string }
  | { type: 'FILE_TRIGGERS_SET_HINT'; groupId: string; hint: string }
  | { type: 'FILE_TRIGGERS_ADD'; groupId: string; path: string; kind: 'file' | 'directory' }
  | { type: 'FILE_TRIGGERS_SET_ENABLED'; groupId: string; id: string; enabled: boolean }
  | { type: 'FILE_TRIGGERS_REMOVE'; groupId: string; id: string }
  | { type: 'GROUP_SET_BOARD'; groupId: string; path: string | null }
  | { type: 'GROUP_REORDER'; groupIds: string[] }
  /** What this device has just read: per room, the time of the last agent reply seen. The Bridge keeps the later one and tells every device. */
  | { type: 'READ_MARKS_SET'; marks: Record<string, string> }
  | { type: 'SET_DEFAULT_FOLDER'; path: string }
  | { type: 'SET_AUTO_COMPACT'; roomId: string; enabled: boolean }
  | { type: 'SET_AUTO_COMPACT_ALL'; enabled: boolean }
  | { type: 'LIST_DIRS'; path: string; files?: boolean; requestId?: string }
  | { type: 'READ_FILE'; path: string }
  | { type: 'MEDIA_LINK'; path: string }
  | { type: 'REVEAL_FILE'; path: string }
  /** One GitHub operation for the GitHub panel (see bridge/github.ts); the answer comes back as GH_RESULT with the same requestId. */
  | { type: 'GH'; requestId: string; op: string; params: Record<string, unknown> }
  /** One Google Drive operation for the Drive panel (see bridge/drive.ts); the answer comes back as DRIVE_RESULT with the same requestId. */
  | { type: 'DRIVE'; requestId: string; op: string; params: Record<string, unknown> }
  /** Look into the Inbox folder (read only, see bridge/inbox.ts); the answer comes back as INBOX_RESULT with the same requestId. */
  | { type: 'INBOX'; requestId: string; op: string; params: Record<string, unknown> }
  /** Browse the room's folder or a registered worktree of its repo. Answer: WORKTREE_RESULT. */
  | { type: 'WORKTREE'; requestId: string; op: 'worktrees' | 'list' | 'read' | 'diff'; params: { roomId: string; worktree?: string; query?: string; path?: string; mode?: WorktreeDiffMode } }
  | { type: 'GROUP_SET_ORCHESTRATOR_DIRECTION'; groupId: string; direction: string; requestId?: string }
  | { type: 'GROUP_SET_MEMBER_DIRECTION'; groupId: string; roomId: string; direction: string; expectedRoleKey: string; requestId?: string }
  | { type: 'GROUP_SET_MEMBER_ROLE'; groupId: string; roomId: string; role: GroupRoleChoice; requestId?: string }
  | { type: 'GROUP_SET_ORCHESTRATOR'; groupId: string; roomId: string | null }
  | { type: 'SET_SUCCESSOR'; roomId: string; successorRoomId: string | null }
  | { type: 'GROUP_RESTORE_MEMBER'; groupId: string; roomId: string }
  | { type: 'CREATE'; modelId: CLIModelId; roomName: string; repoPath: string; remote: boolean; agyAuto?: boolean; fullAccess?: boolean }
  | { type: 'START'; roomId: string }
  | { type: 'SET_ROOM_MODE'; roomId: string; auto: boolean }
  | { type: 'SET_DEFAULT_MODE'; modelId: CLIModelId; auto: boolean }
  | { type: 'INPUT'; roomId: string; text: string; menuId?: string; groupId?: string; requestId?: string; attachment?: { mime: string; data: string }; attachments?: { mime: string; data: string }[]; files?: FileUpload[] }
  | { type: 'APPROVAL'; roomId: string; approvalId: string; decision: string; requestId?: string }
  | { type: 'MENU'; roomId: string; menuId: string; key: MenuKey | string }
  | { type: 'TERMINAL_KEY'; roomId: string; screen: string; screenId?: string; key: string }
  /** Answers the question a working CLI has queued: choice/choices are 1-based listed options, text is a typed one. */
  | { type: 'ANSWER_QUESTION'; roomId: string; questionId?: string; choice?: number; choices?: number[]; text?: string; /** One answer per question, for a card with several (Claude or AGY). */ answers?: { choice?: number; choices?: number[]; text?: string }[]; requestId?: string }
  /** An agent's workbench (local only): see bridge/bench.ts. */
  | { type: 'BENCH'; requestId: string; action: string; [key: string]: unknown }
  | ({ type: 'BENCH_WAKE'; phase: 'start' | 'input'; requestId: string } & FixedBenchWake)
  | { type: 'HANDOFF_REPORT'; from?: string; to?: string; code?: number; ms?: number; note?: string }
  | { type: 'HANDOFF_LOG'; requestId: string; last?: number; failedOnly?: boolean }
  | { type: 'INTERRUPT' | 'CLOSE'; roomId: string }
  | { type: 'SYNC'; modelId: CLIModelId }
  | { type: 'ARCHIVE'; roomId: string; archived: boolean }
  | { type: 'PIN_ROOM'; roomId: string; pinned: boolean }
  | { type: 'PROTECT_ROOM'; roomId: string; protected: boolean }
  | { type: 'STORAGE_USAGE'; days: number }
  | { type: 'DELETE_ARCHIVED'; roomIds: string[] }
  | { type: 'IDLE_ROOMS' }
  | { type: 'CLOSE_IDLE'; roomIds: string[] }
  | { type: 'RENAME'; roomId: string; name: string }
  | { type: 'MOVE_ROOM'; roomId: string; folder: string; copyMemory?: boolean; requestId?: string }
  | { type: 'IMAGE_PREVIEW'; roomId: string; path: string }
  | { type: 'HISTORY_MORE'; roomId: string }
  | { type: 'PUSH_SUBSCRIBE'; subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; visible: boolean }
  | { type: 'PUSH_UNSUBSCRIBE' }
  | { type: 'PUSH_VISIBLE'; visible: boolean }
  | { type: 'PUSH_TEST' }
  | { type: 'TRANSCRIBE'; requestId: string; mime: string; data: string; language?: 'zh' | 'yue' | 'en' | 'ja' | 'auto'; style?: 'colloquial' | 'written' };

// Send state and results to clients
// The initial snapshot advertises capabilities. Later events report updates and request results.
export type ServerEvent =
  | { type: 'SNAPSHOT'; readMarksSupported?: boolean; autoCompactSupported?: true; autoCompactAll?: boolean; restartSupported?: boolean; restartInstanceId?: string; rooms: TerminalRoom[]; characters: Record<CLIModelId, CharacterProfile>; tailscaleUrl: string | null; archivedKeys: string[]; pinSupported?: true; pinnedKeys?: string[]; protectedKeys?: string[]; renameSupported: true; deleteArchivedSupported?: true; idleCloseSupported?: true; workspaceRoot?: string; defaultFolder?: string; fixedRoomDirectorySupported?: true; agyAutoSupported?: true; roomLaunchOptionsSupported?: true; roomPresenceSupported?: true; roomDraftsSupported?: true; roomViewStartSupported?: true; attachmentSupported?: true; fileUploadSupported?: true; terminalKeySupported?: true; questionAnswerSupported?: true; imagePreviewSupported?: true; videoSupported?: true; worktreeSupported?: true; historyPagingSupported?: true; pushPublicKey?: string; launchModes?: LaunchModes; launchModesSupported?: true; transcribeSupported?: boolean; groups?: GroupChat[]; groupBoardSupported?: true; inboxSupported?: true; groupMemberRolesSupported?: true; roleDirectionSupported?: true; fileTriggersSupported?: true; roleRoutingSupported?: true; groupMemberRolesNeedRepair?: true; successors?: Record<string, string> }
  | { type: 'BRIDGE_RESTART_NOTICE' }
  | { type: 'BRIDGE_RESTART_RESULT'; ok: true }
  | { type: 'BRIDGE_RESTART_RESULT'; ok: false; code: 'unsupported' | 'busy' | 'cooldown' | 'failed' }
  | { type: 'FILE_TRIGGERS_STATE'; groupId: string; items: FileTriggerItem[]; confirmationHint: string; integrity?: 'ok' | 'stale' | 'invalid'; stalePaths?: string[]; staleDigest?: string; staleHint?: string }
  | { type: 'GROUP'; group: GroupChat; select?: boolean }
  | { type: 'GROUP_MEMBER_ROLE_RESULT'; requestId: string; ok: true }
  | { type: 'GROUP_MEMBER_ROLE_RESULT'; requestId: string; ok: false; code: 'invalid' | 'missing' | 'repair' | 'failed' | 'conflict' }
  | { type: 'GROUP_MEMBER_ROLE_WARNING'; code: 'conflict' }
  | { type: 'GROUP_REMOVED'; groupId: string }
  | { type: 'IDLE_ROOMS_RESULT'; candidates: { roomId: string; name: string }[]; busy: number; tickets: number }
  | { type: 'CLOSE_IDLE_RESULT'; closed: string[]; skipped: { roomId: string; reason: 'busy' | 'tickets' }[] }
  | { type: 'GROUPS_ORDER'; groupIds: string[] }
  /** Read marks the Bridge holds: all of them on connect, then only what changed. */
  | { type: 'READ_MARKS'; marks: Record<string, string> }
  | { type: 'DEFAULT_FOLDER'; path: string }
  | { type: 'GH_RESULT'; requestId: string; ok: boolean; data?: unknown; message?: string }
  | { type: 'DRIVE_RESULT'; requestId: string; ok: boolean; data?: unknown; message?: string }
  | { type: 'INBOX_RESULT'; requestId: string; ok: boolean; data?: unknown; message?: string }
  | { type: 'INBOX_ALERTS'; data: import('../../bridge/inbox-alerts').InboxAlertScan }
  | { type: 'WORKTREE_RESULT'; requestId: string; ok: boolean; data?: unknown; message?: string }
  | { type: 'FILE'; path: string; text?: string; truncated?: boolean; size?: number; error?: string }
  | ({ type: 'MEDIA_LINK_RESULT'; path: string } & ({ url: string; expiresAt: number } | { error: string }))
  | { type: 'DIRS'; path: string; parent: string | null; dirs: string[]; files?: string[]; requestId?: string; error?: string }
  | { type: 'SUCCESSORS'; successors: Record<string, string> }
  | { type: 'MOVE_ROOM_RESULT'; requestId?: string; ok: boolean; roomId?: string; newRoomId?: string; message: string }
  | { type: 'ARCHIVED'; archivedKeys: string[]; archivedRoomId?: string; restoredRoomId?: string; quiet?: true }
  | { type: 'PINS'; pinnedKeys: string[] }
  | { type: 'PROTECTED_ROOMS'; protectedKeys: string[] }
  | { type: 'STORAGE_USAGE'; data: import('../../bridge/storage-usage').StorageUsage }
  | { type: 'ROOM'; room: TerminalRoom; select?: boolean }
  | { type: 'SYNC_UPDATE'; character: CharacterProfile; room?: TerminalRoom }
  | { type: 'ROOM_REMOVED'; roomId: string; replacementRoomId?: string; /** The Founder deleted this archived room for good. */ deleted?: boolean }
  | { type: 'NOTICE'; message: string }
  | { type: 'ERROR'; message: string }
  | { type: 'LAUNCH_MODES'; launchModes: LaunchModes }
  | { type: 'AUTO_COMPACT_ALL'; enabled: boolean }
  | { type: 'ATTENTION'; roomId: string; message: string }
  | { type: 'TRANSCRIBE_RESULT'; requestId: string; ok: boolean; text?: string; message?: string }
  | { type: 'ACTION_RESULT'; requestId: string; ok: boolean; message: string }
  /** Ticket dispatch and completion events drive the group avatar overlays. */
  | { type: 'BENCH_FLOW'; fromRoomId: string; toRoomId: string; kind: 'task' | 'done'; ticket: number }
  | { type: 'HANDOFF_LOG_RESULT'; requestId: string; entries: HandoffEntry[] }
  | { type: 'BENCH_RESULT'; requestId: string; ok: boolean; stop?: boolean; errorCode?: BenchRoutingError; route?: RoleRouteReceipt; wake?: FixedBenchWake; lines: string[]; ping?: { to: string; from: string; text: string; ticket: number } }
  | { type: 'IMAGE_PREVIEW'; roomId: string; path: string; ok: true; mime: string; data: string; size: number; resized: boolean }
  | { type: 'IMAGE_PREVIEW'; roomId: string; path: string; ok: false; message: string }
  | { type: 'PUSH_RESULT'; ok: boolean; message: string; enabled?: boolean }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'NETWORK'; tailscaleUrl: string | null };
