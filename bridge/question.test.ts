import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pendingQuestionOf } from './sessions';
import { QuestionCard, questionAnswerText } from '../src/components/QuestionCard';
import type { PendingQuestion, TerminalLogEntry } from '../src/types/guild';

const at = '2026-11-13T10:35:00.000Z';
const now = Date.parse('2026-11-13T11:00:00.000Z');
const asked = (questions: unknown, timestamp = at) => ({ timestamp, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', questions } } });
const user = (createdAt: string): TerminalLogEntry => ({ id: createdAt, timestamp: '', createdAt, sender: 'user', text: '好' });

test('a question stays pending until the user answers it, and keeps its choices', () => {
  const records = [{ type: 'response_item', payload: {} }, asked([{ title: '揀一個', options: ['A', 'B'] }, { title: '請打字', options: null }])];
  const pending = pendingQuestionOf(records, [user('2026-11-13T10:30:00.000Z')], now);
  assert.equal(pending?.id, at);
  assert.deepEqual(pending?.questions, [{ title: '揀一個', options: ['A', 'B'] }, { title: '請打字', options: null }]);
  // A message from the user after it answers it; one from before does not.
  assert.equal(pendingQuestionOf(records, [user('2026-11-13T10:36:00.000Z')], now), undefined);
});

test('only the latest question counts, an old one has lapsed, and empty or odd entries are ignored', () => {
  const older = asked([{ title: '舊問題', options: null }], '2026-11-13T09:00:00.000Z');
  const latest = asked([{ title: '新問題', options: [] }]);
  assert.equal(pendingQuestionOf([older, latest], [], now)?.questions[0].title, '新問題');
  assert.equal(pendingQuestionOf([older, latest], [], now)?.questions[0].options, null, 'an empty list means typing');
  assert.equal(pendingQuestionOf([latest], [], now + 13 * 60 * 60 * 1000), undefined);
  assert.equal(pendingQuestionOf([asked([{ title: '  ', options: null }])], [], now), undefined);
  assert.equal(pendingQuestionOf([asked([])], [], now), undefined);
  assert.equal(pendingQuestionOf([], [], now), undefined);
});

test('the answer names its question, for one or several', () => {
  const one: PendingQuestion = { id: at, questions: [{ title: '你方便喺 Mac 批准嗎？', options: ['方便', '不方便'] }] };
  assert.equal(questionAnswerText(one, ['方便']), '回答你的問題「你方便喺 Mac 批准嗎？」：方便');
  const two: PendingQuestion = { id: at, questions: [{ title: '揀一個', options: ['A'] }, { title: '請打字', options: null }] };
  assert.equal(questionAnswerText(two, ['A', '你好']), '回答你的問題：\n1.「揀一個」：A\n2.「請打字」：你好');
  const long: PendingQuestion = { id: at, questions: [{ title: 'x'.repeat(60), options: null }] };
  assert.match(questionAnswerText(long, ['ok']), /「x{28}…」：ok$/);
});

test('the card is a short prompt until it is opened to answer', () => {
  const pending: PendingQuestion = { id: at, questions: [{ title: '揀一個', options: ['測試選項 A', '測試選項 B'] }] };
  const html = renderToStaticMarkup(createElement(QuestionCard, { pending, name: '光', onAnswer() {} }));
  assert.match(html, /光 有問題等你回答/);
  assert.match(html, />回答</);
  assert.doesNotMatch(html, /測試選項 A|送出回答/);
});

test('an answer given in Codex\'s own question screen reads as one line, not as a block of tags and JSON', async () => {
  const { transcriptText } = await import('../src/utils/transcriptText');
  const reply = (items: unknown) => `<send_user_message_question_reply>\n${JSON.stringify(items)}\n</send_user_message_question_reply>`;
  assert.equal(transcriptText('CODEX', 'user', reply([{ answer: '測試打字答案：我自己打嘅', question: '【Komorebi 工作中答題測試】揀一個', questionItemId: '["request_user_input_async","call_1",0]' }])),
    '回答「【Komorebi 工作中答題測試】揀一個」：測試打字答案：我自己打嘅');
  assert.equal(transcriptText('CODEX', 'user', reply([{ answer: 'A', question: '一' }, { answer: 'B', question: '二' }])), '回答「一」：A\n回答「二」：B');
  assert.equal(transcriptText('CODEX', 'user', reply([{ answer: '好', question: 'x'.repeat(50) }])), `回答「${'x'.repeat(30)}…」：好`);
  // Anything else, including a person's own message that mentions the tag or a reply nobody answered, is left as it is.
  const broken = '<send_user_message_question_reply>not json</send_user_message_question_reply>';
  assert.equal(transcriptText('CODEX', 'user', broken), broken);
  assert.equal(transcriptText('CODEX', 'user', reply([{ question: '空', answer: '' }])), reply([{ question: '空', answer: '' }]));
  assert.equal(transcriptText('CODEX', 'user', `請看 ${reply([{ answer: 'A', question: 'q' }])}`), `請看 ${reply([{ answer: 'A', question: 'q' }])}`);
  assert.equal(transcriptText('CODEX', 'user', '一般訊息'), '一般訊息');
});

test('a question appears in the conversation with its choices, once, marked open or answered', async () => {
  const { writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSession } = await import('./sessions');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-question-log-'));
  const id = '00000007-0007-4007-8007-000000000007';
  const stamp = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const event = (minutes: number, title: string, options: string[] | null, ordinal: number) => ({ timestamp: stamp(minutes), ordinal, type: 'event_msg',
    payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: options ? `${title}\n${options.map(option => ` - ${option}`).join('\n')}` : title }], questions: [{ title, options }] } } });
  const message = (minutes: number, role: string, text: string, ordinal: number) => ({ timestamp: stamp(minutes), ordinal, type: 'response_item',
    payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  try {
    const file = join(tmp, 'rollout.jsonl');
    await writeFile(file, [
      { type: 'session_meta', payload: { id, cwd: tmp } },
      event(30, '舊問題？', ['好', '唔好'], 1),
      message(30, 'assistant', '舊問題？', 2),                 // the same question again as a message: not shown twice
      message(20, 'user', '好', 3),                              // answers it
      event(5, '新問題？', ['A', 'B'], 4),
      event(4, '請打字', null, 5),
    ].map(row => JSON.stringify(row)).join('\n'));
    const session = await readSession('CODEX', file, tmp, tmp);
    const texts = session!.logs.map(entry => entry.text);
    assert.deepEqual(texts, ['舊問題？\n - 好\n - 唔好', '好', '新問題？\n - A\n - B', '請打字']);
    assert.deepEqual(session!.logs.map(entry => entry.question), ['answered', undefined, undefined, 'open']);
    assert.equal(session!.pendingQuestion?.questions[0].title, '請打字');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('the app answers a one-question card inside the CLI whether or not it lists answers', async () => {
  const { readFile } = await import('node:fs/promises')
  const app = await readFile('src/App.tsx', 'utf8')
  assert.match(app, /const single = target\?\.pendingQuestion\?\.questions\.length === 1;/)
  assert.doesNotMatch(app, /questions\[0\]\.options;\s*\n\s*const queued/, 'a question with only a box to type in is not left to the plain message, which a working CLI cannot take')
})

test('a message sent to Claude while it works (a queued command, not a user row) stays in the conversation', async () => {
  const { writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { readSession } = await import('./sessions')
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-queued-'))
  const id = '00000008-0008-4008-8008-000000000008'
  const at = (second: number) => new Date(Date.UTC(2026, 10, 13, 18, 0, second)).toISOString()
  const user = (second: number, text: string, uuid: string) => ({ type: 'user', uuid, timestamp: at(second), sessionId: id, cwd: tmp, message: { role: 'user', content: text } })
  const queued = (second: number, prompt: unknown, uuid: string) => ({ type: 'attachment', uuid, timestamp: at(second), sessionId: id, cwd: tmp, attachment: { type: 'queued_command', prompt } })
  try {
    const file = join(tmp, 'claude.jsonl')
    await writeFile(file, [
      user(1, '開始做', 'u1'),
      { type: 'assistant', uuid: 'a1', timestamp: at(2), sessionId: id, cwd: tmp, message: { role: 'assistant', content: [{ type: 'text', text: '好，我做緊。' }] } },
      queued(3, [{ type: 'text', text: '[Image #40] 偷試左失敗' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }], 'q1'),
      queued(4, '純文字補充', 'q2'),
      queued(5, '<task-notification>\n<task-id>x</task-id>\n</task-notification>', 'q3'),
      { type: 'queue-operation', operation: 'enqueue', timestamp: at(6), sessionId: id, content: '只係排隊記錄' },
      { type: 'attachment', uuid: 'o1', timestamp: at(7), sessionId: id, cwd: tmp, attachment: { type: 'hook_success', content: 'x' } },
    ].map(row => JSON.stringify(row)).join('\n'))
    const session = await readSession('CLAUDE', file, tmp, tmp)
    assert.deepEqual(session!.logs.map(entry => [entry.sender, entry.text]), [
      ['user', '開始做'], ['agent', '好，我做緊。'], ['user', '📎 圖片 偷試左失敗'], ['user', '純文字補充'],
    ])
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test('a question Claude puts to the user with AskUserQuestion is pending until a tool result answers it, and shows in the conversation', async () => {
  const { rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSession, claudePendingQuestionOf } = await import('./sessions');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-claude-ask-'));
  try {
    const id = '00000009-0009-4009-8009-000000000009';
    // Recent, because a question older than twelve hours counts as lapsed.
    const asking = new Date(Date.now() - 5 * 60_000).toISOString();
    const before = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const base = { sessionId: id, cwd: tmp, userType: 'external', gitBranch: 'main' };
    const ask = {
      ...base, type: 'assistant', uuid: 'a2', timestamp: asking,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: { questions: [{
        question: 'Should the strip scroll?', header: 'Strip', multiSelect: false,
        options: [{ label: 'Scroll sideways (Recommended)', description: 'Keep the staff large.' }, { label: 'Two lines', description: 'Wrap.' }],
      }] } }] },
    };
    const head = [
      { ...base, type: 'user', uuid: 'u1', timestamp: before(30), message: { role: 'user', content: 'fix it' } },
      { ...base, type: 'assistant', uuid: 'a1', timestamp: before(20), message: { role: 'assistant', content: [{ type: 'text', text: 'Let me ask.' }] } },
    ];
    const toolResult = (text: string) => ({ ...base, type: 'user', uuid: 'r1', timestamp: before(1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text }] } });
    const file = join(tmp, `${id}.jsonl`);
    const write = (rows: object[]) => writeFile(file, rows.map(item => JSON.stringify(item)).join('\n') + '\n');

    // Waiting: the room carries the question and its choices, and the conversation shows it as open.
    await write([...head, ask]);
    const waiting = await readSession('CLAUDE', file, tmp, tmp);
    assert.deepEqual(waiting?.pendingQuestion, { id: asking, questions: [{ title: 'Should the strip scroll?', options: ['Scroll sideways (Recommended)', 'Two lines'] }] });
    const shown = waiting?.logs.at(-1);
    assert.equal(shown?.sender, 'agent');
    assert.equal(shown?.question, 'open');
    assert.match(shown?.text ?? '', /Should the strip scroll\?\n - Scroll sideways \(Recommended\)\n - Two lines/);
    assert.equal(waiting?.logs.length, 3, 'the earlier messages are still there');

    // The same question keeps the same id when the rows around it move (the read window slides as the transcript grows),
    // otherwise each read adds it to the conversation again.
    const firstId = shown?.id;
    await write([{ ...base, type: 'user', uuid: 'u0', timestamp: before(40), message: { role: 'user', content: 'earlier' } }, ...head, ask]);
    const slid = await readSession('CLAUDE', file, tmp, tmp);
    assert.equal(slid?.logs.filter(entry => entry.text.includes('Should the strip scroll?')).length, 1);
    assert.equal(slid?.logs.find(entry => entry.text.includes('Should the strip scroll?'))?.id, firstId);
    await write([...head, ask]);

    // Answered in the CLI (a choice or a dismissal both write a tool result): nothing is pending, the entry reads as answered.
    for (const text of ['User has answered your questions: "Should the strip scroll?"="Two lines".', 'The user doesn\'t want to proceed with this tool use.']) {
      await write([...head, ask, toolResult(text)]);
      const done = await readSession('CLAUDE', file, tmp, tmp);
      assert.equal(done?.pendingQuestion, undefined);
      assert.equal(done?.logs.find(entry => entry.text.includes('Should the strip scroll?'))?.question, 'answered');
    }
    // Once answered, the entry keeps the question and the chosen answer only; a dismissed one keeps just the question.
    await write([...head, ask, { ...toolResult('User has answered your questions: "Should the strip scroll?"="Two lines".'), toolUseResult: { answers: { 'Should the strip scroll?': 'Two lines' } } }]);
    const chosen = (await readSession('CLAUDE', file, tmp, tmp))?.logs.find(entry => entry.text.includes('Should the strip scroll?'));
    assert.equal(chosen?.text, 'Should the strip scroll?\n答：Two lines');
    await write([...head, ask, toolResult('The user doesn\'t want to proceed with this tool use.')]);
    assert.equal((await readSession('CLAUDE', file, tmp, tmp))?.logs.find(entry => entry.text.includes('Should the strip scroll?'))?.text, 'Should the strip scroll?');
    assert.equal(claudePendingQuestionOf([ask], Date.parse(asking) + 13 * 60 * 60 * 1000), undefined, 'an old one has lapsed');
    assert.equal(claudePendingQuestionOf([{ ...ask, isSidechain: true }]), undefined, 'a sub-agent\'s question is not the room\'s');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('AGY ask_question in transcript_full.jsonl is pending until a GENERIC answer row arrives, supports multi-select and several questions, keeps stable step_index ids, and shows only chosen answers once answered', async () => {
  const { mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSession, agyPendingQuestionOf } = await import('./sessions');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-agy-ask-'));
  try {
    const id = '00000010-0010-4010-8010-000000000010';
    const root = join(tmp, 'antigravity-cli/brain');
    const logDir = join(root, id, '.system_generated/logs');
    await mkdir(logDir, { recursive: true });
    const file = join(logDir, 'transcript_full.jsonl');

    const recent = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const askTime = recent(5);

    // Real captured row shapes from Phase 1 throwaway AGY sessions (single select, multi-select, recommended mark, Write-in, two questions, and User Skipped).
    const userRow = {
      step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: recent(10),
      content: '<USER_REQUEST>\nCheck build options.\n</USER_REQUEST>',
    };
    const askMultiAndSingle = {
      step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: askTime,
      model: 'gemini-3.8-flash-low', input_tokens: 9043, cache_read_tokens: 0, output_tokens: 78,
      tool_calls: [{
        name: 'ask_question',
        args: {
          questions: [
            { is_multi_select: true, options: ['(Recommended) iOS', 'macOS', 'Web'], question: 'Which platforms to build?' },
            { is_multi_select: false, options: ['(Recommended) Beta', 'Stable'], question: 'Release channel?' },
          ],
        },
      }],
    };
    const genericAnswer = (stepIndex: number, lines: string[]) => ({
      step_index: stepIndex, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: recent(2),
      content: `Created At: ${recent(2)}\nCompleted At: ${recent(2)}\nCreated At: ${recent(2)}\nCompleted At: ${recent(2)}\n${lines.join('\n')}`,
    });
    const write = (rows: object[]) => writeFile(file, rows.map(item => JSON.stringify(item)).join('\n') + '\n');

    // 1. Waiting: pendingQuestion carries both questions, their options (including "(Recommended)"), and multiSelect: true on the first.
    await write([userRow, askMultiAndSingle]);
    const waiting = await readSession('AGY', file, root, tmp);
    assert.deepEqual(waiting?.pendingQuestion, {
      id: askTime,
      questions: [
        { title: 'Which platforms to build?', options: ['(Recommended) iOS', 'macOS', 'Web'], multiSelect: true },
        { title: 'Release channel?', options: ['(Recommended) Beta', 'Stable'] },
      ],
    });
    const openEntry = waiting?.logs.at(-1);
    assert.equal(openEntry?.sender, 'agent');
    assert.equal(openEntry?.question, 'open');
    assert.equal(
      openEntry?.text,
      'Which platforms to build?\n - (Recommended) iOS\n - macOS\n - Web\n\nRelease channel?\n - (Recommended) Beta\n - Stable',
    );

    // 2. Stable entry id from step_index when earlier rows are prepended (sliding window).
    const firstId = openEntry?.id;
    assert.equal(firstId, `${id}-q1`);
    const earlierRow = {
      step_index: 999, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: recent(20),
      content: '<USER_REQUEST>\nEarlier message\n</USER_REQUEST>',
    };
    await write([earlierRow, userRow, askMultiAndSingle]);
    const slid = await readSession('AGY', file, root, tmp);
    const matches = slid?.logs.filter(entry => entry.text.includes('Which platforms to build?')) ?? [];
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, firstId);

    // 3. Answered with listed + Write-in choices: pendingQuestion clears, and the conversation entry shows only the questions and chosen answers.
    await write([userRow, askMultiAndSingle, genericAnswer(2, ['A1: (Recommended) iOS, macOS, Custom target', 'A2: Stable'])]);
    const answered = await readSession('AGY', file, root, tmp);
    assert.equal(answered?.pendingQuestion, undefined);
    const answeredEntry = answered?.logs.find(entry => entry.id === firstId);
    assert.equal(answeredEntry?.question, 'answered');
    assert.equal(
      answeredEntry?.text,
      'Which platforms to build?\n答：(Recommended) iOS, macOS, Custom target\n\nRelease channel?\n答：Stable',
    );

    // 4. Skipped with Esc ("A1: User Skipped"): counts as answered and shows only the question title without "答：User Skipped".
    const askSkip = {
      step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: recent(1),
      model: 'gemini-3.8-flash-low', input_tokens: 2157, cache_read_tokens: 7016, output_tokens: 42,
      tool_calls: [{ name: 'ask_question', args: { questions: [{ is_multi_select: false, options: ['(Recommended) Yes', 'No'], question: 'Skip me?' }] } }],
    };
    await write([userRow, askSkip, genericAnswer(4, ['A1: User Skipped'])]);
    const skipped = await readSession('AGY', file, root, tmp);
    assert.equal(skipped?.pendingQuestion, undefined);
    const skippedEntry = skipped?.logs.find(entry => entry.id === `${id}-q3`);
    assert.equal(skippedEntry?.question, 'answered');
    assert.equal(skippedEntry?.text, 'Skip me?');

    // 5. Lapsed (> 12 hours old) is not pending.
    assert.equal(agyPendingQuestionOf([askMultiAndSingle], Date.parse(askTime) + 13 * 60 * 60 * 1000), undefined);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
