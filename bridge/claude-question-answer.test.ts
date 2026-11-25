import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';

const header = ['[Screen Reader Mode: on via flag]', 'you: ask me', 'Question: Colour', '> Which colour do you like?'];
const list = (typed: string, options = ['1. Red — A warm, bold red.', '2. Blue — A cool, calm blue.', '3. Other', '4. Chat about this']) =>
  [...header, ...options, `Select with numbers [1-${options.length}]. Then Enter to submit or Escape to cancel: ${typed}`.trimEnd()];
const textBox = (typed: string) => [...header, '1. Red — A warm, bold red.', '2. Blue — A cool, calm blue.', '3. Other', '4. Chat about this', `Enter text for option 3 (Other), or Escape for the list: ${typed}`.trimEnd()];
const done = (answer: string) => ['Answered Claude\'s questions:', `· Which colour do you like? → ${answer}`, 'claude: ok', '$'];

/** A Claude in screen-reader mode that behaves like the captured screens: a digit is echoed, Enter submits it or opens the Other box. */
function fakeClaude(options?: string[], opts: { swallowDigit?: boolean } = {}) {
  const state = { mode: 'list', typed: '', answered: undefined as string | undefined, other: 3 };
  const lines: string[] = [];
  const render = () => lines.splice(0, lines.length, ...(state.mode === 'list' ? list(state.typed, options) : state.mode === 'text' ? textBox(state.typed) : done(state.answered ?? '')));
  render();
  const writes: string[] = [];
  const process = { write: (value: string) => {
    writes.push(value);
    if (state.mode === 'list') {
      if (/^\d$/.test(value) && !opts.swallowDigit) state.typed += value;
      else if (value === '\x7f') state.typed = state.typed.slice(0, -1);
      else if (value === '\r' && state.typed) {
        if (Number(state.typed) === state.other) { state.mode = 'text'; state.typed = ''; } else { state.answered = ['', 'Red', 'Blue'][Number(state.typed)]; state.mode = 'done'; }
      }
    } else if (state.mode === 'text') {
      if (value === '\x1b') { state.mode = 'list'; state.typed = ''; }
      else if (value === '\r') { state.answered = state.typed; state.mode = 'done'; }
      else if (!value.startsWith('\x1b')) state.typed += value;
    }
    render();
  } };
  const terminal = { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
  return { process, terminal, writes, state, queued: 0, dirty: true };
}

async function withFake(run: (rooms: Rooms, room: TerminalRoom, fake: any) => Promise<void>, fake: any = fakeClaude(), questions?: { title: string; options: string[] | null }[]) {
  const rooms = new Rooms(process.cwd(), () => {});
  rooms.questionStepMs = 5;
  const room = { id: 'cq', modelId: 'CLAUDE', roomName: '測試', repoPath: '/tmp', logs: [], live: true, status: 'running', ready: false, screen: '',
    pendingQuestion: { id: 'q1', questions: questions ?? [{ title: 'Which colour do you like?', options: ['Red', 'Blue'] }] }, remoteControl: { enabled: false, sessionUrl: '' } } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, fake);
  try { await run(rooms, room, fake); } finally { (rooms as any).live.delete(room.id); }
}
const answer = (rooms: Rooms, room: TerminalRoom, detail: { choice?: number; text?: string }, questionId = 'q1') =>
  rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId, ...detail }, () => {});

test('a listed answer in a Claude question: type its number, wait for it to show, Enter', async () => {
  await withFake(async (rooms, room, fake) => {
    await answer(rooms, room, { choice: 2 });
    assert.deepEqual(fake.writes, ['2', '\r']);
    assert.equal(fake.state.answered, 'Blue');
  });
});

test('a typed answer: the number of Other, Enter, the text on one line, Enter', async () => {
  await withFake(async (rooms, room, fake) => {
    await answer(rooms, room, { text: 'Green\nplease' });
    assert.deepEqual(fake.writes, ['3', '\r', 'Green please', '\r']);
    assert.equal(fake.state.answered, 'Green please');
  });
});

