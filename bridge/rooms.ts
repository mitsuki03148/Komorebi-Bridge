// Contents
// Runtime state — See LiveRoom, the fields at the start of Rooms, and timing fields beside their methods.
// Input diagnostics — Record input timing and outcomes without saving message or screen text.
// Prompt policy — Tell a room on its first eligible prompt that it is working alone.
// Attachment request validation — Accept older image requests and enforce the current file and image limits.
// Usage and model catalogue — Refresh quota readings, daily history and the models shown in pickers.
// Room records — Create room records and keep their recent conversation.
// CLI launch arguments — Build each CLI's flags for room settings, session state and workbench hooks.
// Group wake — Check whether a group room can open and prevent duplicate live sessions.
// Room model settings — Track each room's model, effort and speed and apply saved choices when it opens.
// Room identity and storage — Link rooms to native sessions and preserve room settings across restarts.
// Transcript watching — Watch native session files and update room history as they change.
// Room lifecycle — Start, resume, fork and close room terminals while keeping their session links.
// Screen refresh — Read terminal output and update room readiness, menus and pending cards.
// Answer terminal cards — Send question answers and approval decisions through the terminal.
// Send input — Prepare attachments, send or defer input and verify what reached the terminal.
// Remote Control — Read room connection state and manage the Mac's Codex Remote Control setting.
// Archive idle rooms — List idle rooms and recheck the selection before archiving.
// Delete archived rooms — Check transcript ownership before removing rooms and moving eligible files to the Trash.
// Handle client requests — Check incoming room events and dispatch them against the current room and terminal state.

import { execFile } from 'node:child_process';
import { LaunchModeStore } from './launch-modes';
import { AutoCompactRooms, autoCompactArgs, autoCompactTarget, supportsAutoCompact } from './auto-compact';
import { DailyUsageStore } from './usage-history';
import { RoomPins } from './pins';
import { RoomProtection } from './room-protection';
import { randomBytes, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lstat, mkdtemp, open, readFile, realpath, rm, stat } from 'node:fs/promises';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync, watch as watchFileSystem, watchFile, unwatchFile } from 'node:fs';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { spawn, type IPty } from 'node-pty';
import type { Terminal as TerminalType } from '@xterm/headless';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { ClientEvent, MenuKey, ServerEvent } from '../src/types/bridge';
import type { CLIModelId, TerminalLogEntry, TerminalRoom } from '../src/types/guild';
import { checkedInput } from './input';
import { AttachmentLedger, ownedImageName, trashAttachments, trashSessionFiles } from './attachment-trash';
import { attachmentDirectory, saveAttachment, saveFileAttachments } from './attachments';
import { attachmentCountIssue, maxAttachments, maxFiles, originalUploadName } from '../src/utils/fileAttachments';
import { loadImagePreview } from './images';
import { extractImagePaths } from '../src/utils/imagePaths';
import { agyUsage, claudeUsage, codexUsage, type Usage } from './usage';
import { cliIds, deepTranscriptWindow, entryTime, forkRecoveryIntervalMs, forkRecoveryLimitMs, historyLimit, historyMax, home, inTimeOrder, insertByTime, isInside, mergeHistory, newRoomDirectory, readSession, roomDirectory, sessionRoots, watchSessions, type SavedSession } from './sessions';
import { activeModel, agyQuestionScreen, approvalPrompt, backgroundTasks, codexDraftMatches, codexFastMode, codexStatusSession, composerText, hasWorkingIndicator, isComposer, modelConfirmationChoices, numberedMenuChoices, questionOpen, questionPanel, readUsage, resumePrompt, visibleMenu } from './terminal';
import { readTerminalScreen } from './screen';
import type { ReserveRoster } from './groups';
import { fileLabels, fileReadSuffix, userTextKey } from '../src/utils/transcriptText';
import { startsWithBridgeNote } from '../src/utils/bridgeNote';
import { HISTORY_STEP } from '../src/utils/history';
import { endsWithReport, lastAgentEntry } from '../src/utils/attentionDiff';
import { forkAgyConversation } from './room-replace';

const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless');
const run = promisify(execFile);
const keyCodes: Record<MenuKey, string> = {
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', 'shift-left': '\x1b[1;2D', 'shift-right': '\x1b[1;2C', enter: '\r', escape: '\x1b', tab: '\t',
  'ctrl-u': '\x15',
};

/** A screen flagged "updating" for this long, with no key sent and no output, is not updating: it is read again before a button is refused. */
const staleScreenMs = 1_500;

// Runtime state
// Keep track of the live terminal, pending input and lifecycle callbacks.
interface LiveRoom {
  /** When the Bridge last sent a key to this CLI. */
  keyAt?: number;
  /** The "Resume this conversation?" menu was already reported for this appearance. */
  resumeReported?: boolean;
  process: IPty;
  /** Whether this run was opened with Remote Control, so a reopen (permission mode change) keeps it. */
  remote?: boolean;
  reportBaseline?: string | null;
  terminal: TerminalType;
  closing?: Promise<void>;
  resolveClose?: () => void;
  closedAutomatically?: boolean;
  requested?: string;
  submitted?: NodeJS.Timeout;
  submissionResult?: ActionResult;
  refresh?: NodeJS.Timeout;
  queued: number;
  dirty: boolean;
  /** Last time the CLI wrote to the terminal; Enter waits for output to settle after a paste. */
  lastOutputAt?: number;
  /** An image is being attached to the CLI input; other input waits until it is confirmed. */
  attaching?: boolean;
  preparingAttachments?: boolean;
  /** The single-room note has gone out with this run's first prompt. */
  singleNoted?: boolean;
  approvalFingerprint?: string;
  answered?: string;
  discoveredSessionId?: string;
  forkedFromSession?: string;
  resolvedCwd?: string;
  probedSession?: boolean;
  sessionProbe?: NodeJS.Timeout;
  agySessionLog?: string;
  disposeSessionLog?: () => void;
  disposeForkRollout?: () => void;
  forkRecoveryAttempted?: boolean;
  seenTranscriptAgents?: Set<string>;
  seenTranscriptUsers?: Set<string>;
  matchedLocalUsers?: Set<string>;
  deferredInput?: { input: string; original: string; images?: string[]; timer: NodeJS.Timeout; result: ActionResult; reserveRoster?: ReserveRoster; inputTraceId?: string };
}

type ActionResult = (ok: boolean, message: string) => void;

// Input diagnostics
// Record input timing and outcomes without saving message or screen text.
type InputWaitBranch = 'quiet' | 'typed-prefix' | 'patience' | 'max-wait';
type InputFailure = 'roster-unavailable' | 'bracketed-paste-disabled' | 'paste-write-failed' | 'state-changed' |
  'enter-write-failed' | 'max-wait' | 'submission-cancelled' | 'still-typed' | 'idle-wake-rejected' | 'idle-wake-error' |
  'unread-retry-rejected' | 'unread-retry-error' | 'stall-nudge-rejected' | 'stall-nudge-error' | 'cleanup-unconfirmed';
type InputTrace = ReturnType<typeof beginInputTrace>;

const inputLogLimit = 2 * 1024 * 1024;

export function beginInputTrace(path: string, room: TerminalRoom, text: string, source: 'submit' | 'idle-wake' | 'unread-retry' | 'stall-nudge', requestId = randomBytes(4).toString('hex')) {
  const entry = {
    timestamp: new Date().toISOString(), source, requestId, roomId: room.id, modelId: room.modelId,
    utf16Length: text.length, newlineCount: 0, ready: Boolean(room.ready), steerable: Boolean(room.steerable), status: room.status,
    waitBranch: null as InputWaitBranch | null, waitMs: 0, enterCount: source === 'submit' ? 0 : null as number | null,
  };
  const measure = (input: string) => {
    entry.utf16Length = input.length;
    entry.newlineCount = 0;
    for (let pos = input.indexOf('\n'); pos !== -1; pos = input.indexOf('\n', pos + 1)) entry.newlineCount++;
  };
  measure(text);
  let finished = false;
  return {
    requestId, measure,
    waited(branch: InputWaitBranch | null, ms: number) {
      entry.waitBranch = branch;
      entry.waitMs = ms;
    },
    enter() { if (entry.enterCount !== null) entry.enterCount++; },
    finish(reason?: InputFailure) {
      if (finished) return;
      finished = true;
      // Only metadata is written. In particular, never pass prompt text, screen text or exception messages.
      try {
        const row = JSON.stringify({ ...entry, result: reason ? 'failed' : 'sent', reason: reason ?? null }) + '\n';
        const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
        if (size > 0 && size + Buffer.byteLength(row) > inputLogLimit) renameSync(path, path + '.1');
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, row, { mode: 0o600 });
      } catch { /* Diagnostics must never prevent sending input. */ }
    },
  };
}

// Prompt policy
// Tell a room on its first eligible prompt that it is working alone.
/** Added to the first prompt of a room that is on its own, so its agent works alone instead of handing work to other rooms. It starts like the group roster so the conversation record still matches what was sent. */
export const singleRoomNote = ' ===== 呢間係單人房，冇其他成員。自己完成任務，唔好用工作台或 `komorebi-room send` 派工畀其他房。要協作，等 Founder 指明。';

/** Native attachment markers each CLI shows after a lone image path is pasted. */
const attachmentMarkers: Record<CLIModelId, RegExp> = {
  AGY: /(\d+) media attached/gi,
  CODEX: /\[Image #(\d+)\]/g,
  CLAUDE: /\[Image #(\d+)\]/g,
};
export function attachedImages(modelId: CLIModelId, screen: string) {
  return [...screen.matchAll(attachmentMarkers[modelId])].reduce((most, match) => Math.max(most, Number(match[1])), 0);
}
function screenText(live: LiveRoom) {
  try { return readTerminalScreen(live.terminal, rows).screen; } catch { return undefined; }
}

const pasteQuietMs = 150;
const pasteMaxWaitMs = 8_000;
/** True while the CLI's own screen says it is still taking in pasted content. */
function pasteInProgress(live: LiveRoom) {
  try {
    return /Pasting(?:…|\.{3})/.test(readTerminalScreen(live.terminal, rows).screen.split('\n').slice(-12).join('\n'));
  } catch {
    return false;
  }
}

const cols = 112;
const rows = 42;

// Attachment request validation
// Accept older image requests and enforce the current file and image limits.
/** The images sent with a message: the new list, or the single image older clients send. At most four. */
export const maxImages = maxAttachments;
function imagesOf(event: { attachment?: unknown; attachments?: unknown }): unknown[] {
  if (event.attachments !== undefined) {
    if (!Array.isArray(event.attachments) || event.attachments.length > maxImages) throw new Error(`一次最多 ${maxImages} 張圖片。`);
    return event.attachments;
  }
  return event.attachment ? [event.attachment] : [];
}

function attachmentsOf(event: { attachment?: unknown; attachments?: unknown; files?: unknown }) {
  const imageList = imagesOf(event);
  const fileList = event.files === undefined ? [] : event.files;
  if (!Array.isArray(fileList)) throw new Error('檔案附件清單無效。');
  const issue = attachmentCountIssue(imageList.length, fileList.length);
  if (issue === 'files') throw new Error(`一次最多 ${maxFiles} 個檔案。`);
  if (issue === 'total') throw new Error(`一次最多 ${maxAttachments} 個附件。`);
  return { imageList, fileList, attachmentCount: imageList.length + fileList.length };
}

const roomIdFor = (modelId: CLIModelId, id: string) => `session-${modelId.toLowerCase()}-${id}`;
const sessionUuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const codexSessionLine = new RegExp(`^\\s*[│║]?\\s*Session:\\s+(${sessionUuid})(?:\\s*[│║])?\\s*$`, 'im');
const validSessionId = new RegExp(`^${sessionUuid}$`, 'i');
const maxLiveCli = 12;

// Usage and model catalogue
// Set the refresh intervals and read the model options that Codex exposes to the picker.
/** How often the HP and MP readings, and Codex's model list, are taken again. */
const usageRefreshMs = 60_000;
const agyModelRefreshMs = 5 * 60_000;

/** The models Codex lists in its own cache (`models_cache.json`); a hidden model is left out. Throws if the file is not the expected shape. */
export function codexModelsFromCache(raw: string) {
  const listed = (JSON.parse(raw).models as { slug: unknown; visibility: unknown; display_name?: string; supported_reasoning_levels?: { effort: string }[] }[])
    .filter(model => model.visibility === 'list' && typeof model.slug === 'string') as { slug: string; display_name?: string; supported_reasoning_levels?: { effort: string }[] }[];
  return {
    availableSubModels: listed.map(model => model.slug),
    modelOptions: listed.map(model => ({
      id: model.slug, label: model.display_name || model.slug,
      efforts: (model.supported_reasoning_levels || []).map(level => level.effort)
        .filter(effort => ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)),
    })),
  };
}
export const groupWakeNotice = {
  open: '這間房的 CLI 已開啟。',
  starting: '這間房的 CLI 正在啟動。',
  archived: '請先解除封存，再開啟 CLI。',
  unverified: '未有已核實又可續接的 Session。請先確認原房。',
  limit: `已開啟 ${maxLiveCli} 個 CLI，請先關閉一間。`,
} as const;
const agySessionLine = new RegExp(`\\] (?:Streaming|Resuming) conversation (${sessionUuid})\\b`, 'gi');

interface RoomBinding {
  roomId: string;
  sessionId: string;
  modelId: CLIModelId;
  roomName: string;
  cwd: string;
}

async function agyLogSession(file: string) {
  const handle = await open(file, 'r').catch(() => undefined);
  if (!handle) return;
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, size - buffer.length);
    return [...buffer.toString('utf8', 0, bytesRead).matchAll(agySessionLine)].at(-1)?.[1];
  } finally {
    await handle.close();
  }
}

// Room records
// Create room records and keep their recent conversation.
function newRoom(modelId: CLIModelId, roomName: string, cwd: string, id = randomUUID() as string): TerminalRoom {
  return {
    id, modelId, roomName, repoPath: cwd, gitBranch: '—', selectedSubModel: '—',
    effortLevel: null, contextUsagePct: null, progressPercent: null,
    syncSource: '', syncedStateFile: '', status: 'idle', currentActionSummary: 'CLI 未啟動',
    bubbleSnippet: '', updatedAt: new Date().toISOString(), logs: [], remoteStatus: 'off',
    remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' },
  };
}

function log(room: TerminalRoom, sender: TerminalLogEntry['sender'], text: string, images?: string[]) {
  const now = new Date();
  const limit = Math.max(historyLimit, room.historyLimit ?? 0);
  if (room.logs.length >= limit) room.historyTruncated = true;
  room.logs = [...room.logs.slice(-(limit - 1)), { id: randomUUID(), timestamp: now.toLocaleTimeString(), createdAt: now.toISOString(), sender, text, ...(images?.length ? { images } : {}) }];
}

function hasConversation(room: TerminalRoom) {
  return room.logs.some(entry => entry.sender === 'user' || entry.sender === 'agent');
}

// CLI launch arguments
// Build each CLI's flags for room settings, session state and workbench hooks.
/** Where the workbench hook script is, when a room should get it (group rooms only). */
export interface BenchLaunch { hook: string }

export function claudeModelFlag(name: string | undefined) {
  const text = (name ?? '').trim();
  if (/^claude-[a-z0-9.-]+$/i.test(text)) return text.toLowerCase();
  const match = /^(?:Claude )?(Sonnet|Opus|Haiku|Fable|Mythos) (\d+)(?:\.(\d+))?$/i.exec(text);
  return match ? `claude-${match[1].toLowerCase()}-${match[2]}${match[3] !== undefined ? `-${match[3]}` : ''}` : undefined;
}
/** What `claude --model` takes from the picker or a typed `/model`: a full id, or a family name the CLI resolves to its newest model. */
export function claudeModelArgument(value: string | undefined) {
  const text = (value ?? '').trim().toLowerCase();
  return /^(?:claude-[a-z0-9.-]+|opus|sonnet|haiku|fable|mythos)$/.test(text) ? text : undefined;
}
/** The effort levels `claude --effort` takes (a room can also show "ultra", which it does not). */
export const claudeEffortFlag = (effort: string | null | undefined) => effort && /^(low|medium|high|xhigh|max)$/.test(effort) ? effort : undefined;

/**
 * The workbench hook for Codex and Claude: after each tool and when a prompt arrives, the CLI asks the Bridge for new
 * tickets. Codex runs a hook only once it is trusted; the Bridge's own hook is let through for this launch.
 */
