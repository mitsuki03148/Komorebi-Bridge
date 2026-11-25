import { mkdtempSync } from './test-temp';
import { readFileSync, rmSync, truncateSync, watch, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerEvent } from '../src/types/bridge';
import type { TerminalRoom } from '../src/types/guild';
import { atPromptOnlyBlock, composerBlock, composerHint } from '../src/utils/roomUi';
import { idleDropMs, stepAwaiting, trackActivity } from '../src/utils/roomAttention';
import { beginInputTrace, Rooms } from './rooms';
import { composerText } from './terminal';

const baseRoom = (modelId: TerminalRoom['modelId'], extra: Partial<TerminalRoom> = {}) => ({
  id: 'steer', modelId, roomName: '測試', repoPath: '/tmp', gitBranch: '—', effortLevel: null, contextUsagePct: null, progressPercent: null,
  syncSource: '', syncedStateFile: '', currentActionSummary: '', bubbleSnippet: '', screen: '', logs: [], live: true,
  remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' },
  status: 'running', selectedSubModel: '—', updatedAt: '', ready: false, steerable: true, ...extra,
}) as TerminalRoom;

function terminal(lines: string[]) {
  return { modes: { bracketedPasteMode: true }, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
}

test('a plain prompt can steer a working CLI, while commands and images wait for the prompt', async () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const room = baseRoom('CLAUDE');
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, queued: 0, dirty: false };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    const results: ServerEvent[] = [];
    await assert.rejects(rooms.handle({ type: 'INPUT', roomId: room.id, text: '/compact' }, () => {}), /指令要等/);
    assert.deepEqual(writes, []);
    await new Promise<void>((resolve, reject) => {
      void rooms.handle({ type: 'INPUT', roomId: room.id, text: '改為先看測試', requestId: 'steer-1' }, event => {
        results.push(event);
        if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message));
      }).catch(reject);
    });
    assert.deepEqual(writes, ['改為先看測試', '\r']);
    assert.match((results.at(-1) as { message: string }).message, /處理完當前步驟會收到/);
    room.steerable = false;
    live.dirty = false;
    await assert.rejects(rooms.handle({ type: 'INPUT', roomId: room.id, text: '再改' }, () => {}), /未就緒/);
  } finally { (rooms as any).live.delete(room.id); }
});

test('the input box is reported open while the CLI works, but not during approvals or menus', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const working = baseRoom('CLAUDE', { steerable: undefined });
  const live = { singleNoted: true, process: { write() {} }, terminal: terminal(['Running…', 'auto mode on (shift+tab to cycle)  ·  esc to interrupt', '$']), queued: 0, dirty: false };
  (rooms as any).refresh(working, live);
  assert.equal(working.ready, false);
  assert.equal(working.steerable, true);
  live.terminal = terminal(['Permission Required: Bash command', '1. Yes', '2. No', 'Select with numbers [1-2]. Then Enter to submit or Escape to cancel:']);
  (rooms as any).refresh(working, live);
  assert.equal(working.steerable, false);
});

test('a swallowed Enter clears the stuck working state and says the text is still in the input box', async () => {
  const events: ServerEvent[] = [];
  const rooms = new Rooms(process.cwd(), event => events.push(event));
  rooms.submitCheckMs = 30;
  const room = baseRoom('CLAUDE', { status: 'running', ready: false });
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(['auto mode on (shift+tab to cycle)', '$  請幫我檢查一下這個房間']), queued: 0, dirty: false };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    // Text still typed: Enter is pressed once more, and only if it is still there is the user told.
    (rooms as any).verifySubmission(room, live, '請幫我檢查一下這個房間');
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.deepEqual(writes, ['\r']);
    assert.equal(events.some(event => event.type === 'NOTICE'), false);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.deepEqual(writes, ['\r']);
    assert.ok(events.some(event => event.type === 'NOTICE' && /輸入框仍然有/.test(event.message)));
    assert.equal(room.currentActionSummary, '輸入框仍有未送出的內容');
    // Nothing typed and nothing happening: the room is no longer shown as working.
    events.length = 0;
    live.terminal = terminal(['auto mode on (shift+tab to cycle)', '$']);
    (rooms as any).verifySubmission(room, live, '請幫我檢查一下這個房間');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(room.ready, true);
    assert.equal(room.status, 'idle');
    assert.deepEqual(writes, ['\r']);
    assert.equal(events.some(event => event.type === 'NOTICE'), false);
  } finally { (rooms as any).live.delete(room.id); }
});

