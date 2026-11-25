import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { checkedInput } from './input';

test('multiline prompts preserve line breaks and are submitted as one bracketed paste', async () => {
  const { Rooms } = await import('./rooms');
  const rooms = new Rooms(process.cwd(), () => {});
  const room = { id: 'multiline', modelId: 'CODEX', ready: true, live: true, logs: [] } as unknown as import('../src/types/guild').TerminalRoom;
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (text: string) => writes.push(text) }, terminal: { modes: { bracketedPasteMode: true } }, queued: 0, dirty: false };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    await new Promise<void>((resolve, reject) => {
      rooms.handle({ type: 'INPUT', roomId: room.id, text: 'first\nsecond', requestId: 'test' }, event => {
        if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message));
      }).catch(reject);
    });
    assert.deepEqual(writes, ['\x1b[200~first\nsecond\x1b[201~', '\r']);
    assert.equal(room.logs[0].text, 'first\nsecond');
  } finally { (rooms as any).live.delete(room.id); }
});
import { newRoomDirectory, readSession, roomDirectory } from './sessions';
import { activeModel, approvalPrompt, hasWorkingIndicator, modelConfirmationChoices, numberedMenuChoices, readUsage, visibleMenu } from './terminal';

test('recognizes the AGY rules menu without a tracked slash command', () => {
  const rules = '> Project\nShared with Antigravity\nGlobal\nRules that apply only to this project\nKeyboard: ↑/↓ Navigate  enter Save  esc Close\nauto · Gemini 3.8 Flash · medium';
  assert.deepEqual(visibleMenu('AGY', rules, undefined), { title: '規則設定', confirm: true });
  assert.equal(visibleMenu('CODEX', rules, undefined), undefined);
  assert.equal(visibleMenu('AGY', rules.replace('esc Close', 'press any key'), undefined), undefined);
});

