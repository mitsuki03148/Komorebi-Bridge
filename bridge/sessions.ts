import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { lstat, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { watch } from 'chokidar';
import type { CLIModelId, EffortLevel, PendingQuestion, TaskStep, TaskStepStatus, TerminalLogEntry } from '../src/types/guild';
import { isConversationEntry, transcriptText } from '../src/utils/transcriptText';
import { HISTORY_DEFAULT, HISTORY_MAX } from '../src/utils/history';

export const cliIds: CLIModelId[] = ['AGY', 'CODEX', 'CLAUDE'];
export const home = homedir();
export const sessionRoots: Record<CLIModelId, [string, string]> = {
  AGY: ['.gemini/antigravity/brain', '.gemini/antigravity-cli/brain'],
  CODEX: ['.codex/sessions', 'Library/Application Support/Codex'],
  CLAUDE: ['.claude/projects', 'Library/Application Support/Claude'],
};

export interface SavedSession {
  id: string;
  modelId: CLIModelId;
  cwd?: string;
  branch: string;
  file: string;
  updated: string;
  logs: TerminalLogEntry[];
  activeModel?: string;
  lastEffort?: EffortLevel;
  /** The latest question the agent asked that no later message from the user has answered. */
  pendingQuestion?: PendingQuestion;
  /** How much of the context window the last turn used, in percent (an estimate: see contextOf). */
  contextUsagePct?: number;
  contextTokens?: number;
  contextWindow?: number;
  codexUsableContextWindow?: number;
  resumable: boolean;
  /** Older messages exist that this room does not show. */
  truncated?: boolean;
  /** For a forked Codex session (`codex fork <id>`), the parent session ID recorded in `session_meta.forked_from_id`. */
  forkedFromId?: string;
}

/**
 * How full a conversation's context is, from the token counts each CLI writes into its own record with every turn.
 * Codex records the window itself; Claude and AGY do not, so theirs is assumed from the model: Claude 5 models run a
 * 1M window, older Claude 200k, Gemini 1M. A turn that used more than the assumed window proves a bigger one.
 */
const agyCompactionTokens = 510_000;
export function contextOf(modelId: CLIModelId, records: any[], model?: string): number | undefined {
  return contextUsage(modelId, records, model)?.pct;
}

/** The same, with the real numbers: tokens in the last turn and the window they are measured against. */
export function contextUsage(modelId: CLIModelId, records: any[], model?: string): { pct: number; tokens: number; window: number; codexUsableWindow?: number } | undefined {
  let tokens: number | undefined, window: number | undefined;
  if (modelId === 'CODEX') {
    const info = records.findLast(row => row?.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info)?.payload?.info;
    tokens = info?.last_token_usage?.total_tokens;
    window = info?.model_context_window;
  } else if (modelId === 'CLAUDE') {
    const row = records.findLast(item => item?.type === 'assistant' && !item.isSidechain && !item.agentId && item.message?.usage && item.message.model !== '<synthetic>');
    const usage = row?.message?.usage;
    if (usage) {
      tokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      window = /^claude-(?:opus|sonnet|haiku|fable|mythos)-([5-9]|\d{2,})(?:-|$)/.test(`${row.message.model ?? model ?? ''}`) ? 1_000_000 : 200_000;
    }
  } else {
    const row = records.findLast(item => item?.type === 'PLANNER_RESPONSE' && typeof item.input_tokens === 'number');
    // AGY compacts the conversation at the top of its context window, whatever the model's own limit is, so the ring fills up there and the
    // compaction does not arrive while it still looks nearly empty. It was about 254k until 2026-11-16; the window then opened to 512k and the
    // compactions seen that day came at 509,644 and 510,222 tokens, so the ring measures against 510k.
    if (row) { tokens = row.input_tokens + (row.cache_read_tokens ?? 0); window = agyCompactionTokens; }
  }
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0 || typeof window !== 'number' || window <= 0) return undefined;
  const codexUsableWindow = modelId === 'CODEX' && Number.isSafeInteger(window) ? window : undefined;
  if (tokens > window && modelId !== 'AGY') window = Math.max(window, 1_000_000);
  return { pct: Math.min(100, Math.round((tokens / window) * 100)), tokens, window, ...(codexUsableWindow !== undefined ? { codexUsableWindow } : {}) };
}