test('when Codex offers to queue a message it will not send now, Tab is pressed once, and a waiting question is named', async () => {
  const events: ServerEvent[] = [];
  const rooms = new Rooms(process.cwd(), event => events.push(event));
  rooms.submitCheckMs = 30;
  const room = baseRoom('CODEX', { status: 'running', ready: false });
  const writes: string[] = [];
  const stuck = ['• Queued follow-up inputs', '  ? 1 question', '    ⇧← to answer', '', '› 睇唔到個問題添 唔識用CLI', '', '  tab to queue message', '  GPT-6.1-Sol high · ~/proj'];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(stuck), queued: 0, dirty: false };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    (rooms as any).verifySubmission(room, live, '睇唔到個問題添 唔識用CLI');
    await new Promise(resolve => setTimeout(resolve, 200));
    // Enter once more, then Tab once; never more than that.
    assert.deepEqual(writes, ['\r', '\t']);
    const notice = events.find(event => event.type === 'NOTICE');
    assert.ok(notice && notice.type === 'NOTICE' && /一條問題等你回答/.test(notice.message));
  } finally { (rooms as any).live.delete(room.id); }
});

test('a guarded Codex wake holds its delivery until it can verify Enter', async t => {
  const text = '[工作台 #2072] See All 獨立 debug （內容會自動附上；如未見到：/repo/scripts/komorebi-room bench show 2072 --from worker）';
  const footer = '  GPT-6.1-Sol high · ~/proj';
  const cases = [
    { name: 'first Enter accepted', accept: 1, keys: ['\r'], ok: true },
    { name: 'first Enter swallowed', accept: 2, keys: ['\r', '\r'], ok: true },
    { name: 'native transcript already has the input', echo: true, keys: ['\r'], ok: true },
    { name: 'both Enters swallowed', keys: ['\r', '\r', '\x15'], ok: false },
    { name: 'reservation revoked', revoke: true, keys: ['\r', '\x15'], ok: false },
    { name: 'another draft has the same prefix', edit: true, keys: ['\r'], ok: false },
    { name: 'a question appeared after paste', question: true, keys: ['\r'], ok: false },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const rooms = new Rooms(tmpdir(), () => {});
    rooms.submitCheckMs = 5;
    const lines = ['› Ask Codex to do anything', '', footer];
    const room = baseRoom('CODEX', { ready: true, status: 'idle', screen: lines.join('\n') });
    const writes: string[] = [];
    let idleNotifications = 0;
    rooms.onIdle = () => { idleNotifications++; };
    let enters = 0;
    let obsolete = false;
    const live = { terminal: terminal(lines), queued: 0, dirty: false, process: { write: (value: string) => {
      writes.push(value);
      if (value === text) {
        const split = text.indexOf(' （');
        lines.splice(0, lines.length, '› ' + text.slice(0, split), '  ' + text.slice(split + 1, split + 35), '  ' + text.slice(split + 35), '', footer);
      } else if (value === '\x15' && scenario.revoke) {
        lines.splice(0, lines.length, '› Ask Codex to do anything', '', footer);
      } else if (value === '\r') {
        enters++;
        if (enters === scenario.accept) lines.splice(0, lines.length, '› Ask Codex to do anything', '', footer);
        if (scenario.echo) room.logs.push({ id: 'native', sender: 'user', text, timestamp: '' });
        if (scenario.revoke) obsolete = true;
        if (scenario.edit) lines[2] += ' (draft edit)';
        if (scenario.question) lines.unshift('⇧← to answer');
      }
    } } };
    rooms.rooms.set(room.id, room);
    (rooms as any).live.set(room.id, live);
    try {
      const result = await new Promise<boolean>(resolve =>
        (rooms as any).submitInput(room, live, text, text, 1, resolve, undefined, false, undefined, undefined,
          (phase: 'paste' | 'submit') => phase === 'paste' || !obsolete));
      assert.equal(result, scenario.ok);
      assert.deepEqual(writes, [text, ...scenario.keys]);
      assert.equal(room.logs.filter(entry => entry.sender === 'user').length, scenario.ok ? 1 : 0);
      await Promise.resolve();
      if (!scenario.ok) assert.equal(idleNotifications, 0, 'a failed confirmation does not immediately schedule another wake');
    } finally { (rooms as any).live.delete(room.id); }
  });
});

