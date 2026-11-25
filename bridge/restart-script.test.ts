import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const path = 'scripts/komorebi-restart.sh';
const source = readFileSync(path, 'utf8');

test('restart handover script uses a fixed service, derives its own path, and always removes its job', () => {
  assert.ok((statSync(path).mode & 0o111) !== 0);
  assert.match(source, /root="\$\{0:A:h:h\}"/);
  assert.match(source, /label='com\.komorebi\.bridge'/);
  assert.match(source, /job='com\.komorebi\.bridge-restart'/);
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /launchctl remove "\$job"/);
  assert.match(source, /komorebi-service\.sh" restart/);
  assert.match(source, /unset KOMOREBI_SERVICE_LABEL KOMOREBI_PORT/);
  // Function-local $1 and awk's field $3 are not job arguments.
  const topLevel = source.replace(/^log_line\(\).*$/m, '').replace(/^service_pid\(\).*$/m, '');
  assert.doesNotMatch(topLevel, /\$[1-9@*]|\$\{[1-9@*]/);
  assert.doesNotMatch(source, /\/tmp\/|\/var\/folders\/|scratch/i);
});

test('restart readiness checks a new service process, listener ownership and HTTP, with bounded wait', () => {
  assert.match(source, /old_pid=\$\(service_pid\)/);
  assert.match(source, /"\$pid" != "\$old_pid"/);
  assert.match(source, /SECONDS < 60/);
  assert.match(source, /pgrep -P "\$pid"/);
  assert.match(source, /lsof -nP -a -p "\$owner" -iTCP:"\$port" -sTCP:LISTEN/);
  assert.match(source, /curl .*--fail --max-time 1/);
  assert.match(source, /com\.komorebi\.bridge\.handover\.log/);
});

test('restart script parses in zsh and bash without running', () => {
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    const result = spawnSync(shell, ['-n', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
  }
});

test('isolated mock job records readiness and removes its own job on success and restart failure', async t => {
  const { mkdirSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  for (const fail of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'komorebi-restart-mock-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const scripts = join(dir, 'scripts');
    const mock = join(dir, 'mock');
    mkdirSync(scripts); mkdirSync(mock);
    const marker = join(dir, 'service-restarted');
    const removed = join(dir, 'removed-job');
    const fixture = (name: string, body: string) => {
      const file = join(mock, name);
      writeFileSync(file, `#!/bin/zsh\n${body}\n`, { mode: 0o755 });
      return file;
    };
    const launchctl = fixture('launchctl', `if [[ "$1" == print ]]; then\n  if [[ -e "$MOCK_MARKER" ]]; then echo '  pid = 200'; else echo '  pid = 100'; fi\nelif [[ "$1" == remove ]]; then print -r -- "$2" > "$MOCK_REMOVED"\nfi`);
    const buddy = fixture('plistbuddy', 'exit 1');
    const sleep = fixture('sleep', 'exit 0');
    const pgrep = fixture('pgrep', 'exit 1');
    const lsof = fixture('lsof', 'exit 0');
    const curl = fixture('curl', 'exit 0');
    const service = `#!/bin/zsh\n${fail ? 'exit 7' : 'print ok > "$MOCK_MARKER"'}\n`;
    writeFileSync(join(scripts, 'komorebi-service.sh'), service, { mode: 0o755 });
    const copied = source.replaceAll('/bin/launchctl', launchctl).replaceAll('/usr/libexec/PlistBuddy', buddy)
      .replaceAll('/bin/sleep', sleep).replaceAll('/usr/bin/pgrep', pgrep)
      .replaceAll('/usr/sbin/lsof', lsof).replaceAll('/usr/bin/curl', curl);
    const job = join(scripts, 'komorebi-restart.sh');
    writeFileSync(job, copied, { mode: 0o755 });
    const result = spawnSync('/bin/zsh', [job], { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, HOME: dir, MOCK_MARKER: marker, MOCK_REMOVED: removed } });
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.equal(readFileSync(removed, 'utf8').trim(), 'com.komorebi.bridge-restart');
    assert.equal(existsSync(marker), !fail);
    const log = readFileSync(join(dir, 'Library/Logs/com.komorebi.bridge.handover.log'), 'utf8');
    assert.match(log, fail ? /service command failed/ : /restarted and is listening/);
  }
});