test('session effort is read from the latest relevant turn only', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-effort-'));
  const id = '00000006-0006-4006-8006-000000000006';
  try {
    const codex = join(tmp, 'codex.jsonl');
    await writeFile(codex, [
      { type: 'session_meta', payload: { id, cwd: tmp } },
      { type: 'turn_context', payload: { model: 'gpt-6.1', effort: 'low' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1', effort: 'high' } },
    ].map(row => JSON.stringify(row)).join('\n'));
    assert.equal((await readSession('CODEX', codex, tmp, tmp))?.lastEffort, 'high');
    const claude = join(tmp, 'claude.jsonl');
    await writeFile(claude, [
      { type: 'assistant', sessionId: id, cwd: tmp, effort: 'medium', message: { role: 'assistant', content: 'hello' } },
      { type: 'assistant', sessionId: id, cwd: tmp, isSidechain: true, effort: 'high', message: { role: 'assistant', content: 'ignored' } },
    ].map(row => JSON.stringify(row)).join('\n'));
    assert.equal((await readSession('CLAUDE', claude, tmp, tmp))?.lastEffort, 'medium');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('manual terminal keys require the same unrecognized screen and cannot bypass approval', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-terminal-key-'));
  const previous = process.cwd();
  try {
    process.chdir(tmp);
    const manager = new Rooms(tmp, () => {});
    const room = { id: 'manual', modelId: 'CODEX', screen: 'Unknown prompt', ready: false } as import('../src/types/guild').TerminalRoom;
    const writes: string[] = [];
    const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    const event = { type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen!, key: 'enter' } as const;
    await assert.rejects(manager.handle({ ...event, screen: 'stale' }, () => {}));
    await assert.rejects(manager.handle({ ...event, key: 'x' }, () => {}));
    room.pendingApproval = {} as typeof room.pendingApproval;
    await assert.rejects(manager.handle(event, () => {}));
    room.pendingApproval = undefined;
    await manager.handle(event, () => {});
    assert.deepEqual(writes, ['\r']);
    await assert.rejects(manager.handle(event, () => {}));
    (manager as any).live.delete(room.id);
  } finally { process.chdir(previous); await rm(tmp, { recursive: true, force: true }); }
});
test('Shift+Left reaches the CLI as a manual key, to open a queued question', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-terminal-key-'));
  const previous = process.cwd();
  try {
    process.chdir(tmp);
    const manager = new Rooms(tmp, () => {});
    const room = { id: 'queued-question', modelId: 'CODEX', screen: 'Queued follow-up inputs\n? 1 question\n⇧← to answer', ready: false } as import('../src/types/guild').TerminalRoom;
    const writes: string[] = [];
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, { singleNoted: true, process: { write: (value: string) => writes.push(value) }, queued: 0, dirty: false });
    await manager.handle({ type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen!, key: 'shift-left' }, () => {});
    assert.deepEqual(writes, ['\x1b[1;2D']);
    // The screen the user saw is out of date (a working CLI redraws all the time) and output is still arriving: it still goes through.
    const live = (manager as any).live.get(room.id);
    live.dirty = false;
    await manager.handle({ type: 'TERMINAL_KEY', roomId: room.id, screen: 'older screen', screenId: 'older', key: 'shift-left' }, () => {});
    assert.deepEqual(writes, ['\x1b[1;2D', '\x1b[1;2D']);
    // Idle: no other manual key is allowed, but Shift+Left still is.
    room.ready = true;
    live.dirty = false; live.queued = 0;
    await assert.rejects(manager.handle({ type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen!, key: 'enter' }, () => {}));
    live.dirty = false;
    await manager.handle({ type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen!, key: 'shift-left' }, () => {});
    assert.deepEqual(writes, ['\x1b[1;2D', '\x1b[1;2D', '\x1b[1;2D']);
    // With no question waiting on the screen, nothing is sent.
    room.screen = 'Working…\n› Ask Codex to do anything';
    live.dirty = false;
    await assert.rejects(manager.handle({ type: 'TERMINAL_KEY', roomId: room.id, screen: room.screen, key: 'shift-left' }, () => {}), /沒有排隊中的問題/);
    assert.equal(writes.length, 3);
    (manager as any).live.delete(room.id);
  } finally { process.chdir(previous); await rm(tmp, { recursive: true, force: true }); }
});
import { RoomPresence } from './presence';
import { displayRoom, isConversationEntry, transcriptText } from '../src/utils/transcriptText';

test('conversation excludes Claude command records while preserving ordinary prompts and replies', async () => {
  const command = '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>sonnet</command-args>';
  const result = '<local-command-stdout>Set model to Sonnet 5.5</local-command-stdout>';
  assert.equal(isConversationEntry('CLAUDE', 'user', command), false);
  assert.equal(isConversationEntry('CLAUDE', 'user', result), false);
  assert.equal(isConversationEntry('CODEX', 'user', '/compact'), false);
  assert.equal(isConversationEntry('CLAUDE', 'user', '請解釋 /model'), true);
  assert.equal(isConversationEntry('CLAUDE', 'user', '請分析 <command-name>/model</command-name>'), true);
  assert.equal(isConversationEntry('CLAUDE', 'agent', result), true);
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-conversation-'));
  try {
    const id = '00000006-0006-4006-8006-000000000006';
    const file = join(tmp, 'session.jsonl');
    const rows = [command, result, '你好'].map((content, index) => ({
      type: 'user', sessionId: id, cwd: tmp, uuid: String(index), timestamp: '2026-11-11T07:00:00Z', message: { role: 'user', content },
    }));
    rows.push({ type: 'assistant', sessionId: id, cwd: tmp, uuid: '3', timestamp: '2026-11-11T07:00:00Z', message: { role: 'assistant', content: '收到' } });
    rows.push({ ...rows[0], type: 'api-request-blob', uuid: '4', message: { role: 'user', content: 'Injected instructions' } });
    rows.push({ ...rows[0], uuid: '5', message: { role: 'user', content: '<system-reminder>Injected settings</system-reminder>' } });
    await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n'));
    const session = await readSession('CLAUDE', file, tmp, tmp);
    assert.deepEqual(session?.logs.map(entry => entry.text), ['你好', '收到']);
    assert.equal(session?.logs[0].createdAt, '2026-11-11T07:00:00.000Z');
    const room = { modelId: 'CLAUDE', logs: [
      { sender: 'user', text: command }, { sender: 'user', text: result },
      { sender: 'user', text: '你好' }, { sender: 'agent', text: '收到' },
    ] } as unknown as import('../src/types/guild').TerminalRoom;
    assert.deepEqual(displayRoom(room).logs.map(entry => entry.text), ['你好', '收到']);
    assert.equal(room.logs.length, 4);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('AGY user input envelopes display only the user request without altering other messages', () => {
  const wrapped = '<USER_REQUEST>\nKeep testing 新玩具 😆\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-12T02:13:16Z.\n</ADDITIONAL_METADATA>';
  assert.equal(transcriptText('AGY', 'user', wrapped), 'Keep testing 新玩具 😆');
  assert.equal(transcriptText('AGY', 'user', wrapped + '\n<USER_SETTINGS_CHANGE>New model</USER_SETTINGS_CHANGE>'), 'Keep testing 新玩具 😆');
  assert.equal(transcriptText('AGY', 'user', '<USER_REQUEST>\n  code\n    indented\n</USER_REQUEST>\n<ADDITIONAL_METADATA>time</ADDITIONAL_METADATA>'), '  code\n    indented');
  assert.equal(transcriptText('AGY', 'agent', wrapped), wrapped);
  assert.equal(transcriptText('CODEX', 'user', wrapped), wrapped);
  assert.equal(transcriptText('AGY', 'user', '<USER_REQUEST>literal</USER_REQUEST>'), '<USER_REQUEST>literal</USER_REQUEST>');
  assert.equal(transcriptText('AGY', 'user', wrapped + '\nmore'), wrapped + '\nmore');
  const room = { modelId: 'AGY', logs: [{ sender: 'user', text: wrapped }] } as unknown as import('../src/types/guild').TerminalRoom;
  assert.equal(displayRoom(room).logs[0].text, 'Keep testing 新玩具 😆');
  assert.equal(room.logs[0].text, wrapped, 'source data stays unchanged');
});

const browserDirective = '::browser-complete{title="Sent the completion notice"}';
const directiveRoom = (texts: string[], modelId = 'CODEX', sender = 'agent') => ({
  modelId, logs: texts.map((text, index) => ({ id: String(index), timestamp: '23:24', sender, text })),
}) as import('../src/types/guild').TerminalRoom;

test('Codex control-only replies produce no chat bubble and leave source messages intact', () => {
  const raw = directiveRoom([browserDirective, '::another-action{}']);
  assert.deepEqual(displayRoom(raw).logs, []);
  assert.deepEqual(raw.logs.map(entry => entry.text), [browserDirective, '::another-action{}']);
  assert.equal(transcriptText('CODEX', 'agent', browserDirective), browserDirective);
  assert.equal(displayRoom(directiveRoom([browserDirective], 'CODEX', 'user')).logs[0].text, browserDirective);
  for (const model of ['CLAUDE', 'AGY']) {
    assert.equal(displayRoom(directiveRoom([browserDirective], model)).logs[0].text, browserDirective);
  }
});

test('Codex control lines are stripped from mixed replies while inline references remain', () => {
  const body = ['已送出通知。', '例如 ::foo{} 呢段係正文。', '::foo{} and ::bar{}', '`::foo{}`'];
  const raw = directiveRoom([[browserDirective, '', body[0], '::another-action{title="配對 {}"}', ...body.slice(1), '', browserDirective].join('\r\n')]);
  assert.equal(displayRoom(raw).logs[0].text, body.join('\r\n'));
});

test('Codex replies preserve literal control syntax in Markdown code', () => {
  const code = [
    '```ts\n::foo{}\n```',
    '~~~\n::foo{}\n~~~',
    '    ::foo{}',
    '- Example\n\n  ```\n  ::foo{}\n  ```',
    'Inline `example\n::foo{}\ncontinued`',
  ].join('\n\n');
  const [entry] = displayRoom(directiveRoom([code + '\n\n' + browserDirective])).logs;
  assert.equal(entry.text, code);
});

test('only the last room viewer leaving schedules a close, and reconnect cancels it', async () => {
  const closed: string[] = [];
  const presence = new RoomPresence<string>(room => closed.push(room), 20);
  const wait = () => new Promise(resolve => setTimeout(resolve, 35));
  try {
    presence.view('mac', 'one');
    presence.view('phone', 'one');
    presence.view('phone', 'two');
    await wait();
    assert.deepEqual(closed, [], 'Mac still views the first room');
    presence.view('mac', null);
    presence.view('reconnected', 'one');
    await wait();
    assert.deepEqual(closed, [], 'reconnection within the grace period cancels closure');
    presence.view('reconnected', null);
    presence.view('phone', null);
    await wait();
    assert.deepEqual(closed.sort(), ['one', 'two']);
  } finally { presence.dispose(); }
});

test('an older or reconnecting client with unknown room prevents premature closure', async () => {
  const closed: string[] = [];
  const presence = new RoomPresence<string>(room => closed.push(room), 15);
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    presence.register('old-client');
    presence.register('phone');
    presence.view('phone', 'one');
    presence.disconnect('phone');
    await wait();
    assert.deepEqual(closed, []);
    presence.view('old-client', 'one');
    await wait();
    assert.deepEqual(closed, []);
    presence.disconnect('old-client');
    await wait();
    assert.deepEqual(closed, ['one']);
  } finally { presence.dispose(); }
});

test('a group view protects every member and busy rooms close only after becoming idle', async () => {
  const closed: string[] = [];
  let busy = true;
  const presence = new RoomPresence<string>(room => {
    if (room === 'a' && busy) return false;
    closed.push(room);
  }, 15);
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    presence.viewMany('phone', ['a', 'b']);
    presence.view('mac', 'b');
    presence.disconnect('phone');
    await wait();
    assert.deepEqual(closed, []);
    busy = false;
    presence.idle('a');
    await wait();
    assert.deepEqual(closed, ['a']);
    presence.disconnect('mac');
    await wait();
    assert.deepEqual(closed, ['a', 'b']);
  } finally { presence.dispose(); }
});

test('group deletion considers idle rooms even when the deleted group was not being viewed', async () => {
  const closed: string[] = [];
  let busy = true;
  const presence = new RoomPresence<string>(room => {
    if (room === 'busy' && busy) return false;
    closed.push(room);
  }, 15);
  const wait = () => new Promise(resolve => setTimeout(resolve, 35));
  try {
    presence.view('other-device', 'viewed');
    for (const room of ['idle', 'busy', 'viewed']) presence.considerUnviewed(room);
    await wait();
    assert.deepEqual(closed, ['idle']);
    busy = false;
    presence.idle('busy');
    await wait();
    assert.deepEqual(closed.sort(), ['busy', 'idle']);
    assert.equal(presence.hasViewers('viewed'), true);
  } finally { presence.dispose(); }
});

test('room activity restarts the idle grace period after leaving', async () => {
  const closed: string[] = [];
  const presence = new RoomPresence<string>(room => { closed.push(room); }, 80);
  try {
    presence.view('phone', 'a');
    presence.disconnect('phone');
    await new Promise(resolve => setTimeout(resolve, 45));
    presence.activity('a', true);
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.deepEqual(closed, []);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(closed, ['a']);
  } finally { presence.dispose(); }
});

test('automatic close preserves conversations without a resumable session', async () => {
  const { Rooms } = await import('./rooms');
  const manager = new Rooms(tmpdir(), () => {});
  let kills = 0;
  const room = { id: 'test', modelId: 'CODEX', repoPath: tmpdir(), roomName: '測試', logs: [{ sender: 'user' }], live: true, ready: true, status: 'idle',
    resumable: false } as import('../src/types/guild').TerminalRoom;
  manager.rooms.set(room.id, room);
  const live = { process: { kill: () => { kills++; } } };
  (manager as any).live.set(room.id, live);
  manager.closeUnviewed(room.id);
  assert.equal(kills, 0);
  room.sessionId = '00000006-0006-4006-8006-000000000006';
  manager.closeUnviewed(room.id);
  assert.equal(kills, 0, 'an explicitly non-resumable session remains open');
  room.resumable = true;
  (manager as any).durableBindings.add(`session-codex-${room.sessionId}`);
  (manager as any).roomBindings.set(`session-codex-${room.sessionId}`, { roomId: room.id });
  room.ready = false;
  room.status = 'running';
  assert.equal(manager.closeUnviewed(room.id), false, 'a working agent is not interrupted');
  assert.equal(kills, 0);
  room.ready = true;
  room.status = 'idle';
  manager.closeUnviewed(room.id);
  manager.closeUnviewed(room.id);
  assert.equal(kills, 1, 'a resumable process is closed only once');
  (manager as any).live.delete(room.id);
});

test('returning while automatic close is in progress resumes only if still viewed', async () => {
  const { Rooms } = await import('./rooms');
  const manager = new Rooms(tmpdir(), () => {});
  const room = { id: 'test', modelId: 'CODEX', repoPath: tmpdir(), roomName: '測試', logs: [], live: true, ready: true, status: 'idle',
    sessionId: '00000006-0006-4006-8006-000000000006', resumable: true } as unknown as import('../src/types/guild').TerminalRoom;
  manager.rooms.set(room.id, room);
  (manager as any).durableBindings.add(`session-codex-${room.sessionId}`);
  (manager as any).roomBindings.set(`session-codex-${room.sessionId}`, { roomId: room.id });
  const live: any = { process: { kill() {} } };
  (manager as any).live.set(room.id, live);
  let starts = 0;
  (manager as any).handle = async () => { starts++; };
  manager.closeUnviewed(room.id);
  const reopened = manager.reopenIfClosing(room.id, () => true);
  const departed = manager.reopenIfClosing(room.id, () => false);
  assert.equal(starts, 0);
  live.resolveClose();
  await Promise.all([reopened, departed]);
  assert.equal(starts, 1);
  (manager as any).live.delete(room.id);
});

test('Composer accepts prompts and provider-specific slash actions and rejects direct shell and control input', () => {
  assert.equal(checkedInput('AGY', '請檢查這個房間'), '請檢查這個房間');
  const reviewPrompt = '響，請 review 一次。\nRepo：`/Users/test/Komorebi`\nBranch：`main`\nReview commit：`abc1234`';
  assert.equal(checkedInput('CLAUDE', reviewPrompt), reviewPrompt);
  const naturalPrompt = '請分析以下例子：\n```sh\ngit status && gh pr status\n```\n$HOME < 100% & 其他內容';
  assert.equal(checkedInput('CLAUDE', naturalPrompt), naturalPrompt);
  assert.equal(checkedInput('AGY', '/rc off'), '/remote-control off');
  assert.equal(checkedInput('CODEX', '/effort xhigh'), '/model --reasoning=xhigh');
  assert.equal(checkedInput('CODEX', '/model gpt-6.1-sol'), '/model gpt-6.1-sol');
  assert.equal(checkedInput('CLAUDE', '/model sonnet'), '/model sonnet');
  assert.equal(checkedInput('CLAUDE', '/effort max'), '/effort max');
  assert.equal(checkedInput('AGY', '/effort medium'), '/effort medium');
  assert.equal(checkedInput('AGY', '/config'), '/config');
  assert.equal(checkedInput('CLAUDE', '/config'), '/config');
  assert.equal(checkedInput('CLAUDE', '/plugin list'), '/plugin list');
  assert.equal(checkedInput('CODEX', '/model --reasoning=high'), '/model --reasoning=high');
  assert.equal(checkedInput('CODEX', '/clear'), '/new');
  assert.equal(checkedInput('CLAUDE', '/model claude-sonnet-5-5'), '/model claude-sonnet-5-5');
  for (const input of ['/bin/bash', '!ls', '!git status', '/compact; whoami', '/usr/bin/gh issue list', '/bash', '/shell rm test', '/plugin rm test', 'Hello\x1b[A']) {
    assert.throws(() => checkedInput('CODEX', input));
  }
  // Without a leading "/" a line is plain text, even when it reads like a command.
  for (const input of ['sudo ls', 'rm test', 'curl https://example.com', 'git status', 'gh pr list', 'git log 睇下邊個改咗呢個檔', 'npm test 失敗，幫我睇']) {
    assert.equal(checkedInput('CODEX', input), input);
  }
  assert.equal(checkedInput('AGY', '/unknown'), '/unknown');
});

test('approval selects only one-time allow or explicit rejection on the installed CLI layouts', () => {
  const agy = 'Requesting permission for:\n   /usr/bin/touch fixture.txt\n\nRun this command?\n> 1. Yes, run command\n  2. No, cancel\n\n↑/↓ Navigate · tab Amend\nesc to cancel';
  const codex = 'Would you like to run the following command?\n\n  $ /usr/bin/true\n\n› 1. Yes, proceed (y)\n  2. Yes, and don\'t ask again (p)\n  3. No, and tell Codex what to do differently (esc)\n\n  Press enter to confirm or esc to cancel';
  const claude = 'Permission Required: Bash command\n> /usr/bin/touch fixture.txt\nDo you want to proceed?\n1. Yes\n2. Yes, and don’t ask again\n3. Yes, and switch to auto mode\n4. No\nSelect with numbers [1-4]. Then Enter to submit or Escape to cancel:\nEsc to cancel';
  assert.equal(approvalPrompt('AGY', agy)?.no, '\x1b[B\r');
  assert.equal(approvalPrompt('CODEX', codex)?.yes, '\r');
  assert.equal(approvalPrompt('CODEX', codex)?.no, '\x1b[B\x1b[B\r');
  assert.equal(approvalPrompt('CODEX', codex)?.additional.remember, '\x1b[B\r');
  assert.equal(approvalPrompt('CODEX', codex.replace('› 1. Yes, proceed (y)', '  1. Yes, proceed (y)').replace('  2. Yes, and don\'t ask again (p)', '› 2. Yes, and don\'t ask again (p)'))?.additional.remember, '\r');
  // Unrecognised middle options are listed verbatim under a neutral id; the UI asks for confirmation before sending.
  assert.deepEqual(approvalPrompt('CODEX', codex.replace("Yes, and don't ask again (p)", 'Yes, enable full access'))?.additional, { 'option-2': '\x1b[B\r' });
  assert.equal(approvalPrompt('CLAUDE', claude)?.yes, '1\r');
  assert.equal(approvalPrompt('CLAUDE', claude)?.no, '4\r');
  assert.deepEqual(approvalPrompt('CLAUDE', claude)?.additional, { remember: '2\r', auto: '3\r' });
  assert.deepEqual(approvalPrompt('CLAUDE', claude)?.card.additionalChoices?.map(choice => choice.id), ['remember', 'auto']);
  assert.deepEqual(approvalPrompt('CLAUDE', claude.replace('3. Yes, and switch to auto mode', '3. Yes, allow all commands forever'))?.additional, { remember: '2\r', 'option-3': '3\r' });
  assert.deepEqual(approvalPrompt('CLAUDE', claude.replace('2. Yes, and don’t ask again\n3. Yes, and switch to auto mode\n4. No', '2. No').replace('[1-4]', '[1-2]'))?.additional, {});
  assert.equal(approvalPrompt('CLAUDE', claude + '\n\n$'), undefined);
  assert.equal(approvalPrompt('CODEX', 'Would you like to run a command? (y/n)'), undefined);
});

test('every numbered Claude approval option is exposed, including file prompts with key hints', () => {
  const screen = 'Permission Required: Create file\n  Review/UI-FRESH-REVIEW/HANDOFF.md\nDo you want to create HANDOFF.md?\n(selected) 1. Yes\n2. Yes, allow all edits during this session (shift+tab)\n3. Yes, and switch to auto mode (shift+tab twice)\n4. No\nSelect with numbers [1-4]. Then Enter to submit or Escape to cancel:';
  const parsed = approvalPrompt('CLAUDE', screen)!;
  assert.equal(parsed.yes, '1\r');
  assert.equal(parsed.no, '4\r');
  assert.deepEqual(parsed.card.additionalChoices, [
    { id: 'option-2', key: '2', label: 'Yes, allow all edits during this session (shift+tab)' },
    { id: 'auto', key: '3', label: 'Yes, and switch to auto mode (shift+tab twice)' },
  ]);
  assert.deepEqual(parsed.numbered, { '1': '1\r', '2': '2\r', '3': '3\r', '4': '4\r' });
  const arrows = 'Permission Required: Edit file\n  src/a.ts\n❯ 1. Yes\n  2. Yes, allow all edits during this session (shift+tab)\n  3. No, and tell Claude what to do differently (esc)\nEsc to cancel';
  const arrowParsed = approvalPrompt('CLAUDE', arrows)!;
  assert.deepEqual(arrowParsed.card.additionalChoices?.map(choice => choice.key), ['2']);
  assert.deepEqual(arrowParsed.numbered, { '1': '\r', '2': '\x1b[B\r', '3': '\x1b[B\x1b[B\r' });
});

test('a number typed during an approval answers the matching option on the current screen only', async () => {
  const { Rooms } = await import('./rooms');
  const manager = new Rooms(process.cwd(), () => {});
  const screen = 'Permission Required: Create file\n  notes.md\n1. Yes\n2. Yes, allow all edits during this session (shift+tab)\n3. No\nSelect with numbers [1-3]. Then Enter to submit or Escape to cancel:';
  const parsed = approvalPrompt('CLAUDE', screen)!;
  const room = { id: 'approval-number', modelId: 'CLAUDE', live: true, logs: [], screen, pendingApproval: parsed.card } as unknown as import('../src/types/guild').TerminalRoom;
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, approvalFingerprint: parsed.fingerprint, queued: 0, dirty: false };
  manager.rooms.set(room.id, room);
  (manager as any).live.set(room.id, live);
  try {
    await assert.rejects(manager.handle({ type: 'INPUT', roomId: room.id, text: '7', requestId: 'n7' }, () => {}));
    live.approvalFingerprint = 'stale';
    await assert.rejects(manager.handle({ type: 'INPUT', roomId: room.id, text: '2', requestId: 'n2' }, () => {}));
    assert.deepEqual(writes, []);
    live.approvalFingerprint = parsed.fingerprint;
    const results: import('../src/types/bridge').ServerEvent[] = [];
    await manager.handle({ type: 'INPUT', roomId: room.id, text: '2', requestId: 'n2' }, reply => results.push(reply));
    assert.deepEqual(writes, ['2\r']);
    assert.equal(room.pendingApproval, undefined);
    assert.deepEqual(room.logs, []);
    assert.deepEqual(results, [{ type: 'ACTION_RESULT', requestId: 'n2', ok: true, message: '已將選項 2 送到 CLI' }]);
  } finally { (manager as any).live.delete(room.id); }
});

test('composer accepts long prompts and prose that starts with a path', () => {
  const long = '請 review 以下內容：\n' + '- `item`\n'.repeat(5_000);
  assert.ok(long.length > 12_000);
  assert.equal(checkedInput('CLAUDE', long), long.trim());
  assert.equal(checkedInput('CLAUDE', '/Users/test/Komorebi 這個 repo 幫我看一下'), '/Users/test/Komorebi 這個 repo 幫我看一下');
  assert.throws(() => checkedInput('CLAUDE', 'x'.repeat(100_001)), /上限/);
  assert.throws(() => checkedInput('CLAUDE', '/usr/bin/git status'));
});

test('Codex folder access screen requires an explicit trust decision', () => {
  const screen = 'Folder access\n/Users/example/project\n\nTrust this folder? Codex can read, edit, and run code.\nYour trust decision will be saved.\n\n› 1. Trust and continue\n  2. Back to Agent Command Center\n\nenter continue · esc back';
  const prompt = approvalPrompt('CODEX', screen);
  assert.equal(prompt?.card.type, 'workspace_trust');
  assert.match(prompt!.card.commandOrFile, /\/Users\/example\/project/);
  assert.equal(prompt?.yes, '\r');
  assert.equal(prompt?.no, '\x1b[B\r');
  const second = screen.replace('› 1.', '  1.').replace('  2.', '› 2.');
  assert.equal(approvalPrompt('CODEX', second)?.yes, '\x1b[A\r');
  assert.equal(approvalPrompt('CODEX', second)?.no, '\r');
  assert.equal(approvalPrompt('CODEX', screen.replace('2. Back to Agent Command Center', '2. Something else')), undefined);
});

test('Claude full-access startup asks for explicit confirmation', () => {
  const screen = 'This mode should only be used in a sandboxed container\nBy proceeding, you accept all responsibility\ny. Yes, I accept\nn. No, exit\nEnter y/n:\nEnter to confirm · Esc to cancel';
  const approval = approvalPrompt('CLAUDE', screen);
  assert.equal(approval?.card.title, '確認啟用全權模式');
  assert.equal(approval?.yes, 'y\r');
  assert.equal(approval?.no, 'n\r');
  assert.equal(approvalPrompt('CLAUDE', screen.replace('n. No, exit', 'n. Other')), undefined);
});

test('Claude model switch yes/no is recognized without treating other prompts as model confirmation', () => {
  const screen = 'you: /model opus\nSwitch model?\nYour next response will be slower\ny. Yes, switch to Opus 5.5\nn. No, go back\nPlease answer y or n.\nEnter y/n:';
  assert.equal(modelConfirmationChoices('CLAUDE', screen), true);
  assert.equal(modelConfirmationChoices('CLAUDE', screen.replace('Switch model?', 'Permission Required:')), false);
  assert.equal(modelConfirmationChoices('CODEX', screen), false);
  assert.equal(visibleMenu('CLAUDE', screen, '/model opus')?.title, '模型／推理力度');
});

test('quota values and visible menus follow the rendered provider screen', () => {
  for (const model of ['AGY', 'CODEX', 'CLAUDE'] as const) {
    assert.equal(checkedInput(model, '/permissions'), '/permissions');
    assert.deepEqual(visibleMenu(model, 'Permissions\n1. Settings\nEsc to cancel', '/permissions'), { title: '權限設定', confirm: true });
  }
  assert.deepEqual(readUsage('CLAUDE', 'Current session\n81% 81% used\nResets 5:40pm\nCurrent week (all models)\n64% 64% used', ''),
    { hp: 19, mp: 36, vouchers: undefined });
  assert.deepEqual(readUsage('CODEX', '  Weekly limit: 26% left\n  Earned resets: 2', ''),
    { hp: undefined, mp: 26, vouchers: 2 });
  assert.deepEqual(readUsage('AGY',
    'GEMINI MODELS\nWeekly Limit Remaining\n 12.31%\n\nFive Hour Limit Remaining\n 100%\n\nCLAUDE AND GPT MODELS\nWeekly Limit Remaining\n 91%',
    'Gemini 3.8 Flash'), { hp: 100, mp: 12.31, vouchers: undefined });
  assert.equal(visibleMenu('CODEX', '  Usage\n  Account usage and resets.\n› 1. View analytics\n  2. Redeem reset\n  enter open · esc back', '/usage')?.confirm, true);
  const noResets = "Usage limit resets\nYou don't have any usage limit resets available.\n› 1. Close\nenter select · esc back";
  assert.equal(readUsage('CODEX', noResets, '').vouchers, 0);
  assert.equal(visibleMenu('CODEX', noResets, '/usage')?.confirm, true);
  assert.equal(hasWorkingIndicator('⣟  Running command...\n>'), true);
  assert.equal(hasWorkingIndicator('● Explored 4 files\n⣿  Reading file...\n──────\n>\n──────\nesc to cancel'), true);
  assert.equal(hasWorkingIndicator('● Ran (git status)\n──────\n>\n──────\n? for shortcuts'), false);
  assert.equal(visibleMenu('CLAUDE', 'Current session\n19% used\nEsc to cancel', '/usage')?.confirm, false);
  assert.equal(visibleMenu('CLAUDE', 'Settings\n1. General\nEsc to cancel', '/config')?.confirm, true);
  assert.equal(activeModel('CODEX', '  GPT-6.1-Sol high · /private/tmp/test').name, 'GPT-6.1-Sol');
  // AGY footer: with a mode in front, with none (the default mode, captured from the real CLI), and sharing a line with the shortcuts hint.
  assert.deepEqual(activeModel('AGY', 'auto · Gemini 3.8 Flash · medium'), { name: 'Gemini 3.8 Flash', effort: 'medium' });
  assert.deepEqual(activeModel('AGY', '>\n? for shortcuts' + ' '.repeat(80) + 'Gemini 4 Hydrogen · medium'), { name: 'Gemini 4 Hydrogen', effort: 'medium' });
  assert.deepEqual(activeModel('AGY', '? for shortcuts' + ' '.repeat(82) + 'Gemini 4 Hydrogen · high'), { name: 'Gemini 4 Hydrogen', effort: 'high' });
  assert.deepEqual(activeModel('AGY', '  Effort set to high\n' + ' '.repeat(90) + 'Gemini 4 Hydrogen · xhigh'), { name: 'Gemini 4 Hydrogen', effort: 'xhigh' });
  assert.deepEqual(activeModel('AGY', 'plain text with no footer'), { name: undefined, effort: undefined });
  assert.equal(activeModel('CLAUDE', 'Set model to Sonnet 5.5 and saved as your default for future sessions.').name, 'Sonnet 5.5');
  assert.equal(activeModel('CLAUDE', 'Set model to Sonnet 5.5 and saved as your default\nSet model to Opus 5.5 · high effort').name, 'Opus 5.5');
  assert.equal(activeModel('CLAUDE', 'Set model to Sonnet 5.5 and saved as your default\nOpus 5.5 with high effort').name, 'Opus 5.5');
  assert.equal(activeModel('CLAUDE', 'Opus 5.5 with high effort\nSet effort level to medium (saved as your default)').effort, 'medium');
  assert.equal(activeModel('CLAUDE', 'Set effort level to medium\nOpus 5.5 with high effort').effort, 'high');
});

test('resolves explicit project paths and imports Codex transcripts outside the default workspace', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-unit-'));
  try {
    const workspace = join(tmp, 'work');
    const project = join(workspace, 'repo');
    const sessions = join(tmp, 'sessions');
    await mkdir(project, { recursive: true });
    await mkdir(sessions);
    await symlink(sessions, join(workspace, 'escape'));
    assert.equal(await roomDirectory(workspace, join(workspace, 'escape')), await roomDirectory(workspace, sessions));
    const cwd = await roomDirectory(workspace, project);
    const root = await roomDirectory(workspace, workspace);
    const id = '00000006-0006-4006-8006-000000000006';
    const file = join(sessions, 'rollout-fixture.jsonl');
    await writeFile(file, [
      { type: 'session_meta', payload: { id, cwd, git: { branch: 'fixture' } } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'Injected AGENTS.md' }, { type: 'input_text', text: 'Injected environment' },
      ], internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions', 'environments.environment_context'] } } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Verified' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'Injected environment' }, { type: 'input_text', text: 'Please review AGENTS.md' },
      ], internal_chat_message_metadata_passthrough: { content_item_kinds: ['environments.environment_context', 'user.text'] } } },
    ].map(row => JSON.stringify(row)).join('\n'));
    const result = await readSession('CODEX', file, sessions, root);
    assert.equal(result?.id, id);
    assert.deepEqual(result?.logs.map(entry => entry.text), ['Verified', 'Please review AGENTS.md']);
    assert.equal((await readSession('CODEX', file, sessions, join(root, 'other')))?.id, id);
    await assert.rejects(roomDirectory(workspace, 'relative/path'));
  } finally {
    await rm(tmp, { recursive: true });
  }
});