function benchHookArgs(modelId: CLIModelId, bench: BenchLaunch | undefined): string[] {
  if (!bench) return [];
  // The hook command goes through a shell, so a path with a space or quote must not split. A plain path stays as it was.
  const path = /^[\w@%+=:,./-]+$/.test(bench.hook) ? bench.hook : `'${bench.hook.replace(/'/g, `'\\''`)}'`;
  const command = (cli: string) => `${path} ${cli}`;
  if (modelId === 'CODEX') {
    const handler = `{type="command",command=${JSON.stringify(command('codex'))},timeout=5}`;
    return ['--dangerously-bypass-hook-trust',
      '-c', `hooks.PostToolUse=[{matcher="*",hooks=[${handler}]}]`,
      '-c', `hooks.UserPromptSubmit=[{hooks=[${handler}]}]`,
      '-c', `hooks.SessionStart=[{matcher="compact",hooks=[${handler}]}]`];
  }
  if (modelId === 'CLAUDE') {
    const handler = { type: 'command', command: command('claude'), timeout: 5 };
    return ['--settings', JSON.stringify({ hooks: { PostToolUse: [{ matcher: '*', hooks: [handler] }], UserPromptSubmit: [{ hooks: [handler] }], SessionStart: [{ matcher: 'compact', hooks: [handler] }] } })];
  }
  return []; // AGY takes hooks only from a plugin (see scripts/komorebi-bench-plugin.sh), not from launch options.
}

export function cliLaunch(room: TerminalRoom, remote: boolean, agyAuto = false, fullAccess = false, bench?: BenchLaunch, agyModel?: string, codexFast?: boolean, claudeChoice?: { model?: string; effort?: string }, forkFromSession?: string, compactArgs: string[] = []): [string, string[]] {
  const resume = room.sessionId;
  const hooks = benchHookArgs(room.modelId, bench);
  if (room.modelId === 'CODEX') {
    const args = ['--no-alt-screen', '-c', 'check_for_update_on_startup=false', ...compactArgs,
      // Each room has its own speed; /fast writes Codex's one config file, so every start says which tier it wants.
      ...(codexFast === undefined ? [] : ['-c', `service_tier="${codexFast ? 'priority' : 'default'}"`]),
      ...(remote ? ['--remote', 'unix://'] : []),
      ...(fullAccess ? ['-s', 'danger-full-access', '-a', 'never'] : ['-c', 'approvals_reviewer="user"', '-s', 'workspace-write', '-a', 'on-request']),
      ...(remote ? ['-C', room.repoPath] : [])];
    return ['codex', [...hooks, ...(forkFromSession ? ['fork', ...args, forkFromSession] : resume ? ['resume', ...args, resume] : args)]];
  }
  if (room.modelId === 'CLAUDE') {
    return ['claude', [
      '--ax-screen-reader', '--permission-mode', fullAccess ? 'bypassPermissions' : 'default', ...hooks, ...compactArgs,
      ...(remote ? ['--remote-control'] : []),
      ...(claudeChoice?.model ? ['--model', claudeChoice.model] : []), ...(claudeChoice?.effort ? ['--effort', claudeChoice.effort] : []),
      ...(forkFromSession
        ? ['--resume', forkFromSession, '--fork-session']
        : resume
          ? ['--resume', resume]
          : validSessionId.test(room.id)
            ? ['--session-id', room.id]
            : []),
    ]];
  }
  // The pink shield on is Turbo: no sandbox and nothing asks for approval (the CLI still blocks its own list of dangerous commands).
  // Off, the CLI runs in its sandbox and asks for each step.
  return ['agy', [
    ...(agyAuto ? ['--settings', '{"toolPermission":"always-proceed"}', '--dangerously-skip-permissions']
      : ['--sandbox', '--settings', '{"toolPermission":"strict"}']),
    // A model given here belongs to this session only; the CLI's own /model would change it for every room.
    ...(agyModel ? ['--model', agyModel] : []),
    ...(remote ? ['--remote-control'] : []),
    ...(forkFromSession ? ['--conversation', room.id] : resume ? ['--conversation', resume] : []),
  ]];
}

export class Rooms {
  readonly characters = structuredClone(INITIAL_CHARACTERS);
  /** How long to wait for a CLI to show its attachment marker after an image path is pasted. */
  attachConfirmMs = 6_000;
  /** Where session files live; tests point these at a temporary directory. */
  sessionHome = home;
  sessionRootDirs: Record<CLIModelId, string[]> = Object.fromEntries(cliIds.map(id => [id, [...sessionRoots[id].map(suffix => join(home, suffix)), ...(id === 'CODEX' ? [join(home, '.codex/archived_sessions')] : [])]])) as Record<CLIModelId, string[]>;
  /** Overridable so tests can point previews at a temporary directory. */
  imagePreviewOptions: { home?: string; roots?: string[]; limit?: number } = {};
  /** When to re-read the screen after Enter to catch a swallowed submission. */
  submitCheckMs = 1_500;
  readonly rooms = new Map<string, TerminalRoom>();
  private readonly live = new Map<string, LiveRoom>();
  private readonly starting = new Set<string>();
  private readonly retainedRooms = new Set<string>();
  private readonly groupWatches = new Map<string, { file: string; stop: () => void }>();
  private readonly saved = new Map<string, SavedSession>();
  private readonly archivePath = join(process.cwd(), '.env.komorebi-room-archive.json');
  private readonly pins = new RoomPins(join(process.cwd(), '.env.komorebi-pins.json'));
  private readonly protection = new RoomProtection(join(process.cwd(), '.env.komorebi-room-protection.json'));
  private readonly deletedPath = join(process.cwd(), '.env.komorebi-room-deleted.json');
  private readonly namesPath = join(process.cwd(), '.env.komorebi-room-names.json');
  /** The model (with its effort) each AGY room runs with, so a change in one room does not reach the others. */
  private readonly agyModelsPath = join(process.cwd(), '.env.komorebi-agy-models.json');
  private readonly agyChoices = new Map<string, string>();
  /** The model and effort each Claude room runs with, so a reopened room keeps it whatever the CLI's one global default has become. */
  private readonly claudeModelsPath = join(process.cwd(), '.env.komorebi-claude-models.json');
  private readonly claudeChoices = new Map<string, { model?: string; effort?: string }>();
  /** Codex rooms' own speed (Fast or standard), as last seen on each room's footer. */
  private codexFastPath?: string;
  private readonly fastChoices = new Map<string, boolean>();
  /** Keep the rooms' speeds in this file (the server sets it; without it they are only kept while the Bridge runs). */
  useFastFile(path: string) {
    this.codexFastPath = path;
    this.fastChoices.clear();
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      for (const [key, value] of Object.entries(saved ?? {})) if (typeof value === 'boolean') this.fastChoices.set(key, value);
    } catch { /* No choices yet, or the file is damaged: standard speed. */ }
  }
  private fastFor(roomId: string) { return this.fastChoices.get(roomId) ?? false; }
  /** Read the speed off a Codex room's footer, show it, and remember it for the room's next start. */
  private noteFast(room: TerminalRoom, screen: string) {
    const fast = codexFastMode(screen);
    if (fast === undefined) return;
    room.fastMode = fast;
    if (this.fastChoices.get(room.id) === fast) return;
    this.fastChoices.set(room.id, fast);
    if (!this.codexFastPath) return;
    try { writeFileSync(this.codexFastPath, JSON.stringify(Object.fromEntries(this.fastChoices)), { mode: 0o600 }); }
    catch { this.emit({ type: 'NOTICE', message: '無法保存這間房的速度設定，重啟 Bridge 後可能跟返標準速度。' }); }
  }
  /** Which room each uploaded image went to, so deleting that room moves its images to the Trash. */
  attachmentLedger = new AttachmentLedger(join(process.cwd(), '.env.komorebi-attachments.json'));
  fileAttachmentDirectory = attachmentDirectory;
  /** Whether a group member must stay open for now because work is still waiting for it (set by the server from the workbench). */
  hasDeliveryHold?: (room: TerminalRoom) => boolean;
  onRecoveryChange?: (roomId: string) => void;
  /** Unfinished tickets to or from the room. Such a room is never closed by the idle action. */
  hasOpenTickets?: (room: TerminalRoom) => boolean;
  /** Where a new room starts its CLI; the workspace itself when this is not set. */
  defaultFolder?: () => string;
  private newRoomRoot() { return this.defaultFolder?.() ?? this.workspace; }
  /** Whether a room belongs to a group (such rooms get a longer grace before they close on their own). */
  isGroupMember(roomId: string) { return this.retainedRooms.has(roomId); }
  /** Moves uploaded images to the Trash (replaceable in tests). */
  trashImages: typeof trashAttachments = trashAttachments;
  trashSessions: typeof trashSessionFiles = trashSessionFiles;
  successors?: () => Record<string, string>;
  private readonly bindingsPath = join(process.cwd(), '.env.komorebi-room-bindings.json');
  private roomNames = new Map<string, string>();
  private roomBindings = new Map<string, RoomBinding>();
  private readonly durableBindings = new Set<string>();
  private bindingsReadable = true;
  private namesReadable = true;
  private archivedKeys = new Set<string>();
  private archiveReadable = true;
  private deletedKeys = new Set<string>();
  private deletedReadable = true;
  private readonly notices = new Set<string>();
  private readonly loggedBackgroundFailures = new Set<string>();
  private codexRemoteChange = false;
  private codexRemoteStatus: TerminalRoom['remoteStatus'] = 'unknown';
  private stopWatching: ReturnType<typeof watchSessions> | undefined;
  private readonly pendingCodexRollouts = new Map<string, () => void>();
  private closed = false;
  private usageTimer?: NodeJS.Timeout;
  private usageRunning = false;
  private nextAgyModelCheck = 0;

  // Group wake
  // Check whether a group room can open and prevent duplicate live sessions.
  async ensureGroupMember(modelId: CLIModelId, roomName: string, roomId: string = randomUUID()) {
    if (this.deletedKeys.has(roomId)) throw new Error('這間房已移除，不會自動重建。');
    const existing = this.rooms.get(roomId);
    if (existing) {
      if (existing.modelId !== modelId) throw new Error('群組成員同房間角色不一致。');
      return existing;
    }
    if (roomId.startsWith('session-')) throw new Error('正在等待原有 CLI 工作階段同步，請稍後重試。');
    const cwd = await newRoomDirectory(this.newRoomRoot(), modelId);
    const room = newRoom(modelId, roomName, cwd, roomId);
    room.autoCompact = this.compactRooms.enabled(this.modeKeys(room));
    this.rooms.set(room.id, room);
    this.emit({ type: 'ROOM', room });
    return room;
  }

  canJoinExistingGroup(room: TerminalRoom) {
    if (!room.sessionId || !room.resumable || !room.repoPath) return false;
    if (room.id === roomIdFor(room.modelId, room.sessionId)) return true;
    const key = roomIdFor(room.modelId, room.sessionId);
    return this.durableBindings.has(key) && this.roomBindings.get(key)?.roomId === room.id;
  }

  /** The live facts used by fixed workbench routing; this never opens a room or changes its mode. */
  roleRoutingState(room: TerminalRoom) {
    return {
      inactive: this.archiveKeys(room).some(key => this.archivedKeys.has(key) || this.deletedKeys.has(key)),
      verifiedSession: this.canJoinExistingGroup(room),
      auto: room.live ? room.autoMode === true : this.modes.resolve(room.modelId, this.modeKeys(room)),
      working: this.isWorking(room.id),
    };
  }

  /** The workbench hook script (set by the server); without it no room gets the hook. */
  benchHook?: string;
  /** Whether AGY has the workbench plugin installed (its hooks come only from there). */
  agyBenchPlugin = () => existsSync(join(home, '.gemini/config/plugins/komorebi-bench/hooks.json'));

  /** Called when a live CLI comes back to its input prompt (the server checks its workbench). */
  onIdle?: (room: TerminalRoom) => void;

  /** Called once each time a Claude room stops at its "Resume this conversation?" menu, so someone can be told. */
  onResumePrompt?: (room: TerminalRoom) => void;

  /**
   * A new room that works as `old`: same name, folder (or `fork.folder`), permission mode, Remote Control, model and effort.
   * Without `fork` it starts a fresh Claude session; with `fork` it forks a Claude, Codex or AGY room into `fork.folder`
   * keeping the old conversation context and discovering/binding its new session ID.
   */
  async cloneRoom(old: TerminalRoom, fork?: { folder: string; sessionId: string }): Promise<TerminalRoom> {
    if (old.modelId !== 'CLAUDE' && !fork) throw new Error('只可以複製 Claude 房。');
    const room = newRoom(old.modelId, old.roomName, fork ? fork.folder : old.repoPath);
    if (old.selectedSubModel && old.selectedSubModel !== '—') room.selectedSubModel = old.selectedSubModel;
    if (old.effortLevel) {
      room.effortLevel = old.effortLevel;
      room.effortSource = 'live';
    }
    if (fork) {
      room.logs = old.logs.filter(entry => entry.sender === 'user' || entry.sender === 'agent').map(entry => ({ ...entry }));
      if (old.modelId === 'CODEX') room.historyLimit = Math.min(historyMax, room.logs.length + historyLimit);
      room.bubbleSnippet = old.bubbleSnippet;
      room.contextUsagePct = old.contextUsagePct;
      room.contextTokens = old.contextTokens;
      room.contextWindow = old.contextWindow;
    }
    if (old.modelId === 'CLAUDE') {
      const savedChoice = this.claudeChoices.get(old.id);
      this.rememberClaudeModel(room.id, {
        model: savedChoice?.model ?? claudeModelFlag(old.selectedSubModel),
        effort: savedChoice?.effort ?? claudeEffortFlag(old.effortLevel),
      });
    } else if (old.modelId === 'AGY') {
      const agyChoice = this.agyChoices.get(old.id) ?? (old.effortLevel ? this.agyModelId(old.selectedSubModel, old.effortLevel) : undefined);
      if (agyChoice) this.rememberAgyModel(room.id, agyChoice);
    } else if (old.modelId === 'CODEX') {
      const fast = this.fastChoices.get(old.id) ?? old.fastMode;
      if (fast !== undefined) {
        this.fastChoices.set(room.id, fast);
        room.fastMode = fast;
      }
    }
    const inGroup = !fork || this.retainedRooms.has(old.id);
    if (inGroup) this.retainedRooms.add(room.id);
    const auto = old.live ? Boolean(old.autoMode) : this.modes.resolve(old.modelId, this.modeKeys(old));
    let rollbackAgyFork: (() => Promise<void>) | undefined;
    try {
      if (old.modelId === 'AGY' && fork) {
        rollbackAgyFork = await forkAgyConversation(this.sessionHome, fork.sessionId, room.id, fork.folder);
      }
      await this.start(room, () => {}, {
        remote: old.remoteControl.enabled,
        ...(old.modelId === 'AGY' ? { agyAuto: auto } : { fullAccess: auto }),
        forkFromSession: fork?.sessionId,
      });
      const started = this.rooms.get(room.id);
      if (!started?.live) throw new Error('新房未能啟動。');
      if (old.modelId === 'AGY' && fork) {
        this.bindSession(started, started.id);
      }
      this.noteClaudeModel(started);
      this.noteEffort(started, undefined);
      await this.handle({ type: 'RENAME', roomId: started.id, name: old.roomName }, () => {});
      return started;
    } catch (error) {
      this.claudeChoices.delete(room.id);
      this.agyChoices.delete(room.id);
      this.fastChoices.delete(room.id);
      this.retainedRooms.delete(room.id);
      this.rooms.delete(room.id);
      await rollbackAgyFork?.();
      throw error;
    }
  }

  /** Forks a Claude, Codex or AGY room into `folder`, keeping its settings and conversation context. */
  async forkRoom(old: TerminalRoom, folder: string): Promise<TerminalRoom> {
    if (!old.sessionId || !validSessionId.test(old.sessionId)) {
      throw new Error('這間房未有可續接的對話，暫時未能更改工作資料夾。請先講一句話再試。');
    }
    return this.cloneRoom(old, { folder, sessionId: old.sessionId });
  }

  /** Closes a live room and waits until its process has exited. */
  async closeRoomAndWait(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    const live = this.live.get(roomId);
    if (!room || !live) return;
    if (!live.closing) this.closeTerminal(room, live, false);
    await live.closing;
  }

  /** A quiet line in a room's conversation, for the people watching (for example a workbench handoff). */
  note(roomId: string, text: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    log(room, 'system', text);
    this.emit({ type: 'ROOM', room });
  }

  retainGroupRooms(roomIds: Iterable<string>) {
    this.retainedRooms.clear();
    for (const id of roomIds) this.retainedRooms.add(id);
  }

  watchGroupRooms(roomIds: Iterable<string>) {
    const wanted = new Set(roomIds);
    // A native directory watch can miss appends to a live Codex rollout on macOS.
    // Keep the same file-level fallback while its CLI runs, even between UI views.
    for (const [id, live] of this.live) {
      if (!live.closing && this.rooms.get(id)?.modelId === 'CODEX') wanted.add(id);
    }
    for (const [id, watch] of this.groupWatches) {
      const room = this.rooms.get(id);
      if (!wanted.has(id) || !room?.syncedStateFile || watch.file !== room.syncedStateFile) {
        watch.stop();
        this.groupWatches.delete(id);
      }
    }
    for (const id of wanted) {
      const room = this.rooms.get(id);
      if (!room?.sessionId || !room.syncedStateFile?.startsWith('~/') || this.groupWatches.has(id)) continue;
      const path = join(home, room.syncedStateFile.slice(2));
      const root = sessionRoots[room.modelId].map(suffix => join(home, suffix)).find(candidate => isInside(candidate, path));
      if (!root) continue;
      let active = true;
      const sync = () => {
        const savedFile = room.syncedStateFile;
        void Promise.all([realpath(root), realpath(path)]).then(([actualRoot, file]) => {
          if (active && isInside(actualRoot, file)) {
            return readSession(room.modelId, file, actualRoot, this.workspace, Math.max(historyLimit, room.historyLimit ?? 0));
          }
        }).then(session => {
          if (active && session && session.id === room.sessionId) this.sync({ ...session, file: savedFile });
        }).catch(() => {});
      };
      const changed = () => sync();
      watchFile(path, { interval: 1000, persistent: false }, changed);
      this.groupWatches.set(id, { file: room.syncedStateFile, stop: () => { active = false; unwatchFile(path, changed); } });
      sync();
    }
  }

  groupStartFailed(roomId: string, error: unknown) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.currentActionSummary = `CLI 啟動失敗：${error instanceof Error ? error.message : '請重試'}`;
    this.emit({ type: 'ROOM', room });
  }

  /** The room has a CLI process that is not already shutting down. */
  isOpen(roomId: string) {
    const live = this.live.get(roomId);
    return Boolean(live && !live.closing);
  }

  /** Something is going on in the room, including startup before its PTY exists. */
  isWorking(roomId: string) {
    if (this.starting.has(roomId)) return true;
    const room = this.rooms.get(roomId);
    const live = this.live.get(roomId);
    if (!room || !live || live.closing) return false;
    return Boolean(!room.ready || room.status !== 'idle' || room.pendingApproval || room.pendingQuestion ||
      room.menu || room.backgroundTasks || this.hasTerminalDraft(room) || live.submitted || live.deferredInput ||
      live.attaching || live.preparingAttachments || live.dirty || live.queued);
  }

  private hasTerminalDraft(room: TerminalRoom) {
    const draft = composerText(room.modelId, room.screen ?? '');
    return Boolean(draft && !(room.modelId === 'CODEX' && draft === 'Ask Codex to do anything'));
  }

  ptyGuard(roomId: string) {
    const live = this.live.get(roomId);
    return () => Boolean(live && !live.closing && this.live.get(roomId) === live);
  }

  currentReport(roomId: string) {
    const room = this.rooms.get(roomId), live = this.live.get(roomId);
    if (!room || !live || live.reportBaseline === undefined) return;
    const report = endsWithReport(room);
    return report !== live.reportBaseline ? report : undefined;
  }

  deliveryPending(roomId: string) {
    const room = this.rooms.get(roomId);
    return Boolean(room && (this.hasOpenTickets?.(room) || this.hasDeliveryHold?.(room)));
  }

  closeUnviewed(roomId: string, reason: 'unviewed' | 'group-idle' = 'unviewed') {
    if (this.starting.has(roomId)) return false;
    const room = this.rooms.get(roomId);
    const live = this.live.get(roomId);
    if (!room || !live || live.closing) return true;
    if (this.isWorking(roomId) || this.deliveryPending(roomId)) return false;
    const emptyRoom = !room.sessionId && !live.discoveredSessionId && !hasConversation(room);
    if (!emptyRoom && !this.canJoinExistingGroup(room)) {
      this.emit({ type: 'NOTICE', message: `${room.roomName} 未確認可以續接，CLI 暫時保持開啟。` });
      return true;
    }
    const before = { status: room.status, ready: room.ready, backgroundTasks: room.backgroundTasks ?? 0,
      dirty: Boolean(live.dirty), queued: live.queued ?? 0, terminalDraft: this.hasTerminalDraft(room),
      lastOutputAt: live.lastOutputAt, lastInputAt: live.keyAt };
    try {
      this.closeTerminal(room, live, true);
      console.info('自動關房 ' + JSON.stringify({ at: new Date().toISOString(), roomId, roomName: room.roomName,
        sessionId: room.sessionId ?? live.discoveredSessionId ?? null, modelId: room.modelId, reason, before }));
    }
    catch { this.emit({ type: 'NOTICE', message: `${room.roomName} 未能自動結束 CLI。` }); }
    return true;
  }

  private closeTerminal(room: TerminalRoom, live: LiveRoom, automatic: boolean) {
    if (live.closing) return;
    live.closedAutomatically = automatic;
    live.closing = new Promise<void>(resolve => { live.resolveClose = resolve; });
    try {
      live.process.kill();
    } catch (error) {
      live.resolveClose?.();
      live.closing = undefined;
      live.resolveClose = undefined;
      live.closedAutomatically = undefined;
      throw error;
    }
    room.ready = false;
    room.steerable = false;
    room.currentActionSummary = 'CLI 結束中';
    this.emit({ type: 'ROOM', room });
  }

  // Room model settings
  // Track each room's model, effort and speed and apply saved choices when it opens.
  /** The model id AGY takes for a name seen on screen ("Gemini 4 Hydrogen") and an effort, if it is one it lists. */
  private agyModelId(name: string, effort: string) {
    const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.characters.AGY.availableSubModels.find(id => id.endsWith(`-${effort}`) && flat(id.slice(0, -(effort.length + 1))) === flat(name));
  }

  /** An explicit choice for a room (the picker): exactly this model and effort, saved. */
  private setClaudeChoice(roomId: string, choice: { model?: string; effort?: string }) {
    if (!choice.model) return;
    this.claudeChoices.set(roomId, { model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}) });
    this.saveClaudeChoices();
  }

  private saveClaudeChoices() {
    try { writeFileSync(this.claudeModelsPath, JSON.stringify(Object.fromEntries(this.claudeChoices)), { mode: 0o600 }); }
    catch { this.emit({ type: 'NOTICE', message: '無法保存這間房的模型選擇，重啟 Bridge 後可能跟返預設。' }); }
  }

  /**
   * A room whose screen does not show the header/footer model line (e.g. a forked room right after startup) has no model name for the picker.
   * It runs with its saved choice, so that names the model until the screen or the transcript says otherwise.
   */
  private noteClaudeModel(room: TerminalRoom) {
    if (!room.live || (room.selectedSubModel && room.selectedSubModel !== '—')) return;
    if (room.modelId === 'CLAUDE') {
      const model = this.claudeChoices.get(room.id)?.model;
      if (model) room.selectedSubModel = model;
    } else if (room.modelId === 'AGY') {
      const choice = this.agyChoices.get(room.id);
      if (choice) room.selectedSubModel = choice.replace(/-(?:low|medium|high|xhigh|max)$/i, '');
    }
  }

  /**
   * The effort a room shows. The screen's header line says it when it is visible. A Claude or AGY CLI that was reopened with --effort / --model may not show that line
   * (the screen starts after it), and then the value read earlier from the old transcript stayed: the picker showed the old effort after a change.
   * Without the header, the effort the room was launched with (its saved choice) is the one it runs with.
   */
  private noteEffort(room: TerminalRoom, shown: string | undefined) {
    if (shown) { room.effortLevel = shown as TerminalRoom['effortLevel']; room.effortSource = 'live'; return; }
    if (!room.live) return;
    const launched = room.modelId === 'CLAUDE'
      ? this.claudeChoices.get(room.id)?.effort
      : room.modelId === 'AGY'
        ? this.agyChoices.get(room.id)?.match(/-(low|medium|high|xhigh|max)$/i)?.[1]?.toLowerCase()
        : undefined;
    if (launched && room.effortLevel !== launched) { room.effortLevel = launched as TerminalRoom['effortLevel']; room.effortSource = 'live'; }
  }

  /** Keep a Claude room's model and effort (as last seen on its screen), and save them when they changed. */
  private rememberClaudeModel(roomId: string, choice: { model?: string; effort?: string }) {
    const model = choice.model ?? this.claudeChoices.get(roomId)?.model;
    const effort = choice.effort ?? this.claudeChoices.get(roomId)?.effort;
    const before = this.claudeChoices.get(roomId);
    if (!model || (before?.model === model && before?.effort === effort)) return;
    this.setClaudeChoice(roomId, { model, effort });
  }

  private rememberAgyModel(roomId: string, id: string) {
    this.agyChoices.set(roomId, id);
    try { writeFileSync(this.agyModelsPath, JSON.stringify(Object.fromEntries(this.agyChoices)), { mode: 0o600 }); }
    catch { this.emit({ type: 'NOTICE', message: '無法保存這間房的模型選擇，重啟 Bridge 後可能跟返預設。' }); }
  }

  /**
   * `/model` and `/effort` in an AGY room: the CLI would write them into its one settings file, and every room follows.
   * Here the choice belongs to the room: it is remembered and the CLI is reopened on the same conversation with `--model`.
   */
  private async switchAgyModel(room: TerminalRoom, live: LiveRoom | undefined, input: string, result: ActionResult) {
    const [, command, argument = ''] = /^\/(model|effort)(?:\s+(.*))?$/i.exec(input) ?? [];
    const available = this.characters.AGY.availableSubModels;
    if (!argument.trim()) throw new Error('瞳這類 AGY 房要用上面的模型／推理力度選單轉，每間房各自設定。');
    const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
    const current = this.agyChoices.get(room.id) ?? (room.effortLevel ? this.agyModelId(room.selectedSubModel, room.effortLevel) : undefined);
    const currentEffort = efforts.find(level => current?.endsWith(`-${level}`));
    const currentFamily = current && currentEffort ? current.slice(0, -(currentEffort.length + 1)) : undefined;
    let target: string | undefined;
    if (command.toLowerCase() === 'effort') {
      const level = flat(argument);
      if (currentFamily) target = available.find(id => id === `${currentFamily}-${level}`);
    } else {
      const wanted = argument.trim().toLowerCase();
      const family = available.filter(id => efforts.some(level => id.endsWith(`-${level}`) &&
        flat(id.slice(0, -(level.length + 1))) === flat(wanted)));
      target = available.find(id => id === wanted) ??
        family.find(id => id.endsWith(`-${currentEffort ?? 'medium'}`)) ?? family[0];
    }
    if (!target) throw new Error(available.length ? '這個 CLI 沒有提供此模型或推理力度。' : '未取得 AGY 模型清單，請稍後再試。');
    if (target === current) { result(true, '已經是這個設定。'); return; }
    if (!live || live.closing) { this.rememberAgyModel(room.id, target); result(true, `已記住：${target}（下次開房生效，只影響這間房）。`); return; }
    if (live.dirty && !live.queued) this.refresh(room, live);
    if (!room.ready || room.pendingApproval || room.menu || live.submitted || live.deferredInput || live.dirty || live.queued) {
      throw new Error('CLI 工作中。要等它回到輸入提示，才可以換模型（會重開 CLI，對話照舊續接）。');
    }
    if (!room.sessionId || !room.resumable) {
      throw new Error('這間房未有可續接的對話，暫時未能換模型。請先講一句話再試。');
    }
    this.rememberAgyModel(room.id, target);
    this.closeTerminal(room, live, true);
    await live.closing;
    await this.resumeForInput(room);
    result(true, `已轉用 ${target}（只影響這間房，對話照舊續接）。`);
  }

  /**
   * `/model` and `/effort` with a value in a Claude room (the pickers send these): the CLI would write them into its one settings file,
   * and every new room follows. Here the choice belongs to the room: it is remembered and the CLI is reopened on the same conversation.
   * A bare `/model` or `/effort` still opens the CLI's own menu.
   */
  private async switchClaudeModel(room: TerminalRoom, live: LiveRoom | undefined, input: string, result: ActionResult) {
    const [, command, argument = ''] = /^\/(model|effort)\s+(.+)$/i.exec(input) ?? [];
    const before = this.claudeChoices.get(room.id);
    const known = before?.model ?? claudeModelFlag(room.selectedSubModel);
    const effort = before?.effort ?? claudeEffortFlag(room.effortLevel);
    let target: { model?: string; effort?: string };
    if (command.toLowerCase() === 'effort') {
      const level = argument.trim().toLowerCase();
      if (level === 'ultra') throw new Error('Claude 的 --effort 不支援 ultra，請選其他力度。');
      if (!claudeEffortFlag(level)) throw new Error('這個 CLI 沒有提供此推理力度。');
      if (!known) throw new Error('未取得這間房目前的模型，請稍後再試。');
      target = { model: known, effort: level };
    } else {
      const model = claudeModelArgument(argument);
      if (!model) throw new Error('這個 CLI 沒有提供此模型。');
      target = { model, ...(effort ? { effort } : {}) };
    }
    const same = (known === target.model || (known && target.model && known.includes(target.model))) && effort === target.effort;
    if (same) { result(true, '已經是這個設定。'); return; }
    const label = `${target.model}${target.effort ? ` · ${target.effort}` : ''}`;
    if (!live || live.closing) { this.setClaudeChoice(room.id, target); result(true, `已記住：${label}（下次開房生效，只影響這間房）。`); return; }
    if (live.dirty && !live.queued) this.refresh(room, live);
    if (!room.ready || room.pendingApproval || room.menu || live.submitted || live.deferredInput || live.dirty || live.queued) {
      throw new Error('CLI 工作中。要等它回到輸入提示，才可以換模型（會重開 CLI，對話照舊續接）。');
    }
    if (!room.sessionId || !room.resumable) {
      throw new Error('這間房未有可續接的對話，暫時未能換模型。請先講一句話再試。');
    }
    this.setClaudeChoice(room.id, target);
    // The old name is the old CLI's. Clear it, so the new CLI's own screen or this choice names the model (a stale name used to stay: the picker said Opus after a switch to Haiku).
    room.selectedSubModel = '—';
    this.closeTerminal(room, live, true);
    await live.closing;
    await this.resumeForInput(room);
    this.noteClaudeModel(room);
    result(true, `已轉用 ${label}（只影響這間房，對話照舊續接）。`);
  }

  /** Opens a closed room on its own session (or waits for one that is closing or opening) and waits until it can take input. */
  private async resumeForInput(room: TerminalRoom, closing?: LiveRoom, waitMs = this.resumeWaitMs) {
    if (closing?.closing) await closing.closing;
    if (this.closed) throw new Error('Bridge 正在關閉。');
    if (!this.live.has(room.id) && !this.starting.has(room.id)) await this.startExisting(room);
    const deadline = Date.now() + waitMs;
    for (;;) {
      const now = this.live.get(room.id);
      if (now && !now.closing && !this.starting.has(room.id) && (room.ready || room.steerable || room.pendingApproval || room.menu)) return;
      if (Date.now() >= deadline) throw new Error(`續接了 ${Math.round(waitMs / 1000)} 秒，CLI 仍未回到輸入位置。請核對房間，再重發一次。`);
      await new Promise<void>(resolve => setTimeout(resolve, 200));
    }
  }

  async reopenIfClosing(roomId: string, stillViewed: () => boolean) {
    const live = this.live.get(roomId);
    if (!live?.closedAutomatically) return;
    await live.closing;
    if (stillViewed() && this.rooms.has(roomId) && !this.closed) {
      await this.handle({ type: 'START', roomId }, event => this.emit(event), { stillWanted: stillViewed });
    }
  }

  canWakeGroupMember(roomId: string, sessionId: string | undefined, allowFresh = false) {
    const room = this.rooms.get(roomId);
    if (!room || room.sessionId !== sessionId ||
        this.archiveKeys(room).some(key => this.archivedKeys.has(key) || this.deletedKeys.has(key))) return false;
    if (sessionId !== undefined) return validSessionId.test(sessionId) && this.canJoinExistingGroup(room);
    return allowFresh && this.retainedRooms.has(roomId) && !this.live.has(roomId) &&
      this.bindingsReadable && validSessionId.test(roomId) && Boolean(room.repoPath) && !hasConversation(room);
  }

  private activeSessionAlias(room: TerminalRoom) {
    const sessionId = room.sessionId?.toLowerCase();
    if (!sessionId) return;
    return [...this.rooms.values()].find(other => other.id !== room.id && other.modelId === room.modelId &&
      other.sessionId?.toLowerCase() === sessionId && (this.live.has(other.id) || this.starting.has(other.id)));
  }

  groupMemberWakeBlock(roomId: string): keyof typeof groupWakeNotice | undefined {
    const room = this.rooms.get(roomId);
    if (room && this.archiveKeys(room).some(key => this.archivedKeys.has(key) || this.deletedKeys.has(key))) return 'archived';
    if (this.isOpen(roomId)) return 'open';
    if (this.starting.has(roomId)) return 'starting';
    const alias = room && this.activeSessionAlias(room);
    if (alias) return this.starting.has(alias.id) ? 'starting' : 'open';
    if (!this.canWakeGroupMember(roomId, room?.sessionId, true)) return 'unverified';
    // A closing process will free its own slot before openViewedRoom attempts a resume.
    const ownClosing = this.live.get(roomId)?.closing ? 1 : 0;
    if (this.live.size + this.starting.size - ownClosing >= maxLiveCli) return 'limit';
  }

  async openViewedRoom(roomId: string, stillViewed: () => boolean) {
    await this.live.get(roomId)?.closing;
    if (this.closed || !stillViewed()) return;
    const room = this.rooms.get(roomId);
    if (!room || this.live.has(roomId)) return;
    if (this.archiveKeys(room).some(key => this.archivedKeys.has(key))) {
      throw new Error(groupWakeNotice.archived);
    }
    await this.startExisting(room, () => stillViewed() && !this.archiveKeys(room).some(key => this.archivedKeys.has(key)));
  }

  inputLogPath?: string;

  // Room identity and storage
  // Link rooms to native sessions and preserve room settings across restarts.
  constructor(private readonly workspace: string, private readonly emit: (event: ServerEvent) => void,
    private readonly saveImage: typeof saveAttachment = saveAttachment,
    private readonly modes = new LaunchModeStore(join(workspace, '.komorebi-launch-modes.json')),
    private readonly usageToday = new DailyUsageStore(join(workspace, '.komorebi-usage-today.json')),
    private readonly compactRooms = new AutoCompactRooms(join(workspace, '.komorebi-auto-compact.json'))) {
    this.showUsageToday();
    try {
      const saved = JSON.parse(readFileSync(this.agyModelsPath, 'utf8'));
      for (const [key, value] of Object.entries(saved ?? {})) if (typeof value === 'string') this.agyChoices.set(key, value);
    } catch { /* No choices yet. */ }
    try {
      const saved = JSON.parse(readFileSync(this.claudeModelsPath, 'utf8'));
      for (const [key, value] of Object.entries(saved ?? {})) {
        const choice = value as { model?: unknown; effort?: unknown } | null;
        if (typeof choice?.model === 'string' && claudeModelArgument(choice.model) === choice.model) {
          this.claudeChoices.set(key, { model: choice.model, ...(typeof choice.effort === 'string' && claudeEffortFlag(choice.effort) ? { effort: choice.effort } : {}) });
        }
      }
    } catch { /* No choices yet. */ }
    try {
      const keys = JSON.parse(readFileSync(this.deletedPath, 'utf8'));
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new Error('Invalid deleted rooms');
      this.deletedKeys = new Set(keys);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.deletedReadable = false;
        console.error('無法讀取已刪除房間狀態，請檢查', this.deletedPath);
      }
    }
    try {
      const keys = JSON.parse(readFileSync(this.archivePath, 'utf8'));
      if (Array.isArray(keys)) this.archivedKeys = new Set(keys.filter(key => typeof key === 'string'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.archiveReadable = false;
        console.error('無法讀取房間封存狀態，請檢查', this.archivePath);
      }
    }
    try {
      const names = JSON.parse(readFileSync(this.namesPath, 'utf8'));
      if (!names || typeof names !== 'object' || Array.isArray(names)) throw new Error('Invalid room names');
      for (const [key, value] of Object.entries(names)) {
        if (typeof value !== 'string') throw new Error('Invalid room name');
        this.roomNames.set(key, value);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.namesReadable = false;
        console.error('無法讀取房間名稱，請檢查', this.namesPath);
      }
    }
    try {
      const bindings: RoomBinding[] = JSON.parse(readFileSync(this.bindingsPath, 'utf8'));
      if (!Array.isArray(bindings) || bindings.some(binding =>
        !binding || typeof binding.roomId !== 'string' || !validSessionId.test(binding.roomId) ||
        typeof binding.sessionId !== 'string' || !validSessionId.test(binding.sessionId) ||
        !cliIds.includes(binding.modelId) || typeof binding.roomName !== 'string' ||
        typeof binding.cwd !== 'string' || !isAbsolute(binding.cwd))) throw new Error('Invalid room bindings');
      for (const binding of bindings) {
        const key = roomIdFor(binding.modelId, binding.sessionId);
        if (this.deletedKeys.has(key) || this.deletedKeys.has(binding.roomId)) continue;
        this.roomBindings.set(key, binding);
        this.durableBindings.add(key);
        const name = this.roomNames.get(binding.roomId) ?? this.roomNames.get(key) ?? binding.roomName;
        const room = newRoom(binding.modelId, name, binding.cwd, binding.roomId);
        room.sessionId = binding.sessionId;
        room.autoCompact = this.compactRooms.enabled(this.modeKeys(room));
        room.resumable = true;
        room.currentActionSummary = '本地工作階段 · 可續接';
        this.rooms.set(room.id, room);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.bindingsReadable = false;
        console.error('無法讀取房間工作階段關聯，請檢查', this.bindingsPath);
      }
    }
  }

  archiveSnapshot() { return [...this.archivedKeys]; }

  pinSnapshot() { return this.pins.snapshot(key => this.archivedKeys.has(key) || this.deletedKeys.has(key)); }
  pinsReadable() { return this.pins.isReadable(); }

  protectedSnapshot() { return this.protection.snapshot(); }
  storageIdentitiesReadable() { return this.bindingsReadable && this.namesReadable; }
  protectionReadable() { return this.protection.readable; }
  isProtected(room: TerminalRoom) { return this.protection.has(this.archiveKeys(room)); }
  isRunningOrStarting(room: TerminalRoom) { return Boolean(room.live || this.live.has(room.id) || this.starting.has(room.id)); }
  runningDirectories() {
    return this.snapshot().filter(room => this.isRunningOrStarting(room)).map(room => this.live.get(room.id)?.resolvedCwd ?? room.repoPath);
  }
  private linkProtection(room: TerminalRoom) {
    try { if (this.protection.link(this.archiveKeys(room))) this.emit({ type: 'PROTECTED_ROOMS', protectedKeys: this.protectedSnapshot() }); }
    catch { this.emit({ type: 'NOTICE', message: '未能保存房間保護關聯，請檢查保護設定。' }); }
  }

  private emitPins() { this.emit({ type: 'PINS', pinnedKeys: this.pinSnapshot() }); }

  private clearInactivePins(keys: ReadonlySet<string>) {
    try {
      if (this.pins.remove(keys)) this.emitPins();
    } catch (error) {
      // The archive/deletion is already saved. Hide those pins and clear any stale pin before a later restore.
      console.error('無法儲存已封存或刪除房間的置頂設定：', error);
      this.emitPins();
    }
  }

  private linkPin(room: TerminalRoom) {
    const keys = this.archiveKeys(room);
    if (keys.some(key => this.archivedKeys.has(key) || this.deletedKeys.has(key))) {
      this.clearInactivePins(new Set(keys));
      return;
    }
    try {
      if (this.pins.link(keys)) this.emitPins();
    } catch (error) { console.error('無法儲存置頂房間的 Session ID：', error); }
  }

  private saveArchive(keys: Set<string>, archivedRoomId?: string, restoredRoomId?: string) {
    if (!this.archiveReadable) throw new Error('無法讀取已保存的封存狀態，請檢查 Mac 上的設定檔。');
    const temporary = this.archivePath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify([...keys]), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.archivePath);
      this.archivedKeys = keys;
    } finally {
      try { unlinkSync(temporary); } catch { /* The rename removed the temporary file. */ }
    }
    this.clearInactivePins(keys);
    this.emit({ type: 'ARCHIVED', archivedKeys: this.archiveSnapshot(), ...(archivedRoomId ? { archivedRoomId } : {}), ...(restoredRoomId ? { restoredRoomId } : {}) });
  }

  private archiveKeys(room: TerminalRoom) {
    return [room.id, ...(room.sessionId ? [roomIdFor(room.modelId, room.sessionId)] : [])];
  }

  private saveDeleted(keys: Set<string>) {
    if (!this.deletedReadable) throw new Error('無法讀取已刪除房間狀態，請檢查 Mac 上的設定檔。');
    const temporary = this.deletedPath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify([...keys]), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.deletedPath);
      this.deletedKeys = keys;
    } finally {
      try { unlinkSync(temporary); } catch { /* The rename removed the temporary file. */ }
    }
  }

  private saveNames(names: Map<string, string>) {
    if (!this.namesReadable) throw new Error('無法讀取已保存的房間名稱，請檢查 Mac 上的設定檔。');
    const temporary = this.namesPath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(names)), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.namesPath);
      this.roomNames = names;
    } finally {
      try { unlinkSync(temporary); } catch { /* The rename removed the temporary file. */ }
    }
  }

  private linkRoomName(room: TerminalRoom, sessionKey: string) {
    const existingName = this.roomNames.get(room.id);
    const sessionName = this.roomNames.get(sessionKey);
    if (existingName && !sessionName) {
      this.saveNames(new Map([...this.roomNames, [sessionKey, existingName]]));
    }
    room.roomName = existingName ?? sessionName ?? room.roomName;
  }

  private bindSession(room: TerminalRoom, sessionId: string) {
    if (!validSessionId.test(room.id) || !validSessionId.test(sessionId) || room.sessionId) return;
    const key = roomIdFor(room.modelId, sessionId);
    const imported = this.rooms.get(key);
    const owner = this.roomBindings.get(key);
    if (this.deletedKeys.has(key) || imported?.live || this.starting.has(key) || (owner && owner.roomId !== room.id)) return;
    const binding: RoomBinding = { roomId: room.id, sessionId, modelId: room.modelId, roomName: room.roomName, cwd: room.repoPath };
    if (this.bindingsReadable) {
      const temporary = this.bindingsPath + '.' + randomUUID() + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify([...this.roomBindings.values(), binding]), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, this.bindingsPath);
        this.durableBindings.add(key);
      } catch {
        this.emit({ type: 'NOTICE', message: '無法保存房間的 Session ID，重啟後可能要重新選擇房。' });
      } finally {
        try { unlinkSync(temporary); } catch { /* The rename removed the temporary file. */ }
      }
    }
    this.roomBindings.set(key, binding);
    room.sessionId = sessionId;
    this.clearPendingCodexRollouts();
    this.linkPin(room);
    this.linkProtection(room);
    room.resumable = true;
    try { this.modes.copy(room.id, key); } catch { /* The room keeps working under its own id. */ }
    if (this.compactRooms.enabled(this.modeKeys(room))) {
      try { this.compactRooms.set(this.modeKeys(room), true); }
      catch { this.emit({ type: 'NOTICE', message: '未能將 Auto Compact 設定連結到原生 Session。' }); }
    }
    if (imported && imported !== room) {
      this.rooms.delete(key);
      this.emit({ type: 'ROOM_REMOVED', roomId: key, replacementRoomId: room.id });
    }
  }

  // Refresh usage and model catalogues
  // Update characters with quota readings, daily history and the latest picker options.
  private async refreshUsage() {
    if (this.closed || this.usageRunning) return;
    this.usageRunning = true;
    try {
      const agyRoom = this.snapshot().find(room => room.modelId === 'AGY' && room.live && room.selectedSubModel !== '—');
      const results = await Promise.allSettled([
        agyUsage(this.workspace, agyRoom?.selectedSubModel ?? 'Gemini'),
        codexUsage(this.workspace),
        claudeUsage(this.workspace),
      ]);
      if (this.closed) return;
      (['AGY', 'CODEX', 'CLAUDE'] as const).forEach((modelId, index) => {
        const result = results[index];
        const notice = `${modelId} 背景額度更新失敗，會在下一輪再試。`;
        if (result.status === 'fulfilled' && (result.value.fiveHour !== undefined || result.value.weekly !== undefined)) {
          this.notices.delete(notice);
          this.applyUsage(modelId, result.value);
        } else if (!this.notices.has(notice)) {
          this.notices.add(notice);
          this.emit({ type: 'NOTICE', message: notice });
        }
      });
    } finally {
      this.usageRunning = false;
    }
  }

  /** Puts today's saved readings on the characters, so the chart survives a restart. */
  private showUsageToday(only?: CLIModelId) {
    for (const modelId of only ? [only] : cliIds) {
      this.characters[modelId].usageHistory = this.usageToday.series(modelId).map(point => ({
        time: new Date(point.at).toLocaleTimeString(), at: point.at, hp: point.hp, mp: point.mp,
      }));
    }
  }

  private applyUsage(modelId: CLIModelId, usage: Usage) {
    const char = this.characters[modelId];
    const hp = usage.fiveHour;
    const mp = usage.weekly;
    const vouchers = usage.vouchers;
    const resetChanged = (usage.fiveHourResetsAt !== undefined && usage.fiveHourResetsAt !== char.hp5h.resetsAt) ||
      (usage.weeklyResetsAt !== undefined && usage.weeklyResetsAt !== char.mpWeekly.resetsAt);
    if (usage.fiveHourResetsAt !== undefined) char.hp5h.resetsAt = usage.fiveHourResetsAt;
    if (usage.weeklyResetsAt !== undefined) char.mpWeekly.resetsAt = usage.weeklyResetsAt;
    const percentChanged = (hp !== undefined && hp !== char.hp5h.current) || (mp !== undefined && mp !== char.mpWeekly.current);
    const changed = percentChanged || resetChanged;
    if (hp !== undefined) {
      char.hp5h.current = hp;
      char.hp5h.usedPercent = 100 - hp;
    }
    if (mp !== undefined) {
      char.mpWeekly.current = mp;
      char.mpWeekly.usedPercent = 100 - mp;
    }
    // The chart is today only (00:00 to 24:00); the first reading after midnight starts it afresh.
    if (this.usageToday.record(modelId, char.mpWeekly.current, char.hp5h.current, percentChanged)) this.showUsageToday(modelId);
    if (changed || (vouchers !== undefined && vouchers !== char.hp5h.resetVouchers)) {
      if (vouchers !== undefined) char.hp5h.resetVouchers = vouchers;
      this.emit({ type: 'SYNC_UPDATE', character: char });
    }
  }

  private reportBackgroundFailure(operation: string, error: unknown) {
    const failure = error as { code?: string | number; signal?: string; name?: string } | undefined;
    if (failure?.code === 'ENOENT') return;
    // Child errors can carry raw CLI output. Keep only the status and log each reason once.
    const reason = failure?.signal ?? failure?.code ?? failure?.name ?? 'unknown';
    const key = `${operation}: ${reason}`;
    if (this.loggedBackgroundFailures.has(key)) return;
    this.loggedBackgroundFailures.add(key);
    console.error(operation, reason);
  }

  /** Codex rewrites its model cache when a new model comes out; read it again so the picker does not wait for a Bridge restart. */
  private async refreshCodexModels() {
    if (this.closed) return;
    try {
      const next = codexModelsFromCache(await readFile(join(process.env.CODEX_HOME || join(home, '.codex'), 'models_cache.json'), 'utf8'));
      const character = this.characters.CODEX;
      if (JSON.stringify([character.availableSubModels, character.modelOptions]) === JSON.stringify([next.availableSubModels, next.modelOptions])) return;
      Object.assign(character, next);
      this.emit({ type: 'SYNC_UPDATE', character });
    } catch (error) {
      // A first write may be incomplete. Leave the current list in place for the next refresh.
      if (!(error instanceof SyntaxError)) this.reportBackgroundFailure('無法刷新 Codex 模型目錄', error);
    }
  }

  /** Entitlements can change while the Bridge is running. Keep the last valid AGY list on failure. */
  private async refreshAgyModels(readModels = async () => (await run('agy', ['models'], { timeout: 10_000, maxBuffer: 128_000 })).stdout) {
    const now = Date.now();
    if (this.closed || now < this.nextAgyModelCheck) return;
    this.nextAgyModelCheck = now + agyModelRefreshMs;
    try {
      const next = [...new Set((await readModels()).split('\n').map(line => line.split('\t')[0].trim())
        .filter(id => /^[\w.-]+$/.test(id) && id.includes('-')))];
      const character = this.characters.AGY;
      if (this.closed || !next.length || next.join('\n') === character.availableSubModels.join('\n')) return;
      character.availableSubModels = next;
      this.emit({ type: 'SYNC_UPDATE', character });
    } catch (error) { this.reportBackgroundFailure('無法刷新 AGY 模型目錄', error); }
  }

  // Transcript watching
  // Watch native session files and update room history as they change.
  async watch() {
    if (this.closed) return;
    void this.refreshUsage();
    this.usageTimer = setInterval(() => {
      void this.refreshUsage();
      void this.refreshCodexModels();
      void this.refreshAgyModels();
    }, usageRefreshMs);
    this.usageTimer.unref();
    const root = await roomDirectory(this.workspace, this.workspace).catch(() => this.workspace);
    if (this.closed) return;
    this.stopWatching = watchSessions(
      () => root, session => this.syncWatchedSession(session),
      (modelId, file) => {
        for (const [id, saved] of this.saved) {
          if (saved.modelId !== modelId || saved.file !== file) continue;
          this.saved.delete(id);
          if (!this.live.has(id) && !this.roomBindings.has(id)) {
            this.rooms.delete(id);
            this.emit({ type: 'ROOM_REMOVED', roomId: id });
          }
          this.emit({ type: 'SYNC_UPDATE', character: this.syncCharacter(modelId) });
        }
      },
      message => {
        if (!this.notices.has(message)) {
          this.notices.add(message);
          this.emit({ type: 'NOTICE', message });
        }
      },
      (modelId, file) => {
        const match = file.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);
        if (!match) return false;
        const key = roomIdFor(modelId, match[0]);
        return this.archivedKeys.has(key) || this.roomNames.has(key) || this.roomBindings.has(key) || this.retainedRooms.has(key) || this.pins.has(key) || (this.protection.readable && this.protection.has([key]));
      },
      // A room that was asked to load earlier messages keeps its larger window when its file changes.
      file => Math.max(historyLimit, ...[...this.rooms.values()].filter(room => room.syncedStateFile === file).map(room => room.historyLimit ?? 0)),
      (file, changed) => this.watchCodexForkRollout(file, changed),
      () => [...this.live].flatMap(([id, live]) => {
        const room = this.rooms.get(id);
        if (live.closing || room?.modelId !== 'CODEX' || room.syncedStateFile) return [];
        const sessionId = room.sessionId ? (live.forkedFromSession ? room.sessionId : undefined) : live.discoveredSessionId;
        return sessionId ? [sessionId] : [];
      }),
    );

    // Load the initial picker options after starting the session watcher.
    const [codex, claude] = await Promise.allSettled([
      readFile(join(process.env.CODEX_HOME || join(home, '.codex'), 'models_cache.json'), 'utf8'),
      run('claude', ['-p', '/model', '--output-format', 'json', '--no-session-persistence'], { timeout: 10_000, maxBuffer: 128_000 }),
      this.refreshAgyModels(),
    ]);
    if (codex.status === 'fulfilled') {
      try { Object.assign(this.characters.CODEX, codexModelsFromCache(codex.value)); }
      catch { /* The original CLI picker remains available. */ }
    }
    if (claude.status === 'fulfilled') {
      try {
        const result = JSON.parse(claude.value.stdout).result as string;
        const aliases = result.match(/Available:\s*([^\n]+)/i)?.[1] ?? '';
        const models = aliases.split(/,\s*|\s+or\s+/).map(value => value.trim())
          .filter(value => /^(?:sonnet|opus|haiku|fable|mythos)$/i.test(value));
        this.characters.CLAUDE.modelOptions = models.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
      } catch { /* Use the native picker until model information is available. */ }
    }
    for (const modelId of ['CODEX', 'CLAUDE'] as const) this.emit({ type: 'SYNC_UPDATE', character: this.characters[modelId] });
  }

  launchModes() { return this.modes.snapshot; }
  autoCompactAll() { return this.compactRooms.all; }

  private modeKeys(room: TerminalRoom) {
    return room.sessionId ? [room.id, roomIdFor(room.modelId, room.sessionId)] : [room.id];
  }

  snapshot() {
    return [...this.rooms.values()].sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || b.updatedAt.localeCompare(a.updatedAt));
  }

  private syncCharacter(modelId: CLIModelId) {
    const character = this.characters[modelId];
    const sessions = [...this.saved.values()].filter(session => session.modelId === modelId);
    const latest = sessions.sort((a, b) => b.updated.localeCompare(a.updated))[0];
    character.localSync = {
      ...character.localSync, syncedFilesCount: sessions.length,
      lastSyncedAt: latest ? new Date(latest.updated).toLocaleString() : '—',
      latestSyncedFile: latest?.file ?? '—',
      syncStatus: 'watching',
    };
    return character;
  }

  private async syncWatchedSession(session: SavedSession) {
    if (session.modelId === 'AGY' && session.file.startsWith('~/.gemini/antigravity-cli/brain/')) {
      const pending = [...this.live].flatMap(([roomId, live]) => {
        const room = this.rooms.get(roomId);
        return room && !room.sessionId && live.agySessionLog ? [{ room, live, file: live.agySessionLog }] : [];
      });
      if (pending.length) {
        // Transcript sync can arrive before macOS delivers the CLI log's file event.
        const ids = await Promise.all(pending.map(({ file }) => agyLogSession(file).catch(() => undefined)));
        const matches = pending.filter(({ room, live }, index) =>
          this.live.get(room.id) === live && ids[index] === session.id);
        if (!this.closed && matches.length === 1) this.bindSession(matches[0].room, session.id);
      }
    }
    this.sync(session);
  }

  private clearPendingCodexRollouts() {
    if ([...this.live].some(([roomId, live]) =>
      live.forkedFromSession && this.rooms.get(roomId)?.modelId === 'CODEX' && !this.rooms.get(roomId)?.sessionId)) return;
    for (const stop of this.pendingCodexRollouts.values()) stop();
  }

  private watchForkFile(file: string, changed: () => void, onStop: () => void) {
    let previous = statSync(file);
    let active = true;
    let polling = true;
    let checking = false;
    const watcher = watchFileSystem(file, { persistent: false }, event => {
      if (!active) return;
      if (event === 'rename') stop();
      else {
        try { previous = statSync(file); } catch { /* The next poll or rename will handle a missing file. */ }
      }
      changed();
    });
    const timer = setInterval(() => {
      if (!active || !polling || checking) return;
      checking = true;
      void stat(file).then(current => {
        if (!active || !polling) return;
        if (current.size !== previous.size || current.mtimeMs !== previous.mtimeMs || current.ino !== previous.ino) {
          previous = current;
          changed();
        }
      }).catch(error => {
        if (active && polling && (error as NodeJS.ErrnoException).code === 'ENOENT') { stop(); changed(); }
      }).finally(() => { checking = false; });
    }, forkRecoveryIntervalMs);
    timer.unref();
    const expiry = setTimeout(() => { polling = false; clearInterval(timer); }, forkRecoveryLimitMs);
    expiry.unref();
    const stop = () => {
      if (!active) return;
      active = false;
      polling = false;
      clearInterval(timer);
      clearTimeout(expiry);
      watcher.close();
      onStop();
    };
    watcher.on('error', stop);
    return stop;
  }

  private watchCodexForkRollout(file: string, changed: () => void) {
    const id = basename(file).slice(-42, -6); // Native rollout names end in <session UUID>.jsonl.
    if (this.closed || !validSessionId.test(id)) return;
    const binding = this.roomBindings.get(roomIdFor('CODEX', id));
    const live = binding && this.live.get(binding.roomId);
    if (!live?.forkedFromSession) {
      if (this.saved.has(roomIdFor('CODEX', id))) return;
      const pending = [...this.live].some(([roomId, candidate]) =>
        candidate.forkedFromSession && this.rooms.get(roomId)?.modelId === 'CODEX' && !this.rooms.get(roomId)?.sessionId);
      if (!pending || this.pendingCodexRollouts.has(file)) return;
      try {
        const stop = this.watchForkFile(file, changed, () => this.pendingCodexRollouts.delete(file));
        this.pendingCodexRollouts.set(file, stop);
      } catch { /* The next directory event can retry. */ }
      return;
    }
    this.pendingCodexRollouts.get(file)?.();
    if (live.disposeForkRollout) return;
    // On macOS the directory watcher can miss appends while Codex holds the file open.
    try {
      const stop = this.watchForkFile(file, changed, () => {
        if (live.disposeForkRollout !== stop) return;
        live.disposeForkRollout = undefined;
      });
      live.disposeForkRollout = stop;
    } catch { /* The directory watcher still handles this rollout if the exact watch could not start. */ }
  }

  private async recoverCodexFork(room: TerminalRoom, live: LiveRoom) {
    if (!live.forkedFromSession || !live.process.pid) return;
    try {
      const result = await run('/usr/sbin/lsof', ['-a', '-p', String(live.process.pid), '-Fn'], { timeout: 3_000, maxBuffer: 512_000 });
      const root = join(home, sessionRoots.CODEX[0]);
      const files = result.stdout.split('\n').filter(line => line.startsWith('n/')).map(line => line.slice(1))
        .filter(file => isInside(root, file) && /^rollout-.*\.jsonl$/.test(basename(file)));
      const sessions = await Promise.all([...new Set(files)].map(async file => {
        if (!isInside(root, await realpath(file))) return;
        return readSession('CODEX', file, root, this.workspace);
      }));
      const matches = sessions.filter((session): session is SavedSession => Boolean(session && session.forkedFromId === live.forkedFromSession &&
        (session.cwd === room.repoPath || session.cwd === live.resolvedCwd)));
      if (matches.length !== 1 || !matches[0] || this.live.get(room.id) !== live || room.sessionId) return;
      const session = matches[0];
      // The process has this file open, so this also disambiguates simultaneous forks of the same parent.
      this.bindSession(room, session.id);
      if (room.sessionId !== session.id) return;
      this.sync(session);
      const file = join(home, session.file.slice(2));
      this.watchCodexForkRollout(file, () => {
        void readSession('CODEX', file, root, this.workspace).then(next => {
          if (next && this.live.get(room.id) === live) this.sync(next);
        }).catch(() => {});
      });
    } catch { /* If process or file inspection fails, the normal watcher remains active. */ }
  }

  private sync(session: SavedSession) {
    if (this.closed) return;
    const id = roomIdFor(session.modelId, session.id);
    if (this.deletedKeys.has(id)) return;
    const prior = this.saved.get(id);
    if (prior && prior.updated > session.updated) session = prior;
    const assignedRoomId = session.modelId === 'CLAUDE'
      ? (this.rooms.has(session.id)
        ? session.id
        : [...this.live].find(([roomId, live]) => {
            const room = this.rooms.get(roomId);
            return Boolean(
              live.forkedFromSession &&
              live.forkedFromSession !== session.id &&
              room?.modelId === 'CLAUDE' &&
              !room.sessionId &&
              (room.repoPath === session.cwd || live.resolvedCwd === session.cwd) &&
              !this.roomBindings.has(id)
            );
          })?.[0] ?? session.id)
      : ([...this.live].find(([, live]) => live.discoveredSessionId === session.id)?.[0] ??
         (session.modelId === 'CODEX'
           ? (() => {
               if (!session.forkedFromId) return;
               const matches = [...this.live].filter(([roomId, live]) => {
                 const room = this.rooms.get(roomId);
                 return Boolean(
                   live.forkedFromSession &&
                   live.forkedFromSession !== session.id &&
                   session.forkedFromId === live.forkedFromSession &&
                   room?.modelId === 'CODEX' &&
                   !room.sessionId &&
                   (room.repoPath === session.cwd || live.resolvedCwd === session.cwd) &&
                   !this.roomBindings.has(id)
                 );
               });
               return matches.length === 1 ? matches[0][0] : undefined;
             })()
           : undefined));
    const candidate = assignedRoomId ? this.rooms.get(assignedRoomId) : undefined;
    if (candidate?.modelId === session.modelId && (candidate.repoPath === session.cwd || this.live.get(candidate.id)?.resolvedCwd === session.cwd)) {
      this.bindSession(candidate, session.id);
    }
    const matching = [...this.rooms.values()].find(room => room.modelId === session.modelId && room.sessionId === session.id);
    const room = matching ?? this.rooms.get(id) ?? newRoom(session.modelId, session.cwd ? basename(session.cwd) : `Brain · ${session.id.slice(0, 8)}`, session.cwd ?? '', id);
    const parentLogs = session.forkedFromId ? this.saved.get(roomIdFor(session.modelId, session.forkedFromId))?.logs : undefined;
    const sessionLogs = parentLogs?.length ? mergeHistory(parentLogs, session.logs) : session.logs;
    this.saved.set(id, sessionLogs === session.logs ? session : { ...session, logs: sessionLogs });
    this.rooms.set(room.id, room);
    if (session.modelId === 'CODEX') this.pendingCodexRollouts.get(join(home, session.file.slice(2)))?.();
    if (this.archivedKeys.has(room.id) && !this.archivedKeys.has(id)) {
      this.saveArchive(new Set([...this.archivedKeys, id]));
    }
    this.linkRoomName(room, id);
    room.sessionId = session.id;
    room.autoCompact = this.compactRooms.enabled(this.modeKeys(room));
    this.linkPin(room);
    this.linkProtection(room);
    room.syncedStateFile = session.file;
    room.syncSource = '本地 Session';
    room.resumable = session.resumable || this.roomBindings.has(id);
    room.pendingQuestion = session.pendingQuestion;
    // The record's token count is the steady source; a Codex screen that says "% context left" is read in refresh and wins.
    if (session.contextUsagePct !== undefined) { room.contextUsagePct = session.contextUsagePct; room.contextTokens = session.contextTokens; room.contextWindow = session.contextWindow; }
    if (room.live) {
      const entries = [...room.logs];
      const live = this.live.get(room.id);
      for (const entry of sessionLogs) {
        const existing = entries.findIndex(item => item.id === entry.id);
        if (existing >= 0) entries[existing] = entry;
        else if (entry.sender === 'user' && !live?.seenTranscriptUsers?.has(entry.id)) {
          const key = userTextKey(entry.text);
          const local = entries.find(item => {
            if (item.sender !== 'user' || live?.matchedLocalUsers?.has(item.id) || item.id.startsWith(session.id + '-')) return false;
            const own = userTextKey(item.text);
            return own === key || (key.startsWith(own) && startsWithBridgeNote(key.slice(own.length))) ||
              (key.startsWith(own + ' 〔群組 Session ID：') && key.endsWith('〕'));
          });
          if (local) {
            live?.matchedLocalUsers?.add(local.id);
            // The CLI stamps its rows to the second and Komorebi to the millisecond, so an answer written in the same second would
            // sort above the message it answers. The CLI's own time is the earlier, so the message takes it.
            const own = entryTime(local), theirs = entryTime(entry);
            if (Number.isFinite(theirs) && !(own <= theirs)) local.createdAt = entry.createdAt;
          } else insertByTime(entries, entry);
        } else if (entry.sender === 'agent' && !live?.seenTranscriptAgents?.has(entry.id)) insertByTime(entries, entry);
        if (entry.sender === 'user') live?.seenTranscriptUsers?.add(entry.id);
        if (entry.sender === 'agent') live?.seenTranscriptAgents?.add(entry.id);
      }
      const limit = Math.max(historyLimit, room.historyLimit ?? 0);
      // A message read later can be older than ones already shown, so the order is kept by time.
      const ordered = inTimeOrder(entries);
      room.logs = ordered.slice(-limit);
      if (ordered.length > limit || session.truncated) room.historyTruncated = true;
    } else {
      room.gitBranch = session.branch;
      room.selectedSubModel = session.activeModel ?? room.selectedSubModel;
      room.effortLevel = session.lastEffort ?? null;
      room.effortSource = session.lastEffort ? 'session' : undefined;
      room.currentActionSummary = session.resumable ? '本地工作階段 · 可續接' : '本地 Brain 對話紀錄';
      room.bubbleSnippet = sessionLogs.at(-1)?.text.slice(0, 100) ?? '';
      room.logs = sessionLogs;
      room.historyTruncated = session.truncated === true;
      room.updatedAt = session.updated;
    }
    this.emit({ type: 'SYNC_UPDATE', character: this.syncCharacter(session.modelId), room });
    if (id !== room.id && this.retainedRooms.has(id)) {
      this.emit({ type: 'ROOM_REMOVED', roomId: id, replacementRoomId: room.id });
    }
    const savedRooms = this.snapshot().filter(item => item.id.startsWith('session-') && !item.live && !this.starting.has(item.id) &&
      !this.retainedRooms.has(item.id) && !this.isProtected(item) && !this.archiveKeys(item).some(key => this.archivedKeys.has(key) || this.roomNames.has(key) || this.pins.has(key)));
    for (const stale of savedRooms.slice(45)) {
      this.saved.delete(stale.id);
      this.rooms.delete(stale.id);
      this.emit({ type: 'ROOM_REMOVED', roomId: stale.id });
    }
  }

  // Room lifecycle
  // Start, resume, fork and close room terminals while keeping their session links.
  private startExisting(room: TerminalRoom, stillWanted?: () => boolean, remote = false) {
    if (!room.repoPath || (room.sessionId && !room.resumable)) throw new Error('這間房未有可續接的工作階段，請先確認原有 Session。');
    if (!room.live && !room.sessionId && hasConversation(room)) {
      throw new Error('未確認到這間房的 Session ID。請在角色房間清單重新選擇已同步的對話續接。');
    }
    return this.start(room, () => {}, { remote }, stillWanted);
  }

  private async start(room: TerminalRoom, select: (event: ServerEvent) => void,
    { remote = false, agyAuto, fullAccess, forkFromSession }: { remote?: boolean; agyAuto?: boolean; fullAccess?: boolean; forkFromSession?: string },
    stillWanted?: () => boolean) {
    if (this.live.has(room.id) || this.starting.has(room.id)) return;
    if (this.activeSessionAlias(room)) {
      throw new Error('同一個 Session 已經在另一間房開啟中。');
    }
    if (this.live.size + this.starting.size >= maxLiveCli) throw new Error(groupWakeNotice.limit);
    this.starting.add(room.id);
    this.onRecoveryChange?.(room.id);
    let agyLogDirectory: string | undefined;
    try {
      const cwd = await roomDirectory(this.workspace, room.repoPath);
      if (this.closed || stillWanted?.() === false) return;
      let connectedRemote = remote;
      if (remote && room.modelId === 'CODEX') {
        try {
          await this.setCodexRemote(true, true);
        } catch {
          connectedRemote = false;
          this.codexRemoteStatus = 'unknown';
          this.emit({ type: 'NOTICE', message: 'Codex Remote Control 啟動失敗，已開啟本地 CLI；請稍後檢查遠端連線。' });
        }
        if (this.closed || stillWanted?.() === false) return;
      }
      // A mode chosen now (creating the room) is remembered; otherwise the room's saved choice, else its CLI's default.
      const chosen = room.modelId === 'AGY' ? agyAuto : fullAccess;
      const auto = chosen ?? this.modes.resolve(room.modelId, this.modeKeys(room));
      if (chosen !== undefined) {
        try { this.modes.setRoom([room.id], chosen); }
        catch { this.emit({ type: 'NOTICE', message: '無法保存這間房的權限模式，重連後可能改用預設。' }); }
      }
      room.autoMode = auto;
      // Only a room in a group gets the workbench hook; a room on its own runs as before.
      const bench = this.benchHook && this.retainedRooms.has(room.id) ? { hook: this.benchHook } : undefined;
      room.benchHooked = Boolean(bench) && (room.modelId !== 'AGY' || this.agyBenchPlugin());
      const keys = this.modeKeys(room);
      const recordedWindow = room.modelId === 'CODEX' && room.sessionId
        ? this.saved.get(roomIdFor('CODEX', room.sessionId))?.codexUsableContextWindow
        : undefined;
      const enabled = this.compactRooms.enabled(keys);
      const compact = enabled ? autoCompactArgs(room.modelId, connectedRemote, recordedWindow) : [];
      // Don't pass bridge credentials or nested-session markers to any child CLI.
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', PWD: cwd };
      for (const key of ['KOMOREBI_PAIRING_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_THREAD_ID']) delete env[key];
      let compactSupported = false;
      if (compact.length || (enabled && room.modelId === 'AGY')) {
        const probe = room.modelId === 'CLAUDE' ? ['claude', '--help'] : [room.modelId.toLowerCase(), '--version'];
        const { stdout } = await run(probe[0], probe.slice(1), { cwd, env, timeout: 2_000 }).catch(error => {
          this.reportBackgroundFailure(`無法檢查 ${room.modelId} Auto Compact 支援`, error);
          return { stdout: '' };
        });
        compactSupported = supportsAutoCompact(room.modelId, stdout);
      }
      if (this.closed || stillWanted?.() === false) return;
      if (room.modelId === 'AGY' && !room.sessionId) {
        agyLogDirectory = await mkdtemp(join(tmpdir(), 'komorebi-agy-session-'));
      }
      if (this.closed || stillWanted?.() === false) {
        if (agyLogDirectory) await rm(agyLogDirectory, { recursive: true, force: true }).catch(error => {
          this.reportBackgroundFailure('無法清理 AGY 臨時 log 目錄', error);
        });
        return;
      }
      // The preference may have changed while probing the CLI or preparing its session log.
      const compactEnabled = this.compactRooms.enabled(this.modeKeys(room));
      const useCompact = compactSupported && compactEnabled;
      const [command, args] = cliLaunch(room, connectedRemote, room.modelId === 'AGY' && auto, room.modelId !== 'AGY' && auto, bench, room.modelId === 'AGY' ? this.agyChoices.get(room.id) : undefined, room.modelId === 'CODEX' ? this.fastFor(room.id) : undefined, room.modelId === 'CLAUDE' ? this.claudeChoices.get(room.id) : undefined, forkFromSession, useCompact ? compact : []);
      if (agyLogDirectory) args.push('--log-file', join(agyLogDirectory, 'cli.log'));
      if (useCompact && room.modelId === 'AGY') env.AGY_CLI_AUTO_COMPACT_OVERRIDE = String(autoCompactTarget);
      const terminal = new Terminal({ cols, rows, scrollback: 100, allowProposedApi: true });
      let child: IPty;
      try { child = spawn(command, args, { name: 'xterm-256color', cols, rows, cwd, env }); }
      catch (error) {
        terminal.dispose();
        if (agyLogDirectory) await rm(agyLogDirectory, { recursive: true, force: true }).catch(error => {
          this.reportBackgroundFailure('無法清理 AGY 臨時 log 目錄', error);
        });
        throw error;
      }
      const live: LiveRoom = {
        process: child, terminal, queued: 0, dirty: false, remote: connectedRemote,
        forkedFromSession: forkFromSession, resolvedCwd: cwd,
        probedSession: room.modelId !== 'CODEX' || Boolean(room.sessionId),
        seenTranscriptAgents: new Set(room.logs.filter(entry => entry.sender === 'agent').map(entry => entry.id)),
        seenTranscriptUsers: new Set(room.logs.filter(entry => entry.sender === 'user').map(entry => entry.id)),
        matchedLocalUsers: new Set(),
      };
      this.live.set(room.id, live);
      room.live = true;
      room.autoCompact = compactEnabled;
      room.autoCompactActive = useCompact;
      room.ready = false;
      room.screen = '';
      room.screenId = undefined;
      room.screenStyles = undefined;
      room.status = 'running';
      room.remoteStatus = room.modelId === 'CODEX' ? this.codexRemoteStatus : remote ? 'connecting' : 'off';
      room.remoteControl.autoLaunchedFlag = [command, ...args].join(' ');
      room.currentActionSummary = 'CLI 啟動中';
      room.updatedAt = new Date().toISOString();
      this.rooms.set(room.id, room);
      if (agyLogDirectory) this.watchAgySession(room, live, agyLogDirectory);
      this.emit({ type: 'ROOM', room });
      select({ type: 'ROOM', room, select: true });
      void run('git', ['-C', cwd, 'branch', '--show-current'], { timeout: 3_000 }).then(({ stdout }) => {
        if (stdout.trim() && room.live) {
          room.gitBranch = stdout.trim();
          this.emit({ type: 'ROOM', room });
        }
      }).catch(error => {
        // A room can start in a folder outside Git.
        if (error?.code === 128 && /^fatal: not a git repository\b/.test(error.stderr ?? '')) return;
        this.reportBackgroundFailure('無法讀取房間 Git 分支', error);
      });
      child.onData(data => {
        live.lastOutputAt = Date.now();
        live.queued++;
        live.dirty = true;
        terminal.write(data, () => {
          live.queued--;
          if (this.live.get(room.id) !== live) return;
          clearTimeout(live.refresh);
          live.refresh = setTimeout(() => {
            live.refresh = undefined;
            this.refresh(room, live);
          }, 60);
        });
      });
      child.onExit(({ exitCode, signal }) => {
        if (this.live.get(room.id) !== live) return;
        clearTimeout(live.refresh);
        this.cancelSubmission(live, 'CLI 已結束，指令未送出。');
        clearTimeout(live.sessionProbe);
        live.disposeSessionLog?.();
        live.disposeForkRollout?.();
        this.cancelDeferred(room, live, 'CLI 已結束');
        try { this.refresh(room, live); }
        catch (error) { console.error('CLI 結束時未能更新最後畫面', error); }
        this.live.delete(room.id);
        this.clearPendingCodexRollouts();
        terminal.dispose();
        room.live = false;
        room.autoCompactActive = false;
        room.benchHooked = false;
        room.ready = false;
        room.pendingApproval = undefined;
        room.menu = undefined;
        room.remoteStatus = room.modelId === 'CODEX' ? this.codexRemoteStatus : 'off';
        room.remoteControl.enabled = false;
        room.remoteControl.sessionUrl = '';
        room.status = 'completed';
        room.currentActionSummary = live.closedAutomatically
          ? '已離開房間 · CLI 已結束'
          : `CLI 已結束（${signal ? `signal ${signal}` : `exit ${exitCode}`}）`;
        log(room, 'system', room.currentActionSummary);
        this.emit({ type: 'ROOM', room });
        live.resolveClose?.();
      });
    } finally {
      this.starting.delete(room.id);
      this.onRecoveryChange?.(room.id);
    }
  }

  private watchAgySession(room: TerminalRoom, live: LiveRoom, directory: string) {
    const file = join(directory, 'cli.log');
    live.agySessionLog = file;
    const discover = async () => {
      if (room.sessionId) return;
      const id = await agyLogSession(file).catch(() => undefined);
      if (!id || this.rooms.get(room.id) !== room) return;
      this.bindSession(room, id);
      if (room.sessionId) {
        const saved = this.saved.get(roomIdFor(room.modelId, id));
        if (saved) this.sync(saved);
        else this.emit({ type: 'ROOM', room });
      }
    };
    let watcher: ReturnType<typeof watchFileSystem> | undefined;
    try {
      watcher = watchFileSystem(directory, { persistent: false }, () => { void discover(); });
      watcher.on('error', () => watcher?.close());
    } catch { /* Check the log once more when the process exits. */ }
    live.disposeSessionLog = () => {
      watcher?.close();
      void discover().finally(() => rm(directory, { recursive: true, force: true })).catch(() => {});
    };
    void discover();
  }

  // Screen refresh
  // Read terminal output and update room readiness, menus and pending cards.
  private refresh(room: TerminalRoom, live: LiveRoom, notifyIdle = true) {
    if (live.closing || live.queued) return;
    live.dirty = false;
    const { screen, styles } = readTerminalScreen(live.terminal, rows);
    const changed = screen !== room.screen || JSON.stringify(styles) !== JSON.stringify(room.screenStyles ?? []);
    const approval = approvalPrompt(room.modelId, screen);
    if (!approval || live.answered !== approval.fingerprint) live.answered = undefined;
    const pending = approval && approval.fingerprint !== live.answered ? approval : undefined;
    if (approval && live.deferredInput) this.cancelDeferred(room, live, 'CLI 需要先處理審批');
    const approvalChanged = pending?.fingerprint !== live.approvalFingerprint;
    if (approvalChanged) {
      live.approvalFingerprint = pending?.fingerprint;
      room.pendingApproval = pending?.card;
    }

    const menu = approval || live.submitted ? undefined : visibleMenu(room.modelId, screen, live.requested);
    const menuChanged = menu?.title !== room.menu?.title || menu?.confirm !== room.menu?.confirm;
    if (menu && (menuChanged || changed)) room.menu = { id: randomUUID(), ...menu, numberKeys: [...numberedMenuChoices(room.modelId, screen).keys()].sort(), yesNo: modelConfirmationChoices(room.modelId, screen) };
    if (!menu) room.menu = undefined;
    const resuming = resumePrompt(room.modelId, screen);
    if (resuming && !live.resumeReported) { live.resumeReported = true; queueMicrotask(() => this.onResumePrompt?.(room)); }
    else if (!resuming) live.resumeReported = false;

    // AGY keeps its composer visible during tools; the footer can be the only busy signal.
    // Keep this out of generic menu detection, where the same hint means cancel a menu.
    const working = hasWorkingIndicator(screen) || (room.modelId === 'AGY' &&
      /^[ \t]*esc to cancel\b/im.test(screen.split('\n').slice(-9).join('\n')));
    const ready = !approval && !room.menu && !live.submitted && isComposer(room.modelId, screen) && !working;
    if (room.modelId === 'CODEX' && ready && !room.sessionId && live.forkedFromSession && !live.forkRecoveryAttempted) {
      live.forkRecoveryAttempted = true;
      void this.recoverCodexFork(room, live);
    }
    if (room.modelId === 'AGY') {
      const agyQ = agyQuestionScreen(screen);
      if (agyQ && !room.pendingQuestion) {
        const opts = agyQ.options.filter(opt => opt.n !== agyQ.other).map(opt => opt.label);
        room.pendingQuestion = {
          id: new Date().toISOString(),
          questions: [{ title: agyQ.title, options: opts.length ? opts : null, ...(agyQ.multiSelect ? { multiSelect: true } : {}) }],
        };
      } else if (!agyQ && room.pendingQuestion && (ready || working)) {
        room.pendingQuestion = undefined;
      }
    }
    if (room.modelId === 'CODEX' && !room.sessionId && live.probedSession === false && ready && !live.sessionProbe) {
      live.sessionProbe = setTimeout(() => {
        live.sessionProbe = undefined;
        if (this.live.get(room.id) !== live || !room.ready || live.dirty || live.queued || live.submitted) return;
        live.probedSession = true;
        this.submitInput(room, live, '/status', undefined, 500);
      }, 500);
    }
    const status = pending ? 'waiting_approval' : ready ? 'idle' : 'running';
    const steerable = !approval && !room.menu && isComposer(room.modelId, screen);
    if (!changed && !approvalChanged && !menuChanged && !live.deferredInput && room.ready === ready && room.status === status && room.steerable === steerable && (room.backgroundTasks ?? 0) === backgroundTasks(room.modelId, screen)) {
      this.onRecoveryChange?.(room.id);
      return;
    }

    room.screen = screen;
    if (changed) room.screenId = randomUUID();
    room.screenStyles = styles;
    const becameIdle = ready && !room.ready;
    if (room.ready && !ready && working && !approval && !room.menu) {
      live.reportBaseline = lastAgentEntry(room) ?? null;
    }
    room.ready = ready;
    room.steerable = steerable;
    room.backgroundTasks = backgroundTasks(room.modelId, screen) || undefined;
    room.status = status;
    room.currentActionSummary = pending ? pending.card.title : room.menu?.title ?? (ready ? 'CLI 可以接收指令' : 'CLI 處理中');
    room.updatedAt = new Date().toISOString();
    if (becameIdle && notifyIdle) queueMicrotask(() => this.onIdle?.(room));

    const model = activeModel(room.modelId, screen);
    if (model.name) room.selectedSubModel = model.name;
    else this.noteClaudeModel(room);
    this.noteEffort(room, model.effort);
    if (room.modelId === 'CODEX') this.noteFast(room, screen);
    // A Claude room keeps the model it runs with, so reopening it does not fall back to the CLI's global default.
    if (room.modelId === 'CLAUDE' && model.name && !live.closing) this.rememberClaudeModel(room.id, { model: claudeModelFlag(model.name), effort: claudeEffortFlag(model.effort) });
    // Remember the model an AGY room is running with, so it keeps it when it is reopened whatever other rooms choose.
    if (room.modelId === 'AGY' && model.name && model.effort && !this.agyChoices.has(room.id)) {
      const id = this.agyModelId(model.name, model.effort);
      if (id) this.rememberAgyModel(room.id, id);
    }
    const context = screen.match(/\b(\d{1,3})% context left\b/i);
    if (context && Number(context[1]) <= 100) room.contextUsagePct = 100 - Number(context[1]);
    if (room.modelId !== 'CODEX') this.updateRemote(room, screen);
    if (room.modelId === 'CLAUDE' && room.menu?.title === '模型／推理力度') {
      const models = [...screen.matchAll(/^\s*\d+\.\s*(?:\(selected\)\s*)?((?:Opus|Sonnet|Haiku|Fable|Mythos) \d+(?:\.\d+)?)\s+[—–]/gim)].map(match => match[1]);
      if (models.length) {
        this.characters.CLAUDE.availableSubModels = models;
        this.characters.CLAUDE.modelOptions = models.map(label => ({ id: label.split(' ')[0].toLowerCase(), label }));
      }
      this.emit({ type: 'SYNC_UPDATE', character: this.characters.CLAUDE });
    }
    // Not only right after our own /status: a message typed straight after it (the Founder's, or the first task) moves `requested` on before this screen is read.
    const unbound = room.modelId === 'CODEX' && !room.sessionId && !live.discoveredSessionId;
    const sessionId = unbound ? (live.requested === '/status' ? screen.match(codexSessionLine)?.[1] : undefined) ?? codexStatusSession(screen) : undefined;
    if (sessionId) {
      live.discoveredSessionId = sessionId;
      const saved = this.saved.get(roomIdFor('CODEX', sessionId));
      if (saved) this.sync(saved);
      else if (live.forkedFromSession && sessionId !== live.forkedFromSession) this.bindSession(room, sessionId);
    }
    this.updateUsage(room, screen);
    this.emit({ type: 'ROOM', room });
    if (ready && live.deferredInput) {
      const queued = live.deferredInput;
      clearTimeout(queued.timer);
      live.deferredInput = undefined;
      this.submitInput(room, live, queued.input, queued.original, 100, queued.result, queued.reserveRoster, false, queued.images, queued.inputTraceId);
    }
  }

  private cancelDeferred(room: TerminalRoom, live: LiveRoom, reason: string) {
    const queued = live.deferredInput;
    if (!queued) return;
    clearTimeout(queued.timer);
    live.deferredInput = undefined;
    log(room, 'system', `${reason}，指令未送出，請重試：${queued.original}`);
    const message = `${reason}，指令未送出；內容已保留在房間紀錄。`;
    queued.result(false, message);
  }

  /**
   * Pastes a lone image path and waits for the CLI's native attachment marker.
   * The prompt text is then sent in the same turn.
   * Returns 'unsupported' when the screen cannot be read, so the caller falls back to a path in the text.
   */
  private async attachImage(room: TerminalRoom, live: LiveRoom, path: string): Promise<'attached' | 'unconfirmed' | 'unsupported'> {
    if (!live.terminal?.modes?.bracketedPasteMode) return 'unsupported';
    const before = screenText(live);
    if (before === undefined) return 'unsupported';
    const count = attachedImages(room.modelId, before);
    live.attaching = true;
    try {
      live.process.write(`\x1b[200~${path}\x1b[201~`);
      const deadline = Date.now() + this.attachConfirmMs;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 60));
        if (this.live.get(room.id) !== live || live.closing) throw new Error(`CLI 已改變狀態，圖片已保存在 Mac：${path}。請重新發送。`);
        const screen = screenText(live);
        if (screen !== undefined && attachedImages(room.modelId, screen) > count) return 'attached';
      }
      return 'unconfirmed';
    } finally {
      live.attaching = false;
      this.onRecoveryChange?.(room.id);
    }
  }

  private cancelSubmission(live: LiveRoom, message: string) {
    clearTimeout(live.submitted);
    live.submitted = undefined;
    const result = live.submissionResult;
    live.submissionResult = undefined;
    result?.(false, message);
  }

  private writeScreenKey(room: TerminalRoom, live: LiveRoom, key: string, input = keyCodes[key as MenuKey] ?? key) {
    live.keyAt = Date.now();
    live.process.write(live.terminal?.modes?.applicationCursorKeysMode ? input.replace(/\x1b\[([A-D])/g, '\x1bO$1') : input);
    if (key === 'escape') live.requested = undefined;
    live.dirty = true;
    // Some keys at the edge of a menu produce no PTY output.
    setTimeout(() => { if (this.live.get(room.id) === live && live.dirty && !live.queued) this.refresh(room, live); }, 100);
  }

  /** How long a message waits for a working CLI to show its input box, per try (shorter in tests). */
  steerWaitMs = 200;
  /** How long a message waits for a closed room to open and reach its input box. */
  resumeWaitMs = 60_000;
  /** How long a message that steers a working CLI waits for the paste to show before Enter, when the CLI never goes quiet. */
  steerPatienceMs = 1_500;

  // Answer terminal cards
  // Send question answers and approval decisions through the terminal.
  /** Waits long enough between the keys that the CLI has redrawn before the next one (shorter in tests). */
  questionStepMs = 220;

  /**
   * Answers the question a working Codex has queued, the way a person does: open it, move to the answer, Enter;
   * for typed text, move to Other, Enter, type, Enter. It looks at the screen after each step and stops, returning to
   * the main prompt, as soon as the screen is not what it expects, so a wrong answer is never sent.
   */
  private async answerQuestion(room: TerminalRoom, live: LiveRoom, event: { questionId?: string; choice?: number; text?: string }) {
    const text = typeof event.text === 'string' ? event.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
    const choice = Number.isInteger(event.choice) && (event.choice as number) >= 1 ? event.choice as number : undefined;
    if (room.modelId !== 'CODEX' || (choice === undefined && !text) || text.length > 2_000) throw new Error('無法用這個方式回答。');
    if (room.pendingApproval || live.closing || live.submitted || live.deferredInput) throw new Error('CLI 正在處理其他事，請稍後再試。');
    // The answer belongs to the question the person was shown. If that one was answered or replaced, nothing is pressed.
    const asked = typeof event.questionId === 'string' ? event.questionId : undefined;
    const still = () => asked !== undefined && room.pendingQuestion?.id === asked;
    if (!still()) throw new Error('這條問題已經改變或已被回答，請看最新一題再答。');
    const pause = () => new Promise<void>(resolve => setTimeout(resolve, this.questionStepMs));
    const look = async () => {
      if (live.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
      if (live.dirty) this.refresh(room, live);
      return room.screen ?? '';
    };
    const until = async (done: (screen: string) => boolean) => {
      for (let tries = 0; tries < 12; tries++) {
        await pause();
        if (done(await look())) return true;
      }
      return false;
    };
    const press = (key: MenuKey) => this.writeScreenKey(room, live, key);
    const giveUp = async (reason: string): Promise<never> => {
      if (questionOpen(await look())) press('shift-right');
      throw new Error(`未能自動回答（${reason}），請改用文字訊息，或在終端作答。`);
    };

    let screen = await look();
    if (!questionOpen(screen)) {
      if (!/⇧←\s*to answer/.test(screen)) throw new Error('目前沒有排隊中的問題。');
      press('shift-left');
      if (!(await until(questionOpen))) await giveUp('問題沒有打開');
    }
    screen = await look();
    // The screen must show the same question as the one answered (spaces and line breaks aside).
    const squash = (value: string) => value.replace(/\s+/g, '');
    const title = squash(room.pendingQuestion?.questions[0]?.title ?? '').slice(0, 24);
    if (title.length >= 6 && !squash(screen).includes(title)) await giveUp('畫面上的問題與你看到的不同');
    const panel = questionPanel(screen);
    const typeAnswer = async () => {
      if (!still()) await giveUp('問題已經改變');
      live.process.write(text);
      live.dirty = true;
      const echo = text.slice(0, 6);
      if (!(await until(next => next.includes(echo)))) await giveUp('輸入的字沒有出現');
      press('enter');
      if (!(await until(next => !questionOpen(next)))) await giveUp('送出後問題仍然開著');
    };
    // A question with no listed answers shows only a box to type in.
    if (!panel && /Type your answer/i.test(screen)) {
      if (choice !== undefined || !text) await giveUp('這條問題只可以打字回答');
      await typeAnswer();
      return;
    }
    const target = choice ?? panel?.other;
    if (!panel || target === undefined || !panel.options.some(option => option.n === target) || (choice !== undefined && choice === panel.other)) {
      await giveUp('找不到這個選項');
    }
    let at = panel!.selected;
    for (let moves = 0; at !== target && moves < 12; moves++) {
      if (at === undefined) await giveUp('看不到目前選了哪項');
      press(at! < (target as number) ? 'down' : 'up');
      const before = at;
      await until(next => questionPanel(next)?.selected !== before);
      at = questionPanel(await look())?.selected;
    }
    if (at !== target) await giveUp('選項沒有移動到位');
    if (!still()) await giveUp('問題已經改變');
    press('enter');
    if (choice !== undefined) {
      if (!(await until(next => !questionOpen(next)))) await giveUp('Enter 後問題仍然開著');
      return;
    }
    // Typed answer: Enter on Other opens a box to type in, which must be there before anything is typed.
    await pause();
    if (!questionOpen(await look())) await giveUp('選了 Other 之後畫面有變');
    await typeAnswer();
  }

  /**
   * Answers the AskUserQuestion a Claude room (started with --ax-screen-reader, so the question is plain text) is waiting on:
   * for each question type the number of the choice, Enter; for typed text, the number of "Other", Enter, the text, Enter.
   * With several questions the CLI asks them one after another and shows "Review your answers"; nothing reaches Claude until
   * "y", Enter confirms it, so the card sends everything together. Every step waits for the screen to show what was typed, and
   * anything unexpected stops it, with a half-typed number taken back or the Other box left with Escape, so a wrong answer is
   * never sent. Answers already entered stay on the CLI's own screen for the person to finish.
   */
  private async answerClaudeQuestion(room: TerminalRoom, live: LiveRoom, event: { questionId?: string; choice?: number; text?: string; answers?: { choice?: number; text?: string }[] }) {
    const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
    const given = Array.isArray(event.answers) ? event.answers : [{ choice: event.choice, text: event.text }];
    const answers = given.map(item => {
      const text = clean(item?.text);
      const choice = Number.isInteger(item?.choice) && (item.choice as number) >= 1 && (item.choice as number) <= 9 ? item.choice as number : undefined;
      return { text, choice };
    });
    if (!answers.length || answers.length > 4 || answers.some(item => (item.choice === undefined) === !item.text || item.text.length > 2_000)) throw new Error('無法用這個方式回答。');
    if (room.pendingApproval || live.closing || live.submitted || live.deferredInput) throw new Error('CLI 正在處理其他事，請稍後再試。');
    const asked = typeof event.questionId === 'string' ? event.questionId : undefined;
    const still = () => asked !== undefined && room.pendingQuestion?.id === asked;
    if (!still()) throw new Error('這條問題已經改變或已被回答，請看最新一題再答。');
    const questions = room.pendingQuestion!.questions;
    if (questions.length !== answers.length) throw new Error(questions.length > 1 ? '這張卡有多個問題，要全部答完先可以送出。' : '無法用這個方式回答。');
    const many = questions.length > 1;
    const pause = () => new Promise<void>(resolve => setTimeout(resolve, this.questionStepMs));
    const look = async () => {
      if (live.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
      if (live.dirty) this.refresh(room, live);
      return room.screen ?? '';
    };
    const until = async (done: (screen: string) => boolean) => {
      for (let tries = 0; tries < 12; tries++) {
        await pause();
        if (done(await look())) return true;
      }
      return false;
    };
    const listPrompt = /Select with numbers \[1-(\d+)\]\. Then Enter to submit or Escape to cancel:[ \t]*(\d*)[ \t]*$/m;
    const textPrompt = /Enter text for option (\d+) \(Other\), or Escape for the list:/;
    const reviewPrompt = /Enter y\/n:[ \t]*(\w*)[ \t]*$/m;
    const tail = (screen: string) => screen.split('\n').slice(-16).join('\n');
    // A long question is drawn over many lines, each starting with "> ", and can be taller than the tail: compare it without
    // the ">" marks and spaces, and read it from the last "Question(s):" header, not from the last few lines.
    const squash = (value: string) => value.replace(/[>\s]+/g, '');
    const fromHeader = (screen: string, header: RegExp) => {
      const rows = screen.split('\n');
      const at = rows.findLastIndex(row => header.test(row));
      return rows.slice(at < 0 ? Math.max(0, rows.length - 16) : at).join('\n');
    };
    const questionBlock = (screen: string) => fromHeader(screen, /^Questions?:\s/);
    const showsQuestion = (screen: string, index: number) => {
      const title = squash(questions[index].title).slice(0, 24);
      return title.length < 6 || squash(questionBlock(screen)).includes(title);
    };
    const giveUp = async (reason: string, entered = 0): Promise<never> => {
      const now = tail(await look());
      // A key goes through writeScreenKey, which also schedules the re-read of the screen. Setting `dirty` by hand does not: a CLI
      // that waits for a person writes nothing more, so the flag stayed on and every later button was refused as "screen updating".
      if (textPrompt.test(now)) this.writeScreenKey(room, live, 'escape');
      else if (listPrompt.exec(now)?.[2] || reviewPrompt.exec(now)?.[1]) this.writeScreenKey(room, live, 'backspace', '\x7f');
      throw new Error(`未能自動回答（${reason}）${entered ? `，已填 ${entered} 條，其餘` : ''}，請改用文字訊息，或在終端作答。`);
    };
    const type = async (value: string, shown: (screen: string) => boolean, what: string, entered: number) => {
      if (!still()) await giveUp('問題已經改變', entered);
      this.writeScreenKey(room, live, 'text', value);
      if (!(await until(next => shown(tail(next))))) await giveUp(`${what}沒有出現`, entered);
    };

    for (let index = 0; index < answers.length; index++) {
      const { choice, text } = answers[index];
      const last = index === answers.length - 1;
      const full = await look();
      const screen = tail(full);
      const prompt = listPrompt.exec(screen);
      if (!prompt) {
        if (index === 0) throw new Error('目前沒有等待回答的選單，請看一看終端。');
        await giveUp('畫面不是下一條問題', index);
      }
      if (prompt![2]) { if (index === 0) throw new Error('終端輸入框已經有字，請先在終端處理。'); await giveUp('輸入框已經有字', index); }
      // The screen must show the same question as the one answered (spaces and line breaks aside).
      if (!showsQuestion(full, index)) await giveUp('畫面上的問題與你看到的不同', index);
      const options = [...questionBlock(full).matchAll(/^(\d+)\.\s+(.+?)\s*$/gm)].map(match => ({ n: Number(match[1]), label: match[2] }));
      const other = options.find(option => /^Other$/i.test(option.label))?.n;
      const listed = questions[index].options;
      let target: number | undefined;
      if (choice !== undefined) {
        const label = listed?.[choice - 1];
        const shownOption = options.find(option => option.n === choice);
        // The record's choice and the screen's must be the same one: the screen shows "Label — description".
        if (!label || !shownOption || !(shownOption.label === label || shownOption.label.startsWith(`${label} — `)) || choice === other) await giveUp('找不到這個選項', index);
        target = choice;
      } else {
        if (other === undefined || other > 9) await giveUp('這條問題沒有 Other 可以打字', index);
        target = other;
      }
      if (Number(prompt![1]) < (target as number)) await giveUp('選項數目不符', index);
      await type(String(target), next => new RegExp(`Escape to cancel:[ \\t]*${target}[ \\t]*$`, 'm').test(next), '選項號碼', index);
      if (!still()) await giveUp('問題已經改變', index);
      this.writeScreenKey(room, live, 'enter');
      if (choice === undefined) {
        if (!(await until(next => textPrompt.test(tail(next))))) await giveUp('沒有出現輸入框', index);
        await type(text, next => next.includes(text.slice(0, 6)), '輸入的字', index);
        if (!still()) await giveUp('問題已經改變', index);
        this.writeScreenKey(room, live, 'enter');
      }
      // After this answer: the next question, the review of all answers, or (one question) the end of the question.
      const arrived = (next: string) => {
        const now = tail(next);
        if (textPrompt.test(now)) return false;
        if (!many) return !listPrompt.test(now);
        return last ? reviewPrompt.test(now) : Boolean(listPrompt.exec(now)) && !listPrompt.exec(now)![2] && showsQuestion(next, index + 1);
      };
      if (!(await until(arrived))) await giveUp(many ? (last ? '答完之後沒有出現確認畫面' : '沒有出現下一條問題') : 'Enter 後問題仍然開著', many ? index + 1 : 0);
    }
    if (!many) return;
    // The CLI lists what it will send; it must be what the card says before anything is confirmed.
    const reviewRows = fromHeader(await look(), /^Review your answers\s*$/).split('\n').map(row => row.trim());
    const pairs: { question: string; answer: string }[] = [];
    let asking = '';
    for (const row of reviewRows) {
      if (row.startsWith('>')) asking += row.slice(1);
      else if (row.startsWith('→')) { pairs.push({ question: asking, answer: row.replace(/^→\s*/, '') }); asking = ''; }
    }
    for (let index = 0; index < answers.length; index++) {
      const title = squash(questions[index].title).slice(0, 24);
      const shown = pairs[index];
      const expected = answers[index].choice !== undefined ? questions[index].options?.[answers[index].choice! - 1] : answers[index].text;
      if (!expected || !shown || !(title.length < 6 || squash(shown.question).includes(title)) ||
          !(shown.answer === expected || shown.answer.startsWith(expected.slice(0, 20)))) {
        throw new Error('未有送出：確認畫面顯示嘅答案同卡片唔一樣，請在終端核對再按 y。');
      }
    }
    await type('y', next => /Enter y\/n:[ \t]*y[ \t]*$/m.test(next), '確認 y', answers.length);
    if (!still()) await giveUp('問題已經改變', answers.length);
    this.writeScreenKey(room, live, 'enter');
    if (!(await until(next => !reviewPrompt.test(tail(next))))) await giveUp('確認後問題仍然開著', answers.length);
  }

  private async answerAgyQuestion(room: TerminalRoom, live: LiveRoom, event: Extract<ClientEvent, { type: 'ANSWER_QUESTION' }>) {
    const question = room.pendingQuestion;
    if (!question || question.id !== event.questionId) throw new Error('呢張問題卡已經過期，請睇最新畫面。');
    if (room.pendingApproval || live.closing || live.submitted || live.deferredInput) throw new Error('CLI 正在處理其他事，請稍後再試。');
    const questions = question.questions;
    const answers = event.answers ?? [{ choice: event.choice, choices: event.choices, text: event.text }];
    if (questions.length === 0 || answers.length !== questions.length) {
      throw new Error('問題數量同答案唔一致，請在終端直接回答。');
    }
    for (let index = 0; index < questions.length; index++) {
      const q = questions[index];
      const optionCount = q.options?.length ?? 0;
      const ans = answers[index];
      const text = ans?.text?.trim() ?? '';
      if (q.multiSelect) {
        const choices = ans?.choices ?? (ans?.choice !== undefined ? [ans.choice] : []);
        const validChoices = choices.every(c => Number.isInteger(c) && c >= 1 && c <= optionCount);
        if (!validChoices || (choices.length === 0 && !text) || text.length > 2_000) {
          throw new Error('找不到呢個選項，請在終端直接回答。');
        }
      } else {
        const choice = ans?.choice;
        const validChoice = choice !== undefined && Number.isInteger(choice) && choice >= 1 && choice <= optionCount;
        if ((choice !== undefined && !validChoice) || (choice === undefined && !text) || text.length > 2_000) {
          throw new Error('找不到呢個選項，請在終端直接回答。');
        }
      }
    }
    const still = () => this.live.get(room.id) === live && room.pendingQuestion?.id === question.id;
    const squash = (value: string) => value.replace(/\s+/g, '');
    const pause = () => new Promise<void>(resolve => setTimeout(resolve, this.questionStepMs));
    const look = async () => {
      if (live.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
      if (live.dirty) this.refresh(room, live);
      return room.screen ?? '';
    };
    const until = async (done: (screen: string) => boolean) => {
      for (let tries = 0; tries < 16; tries++) {
        await pause();
        if (!still()) return false;
        if (done(await look())) return true;
      }
      return still() && done(await look());
    };
    const matchesTitle = (screenTitle: string, expectedTitle: string) => {
      const expected = squash(expectedTitle).slice(0, 24);
      const actual = squash(screenTitle);
      return expected.length < 4 ? actual.includes(expected) : actual.includes(expected) || expected.includes(actual.slice(0, 24));
    };
    const giveUp = async (why: string, done: number): Promise<never> => {
      if (agyQuestionScreen(await look())?.writeInOpen) {
        this.writeScreenKey(room, live, 'escape');
        await until(next => !agyQuestionScreen(next)?.writeInOpen);
      }
      const progress = done > 0 ? `第 1–${done} 題已選好，` : '';
      throw new Error(`未能完成送出（${why}）；${progress}請在終端核對後繼續。`);
    };

    const firstPanel = agyQuestionScreen(await look());
    if (!firstPanel || firstPanel.writeInOpen) {
      throw new Error('終端而家唔係 AGY 問題選單，未有送出。');
    }
    if (firstPanel.index !== 1 || firstPanel.total !== questions.length || !matchesTitle(firstPanel.title, questions[0].title)) {
      throw new Error('終端上的問題或選項與你看到的不同，未有送出。');
    }

    for (let index = 0; index < questions.length; index++) {
      const q = questions[index];
      const ans = answers[index];
      const text = (ans.text ?? '').replace(/\s+/g, ' ').trim();
      const optionCount = q.options?.length ?? 0;
      const last = index === questions.length - 1;

      const panelNow = agyQuestionScreen(await look());
      if (!still() || !panelNow || panelNow.writeInOpen || panelNow.index !== index + 1 || !matchesTitle(panelNow.title, q.title)) {
        await giveUp('終端上的問題或選項與你看到的不同', index);
      }
      const chosenIndices = q.multiSelect
        ? (ans.choices ?? (ans.choice !== undefined ? [ans.choice] : []))
        : (ans.choice !== undefined ? [ans.choice] : []);
      for (const c of chosenIndices) {
        const expectedOpt = squash(q.options?.[c - 1] ?? '').slice(0, 24);
        const screenOpt = squash(panelNow!.options.find(o => o.n === c)?.label ?? '');
        if (!expectedOpt || !screenOpt || (!screenOpt.includes(expectedOpt) && !expectedOpt.includes(screenOpt.slice(0, 24)))) {
          if (index === 0) throw new Error('在終端畫面找不到這個選項，請在終端直接回答。');
          await giveUp('在終端畫面找不到這個選項', index);
        }
      }
      const writeInIndex = panelNow!.other ?? (optionCount + 1);

      const moveTo = async (targetIndex: number) => {
        for (let step = 0; step < optionCount + 4; step++) {
          const current = agyQuestionScreen(await look());
          if (!still() || !current || current.writeInOpen || current.index !== index + 1 || current.selected === undefined) {
            await giveUp('移動光標時問題已經改變', index);
          }
          const cursor = current!.selected!;
          if (cursor === targetIndex) return;
          const nextCursor = cursor < targetIndex ? cursor + 1 : cursor - 1;
          this.writeScreenKey(room, live, cursor < targetIndex ? 'down' : 'up');
          if (!(await until(next => agyQuestionScreen(next)?.selected === nextCursor))) {
            await giveUp('未能移動到目標選項', index);
          }
        }
        if (agyQuestionScreen(await look())?.selected !== targetIndex) {
          await giveUp('未能移動到目標選項', index);
        }
      };

      const submitWriteIn = async (value: string) => {
        await moveTo(writeInIndex);
        if (!still()) await giveUp('問題已經改變', index);
        this.writeScreenKey(room, live, 'enter');
        if (!(await until(next => Boolean(agyQuestionScreen(next)?.writeInOpen)))) {
          await giveUp('沒有出現 Write-in 輸入框', index);
        }
        if (!still()) await giveUp('問題已經改變', index);
        this.writeScreenKey(room, live, 'text', value);
        if (!(await until(next => next.includes(value.slice(0, 6))))) {
          await giveUp('輸入的字沒有出現', index);
        }
        if (!still()) await giveUp('問題已經改變', index);
        this.writeScreenKey(room, live, 'enter');
      };

      if (q.multiSelect) {
        const wanted = new Set(ans.choices ?? (ans.choice !== undefined ? [ans.choice] : []));
        for (let optIndex = 1; optIndex <= optionCount; optIndex++) {
          const current = agyQuestionScreen(await look());
          const opt = current?.options.find(o => o.n === optIndex);
          if (!current || !opt) await giveUp('找不到多選項目', index);
          if (Boolean(opt!.checked) !== wanted.has(optIndex)) {
            await moveTo(optIndex);
            if (!still()) await giveUp('問題已經改變', index);
            this.writeScreenKey(room, live, 'space', ' ');
            if (!(await until(next => Boolean(agyQuestionScreen(next)?.options.find(o => o.n === optIndex)?.checked) === wanted.has(optIndex)))) {
              await giveUp('未能切換多選項目', index);
            }
          }
        }
        if (text) {
          await submitWriteIn(text);
        } else {
          const current = agyQuestionScreen(await look());
          if (!current || current.selected === writeInIndex) {
            await moveTo(1);
          }
          if (!still()) await giveUp('問題已經改變', index);
          this.writeScreenKey(room, live, 'enter');
        }
      } else if (ans.choice !== undefined) {
        await moveTo(ans.choice);
        if (!still()) await giveUp('問題已經改變', index);
        this.writeScreenKey(room, live, 'enter');
      } else {
        await submitWriteIn(text);
      }

      const arrived = (next: string) => {
        const nextPanel = agyQuestionScreen(next);
        if (last) return !nextPanel;
        return Boolean(nextPanel && !nextPanel.writeInOpen && nextPanel.index === index + 2);
      };
      if (!(await until(arrived))) {
        // A screen refresh can clear the completed card before until checks it.
        if (last && !room.pendingQuestion) {
          const screen = await look();
          if (this.live.get(room.id) === live && !room.pendingQuestion && arrived(screen)) return;
        }
        await giveUp(last ? 'Enter 後問題仍然開著' : '沒有出現下一條問題', index);
      }
    }
  }

  private answerApproval(room: TerminalRoom, live: LiveRoom, fingerprint: string, response: string) {
    live.process.write(response);
    live.answered = fingerprint;
    live.approvalFingerprint = undefined;
    room.pendingApproval = undefined;
    room.status = 'running';
    room.currentActionSummary = '已將決定送到 CLI';
    live.dirty = true;
    setTimeout(() => { if (this.live.get(room.id) === live && !live.queued) this.refresh(room, live); }, 100);
    this.emit({ type: 'ROOM', room });
  }

  // Send input
  // Prepare attachments, send or defer input and verify what reached the terminal.
  /**
   * A message was pasted into the CLI's input box but not submitted (the room changed state in between).
   * Left there, the box never reads as empty, the room never reads as ready, and no wake-up reaches it again:
   * a lead once sat for an hour until the Founder cleared the box by hand. Take our own text out; text we did not paste stays.
   */
  private clearOwnPaste(room: TerminalRoom, live: LiveRoom, message: string) {
    try {
      if (live.queued || live.closing) return;
      if (live.dirty) this.refresh(room, live);
      if (room.pendingApproval || room.pendingQuestion || room.menu) return;
      const screen = room.screen ?? '';
      if (!isComposer(room.modelId, screen)) return;
      const typed = composerText(room.modelId, screen)?.replace(/\s+/g, ' ');
      if (!typed) return;
      const prefix = message.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 20);
      // A long or multi-line paste shows as a placeholder in the box ("[Pasted Content 900 chars]", "[Pasted text #1 +4 lines]").
      const ours = (prefix.length >= 4 && typed.startsWith(prefix)) ||
        ((message.includes('\n') || message.length > 1_000) && /^\[Pasted [^\]]+\]$/i.test(typed));
      if (ours) live.process.write(keyCodes['ctrl-u']);
    } catch { /* The Founder can still clear the box by hand. */ }
  }

  private submitInput(room: TerminalRoom, live: LiveRoom, input: string, original?: string, submitDelay = 100, result?: ActionResult, reserveRoster?: ReserveRoster, steer = false, images?: string[], requestId?: string, authorizeBenchInput?: (phase: 'paste' | 'submit') => boolean) {
    if (authorizeBenchInput?.('paste') === false) {
      result?.(false, '原收件房狀態已改變，工單仍留在原工作台。');
      return;
    }
    if (authorizeBenchInput && room.modelId === 'CODEX') {
      const draft = composerText(room.modelId, room.screen ?? '');
      if (draft && draft !== 'Ask Codex to do anything') {
        result?.(false, 'Codex 輸入框已有草稿，工單仍留在原工作台。');
        return;
      }
    }
    const trace = this.inputLogPath ? beginInputTrace(this.inputLogPath, room, input, 'submit', requestId) : undefined;
    let roster: ReturnType<ReserveRoster>;
    try { roster = reserveRoster?.(); }
    catch (error) {
      trace?.finish('roster-unavailable');
      result?.(false, error instanceof Error ? error.message : '群組已更新，請再試。');
      return;
    }
    const finish = (sent: boolean, message: string, reason: InputFailure = 'submission-cancelled') => {
      roster?.finish(sent);
      result?.(sent, message);
      if (!sent) trace?.finish(reason);
    };
    const message = input + (roster?.suffix ?? '');
    const guardedCodex = Boolean(authorizeBenchInput && room.modelId === 'CODEX' &&
      live.terminal?.buffer && !message.includes('\n') && message.length <= 1_000);
    const reportBaseline = lastAgentEntry(room) ?? null;
    const lastBeforePaste = room.logs.at(-1)?.id;
    if (roster?.suffix) trace?.measure(message);
    if (message.includes('\n') && !live.terminal?.modes?.bracketedPasteMode) {
      finish(false, 'CLI 未開啟多行輸入，請等終端就緒後再試。', 'bracketed-paste-disabled');
      return;
    }
    try {
      // Long single-line prompts are pasted too, so the CLI receives them as one block before Enter.
      const paste = message.includes('\n') || (message.length > 1_000 && live.terminal?.modes?.bracketedPasteMode);
      live.process.write(paste ? `\x1b[200~${message}\x1b[201~` : message);
    } catch {
      finish(false, '終端未能接收指令。', 'paste-write-failed');
      return;
    }
    live.requested = /^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(input) ? input : undefined;
    room.ready = false;
    room.status = 'running';
    room.currentActionSummary = '正在送出指令';
    live.submissionResult = finish;
    const started = Date.now();
    const minimumDelay = submitDelay + Math.min(2_000, Math.floor(message.length / 50));
    const releaseSubmission = () => {
      live.submitted = undefined;
      live.submissionResult = undefined;
    };
    const recordSubmission = (alreadyLogged = false) => {
      if (original !== undefined && !input.startsWith('/')) live.reportBaseline = guardedCodex ? reportBaseline : lastAgentEntry(room) ?? null;
      if (original !== undefined && !alreadyLogged) log(room, 'user', original, images);
      room.currentActionSummary = '已送出至 CLI';
      finish(true, steer ? '已送入 CLI，它處理完當前步驟會收到。' : '已送到 CLI');
      this.emit({ type: 'ROOM', room });
    };
    const cleanupGuardedCodex = () => {
      // Keep the input slot until the screen proves the exact paste was removed, or report that it was not confirmed.
      const deadline = Date.now() + 2_000;
      live.submissionResult = finish;
      let clearing = false;
      let clearAttempts = 0;
      let lastClearAt = 0;
      const check = () => {
        if (this.live.get(room.id) !== live || live.closing) {
          releaseSubmission();
          finish(false, 'CLI 已結束，無法確認工單草稿是否清除。', 'cleanup-unconfirmed');
          return;
        }
        const screen = !live.queued ? screenText(live) : undefined;
        const draft = screen && isComposer('CODEX', screen) ? composerText('CODEX', screen) : undefined;
        if (clearing && (draft === '' || draft === 'Ask Codex to do anything')) {
          releaseSubmission();
          finish(false, '原收件房狀態已改變，未送出的工單草稿已清除。', 'state-changed');
          this.refresh(room, live, false);
          return;
        }
        if (clearAttempts < 2 && (clearAttempts === 0 || Date.now() - lastClearAt >= 250) && screen &&
            !room.pendingApproval && !room.pendingQuestion && !room.menu &&
            !approvalPrompt('CODEX', screen) && !questionOpen(screen) && !/⇧←\s*to answer/.test(screen) &&
            !hasWorkingIndicator(screen) && codexDraftMatches(screen, message)) {
          clearAttempts++;
          lastClearAt = Date.now();
          try {
            live.process.write(keyCodes['ctrl-u']);
            clearing = true;
          } catch { /* Report unconfirmed below; never clear an unidentified draft. */ }
        }
        if (Date.now() >= deadline) {
          releaseSubmission();
          finish(false, '未能確認工單草稿已清除，請核對終端。', 'cleanup-unconfirmed');
          if (screen !== undefined) this.refresh(room, live, false);
          return;
        }
        live.submitted = setTimeout(check, Math.min(this.submitCheckMs, 100));
      };
      check();
    };
    const checkGuardedCodex = (retried: boolean, afterRedraw = false) => {
      // Keep the reservation and input slot until this Enter is confirmed. Never send a recovery key after release.
      live.submitted = setTimeout(() => {
        const current = this.live.get(room.id) === live && !live.closing;
        const screen = current && !live.queued ? screenText(live) : undefined;
        const draft = screen && isComposer('CODEX', screen) ? composerText('CODEX', screen) : undefined;
        const recent = room.logs.slice(room.logs.findLastIndex(entry => entry.id === lastBeforePaste) + 1);
        const echoed = current && recent.some(entry => entry.sender === 'user' && userTextKey(entry.text) === userTextKey(message));
        if (echoed || draft === '' || draft === 'Ask Codex to do anything') {
          releaseSubmission();
          recordSubmission(echoed);
          trace?.finish();
          if (screen !== undefined) this.refresh(room, live);
          return;
        }
        if (current && live.queued && !afterRedraw) {
          checkGuardedCodex(retried, true);
          return;
        }
        if (screen && codexDraftMatches(screen, message) && !room.pendingApproval && !room.pendingQuestion &&
            !approvalPrompt('CODEX', screen) && !questionOpen(screen) && !/⇧←\s*to answer/.test(screen) &&
            authorizeBenchInput?.('submit')) {
          try {
            if (!retried) {
              trace?.enter();
              live.process.write('\r');
              checkGuardedCodex(true);
              return;
            }
            this.writeScreenKey(room, live, 'ctrl-u');
          } catch {
            releaseSubmission();
            finish(false, '終端未能接收工單按鍵，請核對輸入框。', 'enter-write-failed');
            return;
          }
        }
        if (current && !authorizeBenchInput?.('submit')) {
          cleanupGuardedCodex();
          return;
        }
        releaseSubmission();
        finish(false, '未能確認工單送出，原單仍留在工作台。', draft ? 'still-typed' : 'state-changed');
        // The periodic workbench retry can pick up the ticket. An immediate idle wake would create a retry loop.
        if (screen !== undefined) this.refresh(room, live, false);
      }, afterRedraw ? pasteQuietMs : this.submitCheckMs);
    };
    const pressEnter = () => {
      releaseSubmission();
      if (this.live.get(room.id) !== live || live.closing || (room.pendingApproval && !authorizeBenchInput)) {
        finish(false, 'CLI 狀態已改變，指令未送出。', 'state-changed');
        return;
      }
      if (authorizeBenchInput && live.dirty && !live.queued && live.terminal?.buffer) this.refresh(room, live);
      if (authorizeBenchInput && (live.queued || room.pendingApproval || authorizeBenchInput('submit') === false)) {
        if (guardedCodex) {
          cleanupGuardedCodex();
          return;
        }
        this.clearOwnPaste(room, live, message);
        finish(false, '原收件房狀態已改變，工單訊息未送出。如仍有草稿，請核對終端。', 'state-changed');
        this.emit({ type: 'ROOM', room });
        return;
      }
      try {
        trace?.enter();
        live.process.write('\r');
      } catch {
        finish(false, '終端未能接收指令。', 'enter-write-failed');
        return;
      }
      if (guardedCodex) {
        live.submissionResult = finish;
        checkGuardedCodex(false);
        return;
      }
      recordSubmission();
      this.verifySubmission(room, live, message, false, false, trace, !authorizeBenchInput);
    };
    // A CLI may still be processing a paste (Claude shows "Pasting…" while it reads an image path).
    // An Enter pressed then is swallowed, so wait until its output settles before submitting.
    let steering = steer;
    const poll = (wait = pasteQuietMs / 3) => {
      live.submitted = setTimeout(() => {
        const now = Date.now();
        // A CLI that is working redraws all the time (its timer, its spinner), so it is never quiet. For a message that steers it,
        // the text showing in its input box says it has taken the paste in; failing that, waiting a little longer is enough.
        let settled = now - started >= minimumDelay && now - (live.lastOutputAt ?? 0) >= pasteQuietMs && !pasteInProgress(live);
        let branch: InputWaitBranch = 'quiet';
        // The room can read "idle" when the message is sent and start a step a moment later; judge by the screen as it is now.
        if (!settled && now - started >= minimumDelay && !pasteInProgress(live)) {
          if (live.dirty && !live.queued) this.refresh(room, live);
          steering = steer || (!room.ready && Boolean(room.steerable));
        }
        if (!settled && steering && now - started >= minimumDelay && !pasteInProgress(live)) {
          const prefix = message.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 20);
          const typed = composerText(room.modelId, room.screen ?? '')?.replace(/\s+/g, ' ');
          const sawPrefix = prefix.length >= 4 && typed !== undefined && typed.includes(prefix);
          settled = sawPrefix || now - started >= minimumDelay + this.steerPatienceMs;
          branch = sawPrefix ? 'typed-prefix' : 'patience';
        }
        // A pending terminal redraw is transient. Keep the reservation until the renderer drains,
        // then check the recipient again in pressEnter before writing the first Enter.
        if (authorizeBenchInput && live.queued && now - started < pasteMaxWaitMs) return poll();
        if (!settled && now - started < pasteMaxWaitMs) return poll();
        if (!settled) {
          trace?.waited('max-wait', now - started);
          live.submitted = undefined;
          live.submissionResult = undefined;
          if (guardedCodex && this.live.get(room.id) === live) {
            cleanupGuardedCodex();
            return;
          }
          if (authorizeBenchInput && this.live.get(room.id) === live) this.clearOwnPaste(room, live, message);
          finish(false, 'CLI 仍在處理貼上的內容，未送出。請核對終端，清走輸入框內容後再試。', 'max-wait');
          this.emit({ type: 'ROOM', room });
          return;
        }
        trace?.waited(branch, now - started);
        pressEnter();
      }, wait);
    };
    poll(minimumDelay);
    this.emit({ type: 'ROOM', room });
  }

  /**
   * Enter writes nothing back when the CLI swallows it, so the room would stay "working" with a still terminal.
   * Re-read the screen shortly after, which also clears that state. If the text is still in the input box,
   * retry Enter once when recovery keys are allowed. Report text that remains after recovery.
   */
  private verifySubmission(room: TerminalRoom, live: LiveRoom, message: string, retried = false, queued = false, trace?: InputTrace, allowExtraKeys = true) {
    const timer = setTimeout(() => {
      if (this.live.get(room.id) !== live || live.closing) { trace?.finish(); return; }
      let recheck = false;
      let reason: InputFailure | undefined;
      try {
        this.refresh(room, live);
        const prefix = message.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 20);
        const typed = composerText(room.modelId, room.screen ?? '')?.replace(/\s+/g, ' ');
        const stillTyped = prefix.length >= 4 && !message.includes('\n') && message.length <= 1_000 && typed !== undefined && typed.includes(prefix);
        if (!stillTyped) return;
        if (allowExtraKeys && !retried && !room.pendingApproval && !live.submitted) {
          // The text is still in the input box, so the first Enter was lost; press it once more.
          trace?.enter();
          reason = 'enter-write-failed';
          live.process.write('\r');
          this.verifySubmission(room, live, message, true, false, trace);
          recheck = true;
          return;
        }
        const screen = room.screen ?? '';
        if (allowExtraKeys && !queued && !room.pendingApproval && !live.submitted && /tab to queue message/i.test(screen)) {
          // Codex will not send it now (for example while it waits for an answer to its question) but offers to queue it: do what it says.
          reason = 'still-typed';
          live.process.write('\t');
          this.verifySubmission(room, live, message, true, true, trace);
          recheck = true;
          return;
        }
        reason = 'still-typed';
        room.currentActionSummary = '輸入框仍有未送出的內容';
        this.emit({ type: 'ROOM', room });
        const asking = /⇧←\s*to answer/.test(screen) ? '它有一條問題等你回答（可以用手動按鍵的 ⇧← 打開），答完或者它自己逾時後才會收到。' : '';
        this.emit({ type: 'NOTICE', message: `${room.roomName}：CLI 輸入框仍然有你剛才的訊息，似乎未送出。${asking}請核對終端。` });
      } catch { /* the screen could not be read; nothing to verify */ }
      finally { if (!recheck) trace?.finish(reason); }
    }, this.submitCheckMs);
    timer.unref?.();
  }

  // Remote Control
  // Read room connection state and manage the Mac's Codex Remote Control setting.
  private updateRemote(room: TerminalRoom, screen: string) {
    const disabled = /Remote Control (?:is off|isn.t connected|disconnected|disabled|stopped|failed|ended)|Disconnected Remote Control|\/rc (?:failed|off)/i.test(screen);
    const enabled = /\/rc active|Remote Control (?:is (?:on|active|enabled)|connected|enabled|session (?:started|active))|Remote session (?:active|connected)/i.test(screen);
    if (disabled || enabled) {
      room.remoteStatus = disabled ? 'off' : 'on';
      room.remoteControl.enabled = !disabled;
      if (disabled) room.remoteControl.sessionUrl = '';
    }
    if (room.remoteStatus === 'on' && room.modelId === 'CLAUDE') {
      room.remoteControl.sessionUrl = screen.match(/https:\/\/claude\.ai\/code\/session_[a-z0-9_-]+/i)?.[0] ?? room.remoteControl.sessionUrl;
    }
  }

  private async setCodexRemote(enabled: boolean, startDaemon = false) {
    if (this.codexRemoteChange) throw new Error('Codex Mac Remote Control 正在更新。');
    this.codexRemoteChange = true;
    const env = { ...process.env };
    delete env.KOMOREBI_PAIRING_KEY;
    const args = startDaemon ? ['remote-control', 'start', '--json'] :
      ['app-server', 'daemon', enabled ? 'enable-remote-control' : 'disable-remote-control'];
    try {
      const { stdout } = await run('codex', args, { env, timeout: startDaemon ? 5_000 : 15_000 });
      if (startDaemon) {
        const status = JSON.parse(stdout);
        if (status.timedOut || status.status !== 'connected') throw new Error('Remote Control 未連線');
      }
      this.codexRemoteStatus = enabled ? 'on' : 'off';
      for (const room of this.rooms.values()) {
        if (room.modelId !== 'CODEX') continue;
        room.remoteStatus = this.codexRemoteStatus;
        this.emit({ type: 'ROOM', room });
      }
    } catch {
      throw new Error('Mac 上的 Codex Remote Control 未能更新，請檢查 Codex 連線再試。');
    } finally {
      this.codexRemoteChange = false;
    }
  }

  // Feed quota values from the terminal into the same history as background readings.
  private updateUsage(room: TerminalRoom, screen: string) {
    const { hp, mp, vouchers } = readUsage(room.modelId, screen, room.selectedSubModel);
    this.applyUsage(room.modelId, { fiveHour: hp, weekly: mp, vouchers });
  }

  // Archive idle rooms
  // List idle rooms and recheck the selection before archiving.
  /** Why an unarchived room is skipped, or null when it can be closed: its CLI is starting, working or closing, or it has unfinished tickets or a delivery hold. */
  private busyReason(room: TerminalRoom): 'busy' | 'tickets' | null {
    if (this.isWorking(room.id) || this.live.get(room.id)?.closing) return 'busy';
    if (this.deliveryPending(room.id)) return 'tickets';
    return null;
  }

  /**
   * Lists the rooms that can be closed (CLI idle, no unfinished tickets), or closes and archives the given ones.
   * Closing re-checks each room, so a room that became busy since the list was shown is left open.
   */
  private async idleRooms(event: Extract<ClientEvent, { type: 'IDLE_ROOMS' | 'CLOSE_IDLE' }>, reply: (event: ServerEvent) => void) {
    const unarchived = [...this.rooms.values()].filter(room => !this.archiveKeys(room).some(key => this.archivedKeys.has(key)));
    if (event.type === 'IDLE_ROOMS') {
      const candidates: { roomId: string; name: string }[] = [];
      let busy = 0;
      let tickets = 0;
      for (const room of unarchived) {
        const reason = this.busyReason(room);
        if (reason === 'busy') busy++;
        else if (reason === 'tickets') tickets++;
        else candidates.push({ roomId: room.id, name: room.roomName });
      }
      reply({ type: 'IDLE_ROOMS_RESULT', candidates, busy, tickets });
      return;
    }
    if (!Array.isArray(event.roomIds) || event.roomIds.length > 10_000 || event.roomIds.some(id => typeof id !== 'string')) {
      throw new Error('無效房間清單。');
    }
    const closed: string[] = [];
    const skipped: { roomId: string; reason: 'busy' | 'tickets' }[] = [];
    const keys = new Set(this.archivedKeys);
    for (const id of new Set(event.roomIds)) {
      const room = this.rooms.get(id);
      if (!room || this.archiveKeys(room).some(key => this.archivedKeys.has(key))) continue;
      const reason = this.busyReason(room);
      if (reason) {
        skipped.push({ roomId: id, reason });
        continue;
      }
      const live = this.live.get(id);
      if (live) this.closeTerminal(room, live, false);
      for (const key of this.archiveKeys(room)) keys.add(key);
      closed.push(id);
    }
    if (closed.length) {
      // One save for the whole batch, then one archive event per room, so each leaves its groups as a single archive does.
      this.saveArchive(keys);
      // Quiet: a group's last member cannot leave it, and the Founder asked for no warning for that when closing many rooms at once.
      for (const id of closed) this.emit({ type: 'ARCHIVED', archivedKeys: this.archiveSnapshot(), archivedRoomId: id, quiet: true });
    }
    reply({ type: 'CLOSE_IDLE_RESULT', closed, skipped });
  }

  // Delete archived rooms
  // Check transcript ownership before removing rooms and moving eligible files to the Trash.
  private async archivedSessionFiles(removed: TerminalRoom[]) {
    const removedIds = new Set(removed.map(room => room.id));
    const otherRooms = [...this.rooms.values()].filter(room => !removedIds.has(room.id));
    const otherPaths = new Set<string>();
    for (const room of otherRooms) {
      if (!room.syncedStateFile?.startsWith('~/')) continue;
      const path = join(this.sessionHome, room.syncedStateFile.slice(2));
      otherPaths.add(await realpath(path).catch(() => path));
    }
    const removedSessions = new Set(removed.map(room => roomIdFor(room.modelId, room.sessionId ?? '')));
    for (const [key, session] of this.saved) {
      if (removedSessions.has(key) || !session.file.startsWith('~/')) continue;
      const path = join(this.sessionHome, session.file.slice(2));
      otherPaths.add(await realpath(path).catch(() => path));
    }
    const successors = this.successors?.() ?? {};
    const successorKeys = new Set([...Object.keys(successors), ...Object.values(successors)]);
    const files = new Set<string>(), shared = new Set<string>(), failed = new Set<string>();
    for (const room of removed) {
      if (!room.sessionId) continue;
      const label = room.syncedStateFile ?? this.saved.get(roomIdFor(room.modelId, room.sessionId))?.file;
      if (!label?.startsWith('~/')) { failed.add(label || room.sessionId); continue; }
      const path = join(this.sessionHome, label.slice(2));
      let failurePath = path;
      try {
        const root = this.sessionRootDirs[room.modelId].find(candidate => isInside(candidate, path));
        if (!root || !(await lstat(path)).isFile()) throw new Error('Invalid session file');
        const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(path)]);
        if (!isInside(actualRoot, actualFile)) throw new Error('Outside session root');
        const parsed = await readSession(room.modelId, path, root, this.workspace, historyLimit, undefined, this.sessionHome);
        if (!parsed || parsed.id !== room.sessionId) throw new Error('Session identity mismatch');
        const group = [actualFile];
        if (room.modelId === 'AGY') {
          const gemini = join(this.sessionHome, '.gemini');
          const actualGemini = await realpath(gemini);
          if (!isInside(actualGemini, actualFile)) throw new Error('Outside AGY root');
          const base = join(gemini, 'antigravity-cli');
          for (const extra of [join(base, 'conversations', `${room.sessionId}.db`), join(base, 'conversations', `${room.sessionId}.db-wal`), join(base, 'conversations', `${room.sessionId}.db-shm`), join(base, 'annotations', `${room.sessionId}.pbtxt`)]) {
            failurePath = extra;
            try {
              if (!(await lstat(extra)).isFile()) throw new Error('Not a regular file');
              const resolved = await realpath(extra);
              if (!isInside(actualGemini, resolved)) throw new Error('Outside AGY root');
              group.push(resolved);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
        }
        if (group.some(file => otherPaths.has(file)) || successorKeys.has(room.id) || successorKeys.has(room.sessionId)) {
          for (const file of group) shared.add(file);
        } else {
          for (const file of group) files.add(file);
        }
      } catch { failed.add(failurePath); }
    }
    for (const file of shared) files.delete(file);
    return { files: [...files], shared: shared.size, failed: [...failed] };
  }

  // Handle client requests
  // Check incoming room events and dispatch them against the current room and terminal state.
  async handle(event: ClientEvent, reply: (event: ServerEvent) => void, options?: { reserveRoster?: ReserveRoster; stillWanted?: () => boolean; resumed?: boolean; inputTraceId?: string; authorizeBenchInput?: (phase: 'paste' | 'submit') => boolean }): Promise<unknown> {
    if (!event || typeof event !== 'object') throw new Error('無效請求。');
    if (event.type === 'IDLE_ROOMS' || event.type === 'CLOSE_IDLE') return this.idleRooms(event, reply);
    if (event.type === 'CREATE') {
      if (!cliIds.includes(event.modelId) || typeof event.roomName !== 'string' || typeof event.repoPath !== 'string' ||
          typeof event.remote !== 'boolean' || (event.agyAuto !== undefined && typeof event.agyAuto !== 'boolean') ||
          (event.fullAccess !== undefined && typeof event.fullAccess !== 'boolean') ||
          (event.fullAccess === true && event.modelId === 'AGY') ||
          (event.agyAuto === true && event.modelId !== 'AGY') || !/^[\p{L}\p{N}][\p{L}\p{N} _.()-]{0,79}$/u.test(event.roomName)) {
        throw new Error('房間名稱或工作目錄無效。');
      }
      // A folder picked for this room is used as it is; with none, the room starts in the default folder.
      const cwd = event.repoPath ? await roomDirectory(this.newRoomRoot(), event.repoPath) : await newRoomDirectory(this.newRoomRoot(), event.modelId);
      return this.start(newRoom(event.modelId, event.roomName, cwd), reply, event, options?.stillWanted);
    }
    if (event.type === 'SET_DEFAULT_MODE') {
      if (!cliIds.includes(event.modelId) || typeof event.auto !== 'boolean') throw new Error('無效權限模式。');
      this.modes.setDefault(event.modelId, event.auto);
      this.emit({ type: 'LAUNCH_MODES', launchModes: this.modes.snapshot });
      return;
    }
    if (event.type === 'SET_AUTO_COMPACT_ALL') {
      if (typeof event.enabled !== 'boolean') throw new Error('所有房間的 Auto Compact 設定無效。');
      this.compactRooms.setAll(event.enabled);
      this.emit({ type: 'AUTO_COMPACT_ALL', enabled: event.enabled });
      // A running CLI keeps its launch settings; each room shows the preference it gets at its next launch or resume.
      for (const room of this.rooms.values()) {
        const enabled = this.compactRooms.enabled(this.modeKeys(room));
        if (room.autoCompact === enabled) continue;
        room.autoCompact = enabled;
        this.emit({ type: 'ROOM', room });
      }
      return;
    }
    if (event.type === 'SYNC') {
      if (!cliIds.includes(event.modelId)) throw new Error('無效 CLI。');
      for (const room of this.snapshot().filter(room => room.modelId === event.modelId)) reply({ type: 'ROOM', room });
      reply({ type: 'SYNC_UPDATE', character: this.characters[event.modelId] });
      return;
    }
    if (event.type === 'DELETE_ARCHIVED') {
      if (!Array.isArray(event.roomIds) || !event.roomIds.length || event.roomIds.length > 10_000 ||
          event.roomIds.some(id => typeof id !== 'string')) throw new Error('無效房間清單。');
      const targets = [...new Set(event.roomIds)].map(id => this.rooms.get(id));
      if (targets.some(room => !room || !this.archiveKeys(room).some(key => this.archivedKeys.has(key)))) {
        throw new Error('房間清單已更新，請重新選擇已封存房間。');
      }
      const targetKeys = new Set(targets.flatMap(room => this.archiveKeys(room!)));
      const related = [...this.rooms.values()].filter(room => this.archiveKeys(room).some(key => targetKeys.has(key)));
      if (related.some(room => this.isProtected(room))) throw new Error('受保護的房間不可移除，請先取消保護。');
      if (related.some(room => room.live || this.live.has(room.id) || this.starting.has(room.id))) {
        throw new Error('請先結束運行中的 CLI，然後再刪除房間。');
      }
      const sessionFiles = await this.archivedSessionFiles(related);
      // Preflight reads are asynchronous; the room may have started or been protected in the meantime.
      if (related.some(room => this.isProtected(room))) throw new Error('受保護的房間不可移除，請先取消保護。');
      if (related.some(room => room.live || this.live.has(room.id) || this.starting.has(room.id))) {
        throw new Error('請先結束運行中的 CLI，然後再刪除房間。');
      }
      const deleted = new Set(this.deletedKeys);
      for (const room of targets) for (const key of this.archiveKeys(room!)) deleted.add(key);
      this.saveDeleted(deleted);
      this.clearInactivePins(targetKeys);
      for (const room of related) {
        this.rooms.delete(room.id);
        this.saved.delete(room.id);
        this.emit({ type: 'ROOM_REMOVED', roomId: room.id, deleted: true });
      }
      const trashedSessions = await this.trashSessions(sessionFiles.files);
      const failures = [...sessionFiles.failed, ...trashedSessions.failed];
      // Uploads follow the removed rooms to the Trash, where they can be restored.
      const uploads = this.attachmentLedger.filesFor(related.map(room => room.id));
      let attachmentNote = '';
      if (uploads.length) {
        const trashed = await this.trashImages(uploads);
        this.attachmentLedger.forget([...trashed.moved, ...trashed.missing]);
        const imagesOnly = uploads.every(name => ownedImageName.test(name));
        const unit = imagesOnly ? '張' : '個';
        const label = imagesOnly ? '上傳圖片' : '附件';
        attachmentNote = trashed.failed.length
          ? `　${trashed.moved.length} ${unit}${label}已移到垃圾桶，${trashed.failed.length} ${unit}未能移動，仍在 Komorebi Attachments。`
          : trashed.moved.length ? `　${trashed.moved.length} ${unit}${label}已移到垃圾桶。` : '';
      }
      reply({ type: 'NOTICE', message: `已從 Komorebi 移除 ${targets.length} 間封存房間；${trashedSessions.moved.length} 個 CLI 對話檔（${trashedSessions.bytes} bytes）已移到垃圾桶，保留 ${sessionFiles.shared} 個共用檔。${failures.length ? `未能移動：${failures.join('、')}。` : ''}工作資料夾保留。${attachmentNote}` });
      return;
    }
    if (!('roomId' in event) || typeof event.roomId !== 'string') throw new Error('無效房間。');
    const room = this.rooms.get(event.roomId);
    if (!room) throw new Error('找不到這間房。');
    const live = this.live.get(room.id);
    const result: ActionResult = (ok, message) => {
      if ((event.type === 'INPUT' || event.type === 'APPROVAL' || event.type === 'ANSWER_QUESTION') &&
          typeof event.requestId === 'string' && event.requestId.length <= 64) {
        reply({ type: 'ACTION_RESULT', requestId: event.requestId, ok, message });
      } else if (!ok) reply({ type: 'NOTICE', message });
    };

    if (event.type === 'HISTORY_MORE') {
      // Reads further back in the CLI's own record, so a long conversation can be read in steps.
      const label = room.syncedStateFile;
      if (!room.sessionId || typeof label !== 'string' || !label.startsWith('~/')) throw new Error('這間房未有可讀取的對話紀錄。');
      const current = Math.max(historyLimit, room.historyLimit ?? 0);
      if (current >= historyMax) {
        reply({ type: 'NOTICE', message: `已經載入到上限（${historyMax} 則）。更早的對話請在 CLI 以原生 /resume 查看。` });
        return;
      }
      const want = Math.min(historyMax, current + HISTORY_STEP);
      const file = join(this.sessionHome, label.slice(2));
      const root = this.sessionRootDirs[room.modelId].find(candidate => isInside(candidate, file));
      if (!root) throw new Error('對話紀錄位置無效。');
      const session = await readSession(room.modelId, file, root, this.workspace, want, deepTranscriptWindow);
      if (!session || session.id !== room.sessionId) throw new Error('未能讀取對話紀錄。');
      const watched = this.live.get(room.id);
      room.historyLimit = want;
      room.logs = mergeHistory(room.live ? room.logs : [], session.logs, watched?.matchedLocalUsers).slice(-want);
      for (const entry of session.logs) (entry.sender === 'user' ? watched?.seenTranscriptUsers : watched?.seenTranscriptAgents)?.add(entry.id);
      room.historyTruncated = session.truncated === true;
      this.emit({ type: 'ROOM', room });
      return;
    }

    if (event.type === 'IMAGE_PREVIEW') {
      // Only images this room's conversation actually mentions can be read, so a client cannot ask for arbitrary files.
      const path = typeof event.path === 'string' ? event.path : '';
      const mentioned = room.logs.some(entry => entry.images?.includes(path) || extractImagePaths(`${entry.text}\n${entry.codeBlock ?? ''}`).includes(path));
      if (!path || !mentioned) {
        reply({ type: 'IMAGE_PREVIEW', roomId: room.id, path, ok: false, message: '這張圖不在房間對話內，不預覽。' });
        return;
      }
      try {
        const preview = await loadImagePreview(path, { cwd: room.repoPath || undefined, ...this.imagePreviewOptions });
        reply({ type: 'IMAGE_PREVIEW', roomId: room.id, path, ok: true, ...preview });
      } catch (error) {
        reply({ type: 'IMAGE_PREVIEW', roomId: room.id, path, ok: false, message: error instanceof Error ? error.message : '未能預覽圖片。' });
      }
      return;
    }

    if (event.type === 'RENAME') {
      if (typeof event.name !== 'string') throw new Error('請輸入房間名稱。');
      const name = event.name.trim();
      if (!name || name.length > 80 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
        throw new Error('房間名稱須為 1 至 80 個字，並且不可以包含控制字元。');
      }
      const keys = this.archiveKeys(room);
      const names = new Map(this.roomNames);
      for (const key of keys) names.set(key, name);
      this.saveNames(names);
      for (const target of this.rooms.values()) {
        if (this.archiveKeys(target).some(key => keys.includes(key))) {
          target.roomName = name;
          this.emit({ type: 'ROOM', room: target });
        }
      }
      return;
    }

    if (event.type === 'PIN_ROOM') {
      if (typeof event.pinned !== 'boolean') throw new Error('無效置頂狀態。');
      const keys = this.archiveKeys(room);
      if (event.pinned && keys.some(key => this.archivedKeys.has(key) || this.deletedKeys.has(key))) {
        throw new Error('已封存或刪除的房間不能置頂。');
      }
      if (this.pins.set(keys, event.pinned)) this.emitPins();
      return;
    }
    if (event.type === 'PROTECT_ROOM') {
      if (typeof event.protected !== 'boolean') throw new Error('無效保護狀態。');
      if (this.protection.set(this.archiveKeys(room), event.protected)) this.emit({ type: 'PROTECTED_ROOMS', protectedKeys: this.protectedSnapshot() });
      return;
    }

    if (event.type === 'ARCHIVE') {
      if (typeof event.archived !== 'boolean') throw new Error('無效封存狀態。');
      const roomKeys = this.archiveKeys(room);
      const keys = new Set(this.archivedKeys);
      if (!event.archived && roomKeys.some(key => keys.has(key)) && this.pins.remove(new Set(roomKeys))) this.emitPins();
      for (const key of roomKeys) {
        if (event.archived) keys.add(key);
        else keys.delete(key);
      }
      this.saveArchive(keys, event.archived ? room.id : undefined, event.archived ? undefined : room.id);
      return;
    }

    if (event.type === 'START') {
      await live?.closing;
      if (options?.stillWanted?.() === false || this.rooms.get(room.id) !== room) return;
      return this.startExisting(room, options?.stillWanted);
    }
    if (event.type === 'CLOSE') {
      if (live) this.closeTerminal(room, live, false);
      return;
    }
    if (event.type === 'SET_ROOM_MODE') {
      if (typeof event.auto !== 'boolean') throw new Error('無效權限模式。');
      this.modes.setRoom(this.modeKeys(room), event.auto);
      this.emit({ type: 'LAUNCH_MODES', launchModes: this.modes.snapshot });
      if (!live || room.autoMode === event.auto) return;
      // A running CLI cannot change its permission mode, so it is reopened on the same session.
      if (!room.sessionId || !room.resumable) {
        reply({ type: 'NOTICE', message: '已記住新模式，但這間房未有可續接的 Session，下次開房才生效。' });
        return;
      }
      this.closeTerminal(room, live, false);
      const remote = Boolean(live.remote);
      await live.closing;
      return this.startExisting(room, options?.stillWanted, remote);
    }
    if (event.type === 'SET_AUTO_COMPACT') {
      if (typeof event.enabled !== 'boolean') throw new Error('這間房的 Auto Compact 設定無效。');
      const roomKeys = this.modeKeys(room);
      const targets = [...this.rooms.values()].filter(target => this.modeKeys(target).some(key => roomKeys.includes(key)));
      this.compactRooms.set(targets.flatMap(target => this.modeKeys(target)), event.enabled);
      for (const target of targets) {
        target.autoCompact = event.enabled;
        this.emit({ type: 'ROOM', room: target });
      }
      return;
    }
    const inputAttachments = event.type === 'INPUT' ? attachmentsOf(event) : undefined;
    if (event.type === 'INPUT' && inputAttachments?.attachmentCount && typeof event.text === 'string' && event.text.trim().startsWith('/')) {
      throw new Error('附件請配合一般訊息發送，不可以和 / 指令一起送。');
    }
    if (event.type === 'INPUT' && room.modelId === 'AGY' && typeof event.text === 'string' && /^\/(?:model|effort)(?:\s|$)/i.test(event.text.trim())) {
      await this.switchAgyModel(room, live, event.text.trim(), result);
      return;
    }
    if (event.type === 'INPUT' && room.modelId === 'CLAUDE' && typeof event.text === 'string' && /^\/(?:model|effort)\s+\S/i.test(event.text.trim())) {
      await this.switchClaudeModel(room, live, event.text.trim(), result);
      return;
    }
    // A message for a room whose CLI is closed, or is being closed because nobody was looking, brings it back on its own session and waits
    // until it is at its input box, the same way a hand-off does, instead of refusing; then the message is handled as usual.
    if (event.type === 'INPUT' && !options?.authorizeBenchInput && !options?.resumed && (!live || live.closedAutomatically) && room.sessionId && room.resumable &&
        !this.archiveKeys(room).some(key => this.archivedKeys.has(key))) {
      if (event.groupId !== undefined && (event.menuId !== undefined || checkedInput(room.modelId, event.text).startsWith('/'))) {
        throw new Error('請先續接 CLI，再發送指令或選項。');
      }
      await this.resumeForInput(room, live);
      return this.handle(event, reply, { ...options, resumed: true });
    }
    if (live?.closing) throw new Error('CLI 正在結束，請等房間續接後再試。');
    if (event.type === 'INPUT') {
      if (options?.authorizeBenchInput && (!live || room.menu || options.authorizeBenchInput('paste') === false)) {
        throw new Error('原收件房狀態已改變，工單仍留在原工作台。');
      }
      let input = checkedInput(room.modelId, event.text);
      let nativeAttachment = false;
      let sentImages: string[] | undefined;
      let sentFiles: string[] = [];
      const { imageList, fileList, attachmentCount } = inputAttachments!;
      // The CLI is working but its input box is open: a prompt, with or without attachments, can steer it.
      // Asked again each time, because the screen is brought up to date first: a busy CLI redraws all the time, and an answer
      // taken before that can be out of date (it said "cannot steer" about a CLI that could by then).
      const working = () => !room.ready && Boolean(room.steerable);
      if (room.modelId === 'CODEX' && input === '/app') {
        const cwd = await roomDirectory(this.workspace, room.repoPath);
        const env = { ...process.env };
        delete env.KOMOREBI_PAIRING_KEY;
        await run('codex', ['app', cwd], { cwd, env, timeout: 30_000 });
        const message = '已在 Mac 呼叫 Codex 桌面 App。';
        result(true, message);
        if (!event.requestId) reply({ type: 'NOTICE', message });
        return;
      }
      if (room.modelId === 'CODEX' && /^\/rc (on|off)$/.test(input)) {
        const enabled = input.endsWith(' on');
        await this.setCodexRemote(enabled);
        const message = enabled ? '已啟用這部 Mac 的 Codex Remote Control 設定。' : '已關閉這部 Mac 的 Codex Remote Control 設定。';
        result(true, message);
        if (!event.requestId) reply({ type: 'NOTICE', message });
        return;
      }
      if (live?.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
      if (live?.closing) throw new Error('CLI 正在結束，請等房間續接後再試。');
      if (live && this.live.get(room.id) === live && live.dirty) this.refresh(room, live);
      // Just after it starts a step a CLI can show no input box for a moment (it is still drawing); give it a moment before refusing.
      if (live && !input.startsWith('/')) {
        for (let tries = 0; tries < 10 && !room.ready && !room.steerable && !room.pendingApproval && !room.menu && this.live.get(room.id) === live; tries++) {
          await new Promise<void>(resolve => setTimeout(resolve, this.steerWaitMs));
          if (live.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
          if (live.dirty) this.refresh(room, live);
        }
      }
      // The screen can change while draining terminal output. A fixed wake may not close a menu or choose an answer.
      if (options?.authorizeBenchInput && options.authorizeBenchInput('paste') === false) {
        throw new Error('原收件房狀態已改變，工單仍留在原工作台。');
      }
      if (options?.resumed && event.groupId !== undefined && (!room.ready || room.menu || room.pendingApproval || room.pendingQuestion)) {
        // The user's draft predates this screen. It cannot answer a choice that appeared during resume.
        throw new Error('續接後 CLI 仍未就緒。請先處理終端提示，再送出訊息。');
      }
      if (room.pendingApproval && /^[1-9]$/.test(input) && !attachmentCount && event.menuId === undefined) {
        const current = approvalPrompt(room.modelId, room.screen ?? '');
        const response = current && Object.hasOwn(current.numbered, input) ? current.numbered[input] : undefined;
        if (!live || this.live.get(room.id) !== live || live.submitted || live.dirty || live.queued || live.deferredInput ||
            !current || current.fingerprint !== live.approvalFingerprint || !response) {
          throw new Error('這個數字不對應目前審批選項。請核對終端，再選擇一次。');
        }
        this.answerApproval(room, live, current.fingerprint, response);
        result(true, `已將選項 ${input} 送到 CLI`);
        return;
      }
      if (event.menuId !== undefined || (room.menu && /^[1-9]$/.test(input) && !attachmentCount)) {
        const selection = modelConfirmationChoices(room.modelId, room.screen ?? '') && /^[yn]$/i.test(input)
          ? input.toLowerCase() + '\r' : numberedMenuChoices(room.modelId, room.screen ?? '').get(input);
        if (!live || this.live.get(room.id) !== live || attachmentCount || live.submitted || live.dirty || live.queued ||
            live.deferredInput || room.pendingApproval || !room.menu?.confirm || room.menu.id !== event.menuId ||
            !selection) {
          throw new Error('選項未對應目前選單。請核對終端，再選擇一次。');
        }
        this.writeScreenKey(room, live, input, selection);
        result(true, '已將選項送到 CLI');
        return;
      }
      const single = !options?.reserveRoster && !input.startsWith('/') && !/^[1-9]$/.test(input) && !input.startsWith('[交接｜') && !input.startsWith('[工作台') && live && !live.singleNoted && !this.retainedRooms.has(room.id);
      const reserveRoster: ReserveRoster | undefined = input.startsWith('/') ? undefined
        : options?.reserveRoster ?? (single ? () => ({ suffix: singleRoomNote, finish: (sent: boolean) => { if (sent && live) live.singleNoted = true; } }) : undefined);
      if (input === '/limit-reset') throw new Error('請在 Claude Settings → Usage 兌換 Reset。');
      if (live?.deferredInput) throw new Error('上一個指令正等待選單關閉。');
      if (live?.attaching || live?.preparingAttachments) throw new Error('圖片附件處理中，請稍後再試。');
      if (attachmentCount) {
        if (!live || this.live.get(room.id) !== live || !(room.ready || working()) || live.submitted || room.pendingApproval || room.menu) {
          throw new Error('CLI 未就緒，請先完成審批或關閉選單。');
        }
        live.preparingAttachments = true;
        this.onRecoveryChange?.(room.id);
        try {
          // Validate and save first, so a bad attachment never leaves a half-written CLI input.
          if (fileList.length) sentFiles = await saveFileAttachments(fileList, this.fileAttachmentDirectory, path => this.attachmentLedger.record(path, room.id));
          const paths: string[] = [];
          for (const image of imageList) { const saved = await this.saveImage(image); paths.push(saved); if (dirname(saved) === attachmentDirectory) this.attachmentLedger.record(saved, room.id); }
          sentImages = paths;
          if (this.live.get(room.id) !== live || !(room.ready || working()) || live.submitted || room.pendingApproval || room.menu) {
            throw new Error(`CLI 狀態已改變，${sentFiles.length ? '附件' : '圖片'}已保存在 Mac：${[...paths, ...sentFiles].join('、')}。請重新發送。`);
          }
          const fallback: string[] = [];
          for (const path of paths) {
            const attached = await this.attachImage(room, live, path);
            if (attached === 'unsupported') fallback.push(path);
            else {
              // 'unconfirmed' means the CLI showed no attachment marker (newer Codex and Gemini CLIs read the pasted path with a tool). The path is still sent, so there is nothing to tell the Founder.
              // The image is now part of the CLI input; the text follows in the same turn.
              nativeAttachment = true;
            }
          }
          if (fallback.length) input += ` 請讀取${fallback.length > 1 ? `這 ${fallback.length} 張` : '這張'}本機圖片：${fallback.join('、')}`;
          if (nativeAttachment) input = ` ${input}`;
        } finally {
          live.preparingAttachments = false;
          this.onRecoveryChange?.(room.id);
        }
      }
      input += fileReadSuffix(sentFiles);
      const original = event.text.trim() + ' 📎 圖片'.repeat(imageList.length) +
        fileLabels(sentFiles.map(path => originalUploadName(basename(path))!));
      if (live && room.menu && room.menu.title !== 'CLI 畫面' && !room.pendingApproval && !live.submitted && !live.dirty && !live.queued) {
        const timer = setTimeout(() => {
          if (this.live.get(room.id) !== live || !live.deferredInput) return;
          this.cancelDeferred(room, live, '未能確認選單已關閉');
          this.emit({ type: 'ROOM', room });
        }, 4000);
        live.deferredInput = { input, original, images: sentImages, timer, result, reserveRoster, inputTraceId: options?.inputTraceId };
        this.writeScreenKey(room, live, 'escape');
        reply({ type: 'NOTICE', message: '正關閉選單，返到輸入位置後會送出指令。' });
        return;
      }
      // While the CLI works its input box stays open: a plain prompt steers it or queues behind the current step.
      const steer = working() && !input.startsWith('/');
      if (!live || this.live.get(room.id) !== live || (!room.ready && !nativeAttachment && !steer) || live.submitted || room.pendingApproval) {
        throw new Error(nativeAttachment ? 'CLI 狀態已改變，圖片附件仍在輸入框，請在終端核對或清除。' :
          !room.ready && room.steerable ? 'CLI 工作中，指令要等它回到輸入提示才可以送。' : 'CLI 未就緒。請先完成審批、關閉選單，或者等 CLI 回到輸入提示。');
      }
      this.submitInput(room, live, input, original, 100, result, reserveRoster, steer, sentImages, options?.inputTraceId, options?.authorizeBenchInput);
      return;
    }
    if (!live) throw new Error('請先開啟或續接 CLI。');
    if (event.type === 'INTERRUPT') {
      this.cancelDeferred(room, live, '已中斷');
      this.cancelSubmission(live, '指令已中斷，未有送出。');
      live.process.write('\x03');
      return;
    }
    if (event.type === 'ANSWER_QUESTION') {
      if (room.modelId === 'CLAUDE') await this.answerClaudeQuestion(room, live, event);
      else if (room.modelId === 'AGY') await this.answerAgyQuestion(room, live, event);
      else await this.answerQuestion(room, live, event);
      result(true, '已回答問題。');
      return;
    }
    if (event.type === 'TERMINAL_KEY' && event.key === 'shift-left') {
      // This key only opens a question the CLI has queued for the user, so unlike other manual keys it does not depend on
      // the screen the user last saw. A working CLI redraws all the time, so catch up with its screen first (as a message does).
      if (live.queued) await new Promise<void>(resolve => live.terminal.write('', resolve));
      if (live.dirty) this.refresh(room, live);
      if (!/⇧←\s*to answer/.test(room.screen ?? '') || live.submitted || live.deferredInput || room.pendingApproval || room.menu) {
        throw new Error('目前沒有排隊中的問題，或畫面已更新，請再看一次。');
      }
      this.writeScreenKey(room, live, 'shift-left');
      return;
    }
    // A CLI that waits for a person writes nothing, so a flag left on by an earlier key would never clear by itself. Only a flag that
    // has stood for a while with no key and no output is read again here: a second tap right after the first must still wait for the
    // screen to answer the first, or one tap could be sent twice.
    if (live.dirty && !live.queued && !live.submitted && !live.deferredInput &&
        Date.now() - (live.keyAt ?? 0) > staleScreenMs && Date.now() - (live.lastOutputAt ?? 0) > staleScreenMs) this.refresh(room, live);
    if (live.submitted || live.dirty || live.queued || live.deferredInput) throw new Error('CLI 畫面更新中，請核對後再試。');
    if (event.type === 'APPROVAL') {
      const current = approvalPrompt(room.modelId, room.screen ?? '');
      if (!current || !room.pendingApproval || room.pendingApproval.id !== event.approvalId ||
          current.fingerprint !== live.approvalFingerprint || typeof event.decision !== 'string') {
        throw new Error('審批要求已更改或處理。');
      }
      const response = event.decision === 'approve' ? current.yes : event.decision === 'reject' ? current.no :
        Object.hasOwn(current.additional, event.decision) ? current.additional[event.decision] : undefined;
      if (!response) throw new Error('目前 CLI 審批選單沒有這個選項。');
      this.answerApproval(room, live, current.fingerprint, response);
      result(true, '審批決定已送到 CLI');
      return;
    }
    if (event.type === 'MENU') {
      const key = event.key;
      const numeric = typeof key === 'string' && /^[1-9]$/.test(key);
      const selection = /^[yn]$/.test(key) && modelConfirmationChoices(room.modelId, room.screen ?? '') ? key + '\r' :
        numeric ? numberedMenuChoices(room.modelId, room.screen ?? '').get(key) : undefined;
      if (room.pendingApproval || !room.menu || room.menu.id !== event.menuId ||
          key === 'ctrl-u' ||
          ((key === 'enter' || numeric) && !room.menu.confirm) ||
          (key === 'tab' && room.menu.title !== '權限設定' && (room.modelId !== 'AGY' || room.menu.title !== '工作階段選單')) ||
          !(Object.hasOwn(keyCodes, key) || selection)) throw new Error('選單已更新或按鍵不適用。');
      this.writeScreenKey(room, live, key, selection);
      return;
    }
    if (event.type === 'TERMINAL_KEY') {
      const numeric = typeof event.key === 'string' && /^[1-9]$/.test(event.key);
      if (typeof event.screen !== 'string' || !event.screen || event.screen !== room.screen ||
          (event.screenId !== undefined && event.screenId !== room.screenId) || live.dirty || live.queued ||
          // An idle CLI can clear its draft. Shift+Left for queued questions is handled above.
          (room.ready && event.key !== 'ctrl-u') || room.pendingApproval || room.menu || !(Object.hasOwn(keyCodes, event.key) || numeric)) {
        throw new Error('終端畫面已更新，或請使用已偵測的審批／選單控制。');
      }
      this.writeScreenKey(room, live, event.key);
      return;
    }
    throw new Error('無效請求。');
  }

  async close() {
    this.closed = true;
    for (const stop of this.pendingCodexRollouts.values()) stop();
    for (const watch of this.groupWatches.values()) watch.stop();
    this.groupWatches.clear();
    clearInterval(this.usageTimer);
    for (const live of this.live.values()) {
      live.disposeForkRollout?.();
      live.process.kill();
    }
    await this.stopWatching?.();
  }
}
