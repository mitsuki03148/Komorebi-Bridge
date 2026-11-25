import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerEvent } from '../src/types/bridge';
import type { TerminalRoom } from '../src/types/guild';
import { Rooms, singleRoomNote } from './rooms';

const idle = ['', '', '› Ask Codex to do anything', '', '  GPT-6.1-Sol low · ~/proj'];
const terminal = () => ({ modes: { bracketedPasteMode: true }, buffer: { active: { viewportY: 0, getLine: (n: number) => ({ length: 0, translateToString: () => idle[n] ?? '' }) } } });
const baseRoom = (id: string) => ({
  id, modelId: 'CODEX', roomName: id, repoPath: '/tmp', gitBranch: '—', effortLevel: null, contextUsagePct: null, progressPercent: null,
  syncSource: '', syncedStateFile: '', currentActionSummary: '', bubbleSnippet: '', screen: '', logs: [], live: true,
  remoteControl: { enabled: false, sessionUrl: '', relayCode: '', connectedDevice: '', liveAppViewers: 0, autoLaunchedFlag: '' },
  status: 'idle', selectedSubModel: '—', updatedAt: '', ready: true, steerable: false,
}) as unknown as TerminalRoom;

async function run(group: boolean, texts: string[]) {
  const rooms = new Rooms(process.cwd(), () => {});
  const room = baseRoom(group ? 'member' : 'solo');
  rooms.rooms.set(room.id, room);
  if (group) rooms.retainGroupRooms([room.id]);
  const writes: string[] = [];
  const live: any = { process: { write: (value: string) => writes.push(value) }, terminal: terminal(), queued: 0, dirty: false };
  (rooms as any).live.set(room.id, live);
  for (const text of texts) {
    await new Promise<void>((resolve, reject) => {
      void rooms.handle({ type: 'INPUT', roomId: room.id, text, requestId: 'r' }, (event: ServerEvent) => { if (event.type === 'ACTION_RESULT') event.ok ? resolve() : reject(new Error(event.message)); }).catch(reject);
    });
    room.ready = true; room.status = 'idle';
  }
  return writes.filter(value => value !== '\r');
}

test('the first prompt in a room on its own says so, once per run; commands, handoffs and group members are left alone', async () => {
  const first = await run(false, ['請檢查呢份 diff', '再睇下第二份']);
  assert.deepEqual(first, ['請檢查呢份 diff' + singleRoomNote, '再睇下第二份'], 'the note goes with the first prompt only');
  assert.match(singleRoomNote, /單人房[\s\S]*komorebi-room send[\s\S]*Founder/);
  assert.deepEqual(await run(false, ['/status', '請做嘢']), ['/status', '請做嘢' + singleRoomNote], 'a command does not use up the note');
  assert.deepEqual(await run(false, ['[交接｜來自 光] 請 review']), ['[交接｜來自 光] 請 review'], 'a message from another agent is not the Founder\'s prompt');
  assert.deepEqual(await run(true, ['請檢查呢份 diff']), ['請檢查呢份 diff'], 'a group member is not alone, and gets the group roster instead');
});