test('nothing wrong is sent: another question, a changed list, a multi-question card or no menu on screen', async () => {
  // The record has moved on to another question.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answer(rooms, room, { choice: 1 }, 'old'), /已經改變或已被回答/);
    assert.deepEqual(fake.writes, []);
  });
  // The screen asks something else than the card shows.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answer(rooms, room, { choice: 1 }), /與你看到的不同/);
    assert.deepEqual(fake.writes, []);
    // A refusal must not leave the screen marked "updating": a CLI waiting for a person writes nothing that would clear it, and every
    // later button would be refused (seen on the phone on 2026-11-20).
    assert.equal(fake.dirty, false);
  }, fakeClaude(), [{ title: 'Which size would you like instead?', options: ['Small', 'Large'] }]);
  // The choice the card means is not the one the screen lists at that number.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answer(rooms, room, { choice: 1 }), /找不到這個選項/);
    assert.deepEqual(fake.writes, []);
  }, fakeClaude(['1. Green — x', '2. Blue — y', '3. Other', '4. Chat about this']));
  // A card with several questions is for the terminal.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answer(rooms, room, { choice: 1 }), /多個問題/);
    assert.deepEqual(fake.writes, []);
  }, fakeClaude(), [{ title: 'Which colour do you like?', options: ['Red', 'Blue'] }, { title: 'Second?', options: null }]);
  // The question is not open any more.
  await withFake(async (rooms, room, fake) => {
    fake.state.mode = 'done'; fake.state.answered = 'Red';
    fake.process.write(''); fake.writes.length = 0;
    await assert.rejects(answer(rooms, room, { choice: 1 }), /沒有等待回答的選單/);
    assert.deepEqual(fake.writes, []);
  });
  // A question with no Other cannot take typed text; text and a choice together are refused.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answer(rooms, room, { text: 'x' }), /沒有 Other/);
    assert.deepEqual(fake.writes, []);
  }, fakeClaude(['1. Red — a', '2. Blue — b', '3. Chat about this']));
  await withFake(async (rooms, room) => { await assert.rejects(answer(rooms, room, { choice: 1, text: 'x' }), /無法用這個方式回答/); });
});

test('a digit the CLI never shows is taken back, so the person finds an empty prompt', async () => {
  await withFake(async (rooms, room, fake) => {
    // The fake swallows the digit: the screen never shows it. The prompt must be left clean and the question open.
    await assert.rejects(answer(rooms, room, { choice: 2 }), /選項號碼沒有出現/);
    assert.equal(fake.state.mode, 'list');
    assert.equal(fake.state.answered, undefined);
    assert.ok(!fake.writes.includes('\r'), 'Enter was never pressed');
    // The taken-back digit schedules its own re-read, so the flag is gone shortly after.
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(fake.dirty, false);
  }, fakeClaude(undefined, { swallowDigit: true }));
});

test('when the Other box does not open, the list is put back with Escape', async () => {
  const fake = fakeClaude();
  const original = fake.process.write;
  // Enter on the number does not open the box (the CLI behaves differently from what was captured).
  fake.process.write = (value: string) => { if (value === '\r') { fake.writes.push(value); return; } original(value); };
  await withFake(async (rooms, room) => {
    await assert.rejects(answer(rooms, room, { text: 'x' }), /沒有出現輸入框/);
    assert.equal(fake.state.answered, undefined);
    assert.equal(fake.state.typed, '', 'the half-typed number was taken back');
  }, fake);
});

