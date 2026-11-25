import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { HistoryNote } from '../src/components/HistoryNote';
import type { ServerEvent } from '../src/types/bridge';
import type { TerminalLogEntry, TerminalRoom } from '../src/types/guild';
import { HISTORY_DEFAULT, HISTORY_MAX, HISTORY_STEP } from '../src/utils/history';
import { Rooms } from './rooms';
import { mergeHistory, readSession } from './sessions';

const sessionId = '00000018-0018-4018-8018-000000000018';
const stamp = (n: number) => new Date(Date.UTC(2026, 10, 12, 10, 0, n)).toISOString();
const rolloutRow = (n: number) => JSON.stringify({ type: 'response_item', ordinal: n, timestamp: stamp(n),
  payload: { type: 'message', role: n % 2 ? 'user' : 'assistant', content: [{ type: n % 2 ? 'input_text' : 'output_text', text: `第 ${n} 則` }] } });
const entry = (id: string, sender: TerminalLogEntry['sender'], text: string, n: number): TerminalLogEntry => ({ id, sender, text, timestamp: '', createdAt: stamp(n) });

async function fixture(count: number) {
  const home = await mkdtemp(join(tmpdir(), 'komorebi-more-'));
  const dir = join(home, '.codex', 'sessions');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'rollout-2026-11-11T17-13-04-00000018-0018-4018-8018-000000000018.jsonl');
  await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: home } }), ...Array.from({ length: count }, (_, i) => rolloutRow(i + 1))].join('\n') + '\n');
  const emitted: ServerEvent[] = [];
  const rooms = new Rooms(home, event => emitted.push(event));
  rooms.sessionHome = home;
  rooms.sessionRootDirs = { AGY: [], CODEX: [dir], CLAUDE: [] };
  const session = await readSession('CODEX', file, dir, home);
  const room = { id: 'r', modelId: 'CODEX', sessionId, roomName: '光', repoPath: home, live: false, logs: session!.logs,
    historyTruncated: session!.truncated, syncedStateFile: '~/.codex/sessions/' + file.split('/').at(-1) } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  return { home, rooms, room, emitted };
}

