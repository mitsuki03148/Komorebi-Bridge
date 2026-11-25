import assert from 'node:assert/strict'
import test from 'node:test'
import { resumePrompt, visibleMenu } from './terminal'
import { pushPayload } from './push'

// The screen as a Claude room showed it after six hours alone (Resume menu, option 2 starts a new conversation).
const stale = [
  'Crunched for 2m 54s · done 12:17 AM',
  'Resume this conversation?',
  'This conversation has been inactive for 6h 40m and is large. Resuming it will use more of your 5-hour usage limit.',
  '1. Resume',
  '2. Start a new conversation — Claude can look this up from the summary',
  'Select with numbers [1-2]. Then Enter to submit:',
  'Enter to confirm · Esc to resume',
].join('\n');

test('the Resume menu of a Claude room left alone for hours is recognised, and only that menu', () => {
  assert.equal(resumePrompt('CLAUDE', stale), true);
  assert.equal(resumePrompt('CODEX', stale), false, 'only Claude Code asks this');
  assert.equal(resumePrompt('CLAUDE', stale.replace('Resume this conversation?', 'Pick one')), false);
  assert.equal(resumePrompt('CLAUDE', 'Do you want to proceed?\n1. Yes\n2. No\nSelect with numbers [1-2]. Then Enter to submit:'), false, 'another numbered menu is not this one');
  assert.equal(resumePrompt('CLAUDE', `${stale}\n${'later output\n'.repeat(20)}`), false, 'an old mention far up the screen is not the menu on screen');
  // The menu is still a visible numbered menu for the page's buttons.
  assert.ok(visibleMenu('CLAUDE', stale, undefined));
});

test('the push for a room stopped at the Resume menu says so and what each choice costs', () => {
  const payload = pushPayload('resume', '響', 'DemoProject 實作', true, 'room-1');
  assert.equal(payload.kind, 'resume');
  assert.match(payload.body, /響 · DemoProject 實作 閒置太久.*Resume.*1.*額度.*2.*新對話/);
  assert.equal(payload.tag, 'komorebi-room-1-resume');
});
