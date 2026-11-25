import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import test from 'node:test';
import { agySteps } from './sessions';

const call = (steps: unknown) => ({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'update_steps', args: { steps } }] });

test('update_steps gives the checklist from a JSON string or a list, and skips odd entries', () => {
  const list = [{ title: '檢查', status: 'done' }, { title: '  寫碼 ', status: 'in_progress' }, { title: '測試', status: 'weird' }, { title: '  ', status: 'done' }, { status: 'done' }];
  const expected = [{ title: '檢查', status: 'done' }, { title: '寫碼', status: 'in_progress' }, { title: '測試', status: 'pending' }];
  assert.deepEqual(agySteps(call(JSON.stringify(list))), expected);
  assert.deepEqual(agySteps(call(list)), expected);
  assert.equal(agySteps(call('not json')), undefined);
  assert.equal(agySteps(call('[]')), undefined);
  assert.equal(agySteps({ type: 'GENERIC' }), undefined);
  assert.equal(agySteps({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'ask_question', args: {} }] }), undefined);
});

test('a checklist shows once per turn, updated in place, and a new turn starts a new one', async () => {
  const { mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSession } = await import('./sessions');
  const tmp = await mkdtemp(join(tmpdir(), 'komorebi-agy-steps-'));
  try {
    const id = '00000011-0011-4011-8011-000000000011';
    const root = join(tmp, 'antigravity-cli/brain');
    const logDir = join(root, id, '.system_generated/logs');
    await mkdir(logDir, { recursive: true });
    const file = join(logDir, 'transcript_full.jsonl');
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const plan = (step: number, minutesAgo: number, steps: object[], content = '') => ({ step_index: step, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: at(minutesAgo), content, tool_calls: [{ name: 'update_steps', args: { steps: JSON.stringify(steps) } }] });
    const rows = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: at(20), content: '<USER_REQUEST>\nAdd a limiter.\n</USER_REQUEST>' },
      plan(1, 19, [{ title: 'A', status: 'in_progress' }, { title: 'B', status: 'pending' }], 'I will start.'),
      plan(5, 15, [{ title: 'A', status: 'done' }, { title: 'B', status: 'in_progress' }]),
      { step_index: 9, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: at(10), content: '<USER_REQUEST>\nNow C.\n</USER_REQUEST>' },
      plan(11, 8, [{ title: 'C', status: 'pending' }]),
    ];
    await writeFile(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const session = await readSession('AGY', file, root, tmp);
    const cards = session!.logs.filter(entry => entry.steps);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].id, `${id}-s1`);
    assert.deepEqual(cards[0].steps, [{ title: 'A', status: 'done' }, { title: 'B', status: 'in_progress' }]);
    assert.equal(cards[0].text, '進度 1/2');
    assert.deepEqual(cards[1].steps, [{ title: 'C', status: 'pending' }]);
    const order = session!.logs.map(entry => entry.steps ? 'steps' : entry.sender);
    assert.deepEqual(order, ['user', 'agent', 'steps', 'user', 'steps']);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