test('composer stays quiet while steerable, and commands are held back with a reason', () => {
  const working = baseRoom('CODEX');
  assert.equal(composerBlock(working), undefined);
  assert.equal(composerHint(working), undefined, 'a steerable working room shows no hint line, so the footer does not jump');
  assert.match(composerBlock({ ...working, steerable: false })!, /回到輸入提示/);
  assert.match(atPromptOnlyBlock(working, '/compact')!, /指令/);
  assert.equal(atPromptOnlyBlock(working, '改為先看測試'), undefined);
  assert.equal(atPromptOnlyBlock({ ...working, ready: true }, '/compact'), undefined);
});

test('the bloom is dropped when a sent prompt leaves the CLI idle with a still terminal', () => {
  const room = baseRoom('AGY', { ready: true, status: 'idle', screenId: 's1' });
  const activity: Record<string, { mark: string; at: number }> = {};
  trackActivity(activity, [room], 1_000);
  const waiting = { steer: { at: 1_000, lastAgent: undefined, sawBusy: true } };
  const quiet = (id: string) => activity[id]?.at;
  assert.deepEqual(Object.keys(stepAwaiting(waiting, [room], 1_000 + idleDropMs - 1, quiet)), ['steer']);
  assert.deepEqual(stepAwaiting(waiting, [room], 1_000 + idleDropMs, quiet), {});
  // A moving screen keeps it alive.
  trackActivity(activity, [{ ...room, screenId: 's2' }], 10_000);
  assert.deepEqual(Object.keys(stepAwaiting(waiting, [room], 1_000 + idleDropMs, quiet)), ['steer']);
});

test('only the live input line counts as typed text, not messages echoed in the history', () => {
  const codexHistory = '› 請幫我檢查一下這個房間\n\n• 好，我看一下。\n\n› Ask Codex to do anything\n  GPT-6.1 Terra high · /tmp';
  assert.equal(composerText('CODEX', codexHistory), 'Ask Codex to do anything');
  assert.equal(composerText('CODEX', '• 完成\n\n› 請幫我檢查一下這個房間\n  GPT-6.1 Terra high · /tmp'), '請幫我檢查一下這個房間');
  const agyHistory = '> 請幫我檢查一下這個房間\n\nOK, checking.\n────────────────────────────────────────────────────────────\n> \n────────────────────────────────────────────────────────────\nauto · Gemini 3.8 Flash · low';
  assert.equal(composerText('AGY', agyHistory), '');
  assert.equal(composerText('AGY', 'working\n────────────────────────────────────────────────────────────\n> 請幫我檢查一下這個房間\n────────────────────────────────────────────────────────────\nauto'), '請幫我檢查一下這個房間');
  assert.equal(composerText('CLAUDE', '$  請幫我檢查一下\n回覆內容\n$'), '');
  assert.equal(composerText('CLAUDE', 'Running…\n$  請幫我檢查一下這個房間'), '請幫我檢查一下這個房間');
  assert.equal(composerText('CLAUDE', 'no prompt here'), undefined);
});

