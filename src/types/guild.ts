// Contents
// - Identify CLI roles and groups
// - Describe pending approvals and questions
// - Record conversations and task steps
// - Describe the state of a terminal room
// - Describe a character and its usage

import type { GroupMemberRole } from './groupRoles';

// Identify CLI roles and groups
// Groups name their members by room and can assign a role and lead.
export type CLIModelId = 'AGY' | 'CODEX' | 'CLAUDE';

export interface GroupChat {
  id: string;
  name: string;
  members: { modelId: CLIModelId; roomId: string; role?: GroupMemberRole }[];
  createdAt: string;
  /** Absolute path to the group's notice board, if configured. */
  boardPath?: string;
  rosterShared?: true;
  /** The member that now leads the group: where reports go when nobody says otherwise. */
  orchestratorRoomId?: string;
  /** The Founder took the lead away on purpose: no member is made the lead by default until one is named again. */
  orchestratorCleared?: true;
  /** What the Founder wants of whoever holds the lead's seat. It belongs to the seat, so it stays when the crown moves to another room. */
  orchestratorDirection?: string;
}

// Describe pending approvals and questions
// The Bridge records prompts the room cannot continue past until someone responds.
export interface PendingApproval {
  id: string;
  type: 'file_edit' | 'shell_command' | 'migration' | 'workspace_trust';
  title: string;
  commandOrFile: string;
  riskLevel: 'normal' | 'elevated';
  reason: string;
  diffLines: {
    type: 'add' | 'del' | 'ctx';
    lineNum: string;
    content: string;
  }[];
  requestedAt: string;
  additionalChoices?: { id: string; key?: string; label: string }[];
}

/** One or more questions an agent asked the user. An option list means choose one (or several when multiSelect is true); null means the answer is typed. */
export interface PendingQuestion {
  /** When it was asked; also identifies it. */
  id: string;
  questions: { title: string; options: string[] | null; multiSelect?: boolean }[];
}

// Record conversations and task steps
// A transcript row can carry a question, an attachment or the latest checklist.
export type TaskStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
export interface TaskStep { title: string; status: TaskStepStatus; }

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  createdAt?: string;
  sender: 'system' | 'user' | 'agent';
  text: string;
  codeBlock?: string;
  /** This message is a question the agent put to the user: still waiting, or answered. */
  question?: 'open' | 'answered';
  /** This message is the agent's task checklist (AGY `update_steps`): the latest list of the turn, in order. */
  steps?: TaskStep[];
  /** Pictures the user sent with this message, as files on the Mac, so the sender can see what was sent. */
  images?: string[];
}

// Describe the state of a terminal room
// Room snapshots combine the CLI session, current screen and conversation.
export type RoomStatus = 'running' | 'waiting_approval' | 'idle' | 'completed';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface RemoteControlSession {
  enabled: boolean;
  sessionUrl: string;
  relayCode: string;
  connectedDevice: string;
  liveAppViewers: number;
  autoLaunchedFlag: string;
}

export interface TerminalStyleRun {
  start: number;
  end: number;
  foreground?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
}

export interface TerminalRoom {
  id: string;
  modelId: CLIModelId;
  roomName: string;
  repoPath: string;
  gitBranch: string;
  selectedSubModel: string;
  effortLevel: EffortLevel | null;
  /** Codex only: Fast mode (a faster tier that uses more of the allowance) is on. Unknown until the footer has been seen. */
  fastMode?: boolean;
  effortSource?: 'live' | 'session';
  contextUsagePct: number | null;
  /** The real numbers behind the share, when the CLI's record gives them. */
  contextTokens?: number;
  contextWindow?: number;
  /** Whether this room opted in and whether the current CLI was launched with that policy. */
  autoCompact?: boolean;
  autoCompactActive?: boolean;
  syncSource: string;
  syncedStateFile: string;
  status: RoomStatus;
  progressPercent: number | null;
  currentActionSummary: string;
  bubbleSnippet: string;
  updatedAt: string;
  remoteControl: RemoteControlSession;
  pendingApproval?: PendingApproval;
  /** The Bridge can find an unanswered question in the CLI transcript or screen. */
  pendingQuestion?: PendingQuestion;
  /** The CLI was started with the workbench hook, so tickets reach it while it works without a message. */
  benchHooked?: boolean;
  screen?: string;
  screenId?: string;
  screenStyles?: TerminalStyleRun[];
  menu?: { id: string; title: string; confirm: boolean; numberKeys?: string[]; yesNo?: boolean };
  live?: boolean;
  ready?: boolean;
  /** How many background tasks (shells, terminals) the CLI shows as still running; none when it shows none. */
  backgroundTasks?: number;
  /** The CLI's input box is open even while it works, so a prompt can steer it mid-turn. */
  steerable?: boolean;
  /** Older messages exist that this room does not show. */
  historyTruncated?: boolean;
  /** How many recent messages this room was asked to hold, once more were loaded. */
  historyLimit?: number;
  sessionId?: string;
  /** The CLI was started without asking for approval (Claude/Codex full access, AGY Turbo). */
  autoMode?: boolean;
  remoteStatus?: 'off' | 'connecting' | 'on' | 'unknown';
  resumable?: boolean;
  logs: TerminalLogEntry[];
}

// Describe a character and its usage
// The roster uses this profile for presentation, model options and quota history.
export interface CharacterProfile {
  id: CLIModelId;
  characterName: string;
  japaneseRomaji: string;
  roleTitle: string;
  genderBadge: string;
  cliToolName: string;
  avatarUrl: string;
  themeColorHex: string;
  availableSubModels: string[];
  modelOptions?: { id: string; label: string; efforts?: EffortLevel[] }[];
  hp5h: {
    current: number | null;
    usedPercent: number | null;
    /** Epoch milliseconds when the 5-hour window refreshes, if the Bridge reports it. */
    resetsAt?: number | null;
    resetVouchers: number | null;
    resetCommandHint: string;
  };
  mpWeekly: {
    current: number | null;
    usedPercent: number | null;
    /** Epoch milliseconds when the weekly window refreshes, if the Bridge reports it. */
    resetsAt?: number | null;
    resetDayText: string;
    tokensUsed: string;
    tokensLimit: string;
  };
  localSync: {
    cliStateDir: string;
    appSupportDir: string;
    syncedFilesCount: number;
    lastSyncedAt: string;
    syncStatus: 'synced' | 'watching' | 'syncing';
    latestSyncedFile: string;
  };
  remoteCommand: string;
  companionAppName: string;
  quotes: {
    running: string;
    waiting_approval: string;
    idle: string;
  };
  usageHistory: {
    time: string;
    /** When the reading was taken (milliseconds since 1970). */
    at?: number;
    hp: number | null;
    mp: number | null;
  }[];
}
