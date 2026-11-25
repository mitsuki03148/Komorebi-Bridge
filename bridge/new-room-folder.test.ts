import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('a new room starts in the folder picked for it, and in the default folder when none is picked', async () => {
  const { Rooms } = await import('./rooms');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-newroom-folder-')));
  const originalPath = process.env.PATH;
  const rooms = new Rooms(root, () => {});
  try {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'claude'), '#!/bin/sh\nwhile IFS= read -r line; do :; done\n', { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    const picked = join(root, 'project-a');
    await mkdir(picked);
    const create = (roomName: string, repoPath: string) => rooms.handle({ type: 'CREATE', modelId: 'CLAUDE', roomName, repoPath, remote: false }, () => {});
    await create('Picked', picked);
    await create('Default', '');
    const folderOf = (name: string) => rooms.snapshot().find(room => room.roomName === name)?.repoPath;
    assert.equal(folderOf('Picked'), picked);
    assert.equal(folderOf('Default'), root);
    await assert.rejects(create('Missing', join(root, 'nowhere')), /找不到/);
    await assert.rejects(create('Relative', 'project-a'), /絕對路徑/);
  } finally {
    await rooms.close();
    process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});
