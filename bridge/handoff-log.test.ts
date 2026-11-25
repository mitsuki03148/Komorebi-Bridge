import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HandoffLog } from './handoff-log';

test('the handoff log keeps outcomes only, the newest 200, survives a restart, and can show just the failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-log-'));
  try {
    const path = join(dir, 'log.json');
    const log = new HandoffLog(path, () => Date.parse('2026-11-14T12:00:00Z'));
    log.add({ from: 'Worker', to: 'CODEX · R5 統籌（01a19c88）', code: 1, ms: 120_000, note: '等了 120 秒，都未準備好。\n未送達' });
    log.add({ from: 'Worker', to: 'CODEX · R5 統籌（01a1d852）', code: 0, ms: 800, note: '已送到' });
    log.add({ to: 'x', code: 'nonsense', ms: -5, note: 7 });
    assert.deepEqual(log.recent(10, true).map(entry => entry.to), ['CODEX · R5 統籌（01a19c88）', 'x'], 'a bad code counts as a failure');
    assert.equal(log.recent(1)[0].ms, 0);
    assert.equal(log.recent(10, true)[0].note, '等了 120 秒，都未準備好。 未送達', 'one line, no stray newlines');
    assert.deepEqual(Object.keys(log.recent(1)[0]).sort(), ['at', 'code', 'ms', 'note', 'to'], 'no message text is kept');
    assert.equal(new HandoffLog(path).recent(10).length, 3, 'it survives a restart');
    for (let index = 0; index < 250; index++) log.add({ to: `r${index}`, code: 0, ms: 1 });
    assert.equal(new HandoffLog(path).recent(500).length, 200);
    assert.equal(log.recent(1)[0].to, 'r249');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
