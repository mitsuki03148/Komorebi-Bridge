import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BridgeRestartController, isRestartSupported, restartJobState, type RestartOptions } from './bridge-restart';

function fixture(overrides: Partial<RestartOptions> = {}) {
  let time = 100_000;
  const commands: string[][] = [];
  const notifications: string[] = [];
  const options: RestartOptions = {
    platform: 'darwin', serviceName: 'com.komorebi.bridge', scriptPath: '/repo/scripts/komorebi-restart.sh',
    now: () => time, log: scope => notifications.push(`log:${scope}`), notify: () => notifications.push('notice'),
    runLaunchctl: async args => { commands.push(args); }, jobState: async () => 'unknown', ...overrides,
  };
  return { options, commands, notifications, setTime: (value: number) => { time = value; } };
}

test('restart is disabled without the exact launchd environment', async () => {
  const f = fixture({ serviceName: undefined });
  const controller = new BridgeRestartController(f.options);
  assert.equal(controller.supported, false);
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'unsupported' });
  assert.deepEqual(f.commands, []);
  assert.equal(isRestartSupported('linux', 'com.komorebi.bridge'), false);
  assert.equal(isRestartSupported('darwin', 'wrong-service'), false);
});

test('restart removes the prior job then submits only the fixed script and rejects concurrent requests', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const commands: string[][] = [];
  const f = fixture({ runLaunchctl: async args => { commands.push(args); if (args[0] === 'submit') await gate; } });
  const controller = new BridgeRestartController(f.options);
  const pending = controller.requestRestart('tailnet');
  assert.deepEqual(await controller.requestRestart('serve'), { ok: false, code: 'busy' });
  release(); assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'busy' });
  assert.deepEqual(commands, [
    ['remove', 'com.komorebi.bridge-restart'],
    ['submit', '-l', 'com.komorebi.bridge-restart', '--', '/bin/zsh', '/repo/scripts/komorebi-restart.sh'],
  ]);
  assert.deepEqual(f.notifications, ['log:tailnet', 'notice']);
});

test('a failed submission releases busy but remains rate limited for 60 seconds', async () => {
  let fail = true;
  const f = fixture({ runLaunchctl: async args => { if (args[0] === 'submit' && fail) throw Error('unavailable'); } });
  const controller = new BridgeRestartController(f.options);
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'failed' });
  f.setTime(159_999);
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'cooldown' });
  f.setTime(160_000); fail = false;
  assert.deepEqual(await controller.requestRestart('local'), { ok: true });
});

test('an absent previous job does not block submitting the new job', async () => {
  const commands: string[][] = [];
  const f = fixture({ runLaunchctl: async args => { commands.push(args); if (args[0] === 'remove') throw Error('absent'); } });
  assert.deepEqual(await new BridgeRestartController(f.options).requestRestart('serve'), { ok: true });
  assert.deepEqual(commands.map(args => args[0]), ['remove', 'submit']);
});

test('server requires authentication before event and ignores all extra client fields', () => {
  const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const auth = source.indexOf('if (!authenticated) {');
  const command = source.indexOf("if (event?.type === 'BRIDGE_RESTART') {");
  assert.ok(auth !== -1 && command > auth);
  const handler = source.slice(command, source.indexOf("if (event?.type === 'TRANSCRIBE')", command));
  assert.match(handler, /restartController\.requestRestart\(scope/);
  assert.doesNotMatch(handler, /event\.(?:path|command|args|payload|script)/);
  assert.match(source, /scriptPath: join\(project, 'scripts', 'komorebi-restart\.sh'\)/);
});


test('submitted job can be retried after 90 seconds only when confirmed absent', async () => {
  let state: 'present' | 'absent' | 'unknown' = 'present';
  let checks = 0;
  const f = fixture({ jobState: async () => { checks++; return state; } });
  const controller = new BridgeRestartController(f.options);
  assert.deepEqual(await controller.requestRestart('local'), { ok: true });
  f.setTime(189_999);
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'busy' });
  assert.equal(checks, 0);
  f.setTime(190_000);
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'busy' });
  state = 'unknown';
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'busy' });
  state = 'absent';
  assert.deepEqual(await controller.requestRestart('local'), { ok: true });
  assert.equal(checks, 3);
  assert.equal(f.commands.filter(args => args[0] === 'submit').length, 2);
});

test('failed job checks and overlapping checks remain busy', async () => {
  let release!: (state: 'absent') => void;
  const gate = new Promise<'absent'>(resolve => { release = resolve; });
  const f = fixture({ jobState: async () => gate });
  const controller = new BridgeRestartController(f.options);
  assert.deepEqual(await controller.requestRestart('local'), { ok: true });
  f.setTime(190_000);
  const checking = controller.requestRestart('local');
  assert.deepEqual(await controller.requestRestart('local'), { ok: false, code: 'busy' });
  release('absent');
  assert.deepEqual(await checking, { ok: true });
  const failure = fixture({ jobState: async () => { throw Error('launchctl unavailable'); } });
  const other = new BridgeRestartController(failure.options);
  await other.requestRestart('local'); failure.setTime(190_000);
  assert.deepEqual(await other.requestRestart('local'), { ok: false, code: 'busy' });
});

test('job list parsing only accepts a complete table and exact label', () => {
  const header = 'PID\tStatus\tLabel\n';
  assert.equal(restartJobState(`${header}-\t0\tcom.komorebi.bridge-restart\n`), 'present');
  assert.equal(restartJobState(`${header}123\t0\tcom.komorebi.bridge-restart-other\n`), 'absent');
  assert.equal(restartJobState(header), 'absent');
  assert.equal(restartJobState('permission denied'), 'unknown');
  assert.equal(restartJobState(`${header}bad output\n`), 'unknown');
  assert.equal(restartJobState(`${header}-\t0\tcom.komorebi.bridge-restart\ncorrupt\n`), 'unknown');
});
