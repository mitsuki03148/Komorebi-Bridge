import { mkdtempSync } from './test-temp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync, renameSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTriggerWatch, validateTriggerPath, type TriggerEvent } from './file-trigger-watch';

function sandbox() { const dir = mkdtempSync(join(realpathSync(tmpdir()), 'komorebi-watch-')); const workspace = join(dir, 'workspace'); mkdirSync(workspace); return { dir, workspace }; }
function eventPromise(action: (emit: (event: TriggerEvent) => void) => void): Promise<TriggerEvent> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('watch timeout')), 4000); action(event => { clearTimeout(timer); resolve(event); }); });
}

test('rejects traversal and symlinks, and detects workspace replacement', () => {
  const { dir, workspace } = sandbox();
  try {
    const file = join(workspace, 'note.md'); writeFileSync(file, 'initial');
    assert.throws(() => validateTriggerPath(workspace, workspace + '/../other', 'file'));
    symlinkSync(dir, join(workspace, 'link'));
    assert.throws(() => validateTriggerPath(workspace, join(workspace, 'link', 'file'), 'file'));
    const identity = validateTriggerPath(workspace, file, 'file');
    renameSync(workspace, workspace + '-old'); mkdirSync(workspace);
    assert.throws(() => validateTriggerPath(workspace, file, 'file', identity), /replaced/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('atomic replace and multiple writes coalesce into one modification without reading content', async () => {
  const { dir, workspace } = sandbox();
  const path = join(workspace, 'note.md'); writeFileSync(path, 'old');
  let watcher: FileTriggerWatch | undefined;
  try {
    const event = await eventPromise(emit => {
      watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent: emit, onStatus: () => {}, debounceMs: 80 });
      watcher.start();
      const replacement = join(workspace, '.save-tmp'); writeFileSync(replacement, 'new'); appendFileSync(replacement, ' chunk'); renameSync(replacement, path);
    });
    assert.equal(event.path, path); assert.equal(event.type, 'change');
    assert.deepEqual(Object.keys(event).sort(), ['observedAt', 'path', 'type']);
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('folder watches direct files only and preserves untrusted names as data', async () => {
  const { dir, workspace } = sandbox(); const folder = join(workspace, 'folder'); mkdirSync(folder);
  let watcher: FileTriggerWatch | undefined;
  try {
    const path = join(folder, 'bad\nname.md');
    const event = await eventPromise(emit => {
      watcher = new FileTriggerWatch({ workspace, target: folder, kind: 'directory', onEvent: emit, onStatus: () => {}, debounceMs: 80 }); watcher.start();
      mkdirSync(join(folder, 'nested')); writeFileSync(join(folder, 'nested', 'ignored'), 'ignored'); writeFileSync(path, 'data');
    });
    assert.equal(event.path, path); assert.equal(event.type, 'add');
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('delete then recreate is observed and close prevents later events', async () => {
  const { dir, workspace } = sandbox(); const path = join(workspace, 'note.md'); writeFileSync(path, 'before');
  const events: TriggerEvent[] = []; let onEvent: (event: TriggerEvent) => void = () => {};
  const watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent: event => { events.push(event); onEvent(event); }, onStatus: () => {}, debounceMs: 80 });
  try {
    watcher.start();
    const removed = await eventPromise(emit => { onEvent = emit; rmSync(path); });
    assert.equal(removed.type, 'delete');
    const created = await eventPromise(emit => { onEvent = emit; writeFileSync(path, 'after'); });
    assert.equal(created.type, 'add');
    watcher.close();
    writeFileSync(path, 'after close');
    assert.equal(events.length, 2);
  } finally { watcher.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('replacing workspace pauses watcher and reports a gap', async () => {
  const { dir, workspace } = sandbox(); const path = join(workspace, 'file'); writeFileSync(path, 'before');
  let watcher: FileTriggerWatch | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gap timeout')), 4000);
      watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent: () => reject(new Error('unexpected event')), onStatus: status => { if (status === 'gap') { clearTimeout(timer); resolve(); } }, debounceMs: 50 });
      watcher.start(); renameSync(workspace, workspace + '-old'); mkdirSync(workspace);
    });
    assert.throws(() => watcher!.validate(), /replaced/);
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a disconnected workspace is a gap, not a deletion, and its old identity rejects a different mounted root', async () => {
  const { dir, workspace } = sandbox(); const path = join(workspace, 'file'); writeFileSync(path, 'before');
  const events: TriggerEvent[] = []; let watcher: FileTriggerWatch | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gap timeout')), 4000);
      watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent: event => events.push(event),
        onStatus: status => { if (status === 'gap') { clearTimeout(timer); resolve(); } }, debounceMs: 80 });
      watcher.start();
      renameSync(workspace, workspace + '-offline');
    });
    assert.deepEqual(events, [], 'unmount-like loss must not report the target as deleted');
    const oldIdentity = watcher!.identity;
    watcher!.close();
    mkdirSync(workspace); writeFileSync(path, 'different root');
    assert.throws(() => validateTriggerPath(workspace, path, 'file', oldIdentity), /replaced/);
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('manual resume alone reconciles offline changes without fabricating events', async () => {
  const { dir, workspace } = sandbox(); const path = join(workspace, 'file'); writeFileSync(path, 'before');
  const events: TriggerEvent[] = []; const statuses: string[] = []; let watcher: FileTriggerWatch | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gap timeout')), 4000);
      watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent: event => events.push(event),
        onStatus: status => { statuses.push(status); if (status === 'gap') { clearTimeout(timer); resolve(); } }, debounceMs: 80 });
      watcher.start(); renameSync(workspace, workspace + '-offline');
    });
    const identity = watcher!.identity, baseline = watcher!.metadataBaseline;
    writeFileSync(join(workspace + '-offline', 'file'), 'offline edit with new size');
    renameSync(workspace + '-offline', workspace);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(statuses.at(-1), 'gap'); assert.equal(events.length, 0);
    const gaps: string[][] = [];
    watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', expectedIdentity: identity, baseline, manualResume: true,
      onGap: paths => gaps.push(paths), onEvent: event => events.push(event), onStatus: status => statuses.push(status) });
    watcher.start();
    assert.deepEqual(gaps, [[path]]); assert.deepEqual(events, []); assert.equal(statuses.at(-1), 'watching');
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('manual resume compares existence, mtime and size only and refuses symlink replacement', () => {
  const { dir, workspace } = sandbox(); const folder = join(workspace, 'nested'); mkdirSync(folder);
  const path = join(folder, 'file'); writeFileSync(path, 'same');
  const first = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent() {}, onStatus() {} });
  const identity = first.identity, baseline = first.metadataBaseline; first.close();
  try {
    const identityOnly = baseline.map(item => ({ ...item, stamp: { ...item.stamp, dev: item.stamp.dev + 1, ino: item.stamp.ino + 1, ctime: item.stamp.ctime + 1 } }));
    const gaps: string[][] = [];
    const watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', expectedIdentity: identity, baseline: identityOnly,
      manualResume: true, onGap: paths => gaps.push(paths), onEvent() {}, onStatus() {} });
    watcher.start(); watcher.close(); assert.deepEqual(gaps, []);
    renameSync(folder, folder + '-offline'); symlinkSync(folder + '-offline', folder);
    assert.throws(() => new FileTriggerWatch({ workspace, target: path, kind: 'file', expectedIdentity: identity, baseline,
      manualResume: true, onGap() {}, onEvent() {}, onStatus() {} }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed gap notice does not advance the saved baseline or begin watching', () => {
  const { dir, workspace } = sandbox(); const path = join(workspace, 'file'); writeFileSync(path, 'before');
  const first = new FileTriggerWatch({ workspace, target: path, kind: 'file', onEvent() {}, onStatus() {} });
  const identity = first.identity, baseline = first.metadataBaseline; first.close(); writeFileSync(path, 'changed offline longer');
  let saved = false; let watcher: FileTriggerWatch | undefined;
  try {
    watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', expectedIdentity: identity, baseline, manualResume: true,
      onGap() { throw Error('store failed'); }, onEvent() {}, onStatus() {}, onBaseline() { saved = true; } });
    assert.throws(() => watcher!.start()); assert.equal(saved, false); assert.deepEqual(watcher.metadataBaseline, baseline);
  } finally { watcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('baseline validation rejects paths outside a one-level selected folder and bounds entries', () => {
  const { dir, workspace } = sandbox(); const folder = join(workspace, 'folder'); mkdirSync(folder);
  const stamp = { dev: 1, ino: 1, size: 1, mtime: 1, ctime: 1 };
  try {
    assert.throws(() => new FileTriggerWatch({ workspace, target: folder, kind: 'directory', baseline: [{ path: join(workspace, 'outside'), stamp }], onEvent() {}, onStatus() {} }), /invalid baseline/);
    assert.throws(() => new FileTriggerWatch({ workspace, target: folder, kind: 'directory', maxEntries: 0, baseline: [{ path: join(folder, 'inside'), stamp }], onEvent() {}, onStatus() {} }), /invalid baseline/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('one post-registration scan catches synchronous atomic replacement and root swaps before watcher callbacks', async () => {
 const cases: Array<{ dir: string; watcher: FileTriggerWatch; event: Promise<string>; status: () => string | undefined }> = [];
 try {
  for (let i = 0; i < 30; i++) {
   const { dir, workspace } = sandbox(); const path = join(workspace, 'file'); writeFileSync(path, 'before');
   let emit: (type: string) => void = () => {}; let status: string | undefined;
   const event = new Promise<string>(resolve => { emit = resolve; });
   const watcher = new FileTriggerWatch({ workspace, target: path, kind: 'file', debounceMs: 80,
    onEvent: value => emit(value.type), onStatus: value => { status = value; } });
   watcher.start();
   if (i % 2 === 0) { const tmp = join(workspace, 'save'); writeFileSync(tmp, 'after'); renameSync(tmp, path); }
   else { renameSync(workspace, workspace + '-offline'); mkdirSync(workspace); }
   cases.push({ dir, watcher, event, status: () => status });
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  for (const [i, value] of cases.entries()) if (i % 2 !== 0) assert.equal(value.status(), 'gap', `root case ${i}`);
  const outcomes = Promise.all(cases.filter((_value, i) => i % 2 === 0).map(value => value.event));
  const timeout = new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(Error('startup event timeout')), 4000); outcomes.finally(() => clearTimeout(timer)); });
  assert.deepEqual(await Promise.race([outcomes, timeout]), Array(15).fill('change'));
 } finally { for (const value of cases) { value.watcher.close(); rmSync(value.dir, { recursive: true, force: true }); } }
});

test('a folder that holds the Bridge\'s own settings does not report them changing, but still reports other files', async () => {
  const { dir, workspace } = sandbox();
  const folder = join(workspace, 'project'); mkdirSync(folder);
  const own = join(folder, '.env.komorebi-file-triggers.json'); writeFileSync(own, '{}');
  const events: TriggerEvent[] = [];
  const watcher = new FileTriggerWatch({ workspace, target: folder, kind: 'directory', onEvent: event => events.push(event), onStatus: () => {}, debounceMs: 60,
    ignore: path => path === own || path.startsWith(`${own}.`) });
  try {
    watcher.start();
    writeFileSync(own, '{"saved":1}'); writeFileSync(`${own}.tmp`, 'x');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual(events, [], 'saving the settings is not an event');
    const other = join(folder, 'real.md'); writeFileSync(other, 'hello');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual((events as TriggerEvent[]).map(event => event.path), [other]);
  } finally { watcher.close(); rmSync(dir, { recursive: true, force: true }); }
});