test('new rooms start in the workspace folder itself, which must already exist', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-directories-'));
  try {
    const workspace = join(tmp, 'workspace');
    await mkdir(workspace);
    const resolvedWorkspace = await realpath(workspace);
    // Every character uses the same folder, and nothing is created inside it.
    for (const modelId of ['CODEX', 'CLAUDE', 'AGY'] as const) assert.equal(await newRoomDirectory(workspace, modelId), resolvedWorkspace);
    assert.deepEqual(await (await import('node:fs/promises')).readdir(workspace), []);
    await assert.rejects(newRoomDirectory(join(tmp, 'missing'), 'AGY'));
    // A workspace given as a link resolves to the real folder.
    const link = join(tmp, 'link');
    await symlink(workspace, link);
    assert.equal(await newRoomDirectory(link, 'CLAUDE'), resolvedWorkspace);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('background quota responses use their own time windows', async () => {
  const { parseAgyUsage, parseClaudeUsage, parseCodexUsage } = await import('./usage');
  const agy = { command: { data: { groups: [
    { name: 'Gemini Models', buckets: [{ window: 'weekly', remaining_fraction: 0.4 }, { window: '5h', remaining_fraction: 0.8 }] },
    { name: 'Claude and GPT models', buckets: [{ window: 'weekly', remaining_fraction: 0.6 }] },
  ] } } };
  assert.deepEqual(parseAgyUsage(agy, 'Gemini 3.8 Flash'), { weekly: 40, fiveHour: 80 });
  assert.deepEqual(parseAgyUsage(agy, 'Claude Opus'), { weekly: 60, fiveHour: undefined });
  assert.deepEqual(parseClaudeUsage({ result: 'Current session: 2% used\nCurrent week (all models): 65% used' }),
    { fiveHour: 98, weekly: 35 });
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: { windowDurationMins: 10080, usedPercent: 74 }, secondary: null }, rateLimitResetCredits: { availableCount: 0 } }),
    { fiveHour: 100, weekly: 26, vouchers: 0 });
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: { windowDurationMins: 300, usedPercent: 20 }, secondary: { windowDurationMins: 10080, usedPercent: 30 } } }),
    { fiveHour: 80, weekly: 70, vouchers: undefined });
});

