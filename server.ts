// Bridge entry point, wired by the local launch scripts.
// Contents
// Startup configuration and locks
// Transcription availability
// Restart and process settings
// Shared request state
// Network identity and socket delivery
// Room events and recovery
// Push notifications and Inbox alerts
// Room settings and replacement
// Group membership and room presence
// Workbench services
// File triggers and notices
// Delivery holds and RSI scheduling
// Group closeout and workbench maintenance
// HTTP and WebSocket admission
// WebSocket services and views
// WebSocket groups, rooms and panels
// WebSocket file triggers and terminal input
// Vite development server
// Local CLI workbench hook
// Web interface delivery
// Before listening
// After binding the port
// Maintenance and shutdown

import { maxUploadFrameBytes } from './src/utils/fileAttachments';
import { BridgeRestartController, restartJobState } from './bridge/bridge-restart';
import { execFile } from 'node:child_process';
import { TranscribeError, transcribeAudio, transcribeAvailable } from './bridge/transcribe';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { isIPv4 } from 'node:net';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { roomBlocker, blockerText } from './bridge/room-blocker';
import { noteStuckScreen } from './bridge/stuck-log';
import type { TerminalRoom } from './src/types/guild';
import { chmod, stat } from 'node:fs/promises';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, type FSWatcher } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import { config as loadLocalEnv } from 'dotenv';
import { WebSocket, WebSocketServer } from 'ws';
import { beginInputTrace, groupWakeNotice, Rooms } from './bridge/rooms';
import { PushNotifier, PushStore, validSubscription } from './bridge/push';
import { accessScope, originAllowed, tailnetAddress } from './bridge/access';
import { pairingBanner, resolvePairingKey } from './bridge/pairing';
import { RoomPresence } from './bridge/presence';
import { inventoryTranscripts, makeStorageUsage } from './bridge/storage-usage';
import { assertMountedVolume, BridgeWorktrees, inspectWorktrees } from './bridge/auto-worktree';
import { Groups, GroupMemberRoleError, type GroupChat } from './bridge/groups';
import { GroupCloser } from './bridge/group-closer';
import { GroupViews } from './bridge/group-views';
import { FolderSetting, listDirectories } from './bridge/folder-setting';
import { bridgeConfig, tailnetUrl } from './bridge/config';
import { lockCheckout, lockWorkspace, assertLoopbackPortFree } from './bridge/workspace-lock';
import { brandHtml, brandManifest } from './src/brand';
import { mediaContentType, readTextFile, resolveReadable } from './bridge/file-reader';
import { worktreeCall } from './bridge/worktree';
import { MediaLinks } from './bridge/media';
import { GitHub, ghToken } from './bridge/github';
import { Drive, defaultDriveEnv } from './bridge/drive';
import { Bench } from './bridge/bench';
import { BenchExperience, experienceFile, inExperienceScope, readExperienceScope, readTidyGroup } from './bridge/bench-experience';
import { FileTriggerStore } from './bridge/file-trigger-store';
import { resumeOfflineTrigger } from './bridge/file-trigger-resume';
import { stopFileTriggerObservers } from './bridge/file-trigger-shutdown';
import { confirmFileTrigger } from './bridge/file-trigger-confirm';
import { watchTriggerConfig as watchSignedTriggerConfig } from './bridge/file-trigger-config-monitor';
import { readFileTriggerKey, provisionFileTriggerKey, provisionFileTriggerResetKey, fileTriggerKeychainAnchor } from './bridge/file-trigger-keychain';
import { resetWithKey } from './bridge/file-trigger-reset-key';
import { reloadGate, unlockWithKey } from './bridge/file-trigger-unlock';
import { ReadMarkStore } from './bridge/read-mark-store';
import { FileTriggerWatch, validateTriggerPath } from './bridge/file-trigger-watch';
import { deliverFileNotice, fileNoticeHoldsRoom } from './bridge/file-trigger-delivery';
import { ArchiveGroups, type RememberedGroup } from './bridge/archive-groups';
import { Successors } from './bridge/successors';
import { moveClaudeRoom, replaceStaleRoom, replaceVerdict } from './bridge/room-replace';
import { HandledReports, manualPersonaNotice, personaReport, sendPersonaNotices } from './bridge/persona-notice';
import { listInbox } from './bridge/inbox';
import { reconcileInboxAlerts, scanInboxAlerts, type InboxAlertScan } from './bridge/inbox-alerts';
import { HandoffLog } from './bridge/handoff-log';
import { attachmentMaxAgeDays, sweepAttachments } from './bridge/attachment-trash';
import { readNativeTestRooms } from './bridge/handoff';
import { reportIsDone, reportWaitMs } from './src/utils/attentionDiff';
import { benchAction, benchHook, benchRequest, cancelLeadTickets, dispatchRsiTidy, escalateStalled, escalateUnread, idleWake, legacyBenchInputGuard, retryUnreadWake, runFixedBenchWake, sendFromBridge, stalledWake, startClosedRecipient, type BenchDeps } from './bridge/bench-server';
import type { ClientEvent, ServerEvent } from './src/types/bridge';

// Startup configuration and locks
// Load local settings and check the UI build, checkout, workspace and port before wiring Bridge services.
const project = fileURLToPath(new URL('.', import.meta.url));
// A direct `npm run dev` uses the same ignored local settings as the launch scripts.
loadLocalEnv({ path: join(project, '.env.komorebi-local'), quiet: true });
const port = Number(process.env.KOMOREBI_PORT) || 3000;
const config = bridgeConfig(process.env, project);
const { workspace, features } = config;
const uiRoot = join(project, 'dist');
if (config.ui === 'build' && (!existsSync(join(uiRoot, 'index.html')) || !existsSync(join(uiRoot, 'manifest.webmanifest')) || lstatSync(uiRoot).isSymbolicLink())) {
  throw new Error('UI build missing or invalid: run npm run build before starting Bridge.');
}
function readBuiltFile(name: string) {
  if (lstatSync(uiRoot).isSymbolicLink()) throw new Error('UI build directory cannot be a symlink.');
  const root = realpathSync(uiRoot);
  const file = realpathSync(join(uiRoot, name));
  const path = relative(root, file);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('UI file is outside dist.');
  return readFileSync(file, 'utf8');
}
if (config.mount) assertMountedVolume(config.mount);
const releaseCheckout = lockCheckout(project, config.host, port);
let releaseWorkspace: () => void;
try {
  if (!config.mount) mkdirSync(workspace, { recursive: true });
  releaseWorkspace = lockWorkspace(workspace, config.host, port);
}
catch (error) { releaseCheckout(); throw error; }
process.once('exit', () => { releaseWorkspace(); releaseCheckout(); });
await assertLoopbackPortFree(port);

if (process.platform === 'darwin') {
  const packageFile = createRequire(import.meta.url).resolve('node-pty/package.json');
  const helper = join(dirname(packageFile), 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  const info = await stat(helper).catch(() => undefined);
  if (info?.isFile() && !(info.mode & 0o100)) await chmod(helper, info.mode | 0o100);
}

// Transcription availability
// Keep the advertised transcription capability current as the local Whisper installation changes.
// Whether this Mac can turn recordings into text (the Whisper model and program are installed); looked at again each minute.
let transcribeReady = false;
const checkTranscribe = () => void transcribeAvailable().then(ok => { transcribeReady = ok; });
checkTranscribe();
setInterval(checkTranscribe, 60_000).unref();

// Restart and process settings
// Wire the launchd restart controller and expose the workspace and skill paths to child processes.
const run = promisify(execFile);

const restartInstanceId = randomUUID();
const restartController = new BridgeRestartController({
  platform: process.platform,
  serviceName: process.env.XPC_SERVICE_NAME,
  scriptPath: join(project, 'scripts', 'komorebi-restart.sh'),
  runLaunchctl: args => run('/bin/launchctl', args, { timeout: 5000, maxBuffer: 262144 }),
  now: Date.now,
  jobState: async () => {
    try { return restartJobState((await run('/bin/launchctl', ['list'], { timeout: 5000, maxBuffer: 1048576 })).stdout); }
    catch { return 'unknown'; }
  },
  notify: () => broadcast({ type: 'BRIDGE_RESTART_NOTICE' }),
  log: scope => console.info(`restart requested via ${scope}`),
});
const restartSupported = restartController.supported;
process.env.KOMOREBI_WORKSPACE = workspace;
process.env.KOMOREBI_SKILLS = config.skills;

// Shared request state
// Keep storage scans, read marks and media links in one place and resolve the pairing key before admitting clients.
let storageScan: ReturnType<typeof inventoryTranscripts> | undefined;
/** What the Founder has read, shared by every device. */
const readMarks = new ReadMarkStore(join(workspace, '.komorebi-read-marks.json'));
const media = new MediaLinks([workspace, join(homedir(), 'Documents')]);
const pairing = await resolvePairingKey(process.env.KOMOREBI_PAIRING_KEY);
if (pairing.warning) console.warn(pairing.warning);
const pairingKey = Buffer.from(pairing.key);

// Network identity and socket delivery
// Resolve request scope, discover the Tailscale address and limit queued data when sending events.
let tailscaleIp: string | null = null;
/** This Mac's Tailscale name, which Tailscale Serve uses as the Host of its HTTPS requests. */
let serveHost: string | null = null;
/** The address phones should use: the HTTPS Serve address when it is set up (needed for push), else the plain tailnet one. */
const tailscaleUrl = () => tailnetUrl(config.host, port, tailscaleIp, serveHost);
const clients = new Set<WebSocket>();
const app = express();
app.disable('x-powered-by');

function access(req: IncomingMessage) {
  return accessScope({
    peer: req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '', local: req.socket.localAddress?.replace(/^::ffff:/, '') ?? '',
    host: req.headers.host, headers: req.headers, port, tailscaleIp, serveHost,
  });
}

async function tailscaleJson(args: string[]): Promise<any> {
  for (const command of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const { stdout } = await run(command, args, { timeout: 3_000, maxBuffer: 2_000_000 });
      return JSON.parse(stdout);
    } catch { /* try the bundled CLI, then give up */ }
  }
}

async function refreshTailscale() {
  if (!config.tailscale) return;
  let detected: string | null = null;
  for (const command of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const { stdout } = await run(command, ['ip', '-4'], { timeout: 2_000, maxBuffer: 8_192 });
      const ip = stdout.trim();
      if (tailnetAddress(ip)) {
        detected = ip;
        break;
      }
    } catch { /* The bundled Mac app CLI works when there is no PATH alias. */ }
  }
  // HTTPS through Tailscale Serve is what lets an iPhone web app receive push notifications.
  const status = await tailscaleJson(['status', '--json']);
  const dns = typeof status?.Self?.DNSName === 'string' ? status.Self.DNSName.replace(/\.$/, '') : null;
  const certificates = Boolean(dns && Array.isArray(status?.CertDomains) && status.CertDomains.includes(dns));
  const serving = certificates ? await tailscaleJson(['serve', 'status', '--json']) : undefined;
  const nextServeHost = dns && serving?.Web && Object.keys(serving.Web).includes(`${dns}:443`) ? dns : null;
  if (detected === tailscaleIp && nextServeHost === serveHost) return;
  tailscaleIp = detected;
  serveHost = nextServeHost;
  for (const client of remoteClients) client.close(1012);
  broadcast({ type: 'NETWORK', tailscaleUrl: tailscaleUrl() });
}

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 2_000_000) {
    ws.terminate();
    return;
  }
  ws.send(JSON.stringify(event));
}

// Room events and recovery
// Send room updates to clients and reconcile group membership and idle timers after room changes.
// Assigned further down, once the groups exist; events that arrive before then skip it.
let groupCloser: GroupCloser | undefined;
let recoveryScheduled = false;
let recoveryMembers = new Set<string>();
// Declared early: a recovery microtask can run at the first top-level await, long before the shutdown code further down.
let shuttingDown = false;
const loggedPushObservationFailures = new Set<string | number>();