test('Claude transcript text drops the paste wrapper and image source line, and matches what was sent', async () => {
  const { transcriptText, userTextKey } = await import('../src/utils/transcriptText');
  const sent = '黃色 。果個萬字夾 不要外圈\n2 不要上次\n4. 想將 Hp/Mp 數字放這到';
  const wrapped = `<pasted_content id="2085">\n${sent}\n</pasted_content>`;
  assert.equal(transcriptText('CLAUDE', 'user', wrapped), sent);
  assert.equal(transcriptText('CODEX', 'user', wrapped), wrapped);
  assert.equal(transcriptText('CLAUDE', 'user', '[Image #1] 幫我看一下\n[Image: source: /Users/x/Komorebi Attachments/a.jpg]'), '📎 圖片 幫我看一下');
  assert.equal(userTextKey(wrapped), userTextKey(sent));
  assert.equal(userTextKey('[Image #1] 幫我看一下'), userTextKey('幫我看一下 📎 圖片'));
  // AGY's transcript has the attached images' paths in front of the text, run together; the copy Komorebi logged has only the marker.
  const attached = '/Users/someone/Documents/Komorebi Attachments/00000017-0017-4017-8017-000000000017.jpg/Users/someone/Documents/Komorebi Attachments/00000013-0013-4013-8013-000000000013.png 想用 bubble 邊顯示';
  assert.equal(userTextKey(attached), userTextKey('想用 bubble 邊顯示 📎 圖片 📎 圖片'));
  assert.notEqual(userTextKey('/Users/someone/notes/a.jpg 睇下'), userTextKey('睇下'), 'only Komorebi\'s own attachment folder is dropped');
  assert.notEqual(userTextKey('幫我看一下'), userTextKey('幫我看一下這個'));
});

test('a message Claude writes to its transcript with the paste wrapper is not logged a second time', async () => {
  const { transcriptText } = await import('../src/utils/transcriptText');
  const rooms = new Rooms(process.cwd(), () => {});
  const sessionId = '00000004-0004-4004-8004-000000000004';
  const sent = '黃色 。果個萬字夾 不要外圈\n2 不要上次';
  const room = baseRoom('CLAUDE', { id: sessionId, sessionId, ready: true, status: 'idle',
    logs: [{ id: 'local-1', timestamp: '11:13', sender: 'user', text: sent }, { id: 'local-2', timestamp: '11:14', sender: 'user', text: '幫我看一下 📎 圖片' }] });
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, { seenTranscriptAgents: new Set<string>(), seenTranscriptUsers: new Set<string>(), matchedLocalUsers: new Set<string>() });
  const entry = (id: string, text: string) => ({ id: `${sessionId}-${id}`, timestamp: '11:13', sender: 'user' as const, text: transcriptText('CLAUDE', 'user', text) });
  const session = { id: sessionId, modelId: 'CLAUDE' as const, cwd: '/tmp', branch: 'main', file: '/tmp/x.jsonl', updated: '2026-11-12T11:15:00Z', resumable: true,
    logs: [entry('u1', `<pasted_content id="2085">\n${sent}\n</pasted_content>`), entry('u2', '[Image #1] 幫我看一下\n[Image: source: /Users/x/a.jpg]')] };
  try {
    (rooms as any).sync(session);
    (rooms as any).sync({ ...session, updated: '2026-11-12T11:16:00Z' });
    assert.deepEqual(room.logs.map(log => log.id), ['local-1', 'local-2']);
    // A message that really came from elsewhere is still added once.
    const external = entry('u3', '<pasted_content id="2086">\n來自 app 的訊息\n</pasted_content>');
    (rooms as any).sync({ ...session, updated: '2026-11-12T11:17:00Z', logs: [...session.logs, external] });
    (rooms as any).sync({ ...session, updated: '2026-11-12T11:18:00Z', logs: [...session.logs, external] });
    assert.equal(room.logs.filter(log => log.text === '來自 app 的訊息').length, 1);
  } finally { (rooms as any).live.delete(room.id); }
});


const sent = (rooms: Rooms, roomId: string, text: string) => new Promise<void>((resolve, reject) => {
  void rooms.handle({ type: 'INPUT', roomId, text, requestId: 'r' }, event => { if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message)) }).catch(reject)
})
const workingCodex = ['• Working (18s • esc to interrupt) · 1 background terminal running', '', '› Ask Codex to do anything', '', '  GPT-6.1-Sol low · ~/proj']

