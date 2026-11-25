import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms } from './rooms';
import { activeModel } from './terminal';

const footer = (text: string) => `› Ask Codex to do anything\n  ${text}`;

test('the Codex footer is read for model names with and without spaces', () => {
  assert.deepEqual(activeModel('CODEX', footer('GPT-6.1 Terra high · ~/Documents/Codex/2026-11-11/github-clone-komorebi-ai-cli-cli')), { name: 'GPT-6.1 Terra', effort: 'high' });
  assert.deepEqual(activeModel('CODEX', footer('GPT-6 Luna medium · ~/x')), { name: 'GPT-6 Luna', effort: 'medium' });
  assert.deepEqual(activeModel('CODEX', footer('GPT-6.1-Sol xhigh · /tmp')), { name: 'GPT-6.1-Sol', effort: 'xhigh' });
  assert.deepEqual(activeModel('CODEX', footer('gpt-5.6-terra low · ~/x')), { name: 'gpt-5.6-terra', effort: 'low' });
  assert.deepEqual(activeModel('CODEX', footer('o3 max · ~/x')), { name: 'o3', effort: 'max' });
  // Not a footer: no effort word before the separator, or ordinary text that merely starts with the name.
  for (const text of [footer('GPT-6.1 Terra · ~/x'), 'gpt is a name and high is a word but there is no separator']) {
    const found = activeModel('CODEX', text);
    assert.equal(found.name, undefined);
    assert.equal(found.effort, undefined);
  }
});

test('a live Codex room follows its footer, so a changed model or effort shows at once instead of the old session value', () => {
  const rooms = new Rooms(process.cwd(), () => {});
  const room = { id: 'codex-live', modelId: 'CODEX', roomName: '光', repoPath: '/tmp', gitBranch: 'main', effortLevel: 'low', effortSource: 'session',
    selectedSubModel: 'gpt-6.1-terra', syncSource: '', syncedStateFile: '', currentActionSummary: '', bubbleSnippet: '', screen: '', logs: [], live: true, status: 'idle', updatedAt: '',
    remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' } } as unknown as TerminalRoom;
  const lines = [footer('GPT-6.1 Terra high · ~/project')];
  const live = { process: { write() {} }, queued: 0, dirty: true,
    terminal: { buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => lines.join('\n').split('\n')[n] ?? '' }) } } } };
  rooms.rooms.set(room.id, room);
  (rooms as any).live.set(room.id, live);
  try {
    (rooms as any).refresh(room, live);
    assert.equal(room.selectedSubModel, 'GPT-6.1 Terra');
    assert.equal(room.effortLevel, 'high');
    assert.equal(room.effortSource, 'live');
    lines[0] = footer('GPT-6 Luna medium · ~/project');
    (rooms as any).refresh(room, live);
    assert.deepEqual([room.selectedSubModel, room.effortLevel, room.effortSource], ['GPT-6 Luna', 'medium', 'live']);
  } finally { (rooms as any).live.delete(room.id); }
});