export function isInside(root: string, path: string) {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep);
}

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const transcriptSize = 256 * 1024;
/** How many recent messages a room keeps, and the most text it holds for them (older ones stay in the CLI's own record). */
export const historyLimit = HISTORY_DEFAULT;
/** The most a room can be asked to load, however often "load earlier" is used. */
export const historyMax = HISTORY_MAX;
const historyChars = 120_000;
/** A session that is mostly tool output has few messages per megabyte, so reading goes back this far at most. */
const maxTranscriptWindow = 16 * 1024 * 1024;
/** How far back a reader's own "load earlier" may go in a huge session: it is a one-off, so slower is fine. */
export const deepTranscriptWindow = 128 * 1024 * 1024;
export const forkRecoveryIntervalMs = 1_000;
export const forkRecoveryLimitMs = 30_000;
/** The window that was enough last time for each file, so a long session is read once per change, not in several growing steps. */
const knownWindows = new Map<string, number>();
type Row = Record<string, any>;

function rows(text: string): Row[] {
  return text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      return row && typeof row === 'object' && !Array.isArray(row) ? [row] : [];
    } catch { return []; }
  });
}

/** A cheap count of message rows, to know when enough of the file's end has been read. */
/**
 * A message the user sends to Claude while it is working is not written as a user row but as an attachment of type
 * queued_command, with its text and pictures in `prompt`. It is as much a message as any other.
 */
const queuedPrompt = (row: Row) => row.type === 'attachment' && row.attachment?.type === 'queued_command' ? row.attachment.prompt : undefined;

function countMessages(modelId: CLIModelId, list: Row[]) {
  return list.filter(row => !row.isMeta && !row.isSidechain && (
    modelId === 'CODEX' ? row.type === 'response_item' && row.payload?.type === 'message' && (row.payload.role === 'user' || row.payload.role === 'assistant') :
    modelId === 'CLAUDE' ? row.type === 'user' || row.type === 'assistant' || queuedPrompt(row) !== undefined :
    row.type === 'USER_INPUT' || row.type === 'PLANNER_RESPONSE')).length;
}

function messageText(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(item => ['text', 'input_text', 'output_text'].includes(item?.type))
    .map(item => typeof item.text === 'string' ? item.text : '').join('\n');
}

/** The record Codex writes when it asks the user something: a message event carrying the questions. */
const questionItem = (row: any) => row?.type === 'event_msg' && Array.isArray(row.payload?.item?.questions) && row.payload.item.questions.length > 0 ? row.payload.item : undefined;

/** Claude's AskUserQuestion call in an assistant row, in the same shape as Codex's questions (a title and its choices). */
function claudeAsked(row: any): { toolId: string; item: { questions: { title: string; options: string[] | null }[] } } | undefined {
  if (row?.type !== 'assistant' || row.isSidechain || row.agentId || !Array.isArray(row.message?.content)) return;
  const call = row.message.content.find((part: any) => part?.type === 'tool_use' && part.name === 'AskUserQuestion' && typeof part.id === 'string' && Array.isArray(part.input?.questions));
  if (!call) return;
  const questions = call.input.questions.map((question: any) => {
    const options = Array.isArray(question?.options)
      ? question.options.map((option: any) => typeof option === 'string' ? option : option?.label).filter((label: unknown): label is string => typeof label === 'string' && Boolean(label.trim()))
      : [];
    return { title: typeof question?.question === 'string' ? question.question.trim() : '', options: options.length ? options : null };
  }).filter((question: { title: string }) => question.title);
  return questions.length ? { toolId: call.id, item: { questions } } : undefined;
}

/** Whether a later row answers that call: Claude writes a tool result (the choice, or a refusal when the question was dismissed) for it. */
const claudeAnswered = (rows: any[], toolId: string) => rows.some(row => row?.type === 'user' && Array.isArray(row.message?.content) &&
  row.message.content.some((part: any) => part?.type === 'tool_result' && part.tool_use_id === toolId));

/** The answers Claude recorded for that call, by question title; empty when the question was dismissed or the result has no answers. */
function claudeAnswers(rows: any[], toolId: string): Map<string, string> {
  const answers = new Map<string, string>();
  const row = rows.find(item => item?.type === 'user' && Array.isArray(item.message?.content) &&
    item.message.content.some((part: any) => part?.type === 'tool_result' && part.tool_use_id === toolId));
  const recorded = row?.toolUseResult?.answers;
  if (recorded && typeof recorded === 'object') {
    for (const [title, answer] of Object.entries(recorded)) if (typeof answer === 'string' && answer.trim()) answers.set(title.trim(), answer.trim());
  }
  return answers;
}