function scheduleRecovery() {
  if (recoveryScheduled || !groupCloser) return;
  recoveryScheduled = true;
  queueMicrotask(() => {
    recoveryScheduled = false;
    if (shuttingDown) return;
    const roster = groups.snapshot();
    const members = new Set(roster.flatMap(group => group.members.map(member => member.roomId)));
    const crowns = new Set(roster.map(group => group.orchestratorRoomId));
    for (const previous of recoveryMembers) if (!members.has(previous)) {
      presence.stopIdle(previous);
      if (rooms.isOpen(previous)) presence.considerUnviewed(previous);
    }
    recoveryMembers = members;
    for (const roomId of members) {
      if (crowns.has(roomId) || !rooms.isOpen(roomId)) presence.stopIdle(roomId);
      else presence.reconcileIdle(roomId, !rooms.isWorking(roomId) && !rooms.deliveryPending(roomId));
    }
    groupCloser?.checkAll();
  });
}
function broadcast(event: ServerEvent) {
  for (const client of clients) send(client, event);
  if ((event.type === 'ROOM' || event.type === 'SYNC_UPDATE') && event.room) {
    void pushNotifier.observe(event.room).catch(error => {
      const reason = error?.code ?? error?.name ?? 'unknown';
      if (loggedPushObservationFailures.has(reason)) return;
      loggedPushObservationFailures.add(reason);
      console.error('未能處理房間推送通知', reason);
    });
  }
  if (event.type === 'ROOM') {
    if (!rooms.isGroupMember(event.room.id)) presence?.activity(event.room.id, Boolean(event.room.ready && event.room.status === 'idle'));
    scheduleRecovery();
    void groupViews?.synced(event.room.id);
    syncGroupWatches();
  } else if (event.type === 'SYNC_UPDATE' && event.room) {
    if (event.room.live && !rooms.isGroupMember(event.room.id)) presence?.activity(event.room.id, Boolean(event.room.ready && event.room.status === 'idle'));
    scheduleRecovery();
    void groupViews?.synced(event.room.id);
    syncGroupWatches();
  }
  else if (event.type === 'ROOM_REMOVED' && event.replacementRoomId) {
    for (const [client, roomId] of roomViews) {
      if (roomId === event.roomId) roomViews.set(client, event.replacementRoomId);
    }
    syncGroupWatches();
    try { groups?.replaceRoom(event.roomId, event.replacementRoomId); }
    catch { for (const client of clients) send(client, { type: 'NOTICE', message: '房間已合併，但群組關聯未能更新；請檢查群組資料。' }); }
  } else if ((event.type === 'ROOM_REMOVED' && event.deleted) || (event.type === 'ARCHIVED' && event.archivedRoomId)) {
    // A room deleted or archived must not stay in a group as a member that cannot reopen (a group keeps at least one member).
    const deleted = event.type === 'ROOM_REMOVED';
    const roomId = deleted ? event.roomId : event.archivedRoomId!;
    removeFromGroups(roomId, deleted ? '已刪除' : '已封存', !deleted, event.type === 'ARCHIVED' && event.quiet === true);
    if (deleted) archiveGroups.take(roomId);
  } else if (event.type === 'ARCHIVED' && event.restoredRoomId && groups) {
    // A restored room goes back into the groups it left when it was archived.
    const skipped = archiveGroups.restore(event.restoredRoomId, rooms.rooms.get(event.restoredRoomId), groups, room => rooms.canJoinExistingGroup(room));
    if (skipped.length) for (const client of clients) send(client, { type: 'NOTICE', message: `房間已還原，但未能加返群組：${skipped.join('、')}（群組已滿或房間未能加入）。` });
  }
}

const archiveGroups = new ArchiveGroups(join(project, '.env.komorebi-archive-groups.json'));

function removeFromGroups(roomId: string, what: string, remember = false, quiet = false) {
  const left: RememberedGroup[] = [];
  for (const group of groups?.snapshot() ?? []) {
    const member = group.members.find(member => member.roomId === roomId);
    if (!member) continue;
    try {
      groups?.removeMember(group.id, roomId);
      left.push({ groupId: group.id, orchestrator: group.orchestratorRoomId === roomId, ...(member.role ? { role: member.role } : {}) });
    } catch { if (!quiet) for (const client of clients) send(client, { type: 'NOTICE', message: `${what}的房間仍在群組「${group.name}」內（群組至少要保留一間成員房），請稍後自行處理。` }); }
  }
  if (remember) archiveGroups.remember(roomId, left);
}

// Push notifications and Inbox alerts
// Track which devices need notices and scan the Inbox for new alerts.
const push = new PushStore(join(project, '.env.komorebi-push.json'));
/** What each open page says about itself: which push subscription it holds, and whether it is on screen. */
const devices = new Map<WebSocket, { endpoint?: string; visible: boolean }>();
const pushNotifier = new PushNotifier(push, {
  displayName: config.displayName,
  onStuck: room => noteStuck(room),
  subject: () => serveHost ? `https://${serveHost}` : 'https://komorebi.invalid',
  foreground: endpoint => [...devices].some(([client, device]) => device.endpoint === endpoint && device.visible && client.readyState === WebSocket.OPEN),
  characterName: modelId => rooms.characters[modelId].characterName,
});
let inboxAlerts: InboxAlertScan | undefined;
let inboxScan: Promise<void> | undefined;
let inboxBaseline = false;
function refreshInboxAlerts() {
  if (inboxScan) return inboxScan;
  inboxScan = scanInboxAlerts(join(workspace, 'Inbox')).then(result => {
    const { data, fresh } = reconcileInboxAlerts(inboxAlerts, result, inboxBaseline);
    inboxAlerts = data;
    if (!result.incomplete) inboxBaseline = true;
    broadcast({ type: 'INBOX_ALERTS', data: inboxAlerts });
    if (fresh) void pushNotifier.callOutInbox().catch(() => {});
  }).catch(() => {
    inboxAlerts = { alerts: (inboxAlerts?.alerts ?? []).map(item => ({ ...item, incomplete: true })), incomplete: true };
    broadcast({ type: 'INBOX_ALERTS', data: inboxAlerts });
  }).finally(() => { inboxScan = undefined; });
  return inboxScan;
}

// Room settings and replacement
// Load room defaults, handle stalled Claude resumes and connect the GitHub and Drive panels.
const rooms = new Rooms(workspace, broadcast);
const inputLogPath = join(homedir(), 'Library', 'Logs', 'komorebi-input.log');
rooms.inputLogPath = inputLogPath;
// Where a new room starts its CLI: set in Settings on a computer, kept in the workspace's settings file.
const folderSetting = new FolderSetting(join(workspace, '.komorebi-settings.json'), workspace);
rooms.defaultFolder = () => folderSetting.get();
// A room left alone for hours stops at Claude's "Resume this conversation?" menu and nothing moves until someone answers.
// A group member (not its lead) is replaced by a copy with the same name, role, model and effort; every other case is called out to the Founder:
// to open pages as a toast, to the others as a push.
const replacing = new Set<string>();
const callOutResume = (room: TerminalRoom, extra = '') => {
  const who = `${rooms.characters[room.modelId].characterName} · ${room.roomName}`;
  const crown = groups.snapshot().some(group => group.orchestratorRoomId === room.id);
  broadcast({ type: 'ATTENTION', roomId: room.id, message: `${who}${crown ? '（總指揮）' : ''} 閒置太久，停在「Resume 舊對話」選單，請揀：1 接回舊對話（較耗額度）／2 開新對話。${extra}` });
  void pushNotifier.callOutResume(room).catch(() => {});
};
const sendFirstRoomInput = async (fresh: TerminalRoom, text: string) => {
  let last = '新房沒有接受第一句。';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise<void>(resolve => setTimeout(resolve, 4_000));
    const requestId = randomUUID().slice(0, 12);
    let answer!: (value: { ok: boolean; message?: string }) => void;
    const answered = new Promise<{ ok: boolean; message?: string }>(resolve => { answer = resolve; });
    try {
      await rooms.handle({ type: 'INPUT', roomId: fresh.id, text, requestId } as ClientEvent, reply => {
        const result = reply as { type?: string; requestId?: string; ok?: boolean; message?: string };
        if (result.type === 'ACTION_RESULT' && result.requestId === requestId) answer({ ok: result.ok === true, message: result.message });
        else if (result.type === 'NOTICE' && result.message) last = result.message;
      });
    } catch (error) { last = error instanceof Error ? error.message : last; continue; }
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([answered, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 15_000); })]);
    clearTimeout(timer);
    if (!outcome) throw new Error('送出狀態未確認，為免重複，沒有再送。');
    if (outcome.ok) return;
    if (outcome.message) last = outcome.message;
  }
  throw new Error(last);
};
rooms.onResumePrompt = room => {
  if (replacing.has(room.id)) return;
  if (rooms.isProtected(room)) { callOutResume(room, '這間房已受保護，請手動處理續接。'); return; }
  if (!replaceVerdict(groups.snapshot(), room).replace) { callOutResume(room); return; }
  replacing.add(room.id);
  void replaceStaleRoom({
    rooms: {
      clone: old => rooms.cloneRoom(old),
      close: async old => { await rooms.handle({ type: 'CLOSE', roomId: old.id } as ClientEvent, () => {}); },
      archive: async old => { await rooms.handle({ type: 'ARCHIVE', roomId: old.id, archived: true } as ClientEvent, () => {}); },
      find: id => rooms.rooms.get(id),
      greet: fresh => sendFirstRoomInput(fresh, 'hi'),
    },
    groups, bench: benchDeps.bench, successors, note: (roomId, text) => rooms.note(roomId, text),
  }, room).then(result => {
    if (result.replaced) { broadcast({ type: 'SUCCESSORS', successors: successors.snapshot() }); return; }
    callOutResume(room, `自動換房失敗：${result.why}。`);
  }).catch(error => callOutResume(room, `自動換房失敗：${error instanceof Error ? error.message : '原因不明'}。`)).finally(() => replacing.delete(room.id));
};
// The GitHub panel reads GitHub with the token `gh` holds; the token stays in this process.
const github = new GitHub({ token: ghToken });
// The Drive panel works on the folder Google Drive for desktop mounts on this Mac.
const drive = new Drive(defaultDriveEnv(workspace));
// Each Codex room's own speed (Fast or standard) survives a restart.
rooms.useFastFile(join(project, '.env.komorebi-codex-fast.json'));
// A room whose screen has stood still away from its prompt is called out: to open pages as a toast, to the others as a push.
const stuckLog = join(homedir(), 'Library/Logs/komorebi-stuck-screens.log');
const noteStuck = (room: TerminalRoom) => noteStuckScreen(room, stuckLog);
setInterval(() => void pushNotifier.tick(rooms.snapshot()).then(called => {
  for (const room of called) {
    const reason = roomBlocker(room);
    broadcast({ type: 'ATTENTION', roomId: room.id, message: `${rooms.characters[room.modelId].characterName} · ${room.roomName} ${reason ? blockerText[reason] : '畫面長時間沒有變化，可能需要你處理'}` });
  }
}).catch(() => {}), 10_000).unref();

// Group membership and room presence
// Track who is viewing each room and reconcile the room watchers when the roster changes.
// The crown has the group clock; every other room closes after 2 minutes unviewed.
const presence = new RoomPresence<WebSocket>(roomId => {
  if (groupCloser?.isCrown(roomId)) { scheduleRecovery(); return true; }
  return rooms.closeUnviewed(roomId);
}, 120_000);
presence.onViewChange = scheduleRecovery;
const roomViews = new Map<WebSocket, string>();
const groupViews = new GroupViews<WebSocket>({
  connected: client => client.readyState === WebSocket.OPEN,
  beginVisit: groupId => groups.beginVisit(groupId),
  select: (client, roomId) => {
    roomViews.delete(client);
    syncGroupWatches();
    presence.view(client, roomId);
  },
  hasRoom: roomId => rooms.rooms.has(roomId),
  canOpenEntry: roomId => rooms.canWakeGroupMember(roomId, rooms.rooms.get(roomId)?.sessionId),
  open: (roomId, stillWanted) => rooms.openViewedRoom(roomId, stillWanted),
  failed: (roomId, error) => rooms.groupStartFailed(roomId, error),
});
const groups = new Groups(join(project, '.env.komorebi-groups.json'), group => {
  retainGroupRooms();
  broadcast({ type: 'GROUP', group: groups.visible(group) });
  groupViews.update(group);
  scheduleRecovery();
  // Group change includes crown changes; re-resolve the recipient server-side.
  if (features.fileTrigger) queueMicrotask(() => { triggerBroadcast(group.id); scheduleFileNotice(group.id); });
},
  roomId => rooms.rooms.get(roomId),
  (message, cause) => {
    console.warn(message);
    if (cause === 'conflict') broadcast({ type: 'GROUP_MEMBER_ROLE_WARNING', code: cause });
  });
groups.boardEnabled = features.board;

