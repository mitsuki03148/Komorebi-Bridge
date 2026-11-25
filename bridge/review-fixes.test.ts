import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Fresh-eye review (Review/FRESH-EYE/REVIEW.md) items confirmed against the code.

test('BUG-03: changing a room\'s permission mode reopens it with the Remote Control it had', () => {
  const rooms = source('bridge/rooms.ts');
  assert.match(rooms, /remote: connectedRemote,/, 'a run remembers whether it was opened with Remote Control');
  assert.match(rooms, /const remote = Boolean\(live\.remote\);[\s\S]*?this\.startExisting\(room, options\?\.stillWanted, remote\)/);
  assert.match(rooms, /this\.start\(room, \(\) => \{\}, \{ remote \}, stillWanted\)/);
});

test('BUG-04: a room deleted for good leaves its groups', () => {
  assert.match(source('bridge/rooms.ts'), /type: 'ROOM_REMOVED', roomId: room\.id, deleted: true/);
  assert.match(source('server.ts'), /event\.type === 'ROOM_REMOVED' && event\.deleted[\s\S]*?groups\?\.removeMember\(group\.id, roomId\)/);
  // Archiving a room takes it out of its groups too.
  assert.match(source('bridge/rooms.ts'), /saveArchive\(keys, event\.archived \? room\.id : undefined, event\.archived \? undefined : room\.id\)/);
  assert.match(source('server.ts'), /event\.type === 'ARCHIVED' && event\.archivedRoomId/);
});

test('BUG-05: a second tap on the microphone while permission is pending opens no second stream', () => {
  assert.match(source('src/components/VoiceButton.tsx'), /if \(starting\.current \|\| media\.current\) return;[\s\S]*?finally \{ starting\.current = false; \}/);
});

test('BUG-06: a Bridge refresh does not reset the boxes ticked in the new-room window', () => {
  assert.match(source('src/components/GuildModals.tsx'), /\[modelId, preset\]\)/);
});

test('BUG-01: the phone approval card can show the change being approved', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ApprovalDiff } = await import('../src/components/ApprovalDiff');
  const html = renderToStaticMarkup(createElement(ApprovalDiff, { lines: [
    { type: 'del', lineNum: '3', content: 'old line' }, { type: 'add', lineNum: '3', content: 'new line' },
  ] }));
  assert.match(html, /查看變更（2 行）/);
  assert.match(html, /old line[\s\S]*new line/);
  assert.equal(renderToStaticMarkup(createElement(ApprovalDiff, { lines: [] })), '', 'no change, no fold');
  assert.match(source('src/App.tsx'), /<ApprovalDiff lines=\{selectedRoom\.pendingApproval\.diffLines\} \/>/);
});

test('BUG-01: the desktop diff window closes once the approval is gone', () => {
  assert.match(source('src/components/RightRoomWorkspace.tsx'), /if \(!hasApproval\) setActivePopup\('none'\)/);
});

test('SEC-03: a hook path with a space or quote is quoted for the shell, and a plain one is left alone', async () => {
  const { cliLaunch } = await import('./rooms');
  const room = { id: 'r', modelId: 'CLAUDE', repoPath: '/repo', roomName: 'x', logs: [] } as never;
  const command = (hook: string) => JSON.parse(cliLaunch(room, false, false, true, { hook })[1][cliLaunch(room, false, false, true, { hook })[1].indexOf('--settings') + 1]).hooks.PostToolUse[0].hooks[0].command;
  assert.equal(command('/repo/scripts/bench-hook'), '/repo/scripts/bench-hook claude');
  assert.equal(command('/My Repo/scripts/bench-hook'), "'/My Repo/scripts/bench-hook' claude");
  assert.equal(command("/it's/bench-hook"), "'/it'\\''s/bench-hook' claude");
});

test('SEC-02: the workbench hook route turns away a browser, which always sends an Origin', () => {
  assert.match(source('server.ts'), /if \(req\.headers\.origin \|\| req\.headers\['sec-fetch-site'\]\) \{ res\.status\(403\)/);
});

test('SEC-01: the dev server does not serve the usage file, scripts or handoff notes', () => {
  const deny = source('server.ts').match(/deny: \[(.*)\]/)?.[1] ?? '';
  for (const pattern of ['.komorebi*', 'scripts/**', 'HANDOFF*']) assert.ok(deny.includes(pattern), pattern);
});

test('BUG-01: the group approval card shows the change being approved too', () => {
  assert.match(source('src/components/GroupChat.tsx'), /<ApprovalDiff lines=\{room\.pendingApproval\.diffLines\} \/>/);
});

test('AGY working screen: input box stays open for steering, and "Working..." counts as working', async () => {
  const { isComposer, hasWorkingIndicator } = await import('./terminal');
  const working = '  some output\n⣯  Working...\n└ Tip: Use /help to see all commands.\n' + '─'.repeat(100) + '\n>\n' + '─'.repeat(100) + '\nesc to cancel                      Gemini 4 Argon · medium';
  assert.equal(isComposer('AGY', working), true);
  assert.equal(hasWorkingIndicator(working), true);
  // A real menu still is not a composer.
  assert.equal(isComposer('AGY', 'Run this command?\n> 1. Yes, run command\n  2. No, cancel\n\n↑/↓ Navigate · tab Amend\nesc to cancel'), false);
  // Other CLIs keep treating "esc to cancel" under the prompt as a menu.
  assert.equal(isComposer('CODEX', '› \nPress enter to confirm or esc to cancel'), false);
});

test('a sent message that the CLI stamps to the second keeps its place above the answer from that second', async () => {
  const { inTimeOrder } = await import('./sessions');
  const at = (createdAt: string, sender: 'user' | 'agent', id: string) => ({ id, timestamp: '', createdAt, sender, text: id });
  // Komorebi stamps 01:11:14.800 on send; the CLI stamps the same message and its answer 01:11:14Z.
  const before = inTimeOrder([at('2026-11-14T01:11:14.800Z', 'user', 'me'), at('2026-11-14T01:11:14Z', 'agent', 'reply')]);
  assert.deepEqual(before.map(entry => entry.id), ['reply', 'me']);
  // The message takes the CLI's own time once matched, so the tie keeps the order it was written in.
  assert.match(source('bridge/rooms.ts'), /local\.createdAt = entry\.createdAt/);
  const after = inTimeOrder([at('2026-11-14T01:11:14Z', 'user', 'me'), at('2026-11-14T01:11:14Z', 'agent', 'reply')]);
  assert.deepEqual(after.map(entry => entry.id), ['me', 'reply']);
});