/** AGY's ask_question call in a PLANNER_RESPONSE row, in the same shape as Claude's and Codex's questions. */
export function agyAsked(row: any): { item: { questions: { title: string; options: string[] | null; multiSelect?: boolean }[] } } | undefined {
  if (row?.type !== 'PLANNER_RESPONSE' || !Array.isArray(row.tool_calls)) return;
  const call = row.tool_calls.find((part: any) => part?.name === 'ask_question' && Array.isArray(part.args?.questions));
  if (!call) return;
  const questions = call.args.questions.map((question: any) => {
    const options = Array.isArray(question?.options)
      ? question.options.map((option: any) => typeof option === 'string' ? option : option?.label).filter((label: unknown): label is string => typeof label === 'string' && Boolean(label.trim()))
      : [];
    const multiSelect = question?.is_multi_select === true || question?.multiSelect === true;
    return {
      title: typeof question?.question === 'string' ? question.question.trim() : '',
      options: options.length ? options : null,
      ...(multiSelect ? { multiSelect: true } : {}),
    };
  }).filter((question: { title: string }) => question.title);
  return questions.length ? { item: { questions } } : undefined;
}

const stepStatuses: readonly TaskStepStatus[] = ['pending', 'in_progress', 'done', 'skipped', 'failed'];

/** AGY's update_steps call in a PLANNER_RESPONSE row: the whole current checklist (args.steps is a JSON string, or already a list). */
export function agySteps(row: any): TaskStep[] | undefined {
  if (row?.type !== 'PLANNER_RESPONSE' || !Array.isArray(row.tool_calls)) return;
  const call = [...row.tool_calls].reverse().find((part: any) => part?.name === 'update_steps');
  if (!call) return;
  let list: unknown = call.args?.steps;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { return; } }
  if (!Array.isArray(list)) return;
  const steps = list.flatMap((item: any): TaskStep[] => {
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 200) : '';
    if (!title) return [];
    return [{ title, status: stepStatuses.includes(item.status) ? item.status : 'pending' }];
  }).slice(0, 50);
  return steps.length ? steps : undefined;
}

const stepsText = (steps: TaskStep[]) => `進度 ${steps.filter(step => step.status === 'done').length}/${steps.length}`;

const agyAnswerRow = (rows: any[]) => {
  for (const row of rows) {
    if (row?.type === 'PLANNER_RESPONSE' || row?.type === 'USER_INPUT') return undefined;
    if (row?.type === 'GENERIC' && typeof row.content === 'string' && /^A[1-9]\d*:\s*.+$/m.test(row.content)) return row;
  }
  return undefined;
};

/** Whether a later row answers that AGY ask_question call: AGY writes a GENERIC row with "A1: <answer>" (or "A1: User Skipped"). */
const agyAnswered = (rows: any[]) =>
  Boolean(agyAnswerRow(rows)) || rows.some(row => row?.type === 'PLANNER_RESPONSE' || row?.type === 'USER_INPUT');

/** The answers AGY recorded for that ask_question call, by question title; empty when the user skipped with Esc. */
function agyAnswers(rows: any[], questions: { title: string }[]): Map<string, string> {
  const answers = new Map<string, string>();
  const row = agyAnswerRow(rows);
  if (!row || typeof row.content !== 'string') return answers;
  for (const match of row.content.matchAll(/^A([1-9]\d*):\s*(.+)$/gm)) {
    const question = questions[Number(match[1]) - 1];
    const answer = match[2].trim();
    if (question && answer && !/^User Skipped$/i.test(answer)) answers.set(question.title, answer);
  }
  return answers;
}

/** What an answered question shows: each title with the answer that was given, and not the list of choices. */
const answeredText = (item: { questions: { title: string }[] }, answers: Map<string, string>) =>
  item.questions.map(question => answers.has(question.title) ? `${question.title}\n答：${answers.get(question.title)}` : question.title).join('\n\n').trim();

/** What Codex shows for a question: each title with its choices under it. */
function questionText(item: any): string {
  const shown = Array.isArray(item.content) ? item.content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n').trim() : '';
  if (shown) return shown;
  return item.questions.map((question: any) => [String(question?.title ?? '').trim(), ...(Array.isArray(question?.options) ? question.options.map((option: unknown) => ` - ${option}`) : [])].join('\n')).join('\n\n').trim();
}

/** A question stays pending for this long; after that nobody is expected to answer it any more. */
const questionLife = 12 * 60 * 60 * 1000;

/**
 * Codex records a question it asks the user (with its choices, if any) on the message that carries it.
 * It is still waiting when no message from the user has come after it, and it is recent.
 */