test('while Claude is busy, its real draft prompt allows steering and records only send metadata', { timeout: 3000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rooms = new Rooms(dir, () => {});
  const path = rooms.inputLogPath = join(dir, 'input.log');
  rooms.submitCheckMs = 15;
  const room = baseRoom('CLAUDE', { ready: false, steerable: false });
  const draft = '私有內容✨🚀\n第二行';
  const writes: string[] = [];
  const lines = ['bypass permissions on (shift+tab to cycle) · esc to interrupt', '/rc', '$\u00a0 好呀先做1/2'];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(lines), queued: 0, dirty: true };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  writeFileSync(path, '');
  const watcher = watch(path);
  try {
    const written = once(watcher, 'change');
    await sent(rooms, room.id, draft);
    await written;
    assert.deepEqual(writes, [`\x1b[200~${draft}\x1b[201~`, '\r']);
    const raw = readFileSync(path, 'utf8');
    const [row, tail] = raw.split('\n');
    assert.equal(tail, '');
    assert.equal(raw.split('\n').length, 2);
    assert.doesNotMatch(raw, /私有內容|第二行|好呀先做/);
    const { timestamp, requestId, waitMs, ...entry } = JSON.parse(row);
    assert.equal(new Date(timestamp).toISOString(), timestamp);
    assert.match(requestId, /^[a-f0-9]{8}$/);
    assert.ok(waitMs >= 100);
    assert.deepEqual(entry, {
      source: 'submit', roomId: room.id, modelId: 'CLAUDE', utf16Length: draft.length, newlineCount: 1,
      ready: false, steerable: true, status: 'running', waitBranch: 'quiet', enterCount: 1, result: 'sent', reason: null,
    });
    // Fail logging without blocking the next PTY submit.
    rooms.inputLogPath = join(path, 'cannot-write-here');
    await sent(rooms, room.id, '仍然可以送出');
    assert.deepEqual(writes.slice(2), ['仍然可以送出', '\r']);
  } finally {
    watcher.close();
    (rooms as any).live.delete(room.id);
  }
});

test('input metadata rotates at 2 MiB and reports idle wake failures without recording content', t => {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'input.log');
  const room = baseRoom('AGY');
  const old = path + '.1';
  writeFileSync(old, 'old rotation');
  writeFileSync(path, 'last generation');
  truncateSync(path, 2 * 1024 * 1024);
  const trace = beginInputTrace(path, room, 'PRIVATE', 'idle-wake');
  trace.waited(null, 43);
  trace.finish('idle-wake-error');
  trace.finish();
  assert.equal(readFileSync(old).subarray(0, 15).toString(), 'last generation');
  const raw = readFileSync(path, 'utf8');
  assert.doesNotMatch(raw, /PRIVATE/);
  const row = JSON.parse(raw);
  assert.equal(row.requestId, trace.requestId);
  assert.equal(row.source, 'idle-wake');
  assert.equal(row.result, 'failed');
  assert.equal(row.reason, 'idle-wake-error');
  assert.equal(row.enterCount, null);
  assert.equal(row.waitMs, 43);
  assert.doesNotThrow(() => beginInputTrace(join(path, 'invalid'), room, 'PRIVATE', 'submit').finish('paste-write-failed'));
});

test('a message to a working CLI is judged on the up-to-date screen, not on the one before it was refreshed', async () => {
  const rooms = new Rooms(process.cwd(), () => {})
  const room = baseRoom('CODEX', { ready: false, steerable: false, status: 'running' })
  const writes: string[] = []
  // The room still says it cannot be steered (an old screen), but the screen it has by now shows an open input box.
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(workingCodex), queued: 0, dirty: true }
  rooms.rooms.set(room.id, room)
  ;(rooms as any).live.set(room.id, live)
  try {
    await sent(rooms, room.id, '補充：請寫暗號')
    assert.deepEqual(writes, ['補充：請寫暗號', '\r'])
  } finally { (rooms as any).live.delete(room.id) }
})

