import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { appendFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { HistoryNote } from '../src/components/HistoryNote';
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';
import { historyLimit, readSession } from './sessions';

const sessionId = '00000018-0018-4018-8018-000000000018';
const row = (ordinal: number, payload: object) => JSON.stringify({ type: 'response_item', ordinal, timestamp: new Date(Date.UTC(2026, 10, 12, 10, 0, ordinal)).toISOString(), payload });
const message = (ordinal: number, text: string) => row(ordinal, { type: 'message', role: ordinal % 2 ? 'user' : 'assistant', content: [{ type: ordinal % 2 ? 'input_text' : 'output_text', text }] });
const toolOutput = (ordinal: number, size: number) => row(ordinal, { type: 'custom_tool_call_output', output: 'x'.repeat(size) });
const meta = (cwd: string) => JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd } });

test('a long tool-heavy session still shows its recent messages, in a stable order with stable ids', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-history-'));
  try {
    const file = join(tmp, 'rollout-2026-11-11T17-13-04-00000018-0018-4018-8018-000000000018.jsonl');
    // A message every ~120 KB of tool output, so the last 256 KB holds only a couple of them.
    const lines = [meta(tmp)];
    for (let i = 1; i <= 120; i++) { lines.push(message(i * 2 - 1, `訊息 ${i * 2 - 1}`)); lines.push(toolOutput(i * 2, 120_000)); }
    await writeFile(file, lines.join('\n') + '\n');
    const session = await readSession('CODEX', file, tmp, tmp);
    assert.ok(session);
    assert.ok(session.logs.length >= historyLimit - 1, `only ${session.logs.length} messages`);
    assert.equal(session.truncated, true);
    assert.equal(session.logs.at(-1)?.text, '訊息 239');
    const ids = session.logs.map(entry => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    // Appending more output must not renumber the messages that were already shown.
    await appendFile(file, [toolOutput(241, 300_000), message(243, '新訊息')].join('\n') + '\n');
    const later = await readSession('CODEX', file, tmp, tmp);
    assert.equal(later?.logs.at(-1)?.text, '新訊息');
    const known = new Set(later?.logs.map(entry => entry.id));
    assert.ok(ids.slice(1).every(id => known.has(id)), 'earlier messages changed id');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a short session shows everything and is not marked as cut off, while a long conversation keeps the newest and says so', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-history-'));
  try {
    const small = join(tmp, 'rollout-small.jsonl');
    await writeFile(small, [meta(tmp), message(1, '你好'), message(2, '你好呀')].join('\n') + '\n');
    const few = await readSession('CODEX', small, tmp, tmp);
    assert.deepEqual(few?.logs.map(entry => entry.text), ['你好', '你好呀']);
    assert.equal(few?.truncated, false);
    const long = join(tmp, 'rollout-long.jsonl');
    await writeFile(long, [meta(tmp), ...Array.from({ length: historyLimit + 25 }, (_, i) => message(i + 1, `第 ${i + 1} 則`))].join('\n') + '\n');
    const many = await readSession('CODEX', long, tmp, tmp);
    assert.equal(many?.logs.length, historyLimit);
    assert.equal(many?.logs.at(-1)?.text, `第 ${historyLimit + 25} 則`);
    assert.equal(many?.truncated, true);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('very long messages are limited by size so a room does not grow without bound', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-history-'));
  try {
    const file = join(tmp, 'rollout-big.jsonl');
    await writeFile(file, [meta(tmp), ...Array.from({ length: 12 }, (_, i) => message(i + 1, `${i + 1}:` + '字'.repeat(30_000)))].join('\n') + '\n');
    const session = await readSession('CODEX', file, tmp, tmp);
    assert.ok(session);
    assert.ok(session.logs.length < 12 && session.logs.length >= 1);
    assert.equal(session.logs.at(-1)?.text.startsWith('12:'), true);
    assert.equal(session.truncated, true);
    assert.ok(session.logs.reduce((sum, entry) => sum + entry.text.length, 0) <= 120_000 + 31_000);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('a live room keeps the newest messages and flags that older ones exist', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const entry = (i: number) => ({ id: `${sessionId}-${i}`, timestamp: '10:00', sender: 'agent' as const, text: `第 ${i} 則` });
  const room = { id: `session-codex-${sessionId}`, modelId: 'CODEX', sessionId, live: true, roomName: '測試', repoPath: '/tmp',
    logs: Array.from({ length: 5 }, (_, i) => ({ ...entry(i), id: `local-${i}` })) } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, { seenTranscriptAgents: new Set<string>(), seenTranscriptUsers: new Set<string>(), matchedLocalUsers: new Set<string>() });
  const session = { id: sessionId, modelId: 'CODEX' as const, cwd: '/tmp', branch: 'main', file: '/tmp/x.jsonl', updated: '2026-11-12T11:00:00Z', resumable: true,
    logs: Array.from({ length: historyLimit + 10 }, (_, i) => entry(i + 100)) };
  try {
    (rooms as any).sync(session);
    assert.equal(room.logs.length, historyLimit);
    assert.equal(room.logs.at(-1)?.text, `第 ${historyLimit + 109} 則`);
    assert.equal(room.historyTruncated, true);
    const offline = { ...room, id: 'session-codex-other', sessionId: '11111111-2222-3333-4444-555555555555', live: false, logs: [], historyTruncated: undefined } as unknown as TerminalRoom;
    rooms.rooms.set(offline.id, offline);
    (rooms as any).sync({ ...session, id: offline.sessionId, truncated: true, logs: [entry(1)] });
    assert.equal(offline.historyTruncated, true);
    (rooms as any).sync({ ...session, id: offline.sessionId, updated: '2026-11-12T11:05:00Z', truncated: false, logs: [entry(1)] });
    assert.equal(offline.historyTruncated, false);
  } finally { (rooms as any).live.delete(room.id); }
});

test('the conversation says when older messages are not shown', () => {
  assert.equal(renderToStaticMarkup(createElement(HistoryNote, { truncated: false, count: 5 })), '');
  assert.match(renderToStaticMarkup(createElement(HistoryNote, { truncated: true, count: 40 })), /只顯示最近 40 則訊息/);
  const room = (truncated: boolean) => ({ id: 'r', modelId: 'CODEX', roomName: '測試', repoPath: '/tmp', gitBranch: 'main', selectedSubModel: 'gpt',
    effortLevel: null, contextUsagePct: null, progressPercent: null, status: 'idle', currentActionSummary: '', bubbleSnippet: '', updatedAt: '', remoteControl: {},
    live: true, ready: true, historyTruncated: truncated, logs: [{ id: 'l', sender: 'agent', text: '你好', timestamp: '10:00' }] }) as unknown as TerminalRoom;
  const html = (truncated: boolean) => renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room: room(truncated), character: INITIAL_CHARACTERS.CODEX, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {},
    onSendPrompt() {}, onSubmitDraft() {}, attachmentPicker: null, attachmentPreview: null, hasAttachment: false,
    promptInput: '', setPromptInput() {}, onRunCompact() {}, terminal: null, terminalOpen: false, onToggleTerminal() {}, controls: null, onRedeemResetVoucher() {},
  }));
  assert.match(html(true), /只顯示最近 1 則訊息/);
  assert.doesNotMatch(html(false), /只顯示最近/);
});