export function pendingQuestionOf(records: any[], logs: TerminalLogEntry[], now = Date.now()): PendingQuestion | undefined {
  const row = records.findLast(item => Array.isArray(item.payload?.item?.questions) && item.payload.item.questions.length > 0);
  const at = row ? Date.parse(row.timestamp) : NaN;
  if (!row || !Number.isFinite(at) || now - at > questionLife) return;
  if (logs.some(entry => entry.sender === 'user' && entryTime(entry) > at)) return;
  const questions = row.payload.item.questions
    .map((question: any) => ({
      title: typeof question?.title === 'string' ? question.title.trim() : '',
      options: Array.isArray(question?.options) ? question.options.filter((option: unknown) => typeof option === 'string' && option.trim()) : null,
    }))
    .filter((question: { title: string }) => question.title);
  if (!questions.length) return;
  return { id: new Date(at).toISOString(), questions: questions.map((question: { title: string; options: string[] | null }) => ({ ...question, options: question.options?.length ? question.options : null })) };
}

/** The AskUserQuestion Claude is waiting on: the latest one, with no answer written after it, and recent. */
export function claudePendingQuestionOf(records: any[], now = Date.now()): PendingQuestion | undefined {
  const index = records.findLastIndex(row => claudeAsked(row));
  if (index < 0) return;
  const asked = claudeAsked(records[index])!;
  const at = Date.parse(records[index].timestamp);
  if (!Number.isFinite(at) || now - at > questionLife || claudeAnswered(records.slice(index + 1), asked.toolId)) return;
  return { id: new Date(at).toISOString(), questions: asked.item.questions };
}

/** The ask_question AGY is waiting on: the latest one, with no GENERIC answer row after it, and recent. */
export function agyPendingQuestionOf(records: any[], now = Date.now()): PendingQuestion | undefined {
  const index = records.findLastIndex(row => agyAsked(row));
  if (index < 0) return;
  const asked = agyAsked(records[index])!;
  const at = Date.parse(records[index].timestamp ?? records[index].created_at);
  if (!Number.isFinite(at) || now - at > questionLife || agyAnswered(records.slice(index + 1))) return;
  return { id: new Date(at).toISOString(), questions: asked.item.questions };
}