test('a CLI that is still drawing, with no input box yet, is given a moment, and a message goes through once the box is there', async () => {
  const rooms = new Rooms(process.cwd(), () => {})
  rooms.steerWaitMs = 20
  const room = baseRoom('CODEX', { ready: false, steerable: false, status: 'running' })
  const writes: string[] = []
  const lines = ['本工單由同組成員派出。', '完成：komorebi-room bench done 27']
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(lines), queued: 0, dirty: true }
  rooms.rooms.set(room.id, room)
  ;(rooms as any).live.set(room.id, live)
  try {
    setTimeout(() => { lines.splice(0, lines.length, ...workingCodex); live.dirty = true }, 70)
    await sent(rooms, room.id, '補充：請寫暗號')
    assert.deepEqual(writes, ['補充：請寫暗號', '\r'])
    // A CLI that never shows an input box is still refused, and says why.
    writes.length = 0
    lines.splice(0, lines.length, '仍然冇輸入框')
    live.dirty = true
    room.steerable = false
    await assert.rejects(rooms.handle({ type: 'INPUT', roomId: room.id, text: '再補充' }, () => {}), /未就緒/)
    assert.deepEqual(writes, [])
  } finally { (rooms as any).live.delete(room.id) }
})

test('a working CLI that never goes quiet still gets the message: Enter follows once the text shows in its input box, or after a short wait', async () => {
  const text = '補充：請寫暗號：梅'
  for (const echoes of [true, false]) {
    const rooms = new Rooms(process.cwd(), () => {})
    rooms.steerPatienceMs = 60
    const room = baseRoom('CODEX', { ready: false, steerable: true, status: 'running' })
    const writes: string[] = []
    const lines = [...workingCodex]
    const live: any = { singleNoted: true, process: { write: (value: string) => { writes.push(value); if (echoes && value === text) { lines[2] = `› ${text}`; live.dirty = true } } }, terminal: terminal(lines), queued: 0, dirty: false }
    rooms.rooms.set(room.id, room)
    ;(rooms as any).live.set(room.id, live)
    // Its timer and spinner redraw all the time, so it is never quiet.
    const redraw = setInterval(() => { live.lastOutputAt = Date.now() }, 10)
    try {
      const started = Date.now()
      await sent(rooms, room.id, text)
      assert.deepEqual(writes, [text, '\r'], echoes ? 'echo seen' : 'no echo, patience')
      if (echoes) assert.ok(Date.now() - started < 1_000, 'it did not wait out the patience')
    } finally { clearInterval(redraw); (rooms as any).live.delete(room.id) }
  }
})

test('a CLI that reads idle when the message is sent and starts a step right after still gets Enter once the text shows in its box', async () => {
  const text = '果個layout 唔洗跟足 你覺得點整咁靚就可以跟你'
  const rooms = new Rooms(process.cwd(), () => {})
  rooms.steerPatienceMs = 60
  const room = baseRoom('CODEX', { ready: true, steerable: true, status: 'idle' })
  const writes: string[] = []
  const lines = ['', '', '› Ask Codex to do anything', '', '  GPT-6.1-Sol low · ~/proj']
  const live: any = { singleNoted: true, process: { write: (value: string) => { writes.push(value); if (value === text) { lines.splice(0, lines.length, ...workingCodex); lines[2] = `› ${text}`; live.dirty = true } } }, terminal: terminal(lines), queued: 0, dirty: false }
  rooms.rooms.set(room.id, room)
  ;(rooms as any).live.set(room.id, live)
  // The step it starts redraws its timer all the time, so the terminal is never quiet.
  const redraw = setInterval(() => { if (writes.length) live.lastOutputAt = Date.now() }, 10)
  try {
    const started = Date.now()
    await sent(rooms, room.id, text)
    assert.deepEqual(writes, [text, '\r'])
    assert.ok(Date.now() - started < 2_000, 'it did not wait out the whole paste limit')
  } finally { clearInterval(redraw); (rooms as any).live.delete(room.id) }
})