test('the summary Claude writes when it compacts a conversation is not shown as something the user said', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-compact-'));
  try {
    const id = '00000019-0019-4019-8019-000000000019';
    const base = { sessionId: id, cwd: tmp, userType: 'external', gitBranch: 'main' };
    const summary = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.\n\n<system-reminder>\n<tools-used-before-summary>Agent, Bash</tools-used-before-summary>\n</system-reminder>';
    const file = join(tmp, `${id}.jsonl`);
    await writeFile(file, [
      { ...base, type: 'user', uuid: 'u1', timestamp: '2026-11-12T10:00:00Z', message: { role: 'user', content: '你好' } },
      { ...base, type: 'assistant', uuid: 'a1', timestamp: '2026-11-12T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: '你好呀' }] } },
      { ...base, type: 'user', uuid: 's1', timestamp: '2026-11-12T10:30:00Z', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: summary } },
      // The same text without the markers (an older format) is still recognised by what it says.
      { ...base, type: 'user', uuid: 's2', timestamp: '2026-11-12T10:31:00Z', message: { role: 'user', content: summary } },
      { ...base, type: 'user', uuid: 'u2', timestamp: '2026-11-12T10:32:00Z', message: { role: 'user', content: '繼續' } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const session = await readSession('CLAUDE', file, tmp, tmp);
    assert.deepEqual(session?.logs.map(entry => entry.text), ['你好', '你好呀', '繼續']);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('background-task notices Claude Code logs as user rows are not shown as messages from the user', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-tasknote-'));
  try {
    const id = '00000020-0020-4020-8020-000000000020';
    const base = { sessionId: id, cwd: tmp, userType: 'external', gitBranch: 'main' };
    const notice = '<task-notification>\n<task-id>bf70rxjky</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>';
    const file = join(tmp, `${id}.jsonl`);
    await writeFile(file, [
      { ...base, type: 'user', uuid: 'u1', timestamp: '2026-11-12T10:00:00Z', message: { role: 'user', content: '跑測試' } },
      { ...base, type: 'user', uuid: 'n1', timestamp: '2026-11-12T10:01:00Z', message: { role: 'user', content: notice } },
      { ...base, type: 'user', uuid: 'n2', timestamp: '2026-11-12T10:01:30Z', message: { role: 'user', content: `${notice}\n\n${notice}` } },
      // A real message that merely mentions the tag keeps being shown.
      { ...base, type: 'user', uuid: 'u2', timestamp: '2026-11-12T10:02:00Z', message: { role: 'user', content: '為何會看到 <task-notification> 這個字' } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const session = await readSession('CLAUDE', file, tmp, tmp);
    assert.deepEqual(session?.logs.map(entry => entry.text), ['跑測試', '為何會看到 <task-notification> 這個字']);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

const entry = (id: string, time: string, sender: 'user' | 'agent' = 'agent', text = id) => ({ id, timestamp: time, createdAt: `2026-11-12T${time}Z`, sender, text }) as never;

test('a message read later is placed by its time, and a list already out of order is put right', async () => {
  const { insertByTime, inTimeOrder } = await import('./sessions');
  const list = [entry('b', '10:00:00'), entry('d', '12:00:00')];
  insertByTime(list, entry('c', '11:00:00'));
  insertByTime(list, entry('a', '09:00:00'));
  insertByTime(list, entry('e', '13:00:00'));
  insertByTime(list, { id: 'x', timestamp: '—', sender: 'agent', text: 'no time' } as never);
  assert.deepEqual(list.map((item: { id: string }) => item.id), ['a', 'b', 'c', 'd', 'e', 'x']);
  const tangled = [entry('late1', '20:03:02'), entry('late2', '20:29:44'), entry('early1', '18:49:07'), entry('early2', '19:39:16'), entry('latest', '20:29:50')];
  assert.deepEqual(inTimeOrder(tangled).map((item: { id: string }) => item.id), ['early1', 'early2', 'late1', 'late2', 'latest']);
  // The same moment keeps the order it arrived in; a message with no time stays beside the one before it.
  const same = [entry('p', '10:00:00'), entry('q', '10:00:00'), { id: 'n', timestamp: '—', sender: 'agent', text: '' } as never, entry('r', '10:00:01')];
  assert.deepEqual(inTimeOrder(same).map((item: { id: string }) => item.id), ['p', 'q', 'n', 'r']);
});

test('a live room keeps its messages in time order when an older part of the conversation is read after a newer one', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-order-'));
  try {
    const manager = new Rooms(tmp, () => {}) as any;
    const id = '00000006-0006-4006-8006-000000000006';
    const saved = (logs: unknown[], updated: string) => ({ id, modelId: 'CLAUDE', cwd: tmp, branch: 'main', file: join(tmp, 'session.jsonl'), updated, logs, resumable: true });
    const t = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`;
    // 1. A first read after a restart only reaches the newest few messages.
    manager.sync(saved([entry(`${id}-m18`, t(18 * 60 + 3)), entry(`${id}-m19`, t(18 * 60 + 5))], '2026-11-12T20:06:00Z'));
    const room = manager.rooms.get(`session-claude-${id}`);
    room.live = true;
    manager.live.set(room.id, { seenTranscriptUsers: new Set(), seenTranscriptAgents: new Set(), matchedLocalUsers: new Set(), process: { write() {} }, queued: 0 });
    // 2. The phone sends a message that is shown at once, before the CLI has written it to its record.
    room.logs = [...room.logs, entry('local-user', t(18 * 60 + 29), 'user', '想問這個chart')];
    // 3. A later read reaches further back, and also holds what the CLI wrote since.
    const older = [1, 2, 3].map(n => entry(`${id}-a${n}`, t(16 * 60 + 49 + n)));
    const newer = [entry(`${id}-m20`, t(18 * 60 + 30))];
    manager.sync(saved([...older, entry(`${id}-m18`, t(18 * 60 + 3)), entry(`${id}-m19`, t(18 * 60 + 5)), ...newer], '2026-11-12T20:07:00Z'));
    assert.deepEqual(room.logs.map((item: { id: string }) => item.id), [`${id}-a1`, `${id}-a2`, `${id}-a3`, `${id}-m18`, `${id}-m19`, 'local-user', `${id}-m20`]);
    assert.equal(room.logs.every((item: { createdAt: string }, index: number, all: { createdAt: string }[]) => index === 0 || all[index - 1].createdAt <= item.createdAt), true);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