export async function readSession(modelId: CLIModelId, file: string, root: string, _workspace: string, limit = historyLimit, maxWindow = maxTranscriptWindow, sessionHome = home): Promise<SavedSession | undefined> {
  const handle = await open(file, 'r');
  let info;
  let header;
  let tail;
  let span = 0;
  try {
    info = await handle.stat();
    if (!info.isFile()) return;
    const buffer = Buffer.alloc(Math.min(info.size, transcriptSize));
    const first = await handle.read(buffer, 0, buffer.length, 0);
    header = rows(buffer.toString('utf8', 0, first.bytesRead));
    span = Math.min(info.size, Math.max(buffer.length, Math.min(knownWindows.get(file) ?? 0, maxWindow)));
    if (info.size > buffer.length) {
      for (;;) {
        const chunk = Buffer.alloc(span);
        const last = await handle.read(chunk, 0, span, info.size - span);
        const text = chunk.toString('utf8', 0, last.bytesRead);
        tail = rows(span >= info.size ? text : text.slice(text.indexOf('\n') + 1));
        if (span >= info.size || span >= maxWindow || countMessages(modelId, tail) >= limit + 30) break;
        span = Math.min(info.size, span * 4, maxWindow);
      }
    } else tail = header;
  } finally {
    await handle.close();
  }

  const codexMeta = modelId === 'CODEX' ? header.find(row => row.type === 'session_meta')?.payload : undefined;
  const claudeMeta = modelId === 'CLAUDE' ? header.find(row => typeof row.cwd === 'string' && uuid.test(row.sessionId) && !row.isSidechain && !row.agentId) : undefined;
  const agyId = relative(root, file).split(sep)[0];
  const id: unknown = codexMeta?.id ?? codexMeta?.session_id ?? claudeMeta?.sessionId ?? (modelId === 'AGY' ? agyId : undefined);
  if (typeof id !== 'string' || !uuid.test(id) || codexMeta?.parent_thread_id) return;
  let cwd: unknown = codexMeta?.cwd ?? claudeMeta?.cwd;
  if (modelId === 'AGY' && root.endsWith('antigravity-cli/brain')) {
    try {
      const cache = JSON.parse(await readFile(join(sessionHome, '.gemini/antigravity-cli/cache/last_conversations.json'), 'utf8'));
      cwd = Object.entries(cache).find(([, value]) => value === id)?.[0];
    } catch { /* A Brain transcript can exist without a workspace mapping. */ }
  }
  let canonicalCwd: string | undefined;
  if (typeof cwd === 'string' && isAbsolute(cwd)) {
    try { canonicalCwd = await realpath(cwd); } catch { canonicalCwd = cwd; }
  } else if (modelId !== 'AGY') return;

  // Remember the window, and let it shrink again if it was far more than needed.
  // Only the ordinary window is remembered: a deep one-off read must not make every later update read that far.
  knownWindows.set(file, Math.min(countMessages(modelId, tail) > (limit + 30) * 3 ? Math.max(transcriptSize, Math.floor(span / 4)) : span, maxTranscriptWindow));
  const askedAt = modelId === 'CODEX' ? tail.flatMap((row, index) => questionItem(row) ? [index] : []) : [];
  const askedIds = new Set<string>();
  const answeredIds = new Set<string>();
  const entriesOf = (row: any, index: number): TerminalLogEntry[] => {
    if (row.isMeta || row.isSidechain || row.agentId) return [];
    // A question is not a message in the transcript, so without this it would never appear in the conversation.
    const claude = modelId === 'CLAUDE' ? claudeAsked(row) : undefined;
    const agy = modelId === 'AGY' ? agyAsked(row) : undefined;
    const asked = modelId === 'CODEX' ? questionItem(row) : claude?.item ?? agy?.item;
    if (asked) {
      const text = questionText(asked);
      const stamp = row.timestamp ?? row.created_at;
      if (!text || !Number.isFinite(Date.parse(stamp))) return [];
      // The row's own uuid / ordinal / step_index keeps the id the same on every read; an index into the tail moves as the window grows, and each read then added the question again.
      const entryId = `${id}-q${row.uuid ?? row.ordinal ?? row.step_index ?? index}`;
      askedIds.add(entryId);
      const later = tail.slice(index + 1);
      const answered = claude ? claudeAnswered(later, claude.toolId) : agy ? agyAnswered(later) : false;
      if (answered) answeredIds.add(entryId);
      // Once answered, the conversation keeps the question and what was chosen; the other choices are no longer useful.
      const chosenAnswers = claude && answered
        ? claudeAnswers(later, claude.toolId)
        : agy && answered
          ? agyAnswers(later, agy.item.questions)
          : undefined;
      const shown = chosenAnswers ? answeredText(asked, chosenAnswers) || text : text;
      return [{ id: entryId, timestamp: new Date(stamp).toLocaleTimeString(), createdAt: new Date(stamp).toISOString(), sender: 'agent', text: shown }];
    }
    // Claude writes its own summary of a compacted conversation as a user row that is only for the transcript view.
    if (row.isCompactSummary || row.isVisibleInTranscriptOnly) return [];
    const queued = modelId === 'CLAUDE' ? queuedPrompt(row) : undefined;
    if (modelId === 'CLAUDE' && !queued && row.type !== 'user' && row.type !== 'assistant') return [];
    const item = modelId === 'CODEX' && row.type === 'response_item' && row.payload?.type === 'message' ? row.payload :
      modelId === 'CLAUDE' ? (queued ? { role: 'user', content: queued } : row.message) : undefined;
    const role = item?.role ?? (row.type === 'USER_INPUT' ? 'user' : row.type === 'PLANNER_RESPONSE' ? 'assistant' : null);
    if (role !== 'user' && role !== 'assistant') return [];
    let content = item?.content ?? row.content;
    if (modelId === 'CODEX' && role === 'user' && Array.isArray(content)) {
      const kinds = item?.internal_chat_message_metadata_passthrough?.content_item_kinds;
      if (Array.isArray(kinds) && kinds.length === content.length) {
        content = content.filter((_, index) => !/^(?:agents_md|environments)\./.test(kinds[index] ?? ''));
      }
    }
    const text = transcriptText(modelId, role === 'user' ? 'user' : 'agent', messageText(content).trim());
    if (!text || !isConversationEntry(modelId, role === 'user' ? 'user' : 'agent', text)) return [];
    // Older records repeat the question as a message beside the event; the event version is the one with the choices.
    if (role === 'assistant' && askedAt.some(at => Math.abs(at - index) <= 6 && questionItem(tail[at]).questions.some((question: any) =>
      String(question?.title ?? '').trim().split('\n')[0] === text.split('\n')[0].trim()))) return [];
    const timestamp = row.timestamp ?? row.created_at;
    return [{
      id: `${id}-${row.uuid ?? row.ordinal ?? row.step_index ?? index}`,
      timestamp: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleTimeString() : '—',
      createdAt: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : undefined,
      sender: role === 'user' ? 'user' : 'agent',
      text,
    }];
  };
  // A checklist is not a message: AGY records it as a tool call. It shows after the row's own text, and one list per turn is kept: the latest, in the place of the first.
  const stepsOf = (row: any, index: number): TerminalLogEntry[] => {
    const steps = modelId === 'AGY' ? agySteps(row) : undefined;
    const stamp = row.timestamp ?? row.created_at;
    if (!steps || !Number.isFinite(Date.parse(stamp))) return [];
    return [{ id: `${id}-s${row.step_index ?? row.ordinal ?? index}`, timestamp: new Date(stamp).toLocaleTimeString(), createdAt: new Date(stamp).toISOString(), sender: 'agent', text: stepsText(steps), steps }];
  };
  const allLogs: TerminalLogEntry[] = [];
  let turnSteps: TerminalLogEntry | undefined;
  tail.forEach((row, index) => {
    for (const entry of [...entriesOf(row, index), ...stepsOf(row, index)]) {
      if (entry.sender === 'user') turnSteps = undefined;
      if (entry.steps && turnSteps) { turnSteps.steps = entry.steps; turnSteps.text = entry.text; continue; }
      if (entry.steps) turnSteps = entry;
      allLogs.push(entry);
    }
  });
  const pendingNow = modelId === 'CODEX'
    ? pendingQuestionOf(tail, allLogs)
    : modelId === 'CLAUDE'
      ? claudePendingQuestionOf(tail)
      : agyPendingQuestionOf(tail);
  for (const entry of allLogs) {
    if (!askedIds.has(entry.id)) continue;
    const at = Date.parse(entry.createdAt ?? '');
    if (answeredIds.has(entry.id) || allLogs.some(other => other.sender === 'user' && entryTime(other) > at)) entry.question = 'answered';
    else if (pendingNow && pendingNow.id === entry.createdAt) entry.question = 'open';
  }
  const logs: TerminalLogEntry[] = [];
  let chars = 0;
  const charBudget = Math.max(historyChars, limit * 3_000);
  for (const entry of allLogs.slice(-limit).reverse()) {
    chars += entry.text.length;
    if (logs.length > 0 && chars > charBudget) break;
    logs.unshift(entry);
  }
  const truncated = span < info.size || allLogs.length > logs.length;
  const codexSettings = modelId === 'CODEX'
    ? tail.findLast(row => row.type === 'event_msg' && row.payload?.type === 'thread_settings_applied')?.payload?.thread_settings
    : undefined;
  const activeModel = tail.findLast(row => row.type === 'turn_context' && row.payload?.model)?.payload?.model ??
    tail.findLast(row => row.type === 'assistant' && row.message?.model)?.message?.model ??
    tail.findLast(row => row.type === 'PLANNER_RESPONSE' && typeof row.model === 'string')?.model ??
    codexSettings?.model;
  const recordedEffort = modelId === 'CODEX'
    ? (tail.findLast(row => row.type === 'turn_context' && row.payload?.effort)?.payload?.effort ?? codexSettings?.reasoning_effort)
    : modelId === 'CLAUDE'
      ? tail.findLast(row => row.type === 'assistant' && !row.isMeta && !row.isSidechain && !row.agentId && row.effort)?.effort
      : tail.findLast(row => row.type === 'PLANNER_RESPONSE' && typeof row.model === 'string')?.model?.match(/-(low|medium|high|xhigh|max)$/i)?.[1]?.toLowerCase();
  const lastEffort = typeof recordedEffort === 'string' && /^(low|medium|high|xhigh|max|ultra)$/.test(recordedEffort) ? recordedEffort as EffortLevel : undefined;
  const forkedFromId = typeof codexMeta?.forked_from_id === 'string' && uuid.test(codexMeta.forked_from_id) ? codexMeta.forked_from_id : undefined;

  const usage = contextUsage(modelId, tail, typeof activeModel === 'string' ? activeModel : undefined);
  return {
    id, modelId, cwd: canonicalCwd, logs, truncated,
    branch: codexMeta?.git?.branch ?? claudeMeta?.gitBranch ?? '—',
    file: '~/' + relative(home, file), updated: info.mtime.toISOString(),
    activeModel: typeof activeModel === 'string' ? activeModel : undefined,
    lastEffort,
    contextUsagePct: usage?.pct,
    contextTokens: usage?.tokens,
    contextWindow: usage?.window,
    codexUsableContextWindow: usage?.codexUsableWindow,
    pendingQuestion: pendingNow,
    resumable: Boolean(canonicalCwd && (modelId !== 'AGY' || root.endsWith('antigravity-cli/brain'))),
    ...(forkedFromId ? { forkedFromId } : {}),
  };
}