test('a message for a closed room, or one that is closing because nobody was looking, reopens it and goes in once it is at its input box', async () => {
  const send = async (rooms: Rooms, roomId: string) => new Promise<ServerEvent>((resolve, reject) => {
    void rooms.handle({ type: 'INPUT', roomId, text: '繼續做', requestId: 'r1' }, event => {
      if (event.type === 'ACTION_RESULT') resolve(event);
    }).catch(reject);
  });
  const writes: string[] = [];
  const reopen = (rooms: Rooms, room: TerminalRoom, started: string[]) => {
    (rooms as any).startExisting = async () => {
      started.push(room.id);
      await new Promise(resolve => setTimeout(resolve, 60));
      room.live = true;
      (rooms as any).live.set(room.id, { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal: terminal(['$']), queued: 0, dirty: false });
      await new Promise(resolve => setTimeout(resolve, 60));
      room.ready = true;
    };
  };
  // Closed: it is started on its own session, waited for, then the message is sent.
  const rooms = new Rooms(process.cwd(), () => {});
  const room = baseRoom('CLAUDE', { live: false, ready: false, status: 'completed', sessionId: '11111111-1111-4111-8111-111111111111', resumable: true });
  const started: string[] = [];
  rooms.rooms.set(room.id, room);
  reopen(rooms, room, started);
  const result = await send(rooms, room.id);
  assert.deepEqual(started, [room.id]);
  assert.deepEqual(writes, ['繼續做', '\r']);
  assert.equal((result as { ok: boolean }).ok, true);
  // Closing automatically: it waits for the close to finish, then reopens once.
  const rooms2 = new Rooms(process.cwd(), () => {});
  const room2 = baseRoom('CLAUDE', { id: 'two', live: true, ready: false, status: 'running', sessionId: '22222222-2222-4222-8222-222222222222', resumable: true });
  let finishClose!: () => void;
  const closing = new Promise<void>(resolve => { finishClose = resolve; });
  rooms2.rooms.set(room2.id, room2);
  (rooms2 as any).live.set(room2.id, { singleNoted: true, process: { write() {} }, closing, closedAutomatically: true, queued: 0, dirty: false });
  const started2: string[] = [];
  writes.length = 0;
  reopen(rooms2, room2, started2);
  const pending = send(rooms2, room2.id);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(started2, [], 'not before the close has finished');
  (rooms2 as any).live.delete(room2.id);
  room2.live = false;
  finishClose();
  await pending;
  assert.deepEqual(started2, [room2.id]);
  assert.deepEqual(writes, ['繼續做', '\r']);
  // A room that cannot be resumed still says so, and one the user is closing by hand is not reopened.
  const rooms3 = new Rooms(process.cwd(), () => {});
  const room3 = baseRoom('CLAUDE', { id: 'three', live: false, ready: false, steerable: false, status: 'completed' });
  rooms3.rooms.set(room3.id, room3);
  await assert.rejects(rooms3.handle({ type: 'INPUT', roomId: room3.id, text: '喂' }, () => {}), /CLI 未就緒/);
  assert.match(readFileSync(new URL('./rooms.ts', import.meta.url), 'utf8'), /live\.closedAutomatically\) && room\.sessionId && room\.resumable/);
});

test('a revoked Codex wake clears its own remaining draft after the first Enter is swallowed', async () => {
  const rooms = new Rooms(tmpdir(), () => {});
  rooms.submitCheckMs = 5;
  const text = '[交接｜來自 工作台] 你的工作台有 2 張新工單';
  const footer = '  GPT-6.1-Sol high · ~/proj';
  const lines = ['› Ask Codex to do anything', '', footer];
  const room = baseRoom('CODEX', { ready: true, status: 'idle', screen: lines.join('\n') });
  const writes: string[] = [];
  let revoked = false;
  const live = { terminal: terminal(lines), queued: 0, dirty: false, process: { write: (value: string) => {
    writes.push(value);
    if (value === text) lines.splice(0, lines.length, '› ' + text, '', footer);
    if (value === '\r') revoked = true;
    if (value === '\x15') lines.splice(0, lines.length, '› Ask Codex to do anything', '', footer);
  } } };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    const result = await new Promise<boolean>(resolve => (rooms as any).submitInput(room, live, text, text, 1,
      resolve, undefined, false, undefined, undefined, (phase: string) => phase === 'paste' || !revoked));
    assert.equal(result, false);
    assert.deepEqual(writes, [text, '\r', '\x15']);
    assert.equal(composerText('CODEX', lines.join('\n')), 'Ask Codex to do anything');
  } finally { (rooms as any).live.delete(room.id); }
});

