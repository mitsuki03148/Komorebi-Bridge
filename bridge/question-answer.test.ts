import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';
import { questionOpen, questionPanel } from './terminal';

const SHIFT_LEFT = '\x1b[1;2D', SHIFT_RIGHT = '\x1b[1;2C', DOWN = '\x1b[B', UP = '\x1b[A';
const collapsed = ['• Working (51s • esc to interrupt)', '• Queued follow-up inputs', '  ? 1 question', '    ⇧← to answer', '', '› Ask Codex to do anything', '  GPT-6.1-Sol high · ~/proj'];
const panelLines = (selected: number) => ['• Working (52s • esc to interrupt)', '• Queued follow-up inputs', '  【測試】揀一個',
  ...['測試選項 A', '測試選項 B', 'Other'].map((label, index) => `${selected === index + 1 ? '  › ' : '    '}${index + 1}. ${label}`),
  '  enter submit   ⌃] skip   ⇧→ main prompt'];
const typing = (typed: string) => ['• Working (53s • esc to interrupt)', '• Queued follow-up inputs', '  【測試】揀一個', `  › 3. Other: ${typed}`, '  enter submit   ⌃] skip   ⇧→ main prompt'];
const freeLines = (typed: string) => ['◦ Checking schedule gating (1m 52s • esc to interrupt)', '• Queued follow-up inputs', '  請接駁同解鎖另一部 iPhone，答「暫時冇」就得。', '', `  ${typed || 'Type your answer'}`, '', '  enter submit   ⌃] skip   ⇧→ main prompt'];
const main = ['• Working (54s • esc to interrupt)', '', '› Ask Codex to do anything', '  GPT-6.1-Sol high · ~/proj'];

/** A Codex that behaves like the captured screens: ⇧← opens the question, ↑↓ move, Enter picks or opens the typing box, ⇧→ goes back. */
function fakeCodex(start: 'collapsed' | 'open' | 'stuck' | 'none' | 'free' | 'free-open' = 'collapsed') {
  const lines = [...(start === 'none' ? main : collapsed)];
  const free = start === 'free' || start === 'free-open';
  const state = { mode: start === 'open' || start === 'free-open' ? 'panel' : start === 'none' ? 'main' : 'collapsed', selected: 1, typed: '', answered: undefined as string | undefined };
  const render = () => lines.splice(0, lines.length, ...(state.mode === 'collapsed' ? collapsed : state.mode === 'panel' ? (free ? freeLines(state.typed) : panelLines(state.selected)) : state.mode === 'text' ? typing(state.typed) : main));
  if (start === 'open' || start === 'free-open') render();
  const writes: string[] = [];
  const process = { write: (value: string) => {
    writes.push(value);
    if (value === SHIFT_LEFT && state.mode === 'collapsed' && start !== 'stuck') state.mode = 'panel';
    else if (value === DOWN && state.mode === 'panel') state.selected = Math.min(3, state.selected + 1);
    else if (value === UP && state.mode === 'panel') state.selected = Math.max(1, state.selected - 1);
    else if (value === SHIFT_RIGHT && state.mode !== 'main') state.mode = 'collapsed';
    else if (free && state.mode === 'panel' && value === '\r') { state.answered = state.typed; state.mode = 'main'; }
    else if (free && state.mode === 'panel' && !value.startsWith('\x1b')) state.typed += value;
    else if (value === '\r' && state.mode === 'panel') { if (state.selected === 3) state.mode = 'text'; else { state.answered = String(state.selected); state.mode = 'main'; } }
    else if (value === '\r' && state.mode === 'text') { state.answered = state.typed; state.mode = 'main'; }
    else if (state.mode === 'text' && !value.startsWith('\x1b')) state.typed += value;
    render();
  } };
  const terminal = { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
  return { process, terminal, writes, state, queued: 0, dirty: true };
}

async function withFake(start: Parameters<typeof fakeCodex>[0], run: (rooms: Rooms, room: TerminalRoom, fake: ReturnType<typeof fakeCodex>) => Promise<void>) {
  const events: unknown[] = [];
  const rooms = new Rooms(process.cwd(), event => events.push(event));
  rooms.questionStepMs = 5;
  const room = { id: 'q', modelId: 'CODEX', roomName: '測試', repoPath: '/tmp', logs: [], live: true, status: 'running', ready: false, screen: '', pendingQuestion: { id: 'q1', questions: [{ title: '揀一個', options: null }] }, remoteControl: { enabled: false, sessionUrl: '' } } as unknown as TerminalRoom;
  const fake = fakeCodex(start);
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, fake);
  try { await run(rooms, room, fake); } finally { (rooms as any).live.delete(room.id); }
}