// ---- Several questions in one card: the CLI asks one after another, then "Review your answers" until y, Enter. ----
const pair = [
  { title: 'Which colour do you like?', options: ['Red', 'Blue'] },
  { title: 'Which animal do you like?', options: ['Cat', 'Dog'] },
];
const optionLines = (labels: string[]) => [...labels.map((label, index) => `${index + 1}. ${label} — x`), `${labels.length + 1}. Other`, `${labels.length + 2}. Chat about this`];
const drawn = (title: string) => title.split('\n').map(line => `>${line ? ' ' : ''}${line}`);
const askLines = (index: number, typed: string, list = pair) => [`Questions: Colour${index > 0 ? ' (answered)' : ''}, Animal`, ...drawn(list[index].title), ...optionLines(list[index].options),
  `Select with numbers [1-${list[index].options.length + 2}]. Then Enter to submit or Escape to cancel: ${typed}`.trimEnd()];

function fakeClaudePair(opts: { wrongReview?: boolean; list?: typeof pair } = {}) {
  const list = opts.list ?? pair;
  const state = { index: 0, mode: 'list' as 'list' | 'text' | 'review' | 'done', typed: '', picks: [] as string[], confirm: '', submitted: false };
  const lines: string[] = [];
  const render = () => lines.splice(0, lines.length, ...(state.mode === 'list' ? askLines(state.index, state.typed, list)
    : state.mode === 'text' ? [...askLines(state.index, '', list).slice(0, -1), `Enter text for option 3 (Other), or Escape for the list: ${state.typed}`.trimEnd()]
    : state.mode === 'review' ? ['Review your answers', ...list.flatMap((question, i) => [...drawn(question.title), `→ ${opts.wrongReview && i === 1 ? 'Cat' : state.picks[i]}`]), 'y. Submit answers', 'n. Cancel', `Enter y/n: ${state.confirm}`.trimEnd()]
    : ['Answered Claude\'s questions:', ...state.picks.map(pick => `· ${pick}`), '$']));
  render();
  const writes: string[] = [];
  const process = { write: (value: string) => {
    writes.push(value);
    if (state.mode === 'list') {
      if (/^\d$/.test(value)) state.typed += value;
      else if (value === '\x7f') state.typed = state.typed.slice(0, -1);
      else if (value === '\r' && state.typed) {
        const n = Number(state.typed);
        if (n === list[state.index].options.length + 1) { state.mode = 'text'; state.typed = ''; }
        else { state.picks.push(list[state.index].options[n - 1]); state.typed = ''; if (state.index === list.length - 1) state.mode = 'review'; else state.index++; }
      }
    } else if (state.mode === 'text') {
      if (value === '\x1b') { state.mode = 'list'; state.typed = ''; }
      else if (value === '\r') { state.picks.push(state.typed); state.typed = ''; if (state.index === list.length - 1) state.mode = 'review'; else { state.index++; state.mode = 'list'; } }
      else if (!value.startsWith('\x1b')) state.typed += value;
    } else if (state.mode === 'review') {
      if (value === 'y') state.confirm += 'y';
      else if (value === '\x7f') state.confirm = state.confirm.slice(0, -1);
      else if (value === '\r' && state.confirm === 'y') { state.mode = 'done'; state.submitted = true; }
    }
    render();
  } };
  const terminal = { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
  return { process, terminal, writes, state, queued: 0, dirty: true };
}
const answerAll = (rooms: Rooms, room: TerminalRoom, answers: { choice?: number; text?: string }[], questionId = 'q1') =>
  rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId, answers }, () => {});

test('several questions: each answered in turn, the review checked, and only then y, Enter', async () => {
  await withFake(async (rooms, room, fake) => {
    await answerAll(rooms, room, [{ choice: 1 }, { choice: 2 }]);
    assert.deepEqual(fake.writes, ['1', '\r', '2', '\r', 'y', '\r']);
    assert.deepEqual(fake.state.picks, ['Red', 'Dog']);
    assert.equal(fake.state.submitted, true);
  }, fakeClaudePair() as any, pair);
  // A typed answer in the middle goes through Other.
  await withFake(async (rooms, room, fake) => {
    await answerAll(rooms, room, [{ text: 'Green' }, { choice: 1 }]);
    assert.deepEqual(fake.writes, ['3', '\r', 'Green', '\r', '1', '\r', 'y', '\r']);
    assert.deepEqual(fake.state.picks, ['Green', 'Cat']);
    assert.equal(fake.state.submitted, true);
  }, fakeClaudePair() as any, pair);
});