// Workbench services
// Connect ticket routing, room successors and worktree capacity to the workbench.
// Each group member's workbench: tickets other members write for it (see Review/WORKBENCH/PLAN.md).
rooms.benchHook = join(project, 'scripts', 'bench-hook');
rooms.hasOpenTickets = room => [room.sessionId, room.id].some(key => Boolean(key) && (benchDeps.bench.mine(key as string).length > 0 || benchDeps.bench.openFrom(key as string).length > 0));
const handoffLog = new HandoffLog(join(workspace, '.komorebi-handoff-log.json'));
const successors = new Successors(join(workspace, '.komorebi-successors.json'));
rooms.successors = () => successors.snapshot();
const bridgeWorktrees = new BridgeWorktrees(join(workspace, '.komorebi-bridge-worktrees.json'), join(workspace, 'Worktrees'));
const roomKey = (room: { sessionId?: string; id: string }) => room.sessionId ?? room.id;
const benchDeps: BenchDeps = {
  successors: () => successors.snapshot(),
  bench: new Bench(),
  rooms: () => rooms.snapshot(),
  groups: () => groups.visibleSnapshot(),
  createWorktree: (id, repo, ref) => { if (config.mount) assertMountedVolume(config.mount); return bridgeWorktrees.create(id, repo, ref); },
  worktreeCapacity: () => bridgeWorktrees.capacity(),
  roleRouting: {
    characters: () => rooms.characters,
    state: room => rooms.roleRoutingState(room),
    nativeAllowlist: () => new Set(readNativeTestRooms(workspace).map(id => id.toLowerCase())),
  },
  tool: join(project, 'scripts', 'komorebi-room'),
  note: (roomId, text) => rooms.note(roomId, text),
  notice: message => broadcast({ type: 'NOTICE', message }),
  flow: (fromRoomId, toRoomId, kind, ticket) => broadcast({ type: 'BENCH_FLOW', fromRoomId, toRoomId, kind, ticket }),
};

// File triggers and notices
// Maintain observers against signed settings and deliver pending file notices to group leads.
// Separate, Bridge-owned file-notice state. No watcher exists until an item is explicitly enabled.
const triggerConfigPath = join(project, '.env.komorebi-file-triggers.json');
// Before listening only a fail-closed placeholder exists; constructor recovery can write Keychain.
let triggerNeedsSetup = false;
let fileTriggers = newTriggerStore(undefined);
/** Diagnostic only: names the step and the error text. Never logs keys, file contents or settings. */
function triggerLog(step: string, error: unknown) {
  console.error(`[file-trigger] ${step}: ${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}`);
}
/** A store with the Keychain anchor, whose lock reason goes to the log (never a key, path or content). */
function newTriggerStore(key: Buffer | undefined) {
  const store = new FileTriggerStore(triggerConfigPath, key, undefined, key ? fileTriggerKeychainAnchor(key) : undefined);
  store.onLock = reason => triggerLog('locked', new Error(reason));
  return store;
}
const triggerWatches = new Map<string, FileTriggerWatch>();
const triggerStates = new Map<string, 'monitoring' | 'gap' | 'error' | 'offline'>();
const triggerOfflineTokens = new Map<string, string>();
function offlineToken(id: string) { let token = triggerOfflineTokens.get(id); if (!token) { token = randomUUID(); triggerOfflineTokens.set(id, token); } return token; }
const triggerTimers = new Map<string, NodeJS.Timeout>();
const triggerAttempts = new Set<string>();
const triggerReturns = new Map<string, () => void>();
let triggerConfigWatch: FSWatcher | undefined;
let stoppingTriggers = false;
/** Set when an integrity failure stopped the observers, so they can be started again once the configuration verifies. */
let triggersStoppedByIntegrity = false;

/** When integrity fails, stop every observer and pending retry before reporting it. */
function stopAllTriggers() {
  if (stoppingTriggers) return;
  stoppingTriggers = true;
  triggersStoppedByIntegrity = true;
  try {
    triggerConfigWatch?.close(); triggerConfigWatch = undefined;
    stopFileTriggerObservers({ watches: triggerWatches, returns: triggerReturns, timers: triggerTimers,
      onStopped: id => triggerStates.set(id, 'error') });
    for (const group of groups.snapshot()) triggerBroadcast(group.id);
    broadcast({ type: 'NOTICE', message: '檔案觸發設定或 Keychain 錨點無效；監察已停止，通知不會送出。' });
    scheduleRecovery();
  } finally { stoppingTriggers = false; }
}

const mayReloadTriggers = reloadGate(10_000);
/**
 * Unlock without losing anything (see unlockWithKey). Tried at most every ten seconds unless the Founder asked for it.
 */
function reloadTriggerStore(force = false) {
  if (!mayReloadTriggers(force)) return false;
  const fresh = unlockWithKey({ read: readFileTriggerKey, createStore: newTriggerStore });
  if (!fresh) return false;
  fileTriggers = fresh; triggerDeps.store = fresh; triggerNeedsSetup = false;
  recoverTriggers();
  return true;
}

/** Start every enabled observer again from a verified configuration (what start-up and a confirmed stale file also do). */
function recoverTriggers() {
  triggersStoppedByIntegrity = false;
  try { fileTriggers.recoverInflight(); } catch (error) { triggerLog('recover', error); return; }
  for (const setting of fileTriggers.settings()) if (setting.enabled) startTrigger(setting.id, true);
  for (const group of groups.snapshot()) { triggerBroadcast(group.id); scheduleFileNotice(group.id); }
  scheduleRecovery();
}

/** Verification is repeated at paste/submit and immediately before every store mutation. */
function verifyTriggerIntegrity() {
  // A Keychain read that fails once does not lock the store, so a second look is a real retry; a locked store is replaced by a fresh one loaded from the disk and the anchor.
  if (fileTriggers.readable || fileTriggers.readable || reloadTriggerStore()) return true;
  if (triggerWatches.size || triggerReturns.size || triggerAttempts.size) stopAllTriggers();
  return false;
}

function watchTriggerConfig() {
  if (triggerConfigWatch || (!triggerWatches.size && !triggerReturns.size)) return;
  triggerConfigWatch = watchSignedTriggerConfig(triggerConfigPath, () => fileTriggers.readable || fileTriggers.readable || reloadTriggerStore(), () => {
    triggerConfigWatch = undefined;
    stopAllTriggers();
  });
}

function releaseTriggerConfigWatch() {
  if (!triggerWatches.size && !triggerReturns.size) { triggerConfigWatch?.close(); triggerConfigWatch = undefined; }
}
const triggerState = (groupId: string) => {
  const readable = fileTriggers.readable;
  const preview = readable ? undefined : fileTriggers.stalePreview();
  const integrity = readable || triggerNeedsSetup ? 'ok' as const : preview ? 'stale' as const : 'invalid' as const;
  return { type: 'FILE_TRIGGERS_STATE' as const, groupId, integrity,
  ...(preview ? { staleDigest: preview.sha, stalePaths: preview.settings.map(setting => setting.path), staleHint: preview.confirmationHint } : {}),
  confirmationHint: fileTriggers.readable ? fileTriggers.getHint() : '',
  items: fileTriggers.settings(groupId).map(item => ({ id: item.id, path: item.path, kind: item.kind, enabled: item.enabled,
    ...(item.enabled && item.offline ? { offlineToken: offlineToken(item.id) } : {}),
    status: !item.enabled ? 'disabled' as const : item.offline ? 'offline' as const : !groups.get(groupId)?.orchestratorRoomId ? 'waiting-leader' as const :
      triggerStates.get(item.id) ?? 'error' as const })) };
};
const triggerBroadcast = (groupId: string) => { if (features.fileTrigger) broadcast(triggerState(groupId)); };
const triggerDeps = {
  store: fileTriggers, groups: () => groups.snapshot(), rooms: () => rooms.snapshot(),
  verifyIntegrity: verifyTriggerIntegrity,
  state: (room: TerminalRoom) => {
    const state = rooms.roleRoutingState(room);
    const keys = room.sessionId ? [room.sessionId, room.id] : [room.id];
    const unread = keys.some(key => benchDeps.bench.mine(key).some(ticket => ticket.status === 'new'));
    return { ...state, working: state.working || unread };
  },
  validatePaths: (events: readonly import('./bridge/file-trigger-delivery').FileNoticeEvent[]) => {
    try { for (const event of events) {
      const setting = fileTriggers.settings().find(item => item.id === event.watchId && item.enabled);
      if (!setting || setting.offline || !triggerWatches.has(setting.id)) return false;
      validateTriggerPath(workspace, setting.path, setting.kind, setting.identity);
      if (event.kind === 'gap' ? event.path !== setting.path : setting.kind === 'file' ? event.path !== setting.path : dirname(event.path) !== setting.path) return false;
      if (setting.kind === 'directory' && event.kind !== 'gap') validateTriggerPath(workspace, event.path, 'file');
    } return true; } catch { return false; }
  },
  ptyGuard: (roomId: string) => rooms.ptyGuard(roomId),
  handle: (event: Extract<ClientEvent, { type: 'START' | 'INPUT' }>, reply: (event: ServerEvent) => void,
    options: { stillWanted?: () => boolean; authorizeBenchInput?: (phase: 'paste' | 'submit') => boolean }) => rooms.handle(event, reply, options),
  notice: (message: string) => broadcast({ type: 'NOTICE', message }),
};
function tryFileNotice(groupId: string) {
  if (triggerAttempts.has(groupId) || !verifyTriggerIntegrity() || !fileTriggers.hasPending(groupId)) return;
  triggerAttempts.add(groupId);
  void deliverFileNotice(triggerDeps, groupId).catch(() => broadcast({ type: 'NOTICE', message: '檔案觸發未能遞送；請檢查設定。' }))
    .finally(() => { triggerAttempts.delete(groupId); scheduleRecovery(); });
}
function scheduleFileNotice(groupId: string) {
  if (!features.fileTrigger || !verifyTriggerIntegrity() || !fileTriggers.hasPending(groupId)) return;
  tryFileNotice(groupId);
  // One bounded timer for the existing rate window, never a polling loop.
  const delay = fileTriggers.retryDelay(groupId);
  if (delay > 0 && !triggerTimers.has(groupId)) {
    const timer = setTimeout(() => { triggerTimers.delete(groupId); tryFileNotice(groupId); }, delay + 1);
    timer.unref(); triggerTimers.set(groupId, timer);
  }
}


/** An offline item remains enabled but cannot be restarted or delivered until confirmed. */
function markTriggerOffline(id: string) {
  const item = fileTriggers.settings().find(value => value.id === id);
  if (!item || !item.enabled) return;
  try {
    if (!item.offline) fileTriggers.setOffline(item.groupId, id, true);
    triggerOfflineTokens.set(id, randomUUID());
    triggerStates.set(id, 'offline');
  } catch { triggerStates.set(id, 'error'); if (!fileTriggers.readable) stopAllTriggers(); }
  triggerBroadcast(item.groupId);
}
function startTrigger(id: string, resumed = false, manualAuthorized = false): boolean {
  const item = fileTriggers.settings().find(value => value.id === id);
  if (!item || !item.enabled || !groups.get(item.groupId) || triggerWatches.has(id) || (item.offline && !manualAuthorized)) return false;
  try {
    validateTriggerPath(workspace, item.path, item.kind, item.identity);
    let changedDuringGap = false;
    const watcher = new FileTriggerWatch({ workspace, target: item.path, kind: item.kind, expectedIdentity: item.identity,
      baseline: fileTriggers.getWatchBaseline(item.groupId, id), manualResume: resumed,
      // Saving the watch state rewrites the Bridge's own settings file; a folder that holds it must not see that as a change.
      ignore: path => path === triggerConfigPath || path.startsWith(`${triggerConfigPath}.`),
      onGap: paths => {
        if (!paths.length) return; // Unknown baseline is a visible gap, not proof that a file changed.
        if (!verifyTriggerIntegrity()) throw new Error('Invalid trigger settings');
        fileTriggers.enqueue(item.groupId, { watchId: id, path: item.path, kind: 'gap', observedAt: new Date().toISOString() });
        changedDuringGap = true;
      },
      onBaseline: baseline => { try { if (!verifyTriggerIntegrity()) throw new Error(); fileTriggers.setWatchBaseline(item.groupId, id, baseline); }
        catch (error) { triggerLog('baseline', error); if (!fileTriggers.readable) stopAllTriggers(); triggerStates.set(id, 'error'); throw new Error('Unable to persist file baseline'); } },
      onEvent: event => { try { if (!verifyTriggerIntegrity()) throw new Error(); fileTriggers.enqueue(item.groupId, { watchId: id, path: event.path, kind: event.type, observedAt: event.observedAt });
        if (fileTriggers.overflow(item.groupId)) broadcast({ type: 'NOTICE', message: '檔案觸發積壓已達上限，請檢查。' });
        triggerBroadcast(item.groupId); scheduleFileNotice(item.groupId);
      } catch (error) { triggerLog('event', error); if (!fileTriggers.readable) stopAllTriggers(); triggerStates.set(id, 'error'); triggerBroadcast(item.groupId); throw new Error('Unable to persist file event'); } },
      onStatus: status => {
        if (status === 'gap' || status === 'error') {
          triggerWatches.delete(id); releaseTriggerConfigWatch();
          if (status === 'gap' && triggerStates.get(id) !== 'error') { markTriggerOffline(id); return; }
        }
        if (status === 'watching') triggerStates.set(id, resumed ? 'gap' : 'monitoring');
        else if (status === 'error') triggerStates.set(id, 'error');
        triggerBroadcast(item.groupId);
      },
    });
    triggerWatches.set(id, watcher); watcher.start();
    if (!triggerWatches.has(id)) return false;
    if (item.offline) fileTriggers.setOffline(item.groupId, id, false);
    triggerOfflineTokens.delete(id);
    watchTriggerConfig(); triggerBroadcast(item.groupId);
    if (changedDuringGap || fileTriggers.hasPending(item.groupId)) scheduleFileNotice(item.groupId);
    return true;
  } catch (error) {
    triggerLog('start', error);
    triggerWatches.get(id)?.close(); triggerWatches.delete(id); releaseTriggerConfigWatch();
    // A directory can disappear after the initial validation but before watch() starts.
    // It is offline, even if the native watcher reported a generic setup error.
    let pathUnavailable = false;
    try { validateTriggerPath(workspace, item.path, item.kind, item.identity); } catch { pathUnavailable = true; }
    if (fileTriggers.readable && (pathUnavailable || triggerStates.get(id) !== 'error')) {
      triggerStates.delete(id); markTriggerOffline(id);
    } else if (!fileTriggers.readable) stopAllTriggers();
    triggerBroadcast(item.groupId); return false;
  }
}