/**
 * A room's own entries and the transcript's messages as one list, oldest first. Entries the transcript already
 * has (including the user's messages that were matched to it) come from the transcript; the room's own notes
 * and messages not yet written to it are kept and placed by time.
 */
export const entryTime = (entry: TerminalLogEntry) => (entry.createdAt ? Date.parse(entry.createdAt) : NaN);

/** Puts a message where its time says, after any message from the same moment; one with no usable time goes last. */
export function insertByTime(list: TerminalLogEntry[], entry: TerminalLogEntry) {
  const at = entryTime(entry);
  if (!Number.isFinite(at)) { list.push(entry); return; }
  let index = list.length;
  while (index > 0) {
    const before = entryTime(list[index - 1]);
    if (Number.isFinite(before) && before > at) index--;
    else break;
  }
  list.splice(index, 0, entry);
}

/** The same messages in time order. One with no usable time stays beside the message it followed. */
export function inTimeOrder(list: TerminalLogEntry[]) {
  let last = -Infinity;
  const keyed = list.map((entry, position) => {
    const at = entryTime(entry);
    if (Number.isFinite(at)) last = at;
    return { entry, key: last, position };
  });
  return keyed.sort((a, b) => a.key - b.key || a.position - b.position).map(item => item.entry);
}

export function mergeHistory(current: TerminalLogEntry[], transcript: TerminalLogEntry[], matched: ReadonlySet<string> = new Set()) {
  const known = new Set(transcript.map(entry => entry.id));
  const merged = [...transcript];
  const time = (entry: TerminalLogEntry) => (entry.createdAt ? Date.parse(entry.createdAt) : NaN);
  for (const entry of current) {
    if (known.has(entry.id) || (entry.sender === 'user' && matched.has(entry.id))) continue;
    const at = time(entry);
    const index = Number.isFinite(at) ? merged.findIndex(other => time(other) > at) : -1;
    if (index < 0) merged.push(entry);
    else merged.splice(index, 0, entry);
  }
  return merged;
}