test('several questions: a short card, a changed list or a review that differs sends nothing final', async () => {
  // One answer for two questions.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answerAll(rooms, room, [{ choice: 1 }]), /多個問題/);
    assert.deepEqual(fake.writes, []);
  }, fakeClaudePair() as any, pair);
  // The second question's list is not the card's: stops there, the first answer is already in, and y is never pressed.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answerAll(rooms, room, [{ choice: 1 }, { choice: 1 }]), /找不到這個選項/);
    assert.equal(fake.state.submitted, false);
    assert.ok(!fake.writes.includes('y'));
  }, fakeClaudePair() as any, [pair[0], { title: pair[1].title, options: ['Bird', 'Dog'] }]);
  // The review shows an answer the card did not give: not confirmed.
  await withFake(async (rooms, room, fake) => {
    await assert.rejects(answerAll(rooms, room, [{ choice: 1 }, { choice: 2 }]), /確認畫面顯示嘅答案同卡片唔一樣/);
    assert.equal(fake.state.submitted, false);
    assert.ok(!fake.writes.includes('y'));
    assert.equal(fake.state.mode, 'review', 'the review is left open for the person');
  }, fakeClaudePair({ wrongReview: true }) as any, pair);
});

test('a long question drawn over many lines, each starting with "> " and taller than the last 16 lines, is still found and answered', async () => {
  // What the phone showed on 2026-11-20: a short first line, blank lines between paragraphs, then the choices.
  const long = [
    { title: ['Walk.', 'The next batch is prepared while you answer the current one, so a wrong answer reaches the reader only one batch later.', '', 'If the answer shows you need help (a wrong answer, a change of topic or remediation), what should happen to the batch that is already prepared?', '', 'Please pick one of the two ways of handling it.', '', 'It changes how fast the next page appears.'].join('\n'), options: ['Always use it (Recommended)', 'Discard if wrong'] },
    { title: 'Choose the iPhone layout fixes from the mocks: (A) a 5-bar page, (B) the edge marker.', options: ['A1 + B1 (Recommended)', 'A2 + B1'] },
  ];
  await withFake(async (rooms, room, fake) => {
    // The drawn question really is taller than the tail the prompt is read from.
    assert.ok(fake.terminal.buffer.active.getLine(0).translateToString().length > 0);
    await answerAll(rooms, room, [{ choice: 1 }, { choice: 2 }]);
    assert.deepEqual(fake.writes, ['1', '\r', '2', '\r', 'y', '\r']);
    assert.deepEqual(fake.state.picks, ['Always use it (Recommended)', 'A2 + B1']);
    assert.equal(fake.state.submitted, true);
  }, fakeClaudePair({ list: long }) as any, long);
  // The old comparison would have refused this: the card's first 24 characters cross a line break on screen.
  const squashedOld = (value: string) => value.replace(/\s+/g, '');
  assert.ok(!squashedOld(drawn(long[0].title).join('\n')).includes(squashedOld(long[0].title).slice(0, 24)));
});

// ---- AGY ask_question screen parsing, answering (single-select, multi-select, Write-in, multi-question, failure recovery), and role routing ----

interface FakeAgyQuestionSpec {
  title: string;
  options: string[];
  multiSelect?: boolean;
  includeWriteIn?: boolean;
}

