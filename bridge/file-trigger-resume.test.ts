import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { testAnchor } from './file-trigger-test-anchor';
import { FileTriggerStore } from './file-trigger-store';
import { FileTriggerWatch, validateTriggerPath } from './file-trigger-watch';
import { deliverFileNotice, type FileNoticeDeps } from './file-trigger-delivery';
import { resumeOfflineTrigger } from './file-trigger-resume';
import type { GroupChat, TerminalRoom } from '../src/types/guild';

function fixture() {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'komorebi-offline-'));
 const root = join(dir, 'workspace'); mkdirSync(root); const folder = join(root, 'folder'); mkdirSync(folder);
 const path = join(folder, 'note'); writeFileSync(path, 'old'); const identity = validateTriggerPath(root, path, 'file');
 const storage = join(dir, 'signed'); const key = Buffer.alloc(32, 23);
 const store = new FileTriggerStore(storage, key, undefined, testAnchor(storage));
 const item = store.add('g', path, 'file', identity); store.setEnabled('g', item.id, true);
 let initial = new FileTriggerWatch({ workspace: root, target: path, kind: 'file', onEvent() {}, onStatus() {} });
 store.setWatchBaseline('g', item.id, initial.metadataBaseline); initial.close();
 return { dir, root, folder, path, identity, storage, key, store, item };
}

test('offline stays signed across restart; confirmation is one-time, and later change sends a gap to the crown', async () => {
 const f = fixture();
 const room = { id:'lead',modelId:'CODEX',sessionId:'00000023-0023-4023-8023-000000000023',repoPath:f.root,live:true,ready:true,status:'idle',autoMode:true,resumable:true } as TerminalRoom;
 const group: GroupChat = { id:'g',name:'test',createdAt:'',orchestratorRoomId:room.id,members:[{roomId:room.id,modelId:room.modelId}] };
 f.store.enqueue('g', { watchId:f.item.id,path:f.path,kind:'change',observedAt:new Date().toISOString() });
 renameSync(f.folder, `${f.folder}-offline`); f.store.setOffline('g', f.item.id, true);
 const store = new FileTriggerStore(f.storage, f.key, undefined, testAnchor(f.storage));
 assert.equal(store.settings('g')[0].enabled, true); assert.equal(store.settings('g')[0].offline, true);
 let watcher: FileTriggerWatch | undefined; let delivered = 0; let message = '';
 const deps: FileNoticeDeps = {
  store, verifyIntegrity: () => store.readable, groups: () => [group], rooms: () => [room],
  state: () => ({ inactive:false, verifiedSession:true, auto:true, working:false }),
  validatePaths: () => !!watcher && !store.settings('g')[0].offline,
  ptyGuard: () => () => true, notice() {},
  handle: async (event, reply, guards) => { if (event.type !== 'INPUT') return; assert.equal(guards.authorizeBenchInput?.('paste'), true); delivered++; message=event.text; reply({type:'ACTION_RESULT',requestId:event.requestId!,ok:true,message:''}); },
 };
 // A stored pending notice cannot start the room while the watch is offline.
 assert.equal(await deliverFileNotice(deps, 'g'), 'held'); assert.equal(delivered, 0);
 renameSync(`${f.folder}-offline`, f.folder); writeFileSync(f.path, 'private content changed while offline');
 assert.equal(store.settings('g')[0].offline, true); assert.equal(await deliverFileNotice(deps, 'g'), 'held'); assert.equal(delivered, 0);
 let token: string | undefined = 'once';
 const attempt = () => resumeOfflineTrigger({ token:'once', expectedToken:token, isOffline:() => !!store.settings('g')[0].offline,
  validate:() => { validateTriggerPath(f.root, f.path, 'file', f.identity); }, consume:() => { token=undefined; },
  refreshAfterFailure:() => { token='new-token'; },
  start:() => {
   watcher = new FileTriggerWatch({ workspace:f.root,target:f.path,kind:'file',expectedIdentity:f.identity,baseline:store.getWatchBaseline('g',f.item.id),manualResume:true,
    onEvent(){ throw Error('offline changes must not become live events'); }, onGap:paths => { if(paths.length) store.enqueue('g',{watchId:f.item.id,path:f.path,kind:'gap',observedAt:new Date().toISOString()}); },
    onBaseline:baseline => store.setWatchBaseline('g',f.item.id,baseline), onStatus() {} });
   watcher.start(); store.setOffline('g', f.item.id, false); return true;
  },
 });
 try {
  assert.equal(attempt(), 'accepted'); assert.equal(attempt(), 'stale');
  assert.equal(store.settings('g')[0].offline, undefined);
  assert.equal(await deliverFileNotice(deps, 'g'), 'submitted'); assert.equal(delivered, 1);
  assert.match(message, /觀察有缺口，檔案可能已更新/); assert.doesNotMatch(message, /private content/);
 } finally { watcher?.close(); }
});

test('a symlink substituted while offline is rejected before token consumption and stays offline', () => {
 const f=fixture(); f.store.setOffline('g', f.item.id, true); renameSync(f.folder, `${f.folder}-offline`); symlinkSync(`${f.folder}-offline`, f.folder);
 let started=0, token: string | undefined='first';
 const result=resumeOfflineTrigger({token:'first', expectedToken:token, isOffline:()=>!!f.store.settings('g')[0].offline,
  validate:()=>{validateTriggerPath(f.root,f.path,'file',f.identity);}, consume:()=>{token=undefined;},start:()=>{started++;return true;},refreshAfterFailure:()=>{token='retry';}});
 assert.equal(result,'invalid'); assert.equal(token,'retry'); assert.equal(started,0); assert.equal(f.store.settings('g')[0].offline,true);
});

test('manual confirmation may rebind a recreated in-workspace folder, but never a replaced workspace root', () => {
 const f=fixture(); f.store.setOffline('g',f.item.id,true); renameSync(f.folder,`${f.folder}-old`); mkdirSync(f.folder); writeFileSync(f.path,'replacement');
 const replacement=validateTriggerPath(f.root,f.path,'file');
 assert.notEqual(replacement.parentInode,f.identity.parentInode);
 f.store.rebindOffline('g',f.item.id,replacement);
 assert.equal(f.store.settings('g')[0].offline,true);
 assert.equal(f.store.settings('g')[0].identity.parentInode,replacement.parentInode);
 renameSync(f.root,`${f.root}-old`); mkdirSync(f.root); mkdirSync(f.folder); writeFileSync(f.path,'other');
 const other=validateTriggerPath(f.root,f.path,'file');
 assert.throws(()=>f.store.rebindOffline('g',f.item.id,other),/identity changed/);
 // A rejected mutation fails closed; original signed bytes are not overwritten.
 const restored=new FileTriggerStore(f.storage,f.key,undefined,testAnchor(f.storage));
 assert.equal(restored.settings('g')[0].offline,true);
 assert.equal(restored.settings('g')[0].identity.rootInode,f.identity.rootInode);
});