test('revoked wake cleanup waits for redraw, preserves edits, and reports unconfirmed control keys', async t => {
  for (const mode of ['redraw', 'edited', 'swallowed'] as const) await t.test(mode, async () => {
    const rooms = new Rooms(tmpdir(), () => {});
    rooms.submitCheckMs = 10;
    const text = '[交接｜來自 工作台] 你的工作台有 2 張新工單';
    const footer = '  GPT-6.1-Sol high · ~/proj';
    const lines = ['› Ask Codex to do anything', '', footer];
    const room = baseRoom('CODEX', { ready: true, status: 'idle', screen: lines.join('\n') });
    const writes: string[] = [];
    let revoked = false;
    const live = { terminal: terminal(lines), queued: 0, dirty: false, process: { write: (value: string) => {
      writes.push(value);
      if (value === text) lines.splice(0, lines.length, '› ' + text, '', footer);
      if (value === '\r') {
        revoked = true;
        if (mode === 'edited') lines[0] += ' user edit';
        if (mode === 'redraw') {
          live.queued = 1;
          setTimeout(() => { live.queued = 0; }, 250);
        }
      }
      if (value === '\x15' && mode === 'redraw') lines.splice(0, lines.length, '› Ask Codex to do anything', '', footer);
    } } };
    rooms.rooms.set(room.id, room);
    (rooms as any).live.set(room.id, live);
    try {
      const outcome = await new Promise<{ ok: boolean; message: string }>(resolve =>
        (rooms as any).submitInput(room, live, text, text, 1, (ok: boolean, message: string) => resolve({ ok, message }),
          undefined, false, undefined, undefined, (phase: string) => phase === 'paste' || !revoked));
      assert.equal(outcome.ok, false);
      if (mode === 'redraw') {
        assert.deepEqual(writes, [text, '\r', '\x15']);
        assert.match(outcome.message, /已清除/);
      } else {
        assert.deepEqual(writes, mode === 'edited' ? [text, '\r'] : [text, '\r', '\x15', '\x15']);
        assert.match(outcome.message, /未能確認/);
      }
    } finally { (rooms as any).live.delete(room.id); }
  });
});

test('a Codex wake revoked after paste but before Enter clears only its exact draft', async () => {
  const rooms = new Rooms(tmpdir(), () => {});
  rooms.submitCheckMs = 5;
  const text = '[交接｜來自 工作台] 你的工作台有 2 張新工單';
  const footer = '  GPT-6.1-Sol high · ~/proj';
  const lines = ['› Ask Codex to do anything', '', footer];
  const room = baseRoom('CODEX', { ready: true, status: 'idle', screen: lines.join('\n') });
  const writes: string[] = [];
  const live = { terminal: terminal(lines), queued: 0, dirty: false, process: { write: (value: string) => {
    writes.push(value);
    if (value === text) lines.splice(0, lines.length, '› ' + text, '', footer);
    if (value === '\x15') lines.splice(0, lines.length, '› Ask Codex to do anything', '', footer);
  } } };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    const outcome = await new Promise<{ ok: boolean; message: string }>(resolve =>
      (rooms as any).submitInput(room, live, text, text, 1, (ok: boolean, message: string) => resolve({ ok, message }),
        undefined, false, undefined, undefined, (phase: string) => phase === 'paste'));
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /已清除/);
    assert.deepEqual(writes, [text, '\x15']);
  } finally { (rooms as any).live.delete(room.id); }
});