function fakeAgy(
  questions: FakeAgyQuestionSpec[] = [{ title: 'Replace this lesson?', options: ['(Recommended) Approve', 'Keep old'] }],
  opts: { swallowMove?: boolean; swallowWriteInOpen?: boolean; swallowText?: boolean } = {},
) {
  const state = {
    qIndex: 0,
    selected: 1,
    checked: questions.map(q => q.options.map(() => false)),
    writeInOpen: false,
    typed: '',
    answers: [] as string[],
    done: false,
  };
  const lines: string[] = [];
  const render = () => {
    if (state.done) {
      lines.splice(0, lines.length,
        ...questions.flatMap((q, i) => [`? ${q.title}`, `> ${state.answers[i] ?? ''}`]),
        '⣷  Working...',
        '────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
        '>',
        '────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
        'esc to cancel                                                                             Gemini 3.8 Flash · low',
      );
      return;
    }
    const q = questions[state.qIndex];
    const hasWriteIn = q.includeWriteIn !== false;
    const optRows = [
      ...q.options.map((label, idx) => {
        const n = idx + 1;
        const cursor = state.selected === n ? '> ' : '  ';
        const box = q.multiSelect ? `[${state.checked[state.qIndex][idx] ? 'x' : ' '}] ` : '';
        return `${cursor}${n}. ${box}${label}`;
      }),
      ...(hasWriteIn ? [`${state.selected === q.options.length + 1 ? '> ' : '  '}${q.options.length + 1}. Write-in...`] : []),
    ];
    const onWriteIn = hasWriteIn && state.selected === q.options.length + 1;
    const footer = state.writeInOpen
      ? ['  Your answer:', `  ${state.typed}`, '', '  enter Submit · esc Back']
      : q.multiSelect
        ? [`  ↑/↓ Navigate · ${onWriteIn ? 'enter Write-in' : 'space Toggle · enter Submit'} · esc Skip`]
        : [`  ↑/↓ Navigate · ${onWriteIn ? 'enter Write-in' : state.qIndex === questions.length - 1 && questions.length > 1 ? '← Back · enter Submit All' : 'enter Select'} · esc Skip`];
    lines.splice(0, lines.length,
      ...questions.map(item => `? ${item.title}`),
      '',
      'Question',
      '────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
      '',
      `Question ${state.qIndex + 1}/${questions.length}: ${q.title}`,
      '',
      ...optRows,
      '',
      ...footer,
      'esc to cancel                                                                             Gemini 3.8 Flash · low',
    );
  };
  render();
  const writes: string[] = [];
  const advanceQuestion = (answerText: string) => {
    state.answers.push(answerText);
    state.writeInOpen = false;
    state.typed = '';
    state.selected = 1;
    if (state.qIndex === questions.length - 1) state.done = true;
    else state.qIndex++;
  };
  const process = {
    write: (value: string) => {
      writes.push(value);
      if (state.done) return;
      const q = questions[state.qIndex];
      const maxN = q.options.length + (q.includeWriteIn !== false ? 1 : 0);
      const writeInN = q.includeWriteIn !== false ? q.options.length + 1 : -1;
      if (state.writeInOpen) {
        if (value === '\x1b') {
          state.writeInOpen = false;
          state.typed = '';
        } else if (value === '\r') {
          const pickedLabels = q.multiSelect ? q.options.filter((_, idx) => state.checked[state.qIndex][idx]) : [];
          const combined = [...pickedLabels, ...(state.typed ? [state.typed] : [])].join(', ');
          advanceQuestion(combined);
        } else if (!value.startsWith('\x1b') && !opts.swallowText) {
          state.typed += value;
        }
      } else {
        if (value === '\x1b[B' && !opts.swallowMove) state.selected = Math.min(maxN, state.selected + 1);
        else if (value === '\x1b[A' && !opts.swallowMove) state.selected = Math.max(1, state.selected - 1);
        else if (value === ' ' && q.multiSelect && state.selected >= 1 && state.selected <= q.options.length) {
          state.checked[state.qIndex][state.selected - 1] = !state.checked[state.qIndex][state.selected - 1];
        } else if (value === '\r') {
          if (state.selected === writeInN) {
            if (!opts.swallowWriteInOpen) { state.writeInOpen = true; state.typed = ''; }
          } else if (q.multiSelect) {
            const pickedLabels = q.options.filter((_, idx) => state.checked[state.qIndex][idx]);
            advanceQuestion(pickedLabels.join(', '));
          } else {
            advanceQuestion(q.options[state.selected - 1]);
          }
        }
      }
      render();
    },
  };
  const terminal = { modes: {}, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines[n] ?? '' }) } } };
  return { process, terminal, writes, state, queued: 0, dirty: true };
}

