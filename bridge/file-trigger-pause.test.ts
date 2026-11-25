import { mkdtempSync } from './test-temp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileTriggerDialog } from '../src/components/FileTriggerDialog';
import { FileTriggerStore } from './file-trigger-store';
import { testAnchor } from './file-trigger-test-anchor';
import { FileTriggerWatch, validateTriggerPath } from './file-trigger-watch';

const key = Buffer.alloc(32, 61);
function fixture() {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'komorebi-pause-'));
 const workspace = join(dir, 'workspace'); mkdirSync(workspace);
 const path = join(workspace, 'file'); writeFileSync(path, 'initial');
 const config = join(dir, 'config'); const identity = validateTriggerPath(workspace, path, 'file');
 const store = new FileTriggerStore(config, key, undefined, testAnchor(config));
 const watch = store.add('g', path, 'file', identity); store.setEnabled('g', watch.id, true);
 const event = {watchId:watch.id,path,kind:'change' as const,observedAt:new Date().toISOString()};
 return {dir,workspace,path,config,identity,store,watch,event};
}
const target = (workspace: string) => ({roomId:'room',sessionId:'session',repoPath:workspace});

test('disable atomically drops pending, retains uncertain history, and re-enable never revives a reservation', () => {
 const f = fixture(); f.store.enqueue('g',f.event); const reserved=f.store.reserve('g',target(f.workspace))!;
 assert.ok(f.store.isCurrent(reserved));
 // A distinct event for the same watch remains pending while the first is in flight.
 f.store.enqueue('g',{...f.event,path:f.path+'-other'});
 f.store.setEnabled('g',f.watch.id,false);
 assert.equal(f.store.hasPending('g'),false); assert.equal(f.store.isCurrent(reserved),false);
 f.store.setEnabled('g',f.watch.id,true); assert.equal(f.store.isCurrent(reserved),false); assert.equal(f.store.hasPending('g'),false);
 f.store.enqueue('g',f.event);
 const later = new FileTriggerStore(f.config,key,()=>Date.now()+61_000,testAnchor(f.config));
 const r=later.reserve('g',target(f.workspace))!; assert.ok(r); later.finish(r.id,'uncertain');
 later.setEnabled('g',f.watch.id,false); later.setEnabled('g',f.watch.id,true);
 assert.equal(later.hasPending('g'),false); assert.equal(later.isCurrent(r),false);
 // Uncertain history survives, but has no pending delivery.
 const reloaded=new FileTriggerStore(f.config,key,undefined,testAnchor(f.config));
 assert.equal(reloaded.hasPending('g'),false);
 const payload=JSON.parse(JSON.parse(readFileSync(f.config,'utf8')).payload);
 assert.equal(payload.pending.filter((item: {state:string})=>item.state==='uncertain').length,1);
});

test('pause clears the signed baseline, so changed bytes during pause do not become a resumed event', () => {
 const f=fixture(); let events=0;
 let watcher = new FileTriggerWatch({workspace:f.workspace,target:f.path,kind:'file',expectedIdentity:f.identity,
  onEvent:()=>{events++;},onStatus:()=>{},onBaseline:baseline=>f.store.setWatchBaseline('g',f.watch.id,baseline)});
 watcher.start(); assert.equal(f.store.getWatchBaseline('g',f.watch.id)?.length,1);
 f.store.setEnabled('g',f.watch.id,false); watcher.close();
 writeFileSync(f.path,'changed while paused');
 f.store.setEnabled('g',f.watch.id,true); assert.equal(f.store.getWatchBaseline('g',f.watch.id),undefined);
 watcher=new FileTriggerWatch({workspace:f.workspace,target:f.path,kind:'file',expectedIdentity:f.identity,
  baseline:f.store.getWatchBaseline('g',f.watch.id), onEvent:()=>{events++;}, onStatus:()=>{},
  onBaseline:baseline=>f.store.setWatchBaseline('g',f.watch.id,baseline)});
 watcher.start(); watcher.close(); assert.equal(events,0); assert.equal(f.store.hasPending('g'),false);
});

