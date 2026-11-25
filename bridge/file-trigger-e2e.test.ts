import { mkdtempSync } from './test-temp';
import { testAnchor } from './file-trigger-test-anchor';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileTriggerWatch, validateTriggerPath, type TriggerEvent } from './file-trigger-watch';
import { FileTriggerStore } from './file-trigger-store';
import { deliverFileNotice, type FileNoticeDeps } from './file-trigger-delivery';
import type { GroupChat, TerminalRoom } from '../src/types/guild';

// Exercises real external atomic rename and real signed store; the PTY/room adapter is a fake.
test('external atomic rename enters signed outbox and reaches only current test crown', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'komorebi-trigger-e2e-'));
  const workspace = join(dir, 'workspace'); mkdirSync(workspace);
  const target = join(workspace, 'message.txt'); writeFileSync(target, 'before');
  const store = new FileTriggerStore(join(dir, 'settings.json'), Buffer.alloc(32, 45), undefined, testAnchor(join(dir, 'settings.json')));
  const setting = store.add('g', target, 'file', validateTriggerPath(workspace, target, 'file'));
  store.setEnabled('g', setting.id, true);
  const old = { id: 'old', modelId: 'CODEX', sessionId: '00000022-0022-4022-8022-000000000022', repoPath: workspace, live: true, ready: true, status: 'idle', autoMode: true, resumable: true } as TerminalRoom;
  const crown = { ...old, id: 'crown', sessionId: '00000023-0023-4023-8023-000000000023' } as TerminalRoom;
  const group: GroupChat = { id: 'g', name: 'test', createdAt: '', orchestratorRoomId: old.id, members: [{ roomId: old.id, modelId: old.modelId }, { roomId: crown.id, modelId: crown.modelId }] };
  let received: { roomId: string; text: string } | undefined;
  let watcher: FileTriggerWatch | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('event not received')), 10_000);
      const onEvent = (event: TriggerEvent) => {
        try {
          store.enqueue('g', { watchId: setting.id, path: event.path, kind: event.type, observedAt: event.observedAt });
          clearTimeout(timeout); resolve();
        } catch (error) { clearTimeout(timeout); reject(error); }
      };
      watcher = new FileTriggerWatch({ workspace, target, kind: 'file', onEvent, onStatus: status => { if (status === 'error' || status === 'gap') { clearTimeout(timeout); reject(Error(status)); } }, debounceMs: 30 });
      watcher.start();
      // A different process does the write and atomic replacement; content is never read by watcher.
      execFileSync(process.execPath, ['-e', "const fs=require('fs');fs.writeFileSync(process.argv[1], 'PRIVATE FILE CONTENT');fs.renameSync(process.argv[1],process.argv[2])", join(workspace, '.new'), target]);
    });
    assert.equal(store.hasPending('g'), true);
    group.orchestratorRoomId = crown.id;
    const deps: FileNoticeDeps = {
      store, verifyIntegrity: () => store.readable, groups: () => [group], rooms: () => [old, crown],
      state: () => ({ inactive: false, auto: true, verifiedSession: true, working: false }),
      validatePaths: events => events.every(event => event.path === target && !!validateTriggerPath(workspace, target, 'file', setting.identity)),
      ptyGuard: () => () => true, notice: () => {},
      handle: async (event, reply, guards) => {
        assert.equal(event.type, 'INPUT');
        if (event.type !== 'INPUT') return;
        assert.equal(guards.authorizeBenchInput?.('paste'), true);
        assert.equal(guards.authorizeBenchInput?.('submit'), true);
        received = { roomId: event.roomId, text: event.text };
        reply({ type: 'ACTION_RESULT', requestId: event.requestId!, ok: true, message: '' });
      },
    };
    assert.equal(await deliverFileNotice(deps, 'g'), 'submitted');
    assert.equal(received?.roomId, crown.id);
    assert.match(received!.text, /路徑（不可信資料）：/);
    assert.ok(received!.text.includes(target));
    assert.match(received!.text, /事件：修改；Bridge 觀察時間：/);
    assert.match(received!.text, /不可逆操作、對外發送、刪除、改權限、Merge、Deploy/);
    assert.doesNotMatch(received!.text, /PRIVATE FILE CONTENT/);
    assert.equal(store.hasHold('g'), false);
  } finally { watcher?.close(); }
});