test('loading earlier messages adds a step at a time, oldest first with no repeats, until nothing older exists', async () => {
  const { home, rooms, room, emitted } = await fixture(150);
  try {
    assert.equal(room.logs.length, HISTORY_DEFAULT);
    assert.equal(room.historyTruncated, true);
    const replies: ServerEvent[] = [];
    await rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, event => replies.push(event));
    assert.equal(room.logs.length, HISTORY_DEFAULT + HISTORY_STEP);
    assert.equal(room.logs.at(-1)?.text, '第 150 則');
    assert.equal(room.logs[0].text, `第 ${150 - HISTORY_DEFAULT - HISTORY_STEP + 1} 則`);
    assert.equal(new Set(room.logs.map(log => log.id)).size, room.logs.length);
    assert.deepEqual(room.logs.map(log => log.text), room.logs.map((_, i) => `第 ${150 - room.logs.length + 1 + i} 則`));
    assert.equal(room.historyTruncated, true);
    // Every connected device gets the longer room, so it is broadcast rather than answered to one client.
    assert.equal(emitted.at(-1)?.type, 'ROOM');
    await rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, event => replies.push(event));
    assert.equal(room.logs.length, 150);
    assert.equal(room.logs[0].text, '第 1 則');
    assert.equal(room.historyTruncated, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('there is a ceiling, and a room that cannot be read says so', async () => {
  const { home, rooms, room } = await fixture(5);
  try {
    const replies: ServerEvent[] = [];
    room.historyLimit = HISTORY_MAX;
    await rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, event => replies.push(event));
    assert.match((replies[0] as { message: string }).message, /上限/);
    room.historyLimit = undefined;
    room.syncedStateFile = '';
    await assert.rejects(rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, () => {}), /未有可讀取/);
    room.syncedStateFile = '~/../../etc/passwd';
    await assert.rejects(rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, () => {}), /位置無效/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a room that loaded more keeps that many when its file changes again', async () => {
  const { home, rooms, room } = await fixture(150);
  try {
    await rooms.handle({ type: 'HISTORY_MORE', roomId: room.id }, () => {});
    room.live = true;
    (rooms as any).live.set(room.id, { seenTranscriptAgents: new Set<string>(), seenTranscriptUsers: new Set<string>(), matchedLocalUsers: new Set<string>() });
    const dir = rooms.sessionRootDirs.CODEX[0];
    const file = join(dir, room.syncedStateFile!.split('/').at(-1)!);
    const session = await readSession('CODEX', file, dir, home, room.historyLimit);
    (rooms as any).sync({ ...session, updated: new Date(Date.now() + 5_000).toISOString() });
    assert.equal(room.logs.length, HISTORY_DEFAULT + HISTORY_STEP);
  } finally { (rooms as any).live.delete(room.id); await rm(home, { recursive: true, force: true }); }
});

test('the merged list is in time order, takes the transcript copy of matched messages, and keeps the room\'s own notes', () => {
  const transcript = [entry('t1', 'user', '你好', 1), entry('t2', 'agent', '你好呀', 2), entry('t3', 'user', '再問', 4), entry('t4', 'agent', '答', 5)];
  const current = [
    entry('local-a', 'user', '你好', 1),            // matched to t1
    entry('t2', 'agent', '你好呀', 2),
    entry('note', 'agent', '系統提示', 3),            // the room's own note, between t2 and t3
    entry('local-new', 'user', '最新', 9),           // not in the transcript yet
  ];
  const merged = mergeHistory(current, transcript, new Set(['local-a']));
  assert.deepEqual(merged.map(log => log.id), ['t1', 't2', 'note', 't3', 't4', 'local-new']);
  assert.equal(mergeHistory([], transcript).length, 4);
});

test('the note offers to load more, loads on reaching it, and says when nothing more can be loaded', () => {
  const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(HistoryNote, { count: 40, ...props } as never));
  assert.equal(html({ truncated: false, onLoadMore() {} }), '');
  assert.match(html({ truncated: true, onLoadMore() {} }), /<button[^>]*>載入更早訊息（已顯示 40 則）</);
  assert.match(html({ truncated: true }), /只顯示最近 40 則訊息/);
  assert.doesNotMatch(html({ truncated: true }), /<button/);
  const full = html({ truncated: true, count: HISTORY_MAX, onLoadMore() {} });
  assert.match(full, /已載入最多 300 則/);
  assert.doesNotMatch(full, /<button/);
});

test('a deeper read reaches messages an ordinary read cannot in a session that is mostly tool output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'komorebi-deep-'));
  try {
    const file = join(home, 'rollout-2026-11-11T17-13-04-00000018-0018-4018-8018-000000000018.jsonl');
    const lines = [JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: home } })];
    for (let i = 1; i <= 90; i++) {
      lines.push(rolloutRow(i * 2 - 1));
      lines.push(JSON.stringify({ type: 'response_item', ordinal: i * 2, timestamp: stamp(i * 2), payload: { type: 'custom_tool_call_output', output: 'x'.repeat(150_000) } }));
    }
    await writeFile(file, lines.join('\n') + '\n');
    const ordinary = await readSession('CODEX', file, home, home, 100, 2 * 1024 * 1024);
    const deep = await readSession('CODEX', file, home, home, 100, 64 * 1024 * 1024);
    assert.ok((ordinary?.logs.length ?? 0) < 30, `ordinary read found ${ordinary?.logs.length}`);
    assert.equal(deep?.logs.length, 90);
    assert.equal(deep?.truncated, false);
    // The deep read does not make the next ordinary read go that far.
    const after = await readSession('CODEX', file, home, home, 100, 2 * 1024 * 1024);
    assert.equal(after?.logs.length, ordinary?.logs.length);
  } finally { await rm(home, { recursive: true, force: true }); }
});