test('remove and pause discard pending work and invalidate in-flight reservations', () => {
 for (const action of ['pause','remove'] as const) {
  const f=fixture(); f.store.enqueue('g',f.event); const reservation=f.store.reserve('g',target(f.workspace))!;
  if (action==='pause') f.store.setEnabled('g',f.watch.id,false); else f.store.remove('g',f.watch.id);
  assert.equal(f.store.hasPending('g'),false); assert.equal(f.store.isCurrent(reservation),false);
 }
});

test('SIGKILL after signed pause file is replaced does not revive old work after restart', () => {
 const f=fixture(); f.store.enqueue('g',f.event);
 const storeUrl=new URL('./file-trigger-store.ts',import.meta.url).href;
 const anchorUrl=new URL('./file-trigger-test-anchor.ts',import.meta.url).href;
 const code=`import {FileTriggerStore} from ${JSON.stringify(storeUrl)};import {testAnchor} from ${JSON.stringify(anchorUrl)};const [path,id]=process.argv.slice(1);const base=testAnchor(path);let n=0;const anchor={read:()=>base.read(),write:s=>{if(++n===2)process.kill(process.pid,'SIGKILL');base.write(s)}};new FileTriggerStore(path,Buffer.alloc(32,61),undefined,anchor).setEnabled('g',id,false);`;
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code,f.config,f.watch.id]);
 assert.equal(child.signal,'SIGKILL');
 const reopened=new FileTriggerStore(f.config,key,undefined,testAnchor(f.config));
 assert.equal(reopened.readable,true); assert.equal(reopened.settings('g')[0].enabled,false); assert.equal(reopened.hasPending('g'),false);
 reopened.setEnabled('g',f.watch.id,true); assert.equal(reopened.hasPending('g'),false);
});


test('SIGKILL after pending anchor but before rename rolls back pause and preserves the visible enabled state', () => {
 const f=fixture(); f.store.enqueue('g',f.event);
 const original=readFileSync(f.config,'utf8');
 const storeUrl=new URL('./file-trigger-store.ts',import.meta.url).href;
 const anchorUrl=new URL('./file-trigger-test-anchor.ts',import.meta.url).href;
 const code=`import {FileTriggerStore} from ${JSON.stringify(storeUrl)};import {testAnchor} from ${JSON.stringify(anchorUrl)};const [path,id]=process.argv.slice(1);const base=testAnchor(path);const anchor={read:()=>base.read(),write:s=>{base.write(s);process.kill(process.pid,'SIGKILL')}};new FileTriggerStore(path,Buffer.alloc(32,61),undefined,anchor).setEnabled('g',id,false);`;
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code,f.config,f.watch.id]);
 assert.equal(child.signal,'SIGKILL');
 // No rename took place: the signed settings file is byte-for-byte the pre-pause file.
 assert.equal(readFileSync(f.config,'utf8'),original);
 const raw=JSON.parse(JSON.parse(original).payload);
 assert.equal(raw.settings.find((setting: {id:string})=>setting.id===f.watch.id).enabled,true);
 assert.equal(raw.pending.filter((entry: {event:{watchId:string},state:string})=>entry.event.watchId===f.watch.id && entry.state==='pending').length,1);
 const reopened=new FileTriggerStore(f.config,key,undefined,testAnchor(f.config));
 assert.equal(reopened.readable,true);
 const item=reopened.settings('g')[0];
 assert.equal(item.enabled,true); assert.equal(reopened.hasPending('g'),true);
 assert.deepEqual(reopened.pendingEvents('g'),[f.event]);
 assert.equal(readFileSync(f.config,'utf8'),original);
 // Render the actual dialog against reopened data; this is not a running server or device test.
 const html=renderToStaticMarkup(createElement(FileTriggerDialog,{
  name:'test', root:f.workspace, integrity:{integrity:'ok'}, confirmationHint:'',
  items:[{id:item.id,path:item.path,kind:item.kind,enabled:item.enabled,status:'monitoring'}],
  onBrowse(){},onAdd(){},onEnable(){},onRemove(){},onClose(){},onSaveHint(){},onConfirmStale(){},onReset(){},onResumeOffline(){}
 }));
 assert.match(html,/>暫停<\/button>/);
 assert.doesNotMatch(html,/>啟用<\/button>/);
});
