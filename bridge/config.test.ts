import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bridgeConfig, tailnetUrl } from './config';

test('public defaults use a local workspace, loopback and no private features', () => {
  const home = mkdtempSync(join(tmpdir(), 'komorebi-config-'));
  const config = bridgeConfig({}, '/test/repo', home);
  assert.equal(config.workspace, join(home, 'Komorebi'));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.ui, 'build');
  assert.equal(bridgeConfig({ KOMOREBI_UI: 'dev' }).ui, 'dev');
  assert.throws(() => bridgeConfig({ KOMOREBI_UI: 'other' }), /KOMOREBI_UI/);
  assert.equal(config.tailscale, false);
  assert.equal(config.skills, '/test/repo/skills');
  assert.equal(config.mount, undefined);
  assert.deepEqual(config.features, { rsi: false, inbox: false, board: false, fileTrigger: false, persona: false });
  mkdirSync(join(home, 'Komorebi', 'skills'), { recursive: true });
  assert.equal(bridgeConfig({}, '/test/repo', home).skills, join(home, 'Komorebi', 'skills'));
});

test('Tailscale discovery is opt-in for loopback and enabled for non-loopback', () => {
  for (const host of ['127.0.0.1', '127.0.0.2', '::1', 'localhost']) {
    assert.equal(bridgeConfig({ KOMOREBI_HOST: host }).tailscale, false);
    assert.equal(bridgeConfig({ KOMOREBI_HOST: host, KOMOREBI_TAILSCALE: '1' }).tailscale, true);
  }
  assert.equal(bridgeConfig({ KOMOREBI_HOST: '0.0.0.0' }).tailscale, true);
  assert.equal(bridgeConfig({ KOMOREBI_HOST: '::' }).tailscale, true);
});

test('loopback does not advertise an unreachable direct tailnet address', () => {
  assert.equal(tailnetUrl('127.0.0.1', 3000, '100.100.1.2', null), null);
  assert.equal(tailnetUrl('127.0.0.1', 3000, '100.100.1.2', 'fixture.ts.net'), 'https://fixture.ts.net');
  assert.equal(tailnetUrl('0.0.0.0', 3000, '100.100.1.2', null), 'http://100.100.1.2:3000');
});

test('a private launch file preserves workspace, host, mount and enabled features', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'komorebi-local-config-')), '.env.komorebi-local');
  writeFileSync(path, 'KOMOREBI_WORKSPACE=/Volumes/Example\nKOMOREBI_HOST=0.0.0.0\nKOMOREBI_MOUNT=/Volumes/Example\nKOMOREBI_PRIVATE_FEATURES=rsi,inbox,board,file-trigger,persona\n');
  const output = execFileSync('/bin/zsh', ['-c', 'set -a; source "$1"; print -r -- "$KOMOREBI_WORKSPACE|$KOMOREBI_HOST|$KOMOREBI_MOUNT|$KOMOREBI_PRIVATE_FEATURES"', '--', path], { encoding: 'utf8' }).trim();
  const [workspace, host, mount, enabled] = output.split('|');
  const config = bridgeConfig({ KOMOREBI_WORKSPACE: workspace, KOMOREBI_HOST: host, KOMOREBI_MOUNT: mount, KOMOREBI_PRIVATE_FEATURES: enabled });
  assert.equal(config.workspace, '/Volumes/Example');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.mount, '/Volumes/Example');
  assert.deepEqual(config.features, { rsi: true, inbox: true, board: true, fileTrigger: true, persona: true });
});