export function isTranscript(modelId: CLIModelId, file: string, root: string) {
  const parts = relative(root, file).split(sep);
  if (modelId === 'AGY') return uuid.test(parts[0]) && parts.length === 4 && basename(file) === 'transcript_full.jsonl';
  if (modelId === 'CODEX') return /^rollout-.*\.jsonl$/.test(basename(file));
  return parts.length === 2 && /^[-\da-f]{36}\.jsonl$/i.test(parts[1]);
}

export function ignoredPath(modelId: CLIModelId, file: string, root: string) {
  const suffix = relative(root, file);
  if (!suffix) return false;
  const parts = suffix.split(sep);
  if (isTranscript(modelId, file, root)) return false;
  if (modelId === 'AGY') {
    return parts.length > 3 || !uuid.test(parts[0]) ||
      (parts.length > 1 && parts[1] !== '.system_generated') ||
      (parts.length > 2 && parts[2] !== 'logs');
  }
  if (modelId === 'CODEX' && root.endsWith('.codex/sessions')) {
    return parts.length > 3 || !/^\d{4}$/.test(parts[0]) ||
      parts.slice(1).some(part => !/^\d{2}$/.test(part));
  }
  return parts.length > 1 || /^(?:Cache|Code Cache|GPUCache|Service Worker|blob_storage|Local Storage|Network|Session Storage|Sentry|Partitions)$/i.test(parts[0]);
}