// Delivery holds and RSI scheduling
// Keep rooms open during delivery and dispatch eligible RSI review work.
rooms.hasDeliveryHold = room => benchDeps.bench.hasDeliveryHold(room.sessionId ? [room.sessionId, room.id] : [room.id]) ||
  (features.fileTrigger && fileNoticeHoldsRoom(groups.snapshot(), groupId => fileTriggers.hasHold(groupId), room.id));
rooms.onRecoveryChange = scheduleRecovery;
let tidyGroup: string | undefined;
let tidyScheduled = false;
function scheduleTidy() {
  if (!features.rsi || !tidyGroup || tidyScheduled) return;
  tidyScheduled = true;
  queueMicrotask(() => {
    tidyScheduled = false;
    try {
      const ticket = tidyGroup ? dispatchRsiTidy(benchDeps, tidyGroup) : undefined;
      const room = ticket?.fixed ? rooms.rooms.get(ticket.fixed.toRoomId) : undefined;
      // No agent sent this ticket, so nobody wakes the recipient: open a closed room, or wake an idle one now.
      if (room && !room.live) void rooms.handle({ type: 'START', roomId: room.id }, () => {}).catch(() => {});
      else if (room?.ready && room.status === 'idle') {
        const samePty = rooms.ptyGuard(room.id);
        const wake = idleWake(benchDeps, room);
        if (wake) runWake(room, wake, 'idle-wake', samePty);
      }
    }
    catch { console.warn('RSI Tidy dispatch failed; eligibility is retained for the next maintenance pass.'); }
  });
}
function benchRecoveryChanged() {
  scheduleRecovery();
  scheduleTidy();
  // Existing unread work holds a notice; retry once when the workbench changes.
  if (features.fileTrigger) for (const group of groups.snapshot()) if (fileTriggers.hasPending(group.id)) scheduleFileNotice(group.id);
}

// Group closeout and workbench maintenance
// Close idle group rooms, deliver completion notices and wake rooms with pending work.
groupCloser = new GroupCloser({
  groups: () => groups.snapshot(),
  busy: roomId => presence.hasViewers(roomId) || rooms.isWorking(roomId) || rooms.deliveryPending(roomId),
  isOpen: roomId => rooms.isOpen(roomId),
  report: group => group.orchestratorRoomId ? rooms.currentReport(group.orchestratorRoomId) : undefined,
  close: roomId => { if (!presence.hasViewers(roomId)) rooms.closeUnviewed(roomId, 'group-idle'); },
});

// A wake-up message typed into a member's CLI, the same way for an idle wake, a re-delivery and a reminder.
function runWake(room: TerminalRoom, wake: { text: string; authorizeBenchInput: (phase: 'paste' | 'submit') => boolean; finish: (ok: boolean) => void },
  label: 'idle-wake' | 'unread-retry' | 'stall-nudge', samePty: () => boolean) {
  const trace = beginInputTrace(inputLogPath, room, wake.text, label);
  const started = Date.now();
  void rooms.handle({ type: 'INPUT', roomId: room.id, text: wake.text, requestId: trace.requestId }, result => {
    if (result.type !== 'ACTION_RESULT') return;
    wake.finish(result.ok);
    trace.waited(null, Date.now() - started);
    trace.finish(result.ok ? undefined : `${label}-rejected`);
  }, { inputTraceId: trace.requestId, authorizeBenchInput: phase => samePty() && wake.authorizeBenchInput(phase) }).catch(() => {
    wake.finish(false);
    trace.waited(null, Date.now() - started);
    trace.finish(`${label}-error`);
  });
}

// A room made the lead while it is running still holds its old instructions (a single room is told not to dispatch).
// Tell it once, lightly, as soon as it is at its prompt; the message carries the roster and the dispatch command.
const crownNotices = new Map<string, string>();
function deliverCrownNotice(roomId: string) {
  const groupId = crownNotices.get(roomId);
  const group = groupId ? groups.get(groupId) : undefined;
  const room = rooms.rooms.get(roomId);
  if (!groupId || !group || group.orchestratorRoomId !== roomId || !room?.live) { crownNotices.delete(roomId); return; }
  if (!room.ready || room.status !== 'idle' || room.pendingApproval || room.pendingQuestion || room.menu) return;
  crownNotices.delete(roomId);
  const text = `[交接｜來自 Bridge] 你而家係「${group.name}」嘅總指揮 ♛（隊長）。一般或冇寫等級嘅任務讀 lead-standard，都可以派單。名單同派單方法已附在下面；Founder 冇指示就唔使回覆，之後有需要先派單。`;
  void rooms.handle({ type: 'INPUT', roomId, text }, () => {}, { reserveRoster: () => groups.reserveRoster(groupId, roomId) }).catch(() => {});
}

// A task from a persona ends with the lead's report naming an Inbox folder: the Bridge sends the clerk the "please notify" ticket itself.
const handledReports = features.persona ? new HandledReports(join(workspace, '.komorebi-persona-notices.json')) : undefined;
const personaSince = Date.now();
function notifyPersonas() {
  if (!handledReports) return;
  try {
    sendPersonaNotices({
      inboxRoot: join(workspace, 'Inbox'), since: personaSince, groups: () => groups.snapshot(), room: roomId => rooms.rooms.get(roomId), handled: handledReports,
      tickets: groupId => benchDeps.bench.tasks(groupId),
      beforeNotice: () => { if (features.inbox) void refreshInboxAlerts(); },
      send: (group, lead, ticket) => {
        const result = sendFromBridge(benchDeps, { requestId: 'persona-notice', action: 'send', from: lead.sessionId ?? lead.id, to: '@clerk', groupId: group.id, title: ticket.title, body: ticket.body }, true);
        return result.ok ? { sent: true, roomId: result.wake?.roomId } : { sent: false, why: result.lines.join(' ') || '派單失敗' };
      },
      tell: (lead, text) => { rooms.note(lead.id, text); benchDeps.notice(text); },
    }).forEach(({ roomId }) => {
      const clerk = roomId ? rooms.rooms.get(roomId) : undefined;
      if (!clerk) return;
      // No agent sent this ticket, so nobody wakes the clerk: open a closed room, or wake an idle one.
      if (!clerk.live) void rooms.handle({ type: 'START', roomId: clerk.id }, () => {}).catch(() => {});
      else if (clerk.ready && clerk.status === 'idle') {
        const samePty = rooms.ptyGuard(clerk.id);
        const wake = idleWake(benchDeps, clerk);
        if (wake) runWake(clerk, wake, 'idle-wake', samePty);
      }
    });
  } catch { /* A failed look must not stop the Bridge; the next pass tries again. */ }
}

// Inventory runs asynchronously and never waits in the clerk's delivery path.
if (features.inbox) {
  void refreshInboxAlerts();
  setInterval(() => { void refreshInboxAlerts(); }, 60_000).unref();
}

// The crown's final report says DONE: the tickets it sent that are still open are called off (each report is looked at once).
const finalReports = new Map<string, string>();
function cancelOnFinalReport() {
  for (const group of groups.snapshot()) {
    const lead = group.orchestratorRoomId ? rooms.rooms.get(group.orchestratorRoomId) : undefined;
    const report = lead ? rooms.currentReport(lead.id) : undefined;
    if (!lead || !report || finalReports.get(group.id) === report) continue;
    finalReports.set(group.id, report);
    const text = lead.logs.find(entry => entry.id === report)?.text ?? '';
    if (!reportIsDone(text)) continue;
    const notice = personaReport(text, join(workspace, 'Inbox'));
    const manual = notice && manualPersonaNotice(notice, group, benchDeps.bench.tasks(group.id), id => rooms.rooms.get(id));
    try { cancelLeadTickets(benchDeps, group.id, lead, manual ? [manual.id] : []); } catch { /* The next report tries again; the three-hour close stays the backstop. */ }
  }
}

// A member that finishes with tickets still unread is woken (a moment later, if it is still at its prompt).
rooms.onIdle = idle => {
  scheduleRecovery();
  if (crownNotices.has(idle.id)) setTimeout(() => deliverCrownNotice(idle.id), 2_000).unref();
  notifyPersonas();
  setTimeout(notifyPersonas, reportWaitMs).unref();
  // The report reaches the conversation record a moment after the prompt comes back.
  if (groupCloser?.isCrown(idle.id)) setTimeout(cancelOnFinalReport, reportWaitMs).unref();
  for (const group of groups.snapshot()) if (group.orchestratorRoomId === idle.id) scheduleFileNotice(group.id);
  const samePty = rooms.ptyGuard(idle.id);
  setTimeout(() => {
    const room = rooms.rooms.get(idle.id);
    const wake = samePty() && room?.ready ? idleWake(benchDeps, room) : undefined;
    if (!room || !wake) return;
    runWake(room, wake, 'idle-wake', samePty);
  }, 2_500).unref();
};

// Tickets that nobody answers: a member that stays idle gets an unread ticket again, or a reminder for a task it has read but not finished.
// Retries and reminders need an idle prompt. The same pass can start a closed room with unread work.
const idleSince = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  escalateUnread(benchDeps);
  scheduleTidy();
  notifyPersonas();
  cancelOnFinalReport();
  // A failed Keychain or configuration check stops every observer. When the check passes again they start again by themselves,
  // except the ones that are truly offline, which still need the Founder's confirmed resume.
  if (features.fileTrigger && triggersStoppedByIntegrity) { try { if (fileTriggers.readable) recoverTriggers(); else reloadTriggerStore(); } catch (error) { triggerLog('self-heal', error); } }
  for (const room of rooms.rooms.values()) {
    // A closed recipient with tickets nobody has read is started; once it is at its prompt the usual wake-up delivers them.
    if (!room.live && startClosedRecipient(benchDeps, room)) void rooms.handle({ type: 'START', roomId: room.id }, () => {}).catch(() => {});
    if (!(room.live && room.ready && room.status === 'idle')) { idleSince.delete(room.id); continue; }
    const idleFor = now - (idleSince.get(room.id) ?? (idleSince.set(room.id, now), now));
    escalateStalled(benchDeps, room, idleFor);
    const unread = retryUnreadWake(benchDeps, room);
    const wake = unread ?? stalledWake(benchDeps, room, idleFor);
    if (wake) runWake(room, wake, unread ? 'unread-retry' : 'stall-nudge', rooms.ptyGuard(room.id));
  }
}, 60_000).unref();

