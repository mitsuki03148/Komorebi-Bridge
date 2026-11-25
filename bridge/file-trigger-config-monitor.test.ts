import { mkdtempSync } from './test-temp';
import { testAnchor } from './file-trigger-test-anchor';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTriggerStore } from './file-trigger-store';
import { watchTriggerConfig } from './file-trigger-config-monitor';
import { validateTriggerPath } from './file-trigger-watch';

function fixture() {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), 'komorebi-trigger-config-'));
 const target = join(dir, 'target'); writeFileSync(target, 'data');
 const config = join(dir, 'config.json');
 const store = new FileTriggerStore(config, Buffer.alloc(32, 22), undefined, testAnchor(config));
 store.add('g', target, 'file', validateTriggerPath(dir, target, 'file'));
 return {dir,target,config,store};
}

 test('runtime signed config tampering signals watches to stop without overwriting bytes', async () => {
 const {dir,target,config,store} = fixture();
 let watcher: ReturnType<typeof watchTriggerConfig> | undefined;
 const replacement = join(dir, 'replacement');
 const actual = '{"version":1,"payload":"bad","mac":"00"}';
 const initial = readFileSync(config);
 try {
  await new Promise<void>((resolve, reject) => {
   const timer = setTimeout(() => reject(Error('config monitor timeout')), 10000);
   let observed = false;
   watcher = watchTriggerConfig(config, () => store.readable, () => { clearTimeout(timer); resolve(); }, () => {
    if (observed) return;
    observed = true;
    // The harmless write has reached this exact monitor. Now test tampering.
    writeFileSync(replacement, actual); renameSync(replacement, config);
   });
   // An unchanged valid file is a harmless event used solely to establish readiness.
   setImmediate(() => writeFileSync(config, initial));
  });
  assert.equal(store.readable, false);
  assert.throws(() => store.add('g', target, 'file', validateTriggerPath(dir, target, 'file')));
  assert.equal(readFileSync(config, 'utf8'), actual);
 } finally { watcher?.close(); }
});

test('post-registration verification catches immediate invalid replacement', async () => {
 const {dir,config,store} = fixture();
 let watcher: ReturnType<typeof watchTriggerConfig> | undefined;
 try {
  await new Promise<void>((resolve, reject) => {
   const timer = setTimeout(() => reject(Error('startup verification timeout')), 10000);
   watcher = watchTriggerConfig(config, () => store.readable, () => { clearTimeout(timer); resolve(); });
   const replacement = join(dir, 'replacement'); writeFileSync(replacement, 'invalid'); renameSync(replacement, config);
  });
  assert.equal(store.readable, false);
  assert.equal(readFileSync(config, 'utf8'), 'invalid');
 } finally { watcher?.close(); }
});