async function withFakeAgy(
  run: (rooms: Rooms, room: TerminalRoom, fake: ReturnType<typeof fakeAgy>) => Promise<void>,
  fake = fakeAgy(),
  questions: { title: string; options: string[] | null; multiSelect?: boolean }[] = [{ title: 'Replace this lesson?', options: ['(Recommended) Approve', 'Keep old'] }],
) {
  const rooms = new Rooms(process.cwd(), () => {});
  rooms.questionStepMs = 5;
  const room = {
    id: 'agy-q', modelId: 'AGY', roomName: '瞳 · 鑑識', repoPath: '/tmp', logs: [], live: true, status: 'running', ready: false, screen: '',
    pendingQuestion: { id: 'aq1', questions }, remoteControl: { enabled: false, sessionUrl: '' },
  } as unknown as TerminalRoom;
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, fake);
  try { await run(rooms, room, fake); } finally { (rooms as any).live.delete(room.id); }
}

test('AGY single-select question: listed choice moves cursor with ↓ and presses Enter; Write-in opens Your answer box, types text, and submits', async () => {
  await withFakeAgy(async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', choice: 2 }, () => {});
    assert.deepEqual(fake.writes, ['\x1b[B', '\r']);
    assert.deepEqual(fake.state.answers, ['Keep old']);
    assert.equal(fake.state.done, true);
  });

  await withFakeAgy(async (rooms, room, fake) => {
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', text: 'Custom lesson\nplan' }, () => {});
    assert.deepEqual(fake.writes, ['\x1b[B', '\x1b[B', '\r', 'Custom lesson plan', '\r']);
    assert.deepEqual(fake.state.answers, ['Custom lesson plan']);
    assert.equal(fake.state.done, true);
  });
});

test('AGY accepts an answer once when refresh clears the completed question before confirmation', async () => {
  await withFakeAgy(async (rooms, room, fake) => {
    const write = fake.process.write;
    fake.process.write = (value: string) => {
      write(value);
      if (fake.state.done) (rooms as any).refresh(room, fake);
    };
    await rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', choice: 2 }, () => {});
    assert.deepEqual(fake.writes, ['\x1b[B', '\r']);
    assert.deepEqual(fake.state.answers, ['Keep old']);
    assert.equal(room.pendingQuestion, undefined);
  });
});