function retainGroupRooms() {
  rooms.retainGroupRooms(groups.snapshot().flatMap(group => group.members.map(member => member.roomId)));
}

function syncGroupWatches() {
  rooms.watchGroupRooms([...roomViews.values(), ...(groupViews?.watchedRooms() ?? [])]);
}

retainGroupRooms();

// HTTP and WebSocket admission
// Check the request scope, pair remote clients and send the initial Bridge state.
const http = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: maxUploadFrameBytes, perMessageDeflate: false });
const remoteClients = new Set<WebSocket>();
const connections = new Map<WebSocket, boolean>();

app.use((req, res, next) => {
  if (!access(req)) {
    res.status(403).send('Komorebi is available on localhost and the Mac’s Tailscale address.');
    return;
  }
  res.set({
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
});

app.use('/media', (req, res) => {
  void media.serve(req, res, access(req), req.originalUrl);
});

http.on('upgrade', (req, socket, head) => {
  const scope = access(req);
  const sameOrigin = originAllowed(scope, req.headers.origin, req.headers.host);
  const viteSocket = config.ui === 'dev' && req.url?.startsWith('/_vite?') && req.headers['sec-websocket-protocol'] === 'vite-hmr';
  if (viteSocket) {
    if (!sameOrigin) socket.destroy();
    return;
  }
  if (req.url !== '/ws' || !sameOrigin || connections.size >= 24) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    let authenticated = false;
    let timer: NodeJS.Timeout | undefined;
    const auth = () => {
      authenticated = true;
      clearTimeout(timer);
      clients.add(ws);
      presence.register(ws);
      send(ws, { type: 'SNAPSHOT', readMarksSupported: true, autoCompactSupported: true, autoCompactAll: rooms.autoCompactAll(), restartSupported, restartInstanceId, rooms: rooms.snapshot(), characters: rooms.characters, tailscaleUrl: tailscaleUrl(), archivedKeys: rooms.archiveSnapshot(), pinSupported: true, pinnedKeys: rooms.pinSnapshot(), protectedKeys: rooms.protectedSnapshot(), renameSupported: true, deleteArchivedSupported: true, idleCloseSupported: true, workspaceRoot: workspace, defaultFolder: folderSetting.get(), fixedRoomDirectorySupported: true, agyAutoSupported: true, roomLaunchOptionsSupported: true, roomPresenceSupported: true, roomDraftsSupported: true, roomViewStartSupported: true, attachmentSupported: true, fileUploadSupported: true, terminalKeySupported: true, questionAnswerSupported: true, imagePreviewSupported: true, videoSupported: true, worktreeSupported: true, historyPagingSupported: true, launchModesSupported: true, launchModes: rooms.launchModes(), transcribeSupported: transcribeReady, pushPublicKey: push.publicKey, groups: groups.visibleSnapshot(), ...(features.board ? { groupBoardSupported: true as const } : {}), ...(features.inbox ? { inboxSupported: true as const } : {}), groupMemberRolesSupported: true, roleDirectionSupported: true, ...(features.fileTrigger ? { fileTriggersSupported: true as const } : {}), roleRoutingSupported: true, ...(groups.rolesNeedRepair ? { groupMemberRolesNeedRepair: true } : {}), successors: successors.snapshot() });
      send(ws, { type: 'READ_MARKS', marks: readMarks.all() });
      if (inboxAlerts) send(ws, { type: 'INBOX_ALERTS', data: inboxAlerts });
    };
    connections.set(ws, true);
    devices.set(ws, { visible: true });
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => connections.set(ws, true));
    ws.on('close', () => {
      groupViews.leave(ws);
      roomViews.delete(ws);
      syncGroupWatches();
      presence.disconnect(ws);
      devices.delete(ws);
      clearTimeout(timer);
      connections.delete(ws);
      clients.delete(ws);
      remoteClients.delete(ws);
    });
    if (scope === 'local') auth();
    else {
      remoteClients.add(ws);
      send(ws, { type: 'AUTH_REQUIRED' });
      timer = setTimeout(() => ws.close(1008), 120_000);
    }

    let requests = 0;
    let windowStart = Date.now();
    ws.on('message', async (data, binary) => {
      if (Date.now() - windowStart > 10_000) {
        requests = 0;
        windowStart = Date.now();
      }
      if (binary || ++requests > 45) { ws.close(1008); return; }
      // Large attachment messages require authentication. Before pairing, the client only needs to send the key.
      if (!authenticated && (data as Buffer).length > 4096) { ws.close(1008); return; }
      let requestId: string | undefined;
      try {
        const event: ClientEvent = JSON.parse(data.toString());
        if (!authenticated) {
          const key = event?.type === 'AUTH' && typeof event.key === 'string' ? Buffer.from(event.key) : Buffer.alloc(0);
          if (key.length === pairingKey.length && timingSafeEqual(key, pairingKey)) auth();
          else { send(ws, { type: 'ERROR', message: '配對碼不正確。請核對 Mac Terminal。' }); ws.close(1008); }
          return;
        }
        // WebSocket services and views
        // Handle service requests and update the current room or group view after pairing.
        if (event?.type === 'BRIDGE_RESTART') {
          const result = await restartController.requestRestart(scope as 'local' | 'tailnet' | 'serve');
          send(ws, { type: 'BRIDGE_RESTART_RESULT', ...result });
          return;
        }
        if (event?.type === 'STORAGE_USAGE') {
          if (!Number.isInteger(event.days) || event.days < 1 || event.days > 3650) throw new Error('閒置日數必須介乎 1 至 3650 日。');
          const roots = { ...rooms.sessionRootDirs, CODEX: [...rooms.sessionRootDirs.CODEX, join(rooms.sessionHome, '.codex/archived_sessions')] };
          storageScan ??= inventoryTranscripts(roots).finally(() => { storageScan = undefined; });
          const inventory = await storageScan;
          const groupList = groups.snapshot();
          const claims = benchDeps.bench.activeClaims();
          const groupKeys = new Set(groupList.flatMap(group => [group.orchestratorRoomId, ...group.members.map(member => member.roomId)].filter(Boolean)));
          const snapshot = rooms.snapshot();
          const groupSessions = new Set(snapshot.filter(room => groupKeys.has(room.id) && room.sessionId).map(room => `${room.modelId}:${room.sessionId}`));
          const busy = (room: TerminalRoom) => rooms.isRunningOrStarting(room) || groupKeys.has(room.id) || rooms.isGroupMember(room.id) || groupSessions.has(`${room.modelId}:${room.sessionId}`) ||
            Boolean(rooms.hasOpenTickets?.(room)) || claims.some(claim => claim.by.sessionId === room.sessionId || claim.by.sessionId === room.id);
          // If a group room's identity is missing, it might be an alias for any native session.
          const missingGroupIdentity = [...groupKeys].some(key => !snapshot.some(room => room.id === key && room.sessionId));
          const incomplete = inventory.incomplete || !rooms.protectionReadable() || !rooms.pinsReadable() || !rooms.storageIdentitiesReadable() || !groups.isReadable() || missingGroupIdentity || Boolean(benchDeps.bench.problem());
          const runningDirs = rooms.runningDirectories();
          const inside = (root: string, path: string) => { const part = relative(root, path); return !part || (!part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part)); };
          const worktrees = await inspectWorktrees(bridgeWorktrees.snapshot(), entry => {
            const ticket = benchDeps.bench.get(entry.ticketId);
            const recipient = ticket && snapshot.find(room => room.id === ticket.fixed?.toRoomId || room.id === ticket.to.sessionId || room.sessionId === ticket.to.sessionId);
            const finished = Boolean(ticket && ticket.status === 'done' && (!ticket.expiredAt || ticket.cancelledAt));
            const at = ticket?.cancelledAt ?? ticket?.doneAt;
            return { finished, oldEnough: Boolean(at && Date.now() - Date.parse(at) >= 3 * 86_400_000),
              running: runningDirs.some(dir => isAbsolute(dir) && inside(entry.path, dir)),
              protected: Boolean(recipient && rooms.isProtected(recipient)) || snapshot.some(room => isAbsolute(room.repoPath) && inside(entry.path, room.repoPath) && rooms.isProtected(room)),
              verified: !incomplete && bridgeWorktrees.isReadable() && Boolean(recipient) && runningDirs.every(isAbsolute) };
          });
          send(ws, { type: 'STORAGE_USAGE', data: { ...makeStorageUsage(inventory.files, roots, snapshot, rooms.sessionHome, rooms.protectedSnapshot(), rooms.pinSnapshot(), busy, event.days, incomplete), worktrees, worktreeError: !bridgeWorktrees.isReadable() } });
          return;
        }
        if (event?.type === 'TRANSCRIBE') {
          const id = typeof event.requestId === 'string' && event.requestId.length <= 64 ? event.requestId : undefined;
          if (!id) throw new Error('無效請求。');
          try {
            const text = await transcribeAudio({ mime: event.mime, data: event.data, language: event.language, style: event.style });
            send(ws, { type: 'TRANSCRIBE_RESULT', requestId: id, ok: true, text });
          } catch (error) {
            send(ws, { type: 'TRANSCRIBE_RESULT', requestId: id, ok: false, message: error instanceof TranscribeError ? error.message : '轉文字失敗，請再試。' });
          }
          return;
        }
        if (event?.type === 'BENCH_WAKE') {
          if (typeof event.requestId === 'string' && event.requestId.length <= 64) requestId = event.requestId;
          await runFixedBenchWake(benchDeps, scope, event, rooms.handle.bind(rooms),
            reply => send(ws, reply), () => ws.readyState === WebSocket.OPEN);
          return;
        }
        if (event?.type === 'BENCH') {
          // Workbench requests come from the agents on this Mac, never from a phone.
          if (scope !== 'local' || typeof event.requestId !== 'string' || event.requestId.length > 64 || typeof event.action !== 'string') throw new Error('工作台只供本機 agent 使用。');
          send(ws, await benchRequest(benchDeps, event));
          return;
        }
        if (event?.type === 'HANDOFF_REPORT' || event?.type === 'HANDOFF_LOG') {
          if (scope !== 'local') throw new Error('交接記錄只供本機 agent 使用。');
          if (event.type === 'HANDOFF_REPORT') handoffLog.add(event);
          else if (typeof event.requestId === 'string' && event.requestId.length <= 64) send(ws, { type: 'HANDOFF_LOG_RESULT', requestId: event.requestId, entries: handoffLog.recent(event.last, event.failedOnly === true) });
          return;
        }
        if (event?.type === 'PUSH_SUBSCRIBE') {
          const subscription = validSubscription(event.subscription);
          if (!subscription) throw new Error('通知訂閱無效，請關閉再重新開啟通知。');
          push.add(subscription);
          devices.set(ws, { endpoint: subscription.endpoint, visible: event.visible !== false });
          send(ws, { type: 'PUSH_RESULT', ok: true, enabled: true, message: '已開啟鎖屏推送。' });
          return;
        }
        if (event?.type === 'PUSH_UNSUBSCRIBE') {
          const endpoint = devices.get(ws)?.endpoint;
          if (endpoint) push.remove(endpoint);
          devices.set(ws, { visible: devices.get(ws)?.visible ?? true });
          send(ws, { type: 'PUSH_RESULT', ok: true, enabled: false, message: '已關閉鎖屏推送。' });
          return;
        }
        if (event?.type === 'PUSH_VISIBLE') {
          devices.set(ws, { ...devices.get(ws), visible: event.visible === true });
          return;
        }
        if (event?.type === 'PUSH_TEST') {
          const endpoint = devices.get(ws)?.endpoint;
          send(ws, { type: 'PUSH_RESULT', ...(endpoint ? await pushNotifier.sendTest(endpoint) : { ok: false, message: '這部裝置未開啟通知。' }) });
          return;
        }
        if (event?.type === 'DRAFT_ROOMS') {
          if (!Array.isArray(event.roomIds) || event.roomIds.length > rooms.rooms.size ||
              event.roomIds.some(id => typeof id !== 'string' || !rooms.rooms.has(id))) throw new Error('草稿房間無效。');
          presence.draftMany(ws, event.roomIds);
          return;
        }
        if (event?.type === 'VIEW_ROOM') {
          if (event.roomId !== null && (typeof event.roomId !== 'string' || !rooms.rooms.has(event.roomId))) throw new Error('找不到這間房。');
          groupViews.leave(ws);
          if (event.roomId) roomViews.set(ws, event.roomId);
          else roomViews.delete(ws);
          syncGroupWatches();
          presence.view(ws, event.roomId);
          if (event.roomId) {
            const roomId = event.roomId;
            const stillViewed = () => presence.hasViewers(roomId);
            const opening = event.open === true ? rooms.openViewedRoom(roomId, stillViewed) : rooms.reopenIfClosing(roomId, stillViewed);
            void opening.catch(error => {
              send(ws, { type: 'ERROR', message: error instanceof Error ? error.message : '未能續接房間。' });
            });
          }
          return;
        }
        if (event?.type === 'VIEW_GROUP') {
          const group = typeof event.groupId === 'string' ? groups.get(event.groupId) : undefined;
          if (!group) throw new Error('找不到這個群組。');
          const roomId = typeof event.selectedRoomId === 'string' ? event.selectedRoomId : undefined;
          if (event.wakeSelected === true) {
            if (!roomId) return;
            const stillSelected = groupViews.selectMember(ws, group, roomId);
            if (!stillSelected) return;
            const alreadyOpening = groupViews.isOpening(roomId);
            const block = rooms.groupMemberWakeBlock(roomId) ?? (alreadyOpening ? 'starting' : undefined);
            if (block) {
              // An already-open CLI needs no action, so it gets no notice.
              if (block !== 'open') send(ws, { type: 'NOTICE', message: groupWakeNotice[block] });
              if (block !== 'starting' || !alreadyOpening) return;
            }
            const sessionId = rooms.rooms.get(roomId)?.sessionId;
            void groupViews.retry(roomId, () => stillSelected() && rooms.canWakeGroupMember(roomId, sessionId, true));
          } else {
            void groupViews.view(ws, group, roomId);
          }
          return;
        }
        // WebSocket groups, rooms and panels
        // Route group and room changes, along with requests from their supporting panels.
        if (event?.type === 'GROUP_CREATE') {
          const existingIds = event.existingRoomIds ?? [];
          if (typeof event.name !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} _.()\-]{0,79}$/u.test(event.name.trim())) {
            throw new Error('群組名稱無效：只可使用文字、數字、空格，以及 _ . ( ) -，並以文字或數字開頭。');
          }
          if (!Array.isArray(event.modelIds) || !Array.isArray(existingIds) || event.modelIds.length + existingIds.length < 2 ||
              event.modelIds.length + existingIds.length > 8 || new Set(existingIds).size !== existingIds.length ||
              existingIds.some(id => typeof id !== 'string' || !rooms.rooms.has(id) || !rooms.canJoinExistingGroup(rooms.rooms.get(id)!)) ||
              event.modelIds.some(model => !['AGY', 'CODEX', 'CLAUDE'].includes(model))) {
            throw new Error('請選擇兩至八位成員；現有房間需已確認 Session ID 並可續接。');
          }
          const existingSessions = existingIds.map(id => { const room = rooms.rooms.get(id)!; return `${room.modelId}:${room.sessionId!.toLowerCase()}`; });
          if (new Set(existingSessions).size !== existingSessions.length) throw new Error('同一個 CLI 工作階段不可以重複加入群組。');
          const members = existingIds.map(roomId => ({ modelId: rooms.rooms.get(roomId)!.modelId, roomId }));
          for (const modelId of event.modelIds) {
            const ordinal = members.filter(member => member.modelId === modelId).length + 1;
            const room = await rooms.ensureGroupMember(modelId, `${event.name.trim()} #${ordinal}`);
            members.push({ modelId, roomId: room.id });
          }
          const group = groups.create(event.name, members);
          void groupViews.view(ws, group);
          send(ws, { type: 'GROUP', group, select: true });
          return;
        }
        if (event?.type === 'GROUP_ADD') {
          const group = typeof event.groupId === 'string' ? groups.get(event.groupId) : undefined;
          if (!group || !['AGY', 'CODEX', 'CLAUDE'].includes(event.modelId) || group.members.length >= 8) throw new Error('群組或成員無效。');
          const ordinal = group.members.filter(member => member.modelId === event.modelId).length + 1;
          const room = await rooms.ensureGroupMember(event.modelId, `${group.name} #${ordinal}`);
          groups.addMember(group.id, { modelId: event.modelId, roomId: room.id });
          return;
        }
        if (event?.type === 'GROUP_ADD_EXISTING') {
          const group = groups.get(event.groupId);
          const room = rooms.rooms.get(event.roomId);
          if (!group || !room || !rooms.canJoinExistingGroup(room) || group.members.length >= 8 || group.members.some(member => member.roomId === room.id)) throw new Error('房間需有已確認及可續接的 Session ID，而且未加入這個群組。');
          if (group.members.some(member => {
            const current = rooms.rooms.get(member.roomId);
            return current?.modelId === room.modelId && current.sessionId?.toLowerCase() === room.sessionId?.toLowerCase();
          })) throw new Error('這個 CLI 工作階段已經在群組內。');
          groups.addMember(group.id, { modelId: room.modelId, roomId: room.id });
          return;
        }
        if (event?.type === 'GROUP_SET_MEMBER_ROLE') {
          const requestId = typeof event.requestId === 'string' && event.requestId.length <= 64 ? event.requestId : undefined;
          try {
            groups.setMemberRole(event.groupId, event.roomId, event.role);
            if (requestId) send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: true });
          } catch (error) {
            if (!requestId) throw error;
            send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: false,
              code: error instanceof GroupMemberRoleError ? error.code : 'failed' });
          }
          return;
        }
        if (event?.type === 'GROUP_SET_MEMBER_DIRECTION') {
          const requestId = typeof event.requestId === 'string' && event.requestId.length <= 64 ? event.requestId : undefined;
          try {
            groups.setMemberDirection(event.groupId, event.roomId, event.direction, event.expectedRoleKey);
            if (requestId) send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: true });
          } catch (error) {
            if (!requestId) throw error;
            send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: false,
              code: error instanceof GroupMemberRoleError ? error.code : 'failed' });
          }
          return;
        }
        if (event?.type === 'GROUP_SET_ORCHESTRATOR_DIRECTION') {
          const requestId = typeof event.requestId === 'string' && event.requestId.length <= 64 ? event.requestId : undefined;
          try {
            groups.setOrchestratorDirection(event.groupId, event.direction);
            if (requestId) send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: true });
          } catch (error) {
            if (!requestId) throw error;
            send(ws, { type: 'GROUP_MEMBER_ROLE_RESULT', requestId, ok: false,
              code: error instanceof GroupMemberRoleError ? error.code : 'failed' });
          }
          return;
        }
        if (event?.type === 'GROUP_SET_ORCHESTRATOR') {
          if (typeof event.groupId !== 'string' || (event.roomId !== null && typeof event.roomId !== 'string')) throw new Error('群組或房間無效。');
          if (event.roomId === null) {
            const { group, previous } = groups.clearOrchestrator(event.groupId);
            const was = previous ? rooms.rooms.get(previous) : undefined;
            broadcast({ type: 'NOTICE', message: `「${group.name}」${was ? `已取消「${was.roomName}」的總指揮` : '沒有總指揮'}。` });
            return;
          }
          const room = rooms.rooms.get(event.roomId);
          const wasLead = groups.get(event.groupId)?.orchestratorRoomId === event.roomId;
          const { group, previous } = groups.setOrchestrator(event.groupId, event.roomId);
          if (room) {
            // The new lead is in charge itself again, so nobody takes over for it now.
            successors.set(roomKey(room), null);
            if (room.live && !wasLead) { crownNotices.set(room.id, group.id); setTimeout(() => deliverCrownNotice(room.id), 500).unref(); }
            const old = previous ? rooms.rooms.get(previous) : undefined;
            // A lead that is closed and replaced has been moved from: what is sent to it goes to the new lead.
            if (old && !old.live && roomKey(old) !== roomKey(room)) {
              successors.set(roomKey(old), roomKey(room));
              rooms.note(old.id, `已由「${room.roomName}」接手總指揮，之後送來這裡的訊息會轉去新房。`);
            }
            broadcast({ type: 'SUCCESSORS', successors: successors.snapshot() });
            broadcast({ type: 'NOTICE', message: `「${group.name}」的總指揮已設為「${room.roomName}」。` });
          }
          return;
        }
        if (event?.type === 'SET_SUCCESSOR') {
          const room = typeof event.roomId === 'string' ? rooms.rooms.get(event.roomId) : undefined;
          const heir = typeof event.successorRoomId === 'string' ? rooms.rooms.get(event.successorRoomId) : undefined;
          if (!room || (event.successorRoomId !== null && !heir)) throw new Error('找不到房間。');
          successors.set(roomKey(room), heir ? roomKey(heir) : null);
          rooms.note(room.id, heir ? `已由「${heir.roomName}」接手，之後送來這裡的訊息會轉去新房。` : '已取消接手，訊息照舊送這間房。');
          broadcast({ type: 'SUCCESSORS', successors: successors.snapshot() });
          return;
        }
        if (event?.type === 'GROUP_REMOVE_MEMBER') {
          groups.removeMember(event.groupId, event.roomId);
          return;
        }
        if (event?.type === 'SET_DEFAULT_FOLDER') {
          const path = await folderSetting.set(event.path);
          broadcast({ type: 'DEFAULT_FOLDER', path });
          broadcast({ type: 'NOTICE', message: `預設工作資料夾已改為 ${path}。新房由此開始，舊房不變。` });
          return;
        }
        if (event?.type === 'MOVE_ROOM') {
          const reqId = typeof event.requestId === 'string' ? event.requestId.slice(0, 64) : undefined;
          const target = typeof event.roomId === 'string' ? rooms.rooms.get(event.roomId) : undefined;
          if (!target) {
            const message = '找不到這間房。';
            send(ws, { type: 'MOVE_ROOM_RESULT', requestId: reqId, ok: false, message });
            send(ws, { type: 'ERROR', message });
            return;
          }
          if (rooms.isProtected(target)) {
            const message = '受保護的房間不可搬移，請先取消保護。';
            send(ws, { type: 'MOVE_ROOM_RESULT', requestId: reqId, ok: false, roomId: target.id, message });
            return;
          }
          if (replacing.has(target.id)) {
            const message = '這間房正在換房中，請稍候。';
            send(ws, { type: 'MOVE_ROOM_RESULT', requestId: reqId, ok: false, message });
            send(ws, { type: 'ERROR', message });
            return;
          }
          replacing.add(target.id);
          try {
            const moved = await moveClaudeRoom({
              workspace,
              rooms: {
                isBusy: room => rooms.isWorking(room.id) || Boolean(room.pendingApproval || room.pendingQuestion || room.menu || (room.live && (!room.ready || room.status !== 'idle'))),
                fork: (old, folder) => rooms.forkRoom(old, folder),
                close: old => rooms.closeRoomAndWait(old.id),
                reopen: async old => { await rooms.handle({ type: 'START', roomId: old.id } as ClientEvent, () => {}); },
                archive: async old => { await rooms.handle({ type: 'ARCHIVE', roomId: old.id, archived: true } as ClientEvent, () => {}); },
                find: id => rooms.rooms.get(id),
                greet: (fresh, prompt) => sendFirstRoomInput(fresh, prompt ?? 'hi'),
              },
              groups,
              bench: benchDeps.bench,
              successors,
              note: (roomId, text) => rooms.note(roomId, text),
            }, target, { folder: event.folder, copyMemory: event.copyMemory === true });
            retainGroupRooms();
            for (const [client, viewedId] of roomViews) {
              if (viewedId === target.id) {
                roomViews.set(client, moved.room.id);
                presence.view(client, moved.room.id);
              }
            }
            syncGroupWatches();
            broadcast({ type: 'SUCCESSORS', successors: successors.snapshot() });
            const message = `已將「${moved.room.roomName}」分叉至新工作資料夾：${moved.folder}（舊房已封存）。`;
            send(ws, { type: 'MOVE_ROOM_RESULT', requestId: reqId, ok: true, roomId: target.id, newRoomId: moved.room.id, message });
            broadcast({ type: 'NOTICE', message });
          } catch (error) {
            const message = error instanceof Error ? error.message : '更改工作資料夾失敗。';
            send(ws, { type: 'MOVE_ROOM_RESULT', requestId: reqId, ok: false, roomId: target.id, message });
            send(ws, { type: 'ERROR', message });
          } finally {
            replacing.delete(target.id);
          }
          return;
        }
        if (event?.type === 'DRIVE') {
          const requestId = typeof event.requestId === 'string' ? event.requestId.slice(0, 64) : '';
          try { send(ws, { type: 'DRIVE_RESULT', requestId, ok: true, data: await drive.call(String(event.op), event.params) }); }
          catch (error) { send(ws, { type: 'DRIVE_RESULT', requestId, ok: false, message: error instanceof Error ? error.message : 'Drive 請求失敗。' }); }
          return;
        }
        if (event?.type === 'WORKTREE') {
          const requestId = typeof event.requestId === 'string' ? event.requestId.slice(0, 64) : '';
          try {
            const params = event.params;
            const room = typeof params?.roomId === 'string' ? rooms.rooms.get(params.roomId) : undefined;
            if (!room?.repoPath) throw new Error('找不到這間房的資料夾。');
            const remembered = event.op === 'worktrees' ? benchDeps.bench.lastWorktree(room.id) : undefined;
            const tickets = event.op === 'worktrees' && !params.query ? benchDeps.bench.worktreeTickets(room, groups.snapshot()) : undefined;
            const data = await worktreeCall(room.repoPath, String(event.op), params, room.gitBranch, remembered, tickets);
            send(ws, { type: 'WORKTREE_RESULT', requestId, ok: true, data });
          } catch (error) { send(ws, { type: 'WORKTREE_RESULT', requestId, ok: false, message: error instanceof Error ? error.message : '讀不到這間房的資料夾。' }); }
          return;
        }
        if (event?.type === 'INBOX') {
          const requestId = typeof event.requestId === 'string' ? event.requestId.slice(0, 64) : '';
          try {
            if (!features.inbox) throw new Error('Inbox is disabled.');
            if (event.op === 'alerts') {
              await refreshInboxAlerts();
              send(ws, { type: 'INBOX_RESULT', requestId, ok: true, data: inboxAlerts });
              return;
            }
            if (event.op !== 'list') throw new Error('Inbox 只可以瀏覽。');
            send(ws, { type: 'INBOX_RESULT', requestId, ok: true, data: await listInbox(join(workspace, 'Inbox'), (event.params as { path?: unknown } | undefined)?.path) });
          } catch (error) { send(ws, { type: 'INBOX_RESULT', requestId, ok: false, message: error instanceof Error ? error.message : 'Inbox 讀不到。' }); }
          return;
        }
        if (event?.type === 'GH') {
          const requestId = typeof event.requestId === 'string' ? event.requestId.slice(0, 64) : '';
          try { send(ws, { type: 'GH_RESULT', requestId, ok: true, data: await github.call(String(event.op), event.params) }); }
          catch (error) { send(ws, { type: 'GH_RESULT', requestId, ok: false, message: error instanceof Error ? error.message : 'GitHub 請求失敗。' }); }
          return;
        }
        if (event?.type === 'READ_FILE') {
          // The phone's reader: text files under the workspace or Documents only (see bridge/file-reader.ts).
          const path = typeof event.path === 'string' ? event.path : '';
          try { send(ws, { type: 'FILE', ...(await readTextFile(path, [workspace, join(homedir(), 'Documents')])) }); }
          catch (error) { send(ws, { type: 'FILE', path, error: error instanceof Error ? error.message : '讀不到這個檔案。' }); }
          return;
        }
        if (event?.type === 'MEDIA_LINK') {
          const path = typeof event.path === 'string' ? event.path : '';
          try { send(ws, { type: 'MEDIA_LINK_RESULT', path, ...(await media.issue(path, req.headers.origin!)) }); }
          catch (error) {
            const message = error instanceof Error && !('code' in error) ? error.message : '無法開啟這段影片。';
            send(ws, { type: 'MEDIA_LINK_RESULT', path, error: message });
          }
          return;
        }
        if (event?.type === 'REVEAL_FILE') {
          // Show the file in Finder on this Mac. The same checks as the reader apply.
          const kind = typeof event.path === 'string' && mediaContentType(event.path) ? 'media' : 'text';
          const real = await resolveReadable(event.path, [workspace, join(homedir(), 'Documents')], kind);
          await new Promise<void>((done, fail) => execFile('open', ['-R', real], { timeout: 5_000 }, error => error ? fail(new Error('未能在 Finder 顯示。')) : done()));
          return;
        }
        if (event?.type === 'LIST_DIRS') {
          if (event.files === true) {
            if (!features.board && !features.fileTrigger) throw new Error('Group Board and file triggers are disabled.');
            const tag = typeof event.requestId === 'string' && event.requestId.length <= 64 ? event.requestId : undefined;
            try { send(ws, { type: 'DIRS', ...(await listDirectories(event.path, true)), requestId: tag }); }
            catch (error) {
              send(ws, { type: 'DIRS', path: typeof event.path === 'string' ? event.path : '', parent: null, dirs: [], files: [], requestId: tag,
                error: error instanceof Error ? error.message : '這個資料夾讀不到。' });
            }
          } else send(ws, { type: 'DIRS', ...(await listDirectories(event.path, false, workspace)) });
          return;
        }
        if (event?.type === 'READ_MARKS_SET') {
          const changed = readMarks.apply(event.marks);
          if (readMarks.size > 1_000) readMarks.prune(new Set(rooms.rooms.keys()));
          if (Object.keys(changed).length) broadcast({ type: 'READ_MARKS', marks: changed });
          return;
        }
        if (event?.type === 'GROUP_REORDER') {
          if (!Array.isArray(event.groupIds) || event.groupIds.length > 200 || !event.groupIds.every(id => typeof id === 'string')) throw new Error('群組排序無效。');
          broadcast({ type: 'GROUPS_ORDER', groupIds: groups.reorder(event.groupIds) });
          return;
        }
        if (event?.type === 'GROUP_RENAME') {
          if (typeof event.groupId !== 'string' || typeof event.name !== 'string') throw new Error('群組名稱無效。');
          groups.rename(event.groupId, event.name);
          return;
        }
        // WebSocket file triggers and terminal input
        // Validate trigger and group settings before falling through to the room's terminal event handler.
        if (event?.type === 'FILE_TRIGGERS_RESUME' || event?.type === 'FILE_TRIGGERS_GET' || event?.type === 'FILE_TRIGGERS_RESET' || event?.type === 'FILE_TRIGGERS_CONFIRM' || event?.type === 'FILE_TRIGGERS_SET_HINT' || event?.type === 'FILE_TRIGGERS_ADD' || event?.type === 'FILE_TRIGGERS_SET_ENABLED' || event?.type === 'FILE_TRIGGERS_REMOVE') {
          if (!features.fileTrigger) throw new Error('File triggers are disabled.');
          if (typeof event.groupId !== 'string' || !groups.get(event.groupId)) throw new Error('找不到群組。');
          if (event.type === 'FILE_TRIGGERS_RESET') {
            // A forged reset must not interrupt a valid or merely stale configuration.
            if (fileTriggers.readable) throw new Error('設定有效，毋須重設。');
            // First try to unlock without touching the configuration: the file and the anchor may be fine while this process locked itself.
            if (reloadTriggerStore(true)) {
              broadcast({ type: 'NOTICE', message: '檔案觸發已重新驗證並解鎖，設定保留。' });
              for (const group of groups.snapshot()) triggerBroadcast(group.id);
              return;
            }
            if (fileTriggers.stalePreview()) throw new Error('設定有效，不能用無效設定重置。');
            stopAllTriggers();
            fileTriggers = resetWithKey({ read: readFileTriggerKey, provisionMissing: provisionFileTriggerResetKey,
              createStore: key => newTriggerStore(key) });
            triggerDeps.store = fileTriggers;
            triggerNeedsSetup = false;
            triggerStates.clear(); triggerOfflineTokens.clear();
            for (const group of groups.snapshot()) triggerBroadcast(group.id);
            return;
          }
          if (event.type === 'FILE_TRIGGERS_CONFIRM') {
            if (typeof event.digest !== 'string' || !/^[a-f0-9]{64}$/.test(event.digest)) throw new Error('設定確認無效。');
            confirmFileTrigger({ digest: event.digest, groupIds: () => groups.snapshot().map(group => group.id),
              confirm: digest => fileTriggers.confirmStale(digest),
              onAccepted: () => {
                fileTriggers.recoverInflight();
                for (const setting of fileTriggers.settings()) if (setting.enabled) startTrigger(setting.id, true);
                for (const group of groups.snapshot()) scheduleFileNotice(group.id);
                scheduleRecovery();
              },
              publish: groupId => triggerBroadcast(groupId),
              onRejected: () => { send(ws, { type: 'ERROR', message: '設定確認已失效，請重新檢查。' }); send(ws, triggerState(event.groupId)); },
            });
            return;
          }
          if (event.type === 'FILE_TRIGGERS_ADD' && !fileTriggers.readable && !existsSync(triggerConfigPath)) {
            const key = provisionFileTriggerKey(true);
            if (key.state === 'available') { fileTriggers = newTriggerStore(key.key); triggerDeps.store = fileTriggers; triggerNeedsSetup = false; }
          }
          if (!fileTriggers.readable) {
            verifyTriggerIntegrity();
            if (event.type === 'FILE_TRIGGERS_GET') { send(ws, triggerState(event.groupId)); return; }
            throw new Error('無法驗證檔案觸發設定或金鑰。');
          }
          if (event.type === 'FILE_TRIGGERS_RESUME') {
            if (typeof event.id !== 'string' || typeof event.offlineToken !== 'string') throw new Error('恢復確認無效。');
            const id = event.id;
            const item = fileTriggers.settings(event.groupId).find(value => value.id === id);
            let reboundIdentity: import('./bridge/file-trigger-watch').ValidatedTrigger | undefined;
            const result = resumeOfflineTrigger({ token: event.offlineToken, expectedToken: triggerOfflineTokens.get(id),
              isOffline: () => Boolean(item?.enabled && item.offline),
              validate: () => {
                if (!item) throw new Error('missing');
                const current = validateTriggerPath(workspace, item.path, item.kind);
                if (current.rootDevice !== item.identity.rootDevice || current.rootInode !== item.identity.rootInode || current.workspace !== item.identity.workspace) throw new Error('workspace replaced');
                reboundIdentity = current;
              },
              consume: () => { triggerOfflineTokens.delete(id); },
              start: () => { if (!item || !reboundIdentity) return false; fileTriggers.rebindOffline(item.groupId, id, reboundIdentity); return startTrigger(id, true, true); },
              refreshAfterFailure: () => { if (fileTriggers.settings(event.groupId).find(value => value.id === id)?.offline) triggerOfflineTokens.set(id, randomUUID()); },
            });
            triggerBroadcast(event.groupId);
            if (result !== 'accepted') throw new Error(result === 'stale' ? '恢復確認已失效，請重新查看。' : '未能安全恢復監察，請檢查路徑。');
            return;
          }
          if (event.type === 'FILE_TRIGGERS_SET_HINT') {
            if (typeof event.hint !== 'string' || event.hint.length > 500) throw new Error('提示無效。');
            fileTriggers.setHint(event.hint);
          } else if (event.type === 'FILE_TRIGGERS_ADD') {
            if (typeof event.path !== 'string' || (event.kind !== 'file' && event.kind !== 'directory')) throw new Error('路徑無效。');
            const identity = validateTriggerPath(workspace, event.path, event.kind);
            fileTriggers.add(event.groupId, identity.target, event.kind, identity);
          } else if (event.type === 'FILE_TRIGGERS_SET_ENABLED') {
            if (typeof event.id !== 'string' || typeof event.enabled !== 'boolean') throw new Error('設定無效。');
            const item = fileTriggers.settings(event.groupId).find(value => value.id === event.id);
            if (!item) throw new Error('找不到監察項。');
            if (item.offline) throw new Error('離線中請先確認恢復或取消監察。');
            if (event.enabled) { validateTriggerPath(workspace, item.path, item.kind, item.identity); triggerStates.delete(event.id); }
            fileTriggers.setEnabled(event.groupId, event.id, event.enabled);
            if (event.enabled) { startTrigger(event.id); scheduleFileNotice(event.groupId); } else { triggerWatches.get(event.id)?.close(); triggerWatches.delete(event.id); releaseTriggerConfigWatch(); }
            scheduleRecovery();
          } else if (event.type === 'FILE_TRIGGERS_REMOVE') {
            if (typeof event.id !== 'string') throw new Error('設定無效。');
            fileTriggers.remove(event.groupId, event.id); triggerWatches.get(event.id)?.close(); triggerWatches.delete(event.id); releaseTriggerConfigWatch(); triggerStates.delete(event.id); triggerOfflineTokens.delete(event.id); scheduleRecovery();
          }
          if (event.type === 'FILE_TRIGGERS_SET_HINT') for (const group of groups.snapshot()) triggerBroadcast(group.id);
          else triggerBroadcast(event.groupId);
          return;
        }
        if (event?.type === 'GROUP_SET_BOARD') {
          if (!features.board) throw new Error('Group Board is disabled.');
          groups.setBoard(event.groupId, event.path);
          return;
        }
        if (event?.type === 'GROUP_DELETE') {
          if (typeof event.groupId !== 'string') throw new Error('群組無效。');
          const members = groups.get(event.groupId)?.members ?? [];
          groups.delete(event.groupId);
          // The group is gone before any watch state is discarded. Close even if storage fails.
          for (const item of fileTriggers.settings(event.groupId)) {
            triggerWatches.get(item.id)?.close(); triggerWatches.delete(item.id); triggerStates.delete(item.id);
            try { fileTriggers.remove(event.groupId, item.id); }
            catch { broadcast({ type: 'NOTICE', message: '已刪除群組，但未能移除檔案監察設定；請檢查設定檔。' }); }
          }
          releaseTriggerConfigWatch();
          scheduleRecovery();
          retainGroupRooms();
          for (const client of groupViews.leaveGroup(event.groupId)) presence.view(client, null);
          syncGroupWatches();
          for (const member of members) presence.considerUnviewed(member.roomId);
          broadcast({ type: 'GROUP_REMOVED', groupId: event.groupId });
          return;
        }
        if (event?.type === 'GROUP_RESTORE_MEMBER') {
          const group = groups.get(event.groupId);
          const index = group?.members.findIndex(member => member.roomId === event.roomId) ?? -1;
          if (!group || index < 0) throw new Error('找不到群組成員。');
          const member = group.members[index];
          const ordinal = group.members.slice(0, index + 1).filter(item => item.modelId === member.modelId).length;
          const stillSelected = groupViews.selectionGuard(ws, group.id, member.roomId);
          await rooms.ensureGroupMember(member.modelId, `${group.name} #${ordinal}`, member.roomId);
          void groupViews.retry(member.roomId, stillSelected);
          return;
        }
        if ((event?.type === 'INPUT' || event?.type === 'APPROVAL') &&
            typeof event.requestId === 'string' && event.requestId.length <= 64) requestId = event.requestId;
        const groupId = event.type === 'INPUT' ? event.groupId : undefined;
        const roomId = event.type === 'INPUT' ? event.roomId : undefined;
        if (groupId !== undefined && roomId !== undefined) {
          if (typeof groupId !== 'string') throw new Error('無效群組。');
          groups.assertMember(groupId, roomId);
        }
        await rooms.handle(event, reply => {
          if (event.type === 'CREATE' && reply.type === 'ROOM' && reply.select) {
            groupViews.leave(ws);
            roomViews.set(ws, reply.room.id);
            syncGroupWatches();
            if (ws.readyState === WebSocket.OPEN) presence.view(ws, reply.room.id);
          }
          send(ws, reply);
        }, {
          stillWanted: () => ws.readyState === WebSocket.OPEN,
          authorizeBenchInput: scope === 'local' && event.type === 'INPUT'
            ? legacyBenchInputGuard(benchDeps, event.roomId, event.text, () => ws.readyState === WebSocket.OPEN) : undefined,
          reserveRoster: groupId !== undefined && roomId !== undefined ? () => groups.reserveRoster(groupId, roomId) : undefined,
        });
      } catch (error) {
        if ((triggerWatches.size || triggerReturns.size) && !fileTriggers.readable) stopAllTriggers();
        const message = (error instanceof Error ? error.message : '請求失敗。').slice(0, 350);
        send(ws, requestId ? { type: 'ACTION_RESULT', requestId, ok: false, message } : { type: 'ERROR', message });
      }
    });
  });
});

