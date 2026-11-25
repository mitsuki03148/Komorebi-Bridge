import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { approvalPrompt, codexStatusSession, composerText, hasWorkingIndicator, isComposer, visibleMenu } from './terminal';

const captures = [
  ['s1-2026-11-14T12-40-11.307Z', 'Please adjust the colour and spacing for the sample screen. Keep the motion soft and the layout easy to read.'],
  ['s2-2026-11-16T00-05-11.620Z', '[handoff] A sample task is ready: Please review the result and send the summary. Continue with the next step when the check is complete.'],
  ['s3-2026-11-16T00-16-22.370Z', '[handoff] A sample task is ready: Please review the result and send the summary. Continue with the next step when the check is complete.'],
  ['s4-2026-11-16T08-13-26.343Z', '[handoff] Sample clarification: the local service may handle the request without a provider. Continue after the check. See the task details for the remaining steps.'],
] as const;

for (const [capture, draft] of captures) {
  test(`AGY synthetic capture ${capture}: recognizes the box and its complete draft`, () => {
    const screen = (JSON.parse(readFileSync(new URL(`./fixtures/agy-composer/komorebi-stuck-${capture}.json`, import.meta.url), 'utf8')) as string[]).join('\n');
    assert.equal(isComposer('AGY', screen), true);
    assert.equal(composerText('AGY', screen), draft);
    assert.equal(approvalPrompt('AGY', screen), undefined);
    assert.equal(visibleMenu('AGY', screen, undefined), undefined);
  });
}

const rule = '─'.repeat(80);
const box = (draft: string, footer: string) => [rule, '> ' + draft, rule, footer].join('\n');

test('AGY requires both borders and bounds the wrapped draft and footer', () => {
  const history = ['Completed', '> old prompt', 'continued', rule, 'Gemini 4 Argon · medium'].join('\n');
  for (const screen of [history, box('first\n' + Array(13).fill('continuation').join('\n'), 'Gemini 4 Argon · medium'),
    box('first', Array(10).fill('more output').join('\n'))]) {
    assert.equal(isComposer('AGY', screen), false);
    assert.equal(composerText('AGY', screen), undefined);
  }
  const wrapped = Array.from({ length: 12 }, (_, index) => `row-${index}`);
  assert.equal(composerText('AGY', box(['first', ...wrapped].join('\n'), 'Gemini 4 Argon · medium')), ['first', ...wrapped].join(' '));
});

test('AGY empty composer stays available with a background count or a stop hint', () => {
  const background = box('', 'Gemini 4 Hydrogen · medium · 1 task(s) · /tasks');
  assert.equal(composerText('AGY', background), '');
  assert.equal(isComposer('AGY', background), true);
  assert.equal(hasWorkingIndicator(background), false);
  const working = 'Working...\n' + box('  one   line ', 'esc to cancel');
  assert.equal(composerText('AGY', working), 'one   line');
  assert.equal(isComposer('AGY', working), true);
  assert.equal(hasWorkingIndicator(working), true);
});

test('AGY approval and rules menu take precedence over a visible box', () => {
  const approval = box('', 'Requesting permission for:\nRead a workspace file (y/n)');
  assert.equal(isComposer('AGY', approval), false);
  assert.equal(composerText('AGY', approval), undefined);
  assert.equal(approvalPrompt('AGY', approval)?.yes, 'y');
  const menu = box('', '> Project\nShared with Antigravity\nGlobal\nKeyboard: ↑/↓ Navigate · enter Save · esc Close');
  assert.equal(isComposer('AGY', menu), false);
  assert.equal(composerText('AGY', menu), undefined);
  assert.equal(visibleMenu('AGY', menu, undefined)?.title, '規則設定');
});

test('Claude accepts an empty prompt and the captured busy draft without accepting shell examples', () => {
  const chrome = 'bypass permissions on (shift+tab to cycle) · esc to interrupt\n/rc';
  for (const [screen, expected] of [['$', ''], [chrome + '\n$\u00a0 好呀先做1/2', '好呀先做1/2']]) {
    assert.equal(composerText('CLAUDE', screen), expected);
    assert.equal(isComposer('CLAUDE', screen), true);
  }
  for (const screen of [
    '$ npm test\nPASS', 'Try this in your terminal:\n$ npm test', 'Try this in your terminal:\n$  npm test',
    chrome + '\n$ npm test', chrome + '\n```sh\n$  npm test',
    chrome + '\n$  好呀先做1/2\nEnter y/n:',
    chrome + '\n' + Array(8).fill('older output').join('\n') + '\n$  npm test',
  ]) {
    assert.equal(isComposer('CLAUDE', screen), false);
    assert.equal(composerText('CLAUDE', screen), undefined);
  }
});

test('Codex still distinguishes its composer from menu choices', () => {
  const composer = '› Check the fixture\n  GPT-6.1-Sol low · ~/proj';
  assert.equal(composerText('CODEX', composer), 'Check the fixture');
  assert.equal(isComposer('CODEX', composer), true);
  assert.equal(isComposer('CODEX', '› 1. Yes\nenter continue · esc back'), false);
});

test('Codex session id is read from the /status card even after later messages were typed', () => {
  const card = ['/status', '  >_ OpenAI Codex (v0.169.0)', '  Model:               GPT-6.2-Sol (reasoning medium, summaries auto)',
    '  Directory:           /Volumes/Komorebi/ExampleApp Repo/ExampleApp', '  Account:             a@b (Pro 100)',
    '  Session:             00000003-0003-4003-8003-000000000003', '  Weekly limit:        [█░░░░░░░░░░░░░░░░░░░] 4% left'];
  const later = ['• Model changed to gpt-6-luna high for this session only', '› Hi', '• 收到。', '› Ask Codex to do anything', '  GPT-6-Luna high · /x'];
  assert.equal(codexStatusSession([...card, ...later].join('\n')), '00000003-0003-4003-8003-000000000003');
  // With box borders, as older versions drew it.
  assert.equal(codexStatusSession(card.map(line => `│ ${line.trim()} │`).join('\n')), '00000003-0003-4003-8003-000000000003');
  // A session line that is not inside the card (tool output, a pasted note) is not taken.
  assert.equal(codexStatusSession('$ cat notes\nSession:  00000003-0003-4003-8003-000000000003\n› Hi'), undefined);
  assert.equal(codexStatusSession('nothing here'), undefined);
});