test('AGY does not accept a different question as confirmation of an earlier answer', async () => {
  await withFakeAgy(async (rooms, room, fake) => {
    const write = fake.process.write;
    fake.process.write = (value: string) => {
      write(value);
      if (fake.state.done) {
        (rooms as any).refresh(room, fake);
        room.pendingQuestion = { id: 'new-question', questions: [{ title: 'Another question?', options: ['Yes'] }] };
      }
    };
    await assert.rejects(rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', choice: 2 }, () => {}), /Enter 後問題仍然開著/);
    assert.deepEqual(fake.writes, ['\x1b[B', '\r']);
    assert.deepEqual(fake.state.answers, ['Keep old']);
  });
});

test('AGY multi-select and multi-question call: toggles checkboxes with Space, supports Write-in addition, and answers Question 1/2 then Question 2/2', async () => {
  const twoSpecs: FakeAgyQuestionSpec[] = [
    { title: 'Which platforms to build?', options: ['(Recommended) iOS', 'macOS', 'Web'], multiSelect: true },
    { title: 'Release channel?', options: ['(Recommended) Beta', 'Stable'], multiSelect: false },
  ];
  const twoQuestions = [
    { title: 'Which platforms to build?', options: ['(Recommended) iOS', 'macOS', 'Web'], multiSelect: true },
    { title: 'Release channel?', options: ['(Recommended) Beta', 'Stable'] },
  ];

  await withFakeAgy(async (rooms, room, fake) => {
    await rooms.handle({
      type: 'ANSWER_QUESTION',
      roomId: room.id,
      questionId: 'aq1',
      answers: [{ choices: [1, 2] }, { choice: 2 }],
    }, () => {});
    assert.deepEqual(fake.writes, [' ', '\x1b[B', ' ', '\r', '\x1b[B', '\r']);
    assert.deepEqual(fake.state.answers, ['(Recommended) iOS, macOS', 'Stable']);
    assert.equal(fake.state.done, true);
  }, fakeAgy(twoSpecs), twoQuestions);

  // Multi-select combining a checked option with a Write-in custom answer.
  const singleMultiSpec: FakeAgyQuestionSpec[] = [{ title: 'Pick features?', options: ['(Recommended) Auth', 'Search'], multiSelect: true }];
  const singleMultiQ = [{ title: 'Pick features?', options: ['(Recommended) Auth', 'Search'], multiSelect: true }];
  await withFakeAgy(async (rooms, room, fake) => {
    await rooms.handle({
      type: 'ANSWER_QUESTION',
      roomId: room.id,
      questionId: 'aq1',
      choices: [1],
      text: 'Offline mode',
    }, () => {});
    assert.deepEqual(fake.writes, [' ', '\x1b[B', '\x1b[B', '\r', 'Offline mode', '\r']);
    assert.deepEqual(fake.state.answers, ['(Recommended) Auth, Offline mode']);
    assert.equal(fake.state.done, true);
  }, fakeAgy(singleMultiSpec), singleMultiQ);
});

test('AGY question failures: refused or failed answer never leaves the room stuck dirty, closes an open Write-in box with Escape, and a waiting AGY room is skipped by role routing', async () => {
  // Mismatched question title on screen: sends no keys and leaves dirty = false.
  await withFakeAgy(async (rooms, room, fake) => {
    await assert.rejects(
      rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', choice: 1 }, () => {}),
      /與你看到的不同/,
    );
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.dirty, false, 'refusal does not leave the screen marked updating');
  }, fakeAgy(), [{ title: 'Completely different question title?', options: ['(Recommended) Approve', 'Keep old'] }]);

  // Option mismatch on screen: sends no keys and leaves dirty = false.
  await withFakeAgy(async (rooms, room, fake) => {
    await assert.rejects(
      rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', choice: 1 }, () => {}),
      /找不到這個選項/,
    );
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.dirty, false);
  }, fakeAgy([{ title: 'Replace this lesson?', options: ['Different option 1', 'Keep old'] }]));

  // Write-in box opens but typed text is swallowed: closes Write-in box with Escape and clears dirty flag.
  await withFakeAgy(async (rooms, room, fake) => {
    await assert.rejects(
      rooms.handle({ type: 'ANSWER_QUESTION', roomId: room.id, questionId: 'aq1', text: 'Custom' }, () => {}),
      /輸入的字沒有出現/,
    );
    assert.equal(fake.state.writeInOpen, false, 'Escape closed the Write-in box');
    assert.equal(fake.state.done, false);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(fake.dirty, false);
  }, fakeAgy(undefined, { swallowText: true }));

  // Role routing / isWorking treats an AGY room with a pendingQuestion as waiting/working.
  await withFakeAgy(async (rooms, room) => {
    room.ready = true;
    room.status = 'idle';
    assert.equal(rooms.isWorking(room.id), true, 'an AGY room with a pendingQuestion is treated as working/waiting');
    assert.equal(rooms.roleRoutingState(room).working, true);
    room.pendingQuestion = undefined;
  });
});