// Vite development server
// Set up Vite middleware and its HMR socket on the existing HTTP server.
const vite = config.ui === 'dev' ? await (await import('vite')).createServer({
  root: project,
  server: {
    middlewareMode: true,
    ws: { server: http, path: '/_vite' },
    // Vite's own host check would refuse the Tailscale Serve name. Every request has already passed access() above,
    // which allows only localhost, this Mac's Tailscale address and its exact Serve host name (with an identity).
    allowedHosts: true,
    cors: false,
    watch: null,
    fs: {
      allow: [project],
      deny: ['**/.git/**', '**/.env*', '**/.agents/**', '**/.codex/**', '**/bridge/**', '**/Review/**', '**/server.ts', '**/scripts/**', '**/.komorebi*', '**/HANDOFF*', '**/README.md', '**/*.{pem,key,crt,log}'],
    },
  },
}) : undefined;
// Local CLI workbench hook
// A CLI hook asks for its agent's new tickets. Only from this Mac; any failure answers "nothing" so a hook never breaks the CLI.
app.post('/bench/hook/:cli', express.text({ type: () => true, limit: '8mb' }), (req, res) => {
  if (access(req) !== 'local') { res.status(403).json({}); return; }
  // The hook is curl: it sends no Origin. A browser page (any website open on this Mac) always does, and could otherwise post a text/plain body here without a preflight.
  if (req.headers.origin || req.headers['sec-fetch-site']) { res.status(403).json({}); return; }
  try { res.json(benchHook(benchDeps, req.params.cli, JSON.parse(typeof req.body === 'string' && req.body ? req.body : '{}'))); }
  catch { res.json({}); }
});

