import { mkdtempSync } from './test-temp';
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const mac = process.platform === 'darwin'
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('/bin/zsh', ['scripts/komorebi-service.sh', ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

test('service plist is valid, restarts on crash and escapes paths', { skip: !mac }, () => {
  const out = run(['print-plist'], { KOMOREBI_SERVICE_LABEL: 'com.komorebi.bridge.unit', KOMOREBI_PORT: '3123', KOMOREBI_WORKSPACE: '/tmp/a&b' })
  assert.equal(out.status, 0, out.stderr)
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-plist-'))
  try {
    const file = join(dir, 'x.plist')
    writeFileSync(file, out.stdout)
    const lint = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' })
    assert.equal(lint.status, 0, lint.stdout + lint.stderr)
    const json = JSON.parse(spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }).stdout)
    assert.equal(json.Label, 'com.komorebi.bridge.unit')
    assert.equal(json.RunAtLoad, true)
    assert.deepEqual(json.KeepAlive, { SuccessfulExit: false })
    assert.equal(json.ProgramArguments[0], '/bin/zsh')
    assert.match(json.ProgramArguments[1], /scripts\/start-bridge\.sh$/)
    assert.equal(json.EnvironmentVariables.KOMOREBI_PORT, '3123')
    assert.equal(json.EnvironmentVariables.KOMOREBI_WORKSPACE, '/tmp/a&b')
    assert.match(json.EnvironmentVariables.PATH, /\/opt\/homebrew\/bin|\/usr\/local\/bin/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service script rejects unknown commands', () => {
  const out = run(['nonsense'])
  assert.notEqual(out.status, 0)
})

test('the scripts that are run directly are executable, so rewriting them can never leave the service unable to restart', () => {
  for (const file of ['scripts/komorebi-service.sh', 'scripts/start-bridge.sh', 'scripts/komorebi-room', 'scripts/bench-hook', 'scripts/komorebi-bench-plugin.sh', 'scripts/restart-bridge.command']) {
    assert.ok((statSync(file).mode & 0o111) !== 0, `${file} must keep its executable bit`)
  }
})