test('the open question is read from the captured screen: numbered choices, the highlight and Other', () => {
  const screen = panelLines(2).join('\n');
  assert.equal(questionOpen(screen), true);
  assert.equal(questionOpen(collapsed.join('\n')), false);
  assert.deepEqual(questionPanel(screen), { options: [{ n: 1, label: '測試選項 A' }, { n: 2, label: '測試選項 B' }, { n: 3, label: 'Other' }], selected: 2, other: 3 });
  assert.equal(questionPanel(collapsed.join('\n')), undefined);
});

test('a listed answer: open the question, move to it, Enter', async () => {
  await withFake('collapsed', async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 2 }, () => {});
    assert.deepEqual(fake.writes, [SHIFT_LEFT, DOWN, '\r']);
    assert.equal(fake.state.answered, '2');
  });
  await withFake('open', async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {});
    assert.deepEqual(fake.writes, ['\r'], 'already open and already on the first answer');
  });
});

test('a typed answer: move to Other, Enter, type, Enter', async () => {
  await withFake('collapsed', async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', text: '我想要選項 C\n第二行' }, () => {});
    assert.deepEqual(fake.writes, [SHIFT_LEFT, DOWN, DOWN, '\r', '我想要選項 C 第二行', '\r']);
    assert.equal(fake.state.answered, '我想要選項 C 第二行');
  });
});

test('when the screen is not what is expected nothing wrong is sent, and the question is put back', async () => {
  await withFake('stuck', async (rooms, room, fake) => {
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {}), /未能自動回答/);
    assert.deepEqual(fake.writes, [SHIFT_LEFT], 'it never opened, so there is nothing to put back');
  });
  await withFake('open', async (rooms, room, fake) => {
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 9 }, () => {}), /未能自動回答/);
    assert.deepEqual(fake.writes, [SHIFT_RIGHT]);
    assert.equal(fake.state.answered, undefined);
  });
  await withFake('open', async (rooms, room, fake) => {
    // Picking the "Other" number without typing anything is not an answer.
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 3 }, () => {}), /未能自動回答/);
    assert.equal(fake.state.answered, undefined);
  });
  await withFake('none', async (rooms, room, fake) => {
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {}), /沒有排隊中的問題/);
    assert.deepEqual(fake.writes, []);
  });
});

test('only an answer that can be sent is accepted', async () => {
  await withFake('collapsed', async (rooms, room, fake) => {
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1' }, () => {}), /無法用這個方式/);
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 0 }, () => {}), /無法用這個方式/);
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', text: 'x'.repeat(2001) }, () => {}), /無法用這個方式/);
    assert.deepEqual(fake.writes, []);
  });
});

test('a question with no listed answers is answered by typing into its box, whether it is open already or has to be opened', async () => {
  await withFake('free-open', async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', text: '暫時冇' }, () => {});
    assert.deepEqual(fake.writes, ['暫時冇', '\r']);
    assert.equal(fake.state.answered, '暫時冇');
  });
  await withFake('free', async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', text: '裝置名：測試機\n第二行' }, () => {});
    assert.deepEqual(fake.writes, [SHIFT_LEFT, '裝置名：測試機 第二行', '\r']);
    assert.equal(fake.state.answered, '裝置名：測試機 第二行');
  });
  // There is nothing to pick, so a listed choice makes no sense; nothing is typed and the question is put back.
  await withFake('free-open', async (rooms, room, fake) => {
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {}), /只可以打字回答/);
    assert.deepEqual(fake.writes, [SHIFT_RIGHT]);
    assert.equal(fake.state.answered, undefined);
  });
});

test('an answer to an old question, or one with no question named, presses nothing', async () => {
  await withFake('collapsed', async (rooms, room, fake) => {
    room.pendingQuestion = { id: 'q2', questions: [{ title: '第二題', options: null }] };
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {}), /已經改變/);
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, choice: 1 }, () => {}), /已經改變/);
    assert.deepEqual(fake.writes, [], 'no key reached the CLI');
  });
});

test('the question changes while the answer is on its way: Enter is not sent', async () => {
  await withFake('open', async (rooms, room, fake) => {
    const swap = setTimeout(() => { room.pendingQuestion = { id: 'q2', questions: [{ title: '第二題', options: null }] }; }, 2);
    rooms.questionStepMs = 30;
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 2 }, () => {}), /未能自動回答/);
    clearTimeout(swap);
    assert.equal(fake.state.answered, undefined, 'nothing was answered');
  });
});

test('the screen shows another question than the one answered: nothing is pressed', async () => {
  await withFake('open', async (rooms, room, fake) => {
    room.pendingQuestion = { id: 'q1', questions: [{ title: '完全唔同嘅另一條問題', options: null }] };
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'q1', choice: 1 }, () => {}), /不同/);
    assert.equal(fake.state.answered, undefined);
  });
});