export function watchSessions(
  workspace: () => string, onSession: (session: SavedSession) => void | Promise<void>,
  onRemove: (modelId: CLIModelId, file: string) => void,
  onError: (message: string) => void,
  isArchived: (modelId: CLIModelId, file: string) => boolean = () => false,
  limitFor: (file: string) => number = () => historyLimit,
  onCodexRollout?: (file: string, changed: () => void) => void,
  pendingCodexSessions?: () => string[],
) {
  const watchers = cliIds.flatMap(modelId => sessionRoots[modelId].map(suffix => {
    const root = join(home, suffix);
    let initial = true;
    const recent = new Map<string, number>();
    const pending = new Map<string, NodeJS.Timeout>();
    let active = true;
    const ingest = async (file: string, wanted: () => boolean = () => true, expectedId?: string) => {
      try {
        if (!active || !wanted()) return;
        if (!isInside(root, await realpath(file))) return;
        const observe = suffix === sessionRoots.CODEX[0] && onCodexRollout
          ? () => onCodexRollout(file, () => schedule(file))
          : undefined;
        observe?.();
        const session = await readSession(modelId, file, root, workspace(), limitFor('~/' + relative(home, file)));
        if (session && (!expectedId || session.id === expectedId) && active && wanted()) {
          await onSession(session);
          // A fork can also bind during this first read, before /status is shown.
          observe?.();
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') onError(`${modelId} 讀取 Session 失敗（${code ?? '讀取錯誤'}）`);
      }
    };
    const schedule = (file: string, size = 0) => {
      // Batch Codex changes from the first append. Tool output can keep writing often enough
      // that restarting the delay on every append hides completed replies for the whole burst.
      if (modelId === 'CODEX' && pending.has(file)) return;
      clearTimeout(pending.get(file));
      // A multi-megabyte session that is being written to constantly is read less often.
      pending.set(file, setTimeout(() => {
        pending.delete(file);
        void ingest(file);
      }, size > 8 * 1024 * 1024 ? 750 : 250));
    };
    const watcher = watch(root, {
      depth: 3, backend: 'native', followSymlinks: false, alwaysStat: true,
      ignored: (file, info) => ignoredPath(modelId, file, root) ||
        Boolean(info?.isFile() && !isTranscript(modelId, file, root)),
    });
    // A native watcher can miss a rollout creation or its later writes. Only scan for
    // known live session IDs without a synced rollout, and stop after 30 seconds.
    const firstSeen = new Map<string, number>();
    let scanning = false;
    const recover = async () => {
      if (!active || scanning || !pendingCodexSessions) return;
      const current = new Set(pendingCodexSessions().filter(id => uuid.test(id)));
      for (const id of firstSeen.keys()) if (!current.has(id)) firstSeen.delete(id);
      const now = Date.now();
      for (const id of current) if (!firstSeen.has(id)) firstSeen.set(id, now);
      const wanted = (id: string) => active && Date.now() - (firstSeen.get(id) ?? 0) < forkRecoveryLimitMs && pendingCodexSessions().includes(id);
      if (![...current].some(wanted)) return;
      scanning = true;
      try {
        const today = new Date();
        for (const offset of [0, 1]) {
          if (![...current].some(wanted)) return;
          const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
          const parts = [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];
          let directory = root;
          let valid = true;
          try {
            for (const part of parts) {
              if (![...current].some(wanted)) return;
              directory = join(directory, part);
              if (!(await lstat(directory)).isDirectory()) { valid = false; break; }
            }
            if (!valid) continue;
            for (const name of await readdir(directory)) {
              const id = [...current].find(value => wanted(value) && name.endsWith(`-${value}.jsonl`));
              if (id && /^rollout-.*\.jsonl$/.test(name)) await ingest(join(directory, name), () => wanted(id), id);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && active) onError('CODEX 無法補讀 Session 目錄');
      } finally { scanning = false; }
    };
    const recoveryTimer = modelId === 'CODEX' && suffix === sessionRoots.CODEX[0] && pendingCodexSessions
      ? setInterval(() => { void recover(); }, forkRecoveryIntervalMs) : undefined;
    recoveryTimer?.unref();
    watcher.on('add', (file, info) => {
      if (!isTranscript(modelId, file, root)) return;
      if (initial) recent.set(file, info?.mtimeMs ?? 0);
      else void ingest(file);
    });
    watcher.on('change', (file, info) => {
      if (!isTranscript(modelId, file, root)) return;
      schedule(file, info?.size);
    });
    watcher.on('unlink', file => {
      clearTimeout(pending.get(file));
      pending.delete(file);
      recent.delete(file);
      onRemove(modelId, '~/' + relative(home, file));
    });
    watcher.on('ready', () => {
      initial = false;
      const sorted = [...recent].sort((a, b) => b[1] - a[1]);
      const files = sorted.filter(([file], index) => index < 50 || isArchived(modelId, file));
      recent.clear();
      void (async () => { for (const [file] of files) await ingest(file); })();
    });
    watcher.on('error', () => onError(`${modelId} 無法監聽 ${suffix}`));
    return async () => {
      active = false;
      clearInterval(recoveryTimer);
      for (const timer of pending.values()) clearTimeout(timer);
      await watcher.close();
    };
  }));
  return () => Promise.all(watchers.map(close => close()));
}

export async function roomDirectory(_root: string, requested: string) {
  if (!isAbsolute(requested)) throw new Error('請輸入 Mac 絕對路徑。');
  const cwd = await realpath(requested).catch(() => {
    throw new Error('找不到工作目錄。請先確認資料夾存在和磁碟已掛載。');
  });
  if (!(await stat(cwd)).isDirectory()) {
    throw new Error('工作目錄須是實際資料夾。');
  }
  return cwd;
}

/** A new room starts its CLI in the workspace folder itself (the folder that holds all the repos), whichever character it is for. */
export async function newRoomDirectory(root: string, _modelId: CLIModelId) {
  return roomDirectory(root, root);
}