// Web interface delivery
// Serve the branded shell and assets from Vite in development or from the built UI.
app.get('/manifest.webmanifest', (_req, res) => {
  const manifest = JSON.parse(config.ui === 'build' ? readBuiltFile('manifest.webmanifest') : readFileSync(join(project, 'public', 'manifest.webmanifest'), 'utf8'));
  res.set('Cache-Control', 'no-store').type('application/manifest+json').send(brandManifest(manifest, config.displayName));
});
app.get('/', async (req, res, next) => {
  try {
    const html = brandHtml(config.ui === 'build' ? readBuiltFile('index.html') : readFileSync(join(project, 'index.html'), 'utf8'), config.displayName);
    res.set('Cache-Control', 'no-store').type('html').send(vite ? await vite.transformIndexHtml(req.originalUrl, html) : html);
  } catch (error) { next(error); }
});
if (vite) app.use(vite.middlewares);
else {
  app.use((req, res, next) => {
    let path: string;
    try { path = decodeURIComponent(req.path); } catch { res.sendStatus(400); return; }
    const parts = path.split('/').filter(Boolean);
    if (path.startsWith('/@') || parts.some(part => part.startsWith('.') || ['bridge', 'Review', 'scripts', 'server.ts', 'README.md'].includes(part) || /^HANDOFF/i.test(part)) || /\.(?:pem|key|crt|log)$/i.test(path)) {
      res.sendStatus(404); return;
    }
    const target = resolve(uiRoot, `.${path}`);
    const within = relative(uiRoot, target);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) { res.sendStatus(404); return; }
    if (existsSync(target)) {
      try {
        if (lstatSync(uiRoot).isSymbolicLink()) { res.sendStatus(404); return; }
        const actual = relative(realpathSync(uiRoot), realpathSync(target));
        if (actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual)) { res.sendStatus(404); return; }
      } catch { res.sendStatus(404); return; }
    }
    next();
  });
  app.use(express.static(uiRoot, { dotfiles: 'deny', index: false, fallthrough: true }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || extname(req.path) || !req.accepts('html')) { next(); return; }
    try { res.set('Cache-Control', 'no-store').type('html').send(brandHtml(readBuiltFile('index.html'), config.displayName)); }
    catch (error) { next(error); }
  });
}