test('renaming a room is broadcast, persists with its session, and preserves invalid state', async () => {
  const { Rooms } = await import('./rooms');
  const original = process.cwd();
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-rename-'));
  try {
    process.chdir(tmp);
    const events: any[] = [];
    const manager = new Rooms(tmp, event => events.push(event));
    const sessionId = '00000006-0006-4006-8006-000000000006';
    const room = {
      id: 'room-test', modelId: 'CODEX', roomName: 'Before', repoPath: tmp,
      sessionId, resumable: true, live: true,
    } as import('../src/types/guild').TerminalRoom;
    manager.rooms.set(room.id, room);
    await manager.handle({ type: 'RENAME', roomId: room.id, name: '  🌿 光的房間  ' }, () => {});
    assert.equal(room.roomName, '🌿 光的房間');
    assert.equal(room.repoPath, tmp);
    assert.equal(events.at(-1)?.type, 'ROOM');
    assert.equal(events.at(-1)?.room.roomName, '🌿 光的房間');
    await assert.rejects(manager.handle({ type: 'RENAME', roomId: room.id, name: '\n' }, () => {}));
    await assert.rejects(manager.handle({ type: 'RENAME', roomId: room.id, name: 'a'.repeat(81) }, () => {}));
    const saved = {
      id: sessionId, modelId: 'CODEX', cwd: tmp, branch: 'main',
      file: '~/fixture.jsonl', updated: '2026-11-11T00:00:00Z',
      logs: [], resumable: true,
    } as const;
    const restarted = new Rooms(tmp, () => {});
    (restarted as any).sync(saved);
    const restored = restarted.snapshot().find(item => item.sessionId === sessionId);
    assert.equal(restored?.roomName, '🌿 光的房間');
    (restarted as any).sync({ ...saved, updated: '2026-11-11T00:01:00Z' });
    assert.equal(restored?.roomName, '🌿 光的房間');

    const namesFile = join(tmp, '.env.komorebi-room-names.json');
    await writeFile(namesFile, '{invalid');
    const invalid = new Rooms(tmp, () => {});
    invalid.rooms.set(room.id, room);
    await assert.rejects(invalid.handle({ type: 'RENAME', roomId: room.id, name: 'New' }, () => {}));
    assert.equal(await (await import('node:fs/promises')).readFile(namesFile, 'utf8'), '{invalid');
  } finally {
    process.chdir(original);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('deleting archived rooms persists across sync and rejects active or unarchived rooms atomically', async () => {
  const { Rooms } = await import('./rooms');
  const original = process.cwd();
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-delete-'));
  try {
    process.chdir(tmp);
    const events: import('../src/types/bridge').ServerEvent[] = [];
    const manager = new Rooms(tmp, event => events.push(event));
    const id = '00000006-0006-4006-8006-000000000006';
    const fixture = join(tmp, 'session.jsonl');
    await writeFile(fixture, 'original session');
    const saved = { id, modelId: 'CODEX', cwd: tmp, branch: 'main', file: fixture,
      updated: '2026-11-11T00:00:00Z', logs: [], resumable: true } as const;
    (manager as any).sync(saved);
    const room = manager.snapshot()[0];
    await assert.rejects(manager.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {}));
    await manager.handle({ type: 'ARCHIVE', roomId: room.id, archived: true }, () => {});
    assert.equal(await (await import('node:fs/promises')).readFile(fixture, 'utf8'), 'original session', 'archiving leaves the session file untouched');
    room.live = true;
    await assert.rejects(manager.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {}));
    room.live = false;
    await assert.rejects(manager.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id, 'missing'] }, () => {}));
    assert.equal(manager.snapshot().length, 1);
    await manager.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {});
    assert.equal(manager.snapshot().length, 0);
    assert.ok(events.some(event => event.type === 'ROOM_REMOVED' && event.roomId === room.id));
    assert.equal(await (await import('node:fs/promises')).readFile(fixture, 'utf8'), 'original session');
    const restarted = new Rooms(tmp, () => {});
    (restarted as any).sync({ ...saved, updated: '2026-11-11T00:01:00Z' });
    assert.equal(restarted.snapshot().length, 0);
    await writeFile(join(tmp, '.env.komorebi-room-deleted.json'), '{invalid');
    const invalid = new Rooms(tmp, () => {});
    (invalid as any).sync(saved);
    await assert.rejects(invalid.handle({ type: 'DELETE_ARCHIVED', roomIds: [room.id] }, () => {}));
    assert.equal(await (await import('node:fs/promises')).readFile(join(tmp, '.env.komorebi-room-deleted.json'), 'utf8'), '{invalid');
  } finally {
    process.chdir(original);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('additional Claude approval sends only the option on the current permission screen', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-approval-'));
  const previous = process.cwd();
  try {
    process.chdir(tmp);
    const manager = new Rooms(tmp, () => {});
    const screen = 'Permission Required: Bash command\n> /usr/bin/true\n1. Yes\n2. Yes, and don’t ask again\n3. Yes, and switch to auto mode\n4. No\nSelect with numbers [1-4]. Then Enter to submit or Escape to cancel:';
    const parsed = approvalPrompt('CLAUDE', screen)!;
    const room = { id: 'approval-test', modelId: 'CLAUDE', screen, pendingApproval: parsed.card } as import('../src/types/guild').TerminalRoom;
    const writes: string[] = [];
    const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, approvalFingerprint: parsed.fingerprint, queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    await assert.rejects(manager.handle({ type: 'APPROVAL', roomId: room.id, approvalId: 'old', decision: 'auto' }, () => {}));
    assert.deepEqual(writes, []);
    room.screen = screen.replace('3. Yes, and switch to auto mode', '3. Other option');
    await assert.rejects(manager.handle({ type: 'APPROVAL', roomId: room.id, approvalId: parsed.card.id, decision: 'auto' }, () => {}));
    assert.deepEqual(writes, []);
    room.screen = screen;
    const results: import('../src/types/bridge').ServerEvent[] = [];
    await manager.handle({ type: 'APPROVAL', roomId: room.id, approvalId: parsed.card.id, decision: 'auto', requestId: 'approve-1' }, reply => {
      assert.deepEqual(writes, ['3\r']);
      results.push(reply);
    });
    assert.deepEqual(writes, ['3\r']);
    assert.deepEqual(results, [{ type: 'ACTION_RESULT', requestId: 'approve-1', ok: true, message: '審批決定已送到 CLI' }]);
    await assert.rejects(manager.handle({ type: 'APPROVAL', roomId: room.id, approvalId: parsed.card.id, decision: 'auto' }, () => {}));
    (manager as any).live.delete(room.id);
  } finally {
    process.chdir(previous);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('AGY auto startup is opt-in and does not carry strict permissions', async () => {
  const { cliLaunch } = await import('./rooms');
  const room = { modelId: 'AGY' } as import('../src/types/guild').TerminalRoom;
  const [, normal] = cliLaunch(room, false);
  const [, automatic] = cliLaunch(room, false, true);
  assert.ok(normal.includes('{"toolPermission":"strict"}'));
  assert.ok(normal.includes('--sandbox'));
  assert.ok(!normal.includes('--dangerously-skip-permissions'));
  // Turbo: nothing asks, and no sandbox to stop builds and simulator runs.
  assert.ok(automatic.includes('{"toolPermission":"always-proceed"}'));
  assert.ok(automatic.includes('--dangerously-skip-permissions'));
  assert.ok(!automatic.includes('--sandbox'));
  assert.ok(!automatic.includes('--mode=auto'));
  assert.ok(!automatic.includes('{"toolPermission":"strict"}'));
});

test('new Codex and Claude rooms opt into Remote Control and full access independently', { timeout: 15_000 }, async () => {
  const { Rooms, cliLaunch } = await import('./rooms');
  const closeRooms = async (manager: InstanceType<typeof Rooms>) => {
    const live = (manager as unknown as { live: Map<string, { process: { onExit(listener: () => void): unknown } }> }).live;
    const exits = [...live.values()].map(({ process }) => new Promise<void>(resolve => process.onExit(resolve)));
    await manager.close();
    await Promise.all(exits);
  };
  const root = await mkdtemp(join(tmpdir(), 'komorebi-room-options-'));
  const originalPath = process.env.PATH;
  const rooms = new Rooms(root, () => {});
  try {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'codex'), '#!/bin/sh\nif [ "$1 $2" = "remote-control start" ]; then echo started >> "$(dirname "$0")/remote"; if [ -f "$(dirname "$0")/fail" ]; then echo "{\\"status\\":\\"connecting\\",\\"timedOut\\":true}"; else echo "{\\"status\\":\\"connected\\"}"; fi; exit 0; fi\nwhile IFS= read -r line; do :; done\n', { mode: 0o700 });
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nwhile IFS= read -r line; do :; done\n', { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    for (const modelId of ['CODEX', 'CLAUDE'] as const) {
      const event = { type: 'CREATE', modelId, roomName: 'Remote room', repoPath: '', remote: true, fullAccess: true } as const;
      await rooms.handle(event, () => {});
      const room = rooms.snapshot().find(item => item.modelId === modelId)!;
      if (modelId === 'CODEX') {
        assert.match(room.remoteControl.autoLaunchedFlag, /--remote unix:\/\/ -s danger-full-access -a never/);
        assert.equal(await readFile(join(bin, 'remote'), 'utf8'), 'started\n');
        assert.equal(room.remoteStatus, 'on');
        assert.match(cliLaunch(room, false)[1].join(' '), /-s workspace-write -a on-request/);
      } else {
        assert.match(room.remoteControl.autoLaunchedFlag, /--permission-mode bypassPermissions --remote-control --session-id/);
        assert.match(cliLaunch(room, true)[1].join(' '), /--permission-mode default --remote-control/);
      }
      assert.equal(cliLaunch(room, false, false, true)[1].includes(modelId === 'CODEX' ? '--remote' : '--remote-control'), false);
    }
    await writeFile(join(bin, 'fail'), '');
    const fallbackEvents: import('../src/types/bridge').ServerEvent[] = [];
    const fallbackRooms = new Rooms(root, event => fallbackEvents.push(event));
    try {
      await fallbackRooms.handle({ type: 'CREATE', modelId: 'CODEX', roomName: 'Fallback', repoPath: '', remote: true, fullAccess: true }, () => {});
      const fallback = fallbackRooms.snapshot().find(room => room.roomName === 'Fallback')!;
      assert.ok(fallback.live);
      assert.doesNotMatch(fallback.remoteControl.autoLaunchedFlag, /--remote unix:/);
      assert.match(fallback.remoteControl.autoLaunchedFlag, /danger-full-access/);
      assert.ok(fallbackEvents.some(event => event.type === 'NOTICE' && /啟動失敗/.test(event.message)));
    } finally { await closeRooms(fallbackRooms); }
    await assert.rejects(rooms.handle({ type: 'CREATE', modelId: 'AGY', roomName: 'Invalid', repoPath: '', remote: false, fullAccess: true }, () => {}));
  } finally {
    await closeRooms(rooms);
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test('a prompt sent during a known menu waits for the composer and never bypasses trust', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-menu-'));
  const previous = process.cwd();
  try {
    process.chdir(tmp);
    const manager = new Rooms(tmp, () => {});
    const room: import('../src/types/guild').TerminalRoom = { id: 'menu-test', modelId: 'CODEX', roomName: 'test', repoPath: tmp,
      gitBranch: '—', effortLevel: null, contextUsagePct: null, progressPercent: null, syncSource: '', syncedStateFile: '',
      currentActionSummary: '', bubbleSnippet: '', screen: 'Select a model\nesc back', ready: false,
      menu: { id: 'menu-1', title: '模型／推理力度', confirm: true }, logs: [],
      remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' }, live: true,
      status: 'running', selectedSubModel: '—', updatedAt: '' };
    let terminalLines = ['› Ask Codex to do anything', '', 'GPT-6.1-Sol high · /tmp'];
    const writes: string[] = [];
    const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) },
      terminal: { buffer: { active: { viewportY: 0, getLine: (n: number) => ({ translateToString: () => terminalLines[n] ?? '' }) } } }, queued: 0, dirty: false };
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, live);
    const results: import('../src/types/bridge').ServerEvent[] = [];
    const record = (event: import('../src/types/bridge').ServerEvent) => {
      if (event.type === 'ACTION_RESULT') results.push(event);
    };
    await manager.handle({ type: 'INPUT', roomId: room.id, text: '/status', requestId: 'send-1' }, record);
    assert.deepEqual(writes, ['\x1b']);
    (manager as any).refresh(room, live);
    assert.deepEqual(writes, ['\x1b', '/status']);
    assert.deepEqual(results, []);
    // Enter follows after a short delay; wait for it with a deadline instead of assuming exact timer precision.
    for (const deadline = Date.now() + 1_000; !writes.includes('\r') && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(writes, ['\x1b', '/status', '\r']);
    assert.deepEqual(results, [{ type: 'ACTION_RESULT', requestId: 'send-1', ok: true, message: '已送到 CLI' }]);

    room.menu = { id: 'menu-2', title: 'CLI 設定', confirm: true };
    room.ready = false;
    await manager.handle({ type: 'INPUT', roomId: room.id, text: 'please check', requestId: 'send-2' }, record);
    assert.equal(writes.at(-1), '\x1b');
    terminalLines = ['Folder access', '/tmp/project', 'Trust this folder? Codex can read files.',
      '› 1. Trust and continue', '  2. Back to Agent Command Center', 'enter continue · esc back'];
    (manager as any).refresh(room, live);
    assert.equal(room.pendingApproval?.type, 'workspace_trust');
    assert.equal(writes.includes('please check'), false);
    assert.match(room.logs.at(-1)?.text ?? '', /指令未送出.*please check/);
    assert.deepEqual(results.at(-1), {
      type: 'ACTION_RESULT', requestId: 'send-2', ok: false, message: 'CLI 需要先處理審批，指令未送出；內容已保留在房間紀錄。',
    });
    await assert.rejects(manager.handle({ type: 'INPUT', roomId: room.id, text: '/status' }, () => {}));
    (manager as any).live.delete(room.id);
  } finally {
    process.chdir(previous);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('a native slash command works at an empty Codex prompt and style-only menu movement invalidates old controls', async () => {
  const { Rooms } = await import('./rooms');
  const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof import('@xterm/headless');
  const terminal = new Terminal({ cols: 112, rows: 42, allowProposedApi: true });
  const manager = new Rooms(process.cwd(), () => {});
  const room = { id: 'style-menu', modelId: 'CODEX', logs: [], live: true } as unknown as import('../src/types/guild').TerminalRoom;
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, terminal, queued: 0, dirty: false };
  manager.rooms.set(room.id, room);
  (manager as any).live.set(room.id, live);
  const frame = async (screen: string) => {
    await new Promise<void>(resolve => terminal.write('\x1b[2J\x1b[H' + screen.replaceAll('\n', '\r\n'), resolve));
    (manager as any).refresh(room, live);
  };
  try {
    await frame('›\n\nGPT-6.1-Sol high · /tmp');
    assert.equal(room.ready, true);
    await new Promise<void>((resolve, reject) => {
      void manager.handle({ type: 'INPUT', roomId: room.id, text: '/permissions', requestId: 'slash' }, event => {
        if (event.type === 'ACTION_RESULT' && event.ok) resolve();
      }).catch(reject);
    });
    assert.deepEqual(writes, ['/permissions', '\r']);

    await frame('\x1b[?1hPermissions\n\x1b[7m1. Workspace\x1b[0m\n2. Read only\nEnter to confirm · Esc to cancel');
    const oldMenu = room.menu!.id;
    const plain = room.screen;
    let highlight = room.screenStyles!.find(run => run.background);
    assert.equal(plain!.slice(highlight!.start, highlight!.end), '1. Workspace');
    await manager.handle({ type: 'MENU', roomId: room.id, menuId: oldMenu, key: 'down' }, () => {});
    assert.equal(writes.at(-1), '\x1bOB');

    await frame('Permissions\n1. Workspace\n\x1b[48;2;50;60;70m2. Read only\x1b[0m\nEnter to confirm · Esc to cancel');
    assert.equal(room.screen, plain);
    assert.notEqual(room.menu!.id, oldMenu);
    highlight = room.screenStyles!.find(run => run.background === '#323c46');
    assert.equal(plain!.slice(highlight!.start, highlight!.end), '2. Read only');
    await assert.rejects(manager.handle({ type: 'MENU', roomId: room.id, menuId: oldMenu, key: 'enter' }, () => {}), /選單已更新/);
  } finally {
    (manager as any).live.delete(room.id);
    terminal.dispose();
  }
});

test('Composer numbers reach the current native menu without sending a chat turn or accepting approval', async () => {
  const codexMenu = 'Permissions\n› 1. Workspace\n  2. Read only\nEnter to confirm';
  assert.equal(numberedMenuChoices('CODEX', codexMenu).get('2'), '\x1b[B\r');
  assert.equal(numberedMenuChoices('CODEX', codexMenu.replace('› ', '  ')).size, 0);
  const { Rooms } = await import('./rooms');
  const manager = new Rooms(process.cwd(), () => {});
  const room = { id: 'numbered-menu', modelId: 'CLAUDE', live: true, logs: [],
    screen: 'Select a model\n  (selected) 1. Opus\n  2. Sonnet\nSelect with numbers [1-2]. Then Enter to submit or Escape to cancel:',
    menu: { id: 'current', title: '模型／推理力度', confirm: true } } as unknown as import('../src/types/guild').TerminalRoom;
  const writes: string[] = [];
  const live = { singleNoted: true, process: { write: (value: string) => writes.push(value) }, queued: 0, dirty: false };
  manager.rooms.set(room.id, room);
  (manager as any).live.set(room.id, live);
  const event = { type: 'INPUT', roomId: room.id, text: '2', menuId: 'current', requestId: 'number' } as const;
  try {
    await assert.rejects(manager.handle({ ...event, menuId: 'stale' }, () => {}));
    await assert.rejects(manager.handle({ ...event, text: '3' }, () => {}));
    room.pendingApproval = {} as typeof room.pendingApproval;
    await assert.rejects(manager.handle(event, () => {}));
    room.pendingApproval = undefined;
    const results: import('../src/types/bridge').ServerEvent[] = [];
    await manager.handle(event, result => results.push(result));
    assert.deepEqual(writes, ['2\r']);
    assert.deepEqual(room.logs, []);
    assert.deepEqual(results, [{ type: 'ACTION_RESULT', requestId: 'number', ok: true, message: '已將選項送到 CLI' }]);
    room.menu = undefined;
    live.dirty = false;
    await assert.rejects(manager.handle(event, () => {}));
    assert.deepEqual(writes, ['2\r']);
  } finally { (manager as any).live.delete(room.id); }
});

test('binds only a verified native session and restores the same room after restart', { timeout: 4000 }, async () => {
  const { Rooms, cliLaunch } = await import('./rooms');
  const temporary = await mkdtemp(join(tmpdir(), 'komorebi-binding-'));
  const original = process.cwd();
  try {
    process.chdir(temporary);
    const cwd = await realpath(temporary);
    const events: import('../src/types/bridge').ServerEvent[] = [];
    const rooms = new Rooms(cwd, event => events.push(event));
    const roomId = '00000005-0005-4005-8005-000000000005';
    const sessionId = '00000006-0006-4006-8006-000000000006';
    const session = { id: sessionId, modelId: 'CODEX', cwd, branch: 'main', file: '~/fixture.jsonl',
      updated: '2026-11-12T00:00:00Z', logs: [], resumable: true } as const;
    (rooms as any).sync(session);
    const imported = rooms.snapshot()[0];
    const custom = { ...imported, id: roomId, sessionId: undefined, roomName: 'UI work', live: true };
    rooms.rooms.set(custom.id, custom);
    const statusLines = [`│ Session: ${sessionId} │`, '› Ask Codex to do anything', 'GPT-6.1-Sol high · /tmp'];
    const live = {
      requested: '/status', queued: 0, dirty: false,
      terminal: { buffer: { active: { viewportY: 0, getLine: (index: number) => ({
        translateToString: () => statusLines[index] ?? '',
      }) } } },
    };
    (rooms as any).live.set(custom.id, live);
    (rooms as any).sync(session);
    assert.equal(rooms.snapshot().length, 2, 'same folder is not enough to bind');
    (rooms as any).refresh(custom, live);
    assert.equal(rooms.snapshot().length, 1);
    assert.equal(rooms.snapshot()[0].id, roomId);
    assert.equal(rooms.snapshot()[0].sessionId, sessionId);
    assert.ok(events.some(event => event.type === 'ROOM_REMOVED' && event.replacementRoomId === roomId));
    const restarted = new Rooms(cwd, () => {});
    (restarted as any).sync(session);
    const resumed = restarted.snapshot()[0];
    assert.equal(resumed.id, roomId);
    assert.equal(resumed.roomName, 'UI work');
    assert.equal(restarted.snapshot().length, 1);
    assert.equal(cliLaunch(resumed, false)[1][0], 'resume');
    assert.equal(cliLaunch(resumed, false)[1].at(-1), sessionId);

    const claudeId = '00000012-0012-4012-8012-000000000012';
    const claude = { ...custom, id: claudeId, sessionId: undefined, modelId: 'CLAUDE' as const, roomName: 'Reviews' };
    restarted.rooms.set(claudeId, claude);
    assert.deepEqual(cliLaunch(claude, false)[1].slice(-2), ['--session-id', claudeId]);
    (restarted as any).sync({ ...session, id: claudeId, modelId: 'CLAUDE' });
    assert.deepEqual(cliLaunch(claude, false)[1].slice(-2), ['--resume', claudeId]);

    const agyId = '00000015-0015-4015-8015-000000000015';
    const agySession = '00000016-0016-4016-8016-000000000016';
    const agy = { ...custom, id: agyId, sessionId: undefined, modelId: 'AGY' as const, roomName: 'Research' };
    const logDirectory = await mkdtemp(join(cwd, 'agy-'));
    await writeFile(join(logDirectory, 'cli.log'), `I1112 10:00 cli.go:1] Streaming conversation ${agySession}\n`);
    let notifyBound: () => void;
    const bound = new Promise<void>(resolve => { notifyBound = resolve; });
    const agyRooms = new Rooms(cwd, event => { if (event.type === 'ROOM' && event.room.id === agyId) notifyBound(); });
    agyRooms.rooms.set(agyId, agy);
    const agyLive: { disposeSessionLog?: () => void } = {};
    (agyRooms as any).watchAgySession(agy, agyLive, logDirectory);
    try {
      await bound;
      assert.deepEqual(cliLaunch(agy, false)[1].slice(-2), ['--conversation', agySession]);
      (agyRooms as any).sync({ ...session, id: agySession, modelId: 'AGY', cwd: undefined, resumable: false });
      assert.equal(agy.resumable, true);
      assert.equal(agyRooms.snapshot().filter(room => room.sessionId === agySession).length, 1);
    } finally {
      agyLive.disposeSessionLog?.();
    }
  } finally {
    process.chdir(original);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('AGY transcript arriving before the CLI log watcher binds to the named room before publishing', async () => {
  const { Rooms, cliLaunch } = await import('./rooms');
  const cwd = await mkdtemp(join(tmpdir(), 'komorebi-agy-bind-'));
  const original = process.cwd();
  try {
    process.chdir(cwd);
    const rooms = new Rooms(cwd, () => {});
    const room = await rooms.ensureGroupMember('AGY', 'Xcode Testing 2');
    const nativeId = '00000016-0016-4016-8016-000000000016';
    const externalId = '00000014-0014-4014-8014-000000000014';
    const agySessionLog = join(cwd, 'cli.log');
    await writeFile(agySessionLog, `I1112 10:00 cli.go:1] Streaming conversation ${nativeId}\n`);
    (rooms as any).live.set(room.id, { agySessionLog });
    const session = (id: string) => ({ id, modelId: 'AGY', cwd, branch: '—',
      file: `~/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`,
      updated: new Date().toISOString(), logs: [], resumable: true });
    await (rooms as any).syncWatchedSession(session(externalId));
    assert.equal(room.sessionId, undefined, 'an unrelated session in the same directory stays separate');
    await (rooms as any).syncWatchedSession(session(nativeId));
    assert.deepEqual(rooms.snapshot().filter(item => item.sessionId === nativeId).map(item => item.roomName), ['Xcode Testing 2']);
    assert.equal(rooms.snapshot().length, 2);
    const restarted = new Rooms(cwd, () => {});
    const restored = restarted.rooms.get(room.id)!;
    assert.equal(restored.sessionId, nativeId);
    assert.deepEqual(cliLaunch(restored, false)[1].slice(-2), ['--conversation', nativeId]);
  } finally {
    process.chdir(original);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('syncs live AGY replies into the room without duplicating local user messages', async () => {
  const { Rooms } = await import('./rooms');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-live-reply-'));
  const original = process.cwd();
  try {
    process.chdir(tmp);
    const sessionId = '00000006-0006-4006-8006-000000000006';
    const root = join(tmp, 'brain');
    const directory = join(root, sessionId, '.system_generated', 'logs');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'transcript_full.jsonl');
    const response = '回答'.repeat(1200);
    const rows = [
      { type: 'USER_INPUT', step_index: 0, content: '<USER_REQUEST>\n你好\n</USER_REQUEST>\n<ADDITIONAL_METADATA>local time</ADDITIONAL_METADATA>' },
      { type: 'PLANNER_RESPONSE', step_index: 1, content: response },
    ];
    await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n'));
    const session = await readSession('AGY', file, root, tmp);
    assert.ok(session);
    assert.equal(session.logs[0].text, '你好');
    assert.equal(session.logs[1].text, response);
    const manager = new Rooms(tmp, () => {});
    const room = {
      id: 'live-room', modelId: 'AGY', sessionId, live: true, roomName: '測試', repoPath: tmp,
      logs: [{ id: 'local-user', timestamp: '10:00', sender: 'user', text: '你好' }],
    } as import('../src/types/guild').TerminalRoom;
    manager.rooms.set(room.id, room);
    (manager as any).live.set(room.id, { seenTranscriptAgents: new Set<string>(), seenTranscriptUsers: new Set<string>(), matchedLocalUsers: new Set<string>() });
    (manager as any).sync(session);
    assert.deepEqual(room.logs.map(entry => entry.sender), ['user', 'agent']);
    assert.equal(room.logs[1].text, response);
    const external = { id: sessionId + '-external', timestamp: '10:01', sender: 'user' as const, text: '外部訊息' };
    (manager as any).sync({ ...session, logs: [...session.logs, external] });
    (manager as any).sync({ ...session, logs: [...session.logs, external] });
    assert.equal(room.logs.filter(entry => entry.text === '外部訊息').length, 1);
    room.logs = room.logs.filter(entry => entry.id !== external.id);
    (manager as any).sync({ ...session, logs: session.logs.map(entry => entry.sender === 'agent' ? { ...entry, text: '更新後' } : entry) });
    assert.equal(room.logs.length, 2);
    assert.equal(room.logs[1].text, '更新後');
    room.logs = [room.logs[0]];
    (manager as any).sync(session);
    assert.deepEqual(room.logs.map(entry => entry.sender), ['user']);
  } finally {
    process.chdir(original);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('quota reset times are read from AGY, Claude and Codex output', async () => {
  const { parseAgyUsage, parseClaudeUsage, parseClaudeReset, parseCodexUsage } = await import('./usage');
  const agy = { command: { data: { groups: [{ name: 'Gemini Models', buckets: [
    { window: '5h', remaining_fraction: 0.5, reset_time: '2026-11-12T11:59:28Z' },
    { window: 'weekly', remaining_fraction: 0.1, reset_time: '2026-11-14T00:30:16Z' }] }] } } };
  assert.deepEqual(parseAgyUsage(agy, 'Gemini 3.8 Flash'), {
    fiveHour: 50, weekly: 10, fiveHourResetsAt: Date.UTC(2026, 10, 12, 11, 59, 28), weeklyResetsAt: Date.UTC(2026, 10, 14, 0, 30, 16) });
  const now = Date.UTC(2026, 10, 12, 10, 54);
  const text = 'Current session: 42% used · resets Nov 12 at 1:39pm (Europe/London)\nCurrent week (all models): 75% used · resets Nov 17 at 1:59am (Europe/London)\nCurrent week (Fable): 0% used · resets Nov 17 at 2am (Europe/London)';
  assert.equal(parseClaudeReset(text, 'Current session', now), Date.UTC(2026, 10, 12, 13, 39));
  assert.equal(parseClaudeReset(text, 'Current week \\(all models\\)', now), Date.UTC(2026, 10, 17, 1, 59));
  assert.deepEqual(Object.keys(parseClaudeUsage({ result: text })).sort(), ['fiveHour', 'fiveHourResetsAt', 'weekly', 'weeklyResetsAt']);
  // Summer time shifts the offset; a bare time rolls to tomorrow once it has passed.
  assert.equal(parseClaudeReset('Current session: 1% used · resets Jul 1 at 1pm (Europe/London)', 'Current session', Date.UTC(2026, 5, 20)), Date.UTC(2026, 6, 1, 12));
  assert.equal(parseClaudeReset('Current session: 1% used · resets 5:40pm (Europe/London)', 'Current session', now), Date.UTC(2026, 10, 12, 17, 40));
  assert.equal(parseClaudeReset('Current session: 1% used · resets 9:00am (Europe/London)', 'Current session', now), Date.UTC(2026, 10, 13, 9, 0));
  assert.equal(parseClaudeReset('Current session: 1% used', 'Current session', now), undefined);
  assert.equal(parseClaudeReset('Current session: 1% used · resets 5pm (Not/AZone)', 'Current session', now), undefined);
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: { windowDurationMins: 10080, usedPercent: 82, resetsAt: 1794836069 }, secondary: null } }),
    { fiveHour: 100, weekly: 18, vouchers: undefined, weeklyResetsAt: 1794836069000 });
});