// Before listening
// Restore group rooms, discover the network address and start attachment housekeeping.
for (const group of groups.snapshot()) for (const [index, member] of group.members.entries()) {
  if (member.roomId.startsWith('session-')) continue; // Restored by the transcript watcher.
  const ordinal = group.members.slice(0, index + 1).filter(item => item.modelId === member.modelId).length;
  try { await rooms.ensureGroupMember(member.modelId, `${group.name} #${ordinal}`, member.roomId); }
  catch (error) { console.error('未能還原群組房間', group.name, error); }
}

await refreshTailscale();
http.on('error', error => { console.error(error.message); void shutdown(1); });
// Uploaded attachments (images and other files) nobody has touched for two weeks go to the Trash, at start and then once a day.
const sweepOldAttachments = () => void sweepAttachments().then(result => {
  if (result.moved.length) broadcast({ type: 'NOTICE', message: `${result.moved.length} 個超過 ${attachmentMaxAgeDays} 日的上傳附件已移到垃圾桶。` });
  if (result.failed.length) console.error(`未能移動 ${result.failed.length} 個舊上傳附件到垃圾桶，保留原位。`);
}).catch(() => {});
sweepOldAttachments();
setInterval(sweepOldAttachments, 24 * 3_600_000).unref();

// After binding the port
// Recover persisted work and start the transcript and trigger watchers once this process owns the listener.
http.listen(port, config.host, () => {
  // Load and retire durable work only in the Bridge that actually acquired the port.
  const experienceScope = features.rsi ? readExperienceScope(workspace) : undefined;
  tidyGroup = readTidyGroup(workspace, experienceScope);
  const benchExperience = experienceScope ? new BenchExperience(
    join(workspace, experienceFile), experienceScope, undefined, undefined,
    ticket => groups.snapshot().find(group => group.id === ticket.groupId)?.members.find(member => {
      if (member.modelId !== ticket.to.modelId) return false;
      const room = rooms.rooms.get(member.roomId);
      return member.roomId === ticket.fixed?.toRoomId || member.roomId === ticket.to.sessionId ||
        member.roomId === `session-${ticket.to.modelId.toLowerCase()}-${ticket.to.sessionId}` || room?.sessionId === ticket.to.sessionId;
    })?.role?.key,
  ) : undefined;
  benchDeps.bench = new Bench(join(workspace, '.komorebi-bench.json'), undefined,
    benchExperience && (changes => benchExperience.record(changes)), tidyGroup,
    experienceScope && (groupId => inExperienceScope(experienceScope, groupId)), join(config.skills, '_lessons', 'log.jsonl'), join(workspace, experienceFile));
  benchDeps.bench.onRecoveryChange = benchRecoveryChanged;
  scheduleTidy();
  // Only after the port is successfully bound may recovery touch the signed configuration or Keychain anchor.
  if (features.fileTrigger) {
    const initialKey = readFileTriggerKey();
    triggerNeedsSetup = initialKey.state === 'missing' && !existsSync(triggerConfigPath);
    fileTriggers = newTriggerStore(initialKey.state === 'available' ? initialKey.key : undefined);
    triggerDeps.store = fileTriggers;
    if (fileTriggers.readable) fileTriggers.recoverInflight();
  }
  console.log(`Komorebi · http://localhost:${port}`);
  if (config.tailscale) console.log(tailscaleUrl() ? `Tailscale · ${tailscaleUrl()}` : 'Tailscale · 等待 Mac 登入');
  console.log(pairingBanner(pairing.source, pairingKey.toString()));
  void rooms.watch();
  if (features.fileTrigger) {
    for (const item of fileTriggers.settings()) if (item.enabled) startTrigger(item.id, true);
    for (const group of groups.snapshot()) scheduleFileNotice(group.id);
  }
});

// Maintenance and shutdown
// Refresh trigger and socket health during operation, then release services when the process stops.
// A locked or briefly unverifiable configuration heals itself: reload it, and start the observers again if they were stopped.
if (features.fileTrigger) setInterval(() => {
  if (triggerNeedsSetup) return;
  if (!fileTriggers.readable && !reloadTriggerStore()) return;
  if (triggersStoppedByIntegrity) { recoverTriggers(); broadcast({ type: 'NOTICE', message: '檔案觸發已自動恢復。' }); }
}, 60_000).unref();
const heartbeat = setInterval(() => {
  for (const [client, alive] of connections) {
    if (!alive) client.terminate();
    else {
      connections.set(client, false);
      client.ping();
    }
  }
  void refreshTailscale();
}, 15_000).unref();

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  for (const timer of triggerTimers.values()) clearTimeout(timer);
  triggerConfigWatch?.close();
  for (const stop of triggerReturns.values()) stop();
  for (const watcher of triggerWatches.values()) watcher.close();
  presence.dispose();
  groupCloser?.dispose();
  benchDeps.bench.disposeDeliveryHolds();
  for (const client of connections.keys()) client.terminate();
  http.close();
  wss.close();
  await Promise.all([rooms.close(), vite?.close()]);
  process.exitCode = exitCode;
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
