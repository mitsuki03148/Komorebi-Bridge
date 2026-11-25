import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Rooms } from './rooms';
import { trashSessionFiles } from './attachment-trash';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'komorebi-archive-session-'));
  const root = join(home, '.codex/sessions'), trash = join(home, '.Trash');
  await mkdir(root, { recursive: true });
  await mkdir(trash);
  const file = join(root, 'rollout-test.jsonl');
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: home } }) + '\n');
  const old = process.cwd();
  process.chdir(home);
  const rooms = new Rooms(home, () => {});
  rooms.sessionHome = home;
  rooms.sessionRootDirs = { CODEX: [root], AGY: [], CLAUDE: [] };
  rooms.trashSessions = files => trashSessionFiles(files, trash);
  const room = { id: 'room', sessionId: id, modelId: 'CODEX', roomName: 'test', repoPath: home, logs: [], live: false, syncedStateFile: '~/.codex/sessions/rollout-test.jsonl' } as any;
  rooms.rooms.set(room.id, room);
  return { home, root, trash, file, old, rooms, room };
}

test('archiving keeps the conversation; deleting then moves the exclusive file to Trash', async () => {
  const f = await fixture();
  try {
    await f.rooms.handle({ type: 'ARCHIVE', roomId: f.room.id, archived: true }, () => {});
    assert.match(await readFile(f.file, 'utf8'), /session_meta/);
    assert.deepEqual(await readdir(f.trash), []);
    const replies: string[] = [];
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: [f.room.id] }, e => { if (e.type === 'NOTICE') replies.push(e.message); });
    assert.equal(f.rooms.rooms.has(f.room.id), false);
    assert.match(await readFile(join(f.trash, 'rollout-test.jsonl'), 'utf8'), /session_meta/);
    await assert.rejects(readFile(f.file));
    assert.match(replies[0], /1 個 CLI 對話檔/);
  } finally { process.chdir(f.old); }
});

test('a session referenced by another room or successor remains in place', async () => {
  const f = await fixture();
  try {
    f.rooms.rooms.set('other', { ...f.room, id: 'other', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    (f.rooms as any).archivedKeys = new Set(['room']);
    const replies: string[] = [];
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, e => { if (e.type === 'NOTICE') replies.push(e.message); });
    assert.match(await readFile(f.file, 'utf8'), /session_meta/);
    assert.match(replies[0], /保留 1 個共用檔/);
  } finally { process.chdir(f.old); }
});

test('a successor reference preserves the session', async () => {
  const f = await fixture();
  try {
    f.rooms.successors = () => ({ [id]: 'other' });
    (f.rooms as any).archivedKeys = new Set(['room']);
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, () => {});
    assert.match(await readFile(f.file, 'utf8'), /session_meta/);
  } finally { process.chdir(f.old); }
});

test('an unreadable deleted-state file prevents both room removal and file movement', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.home, '.env.komorebi-room-deleted.json'), '{invalid');
    const rooms = new Rooms(f.home, () => {});
    rooms.sessionHome = f.home;
    rooms.sessionRootDirs = { CODEX: [f.root], AGY: [], CLAUDE: [] };
    rooms.trashSessions = files => trashSessionFiles(files, f.trash);
    rooms.rooms.set('room', f.room);
    (rooms as any).archivedKeys = new Set(['room']);
    await assert.rejects(rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, () => {}));
    assert.equal(rooms.rooms.has('room'), true);
    assert.match(await readFile(f.file, 'utf8'), /session_meta/);
    assert.deepEqual(await readdir(f.trash), []);
  } finally { process.chdir(f.old); }
});

test('an outside-root link or missing Trash leaves the file and reports failure while removing the room', async () => {
  for (const kind of ['outside', 'outside-link', 'trash'] as const) {
    const f = await fixture();
    try {
      if (kind === 'outside' || kind === 'outside-link') {
        const external = join(f.home, 'external.jsonl');
        await writeFile(external, await readFile(f.file));
        if (kind === 'outside-link') {
          const link = join(f.root, 'alias.jsonl');
          await symlink(external, link);
          f.room.syncedStateFile = '~/.codex/sessions/alias.jsonl';
        } else f.room.syncedStateFile = '~/external.jsonl';
      } else f.rooms.trashSessions = files => trashSessionFiles(files, join(f.home, 'missing-trash'));
      (f.rooms as any).archivedKeys = new Set(['room']);
      const replies: string[] = [];
      await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, e => { if (e.type === 'NOTICE') replies.push(e.message); });
      assert.equal(f.rooms.rooms.has('room'), false);
      assert.match(await readFile(f.file, 'utf8'), /session_meta/);
      assert.match(replies[0], /未能移動/);
    } finally { process.chdir(f.old); }
  }
});

test('a Trash name collision preserves both files and the original session filename', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.trash, 'rollout-test.jsonl'), 'existing');
    (f.rooms as any).archivedKeys = new Set(['room']);
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, () => {});
    const entries = await readdir(f.trash);
    assert.equal(await readFile(join(f.trash, 'rollout-test.jsonl'), 'utf8'), 'existing');
    const moved = entries.find(name => name.endsWith('_rollout-test.jsonl'));
    assert.ok(moved);
    assert.match(await readFile(join(f.trash, moved), 'utf8'), /session_meta/);
  } finally { process.chdir(f.old); }
});

test('AGY transcript and its per-session database and sidecars move together, other files remain', async () => {
  const f = await fixture();
  try {
    const agy = join(f.home, '.gemini/antigravity-cli');
    const brain = join(agy, 'brain', id, '.system_generated/logs');
    await mkdir(brain, { recursive: true });
    await mkdir(join(agy, 'conversations'), { recursive: true });
    await mkdir(join(agy, 'annotations'), { recursive: true });
    await writeFile(join(brain, 'transcript_full.jsonl'), '{}\n');
    for (const file of [`${id}.db`, `${id}.db-wal`]) await writeFile(join(agy, 'conversations', file), file);
    await writeFile(join(agy, 'annotations', `${id}.pbtxt`), 'annotation');
    await writeFile(join(agy, 'conversations', 'unrelated.db'), 'untouched');
    f.rooms.sessionRootDirs.AGY = [join(agy, 'brain')];
    f.room.modelId = 'AGY';
    f.room.syncedStateFile = `~/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`;
    (f.rooms as any).archivedKeys = new Set(['room']);
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, () => {});
    assert.equal((await readdir(f.trash)).length, 4);
    assert.equal(await readFile(join(agy, 'conversations', 'unrelated.db'), 'utf8'), 'untouched');
    assert.deepEqual(await readdir(brain), []);
  } finally { process.chdir(f.old); }
});

test('AGY retains the whole group when one existing sidecar is not a regular file', async () => {
  const f = await fixture();
  try {
    const agy = join(f.home, '.gemini/antigravity-cli');
    const brain = join(agy, 'brain', id, '.system_generated/logs');
    await mkdir(brain, { recursive: true });
    await mkdir(join(agy, 'conversations'), { recursive: true });
    const transcript = join(brain, 'transcript_full.jsonl');
    await writeFile(transcript, '{}\n');
    const db = join(agy, 'conversations', `${id}.db`);
    await writeFile(db, 'database');
    await symlink(f.file, `${db}-wal`);
    f.rooms.sessionRootDirs.AGY = [join(agy, 'brain')];
    f.room.modelId = 'AGY';
    f.room.syncedStateFile = `~/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`;
    (f.rooms as any).archivedKeys = new Set(['room']);
    const replies: string[] = [];
    await f.rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['room'] }, e => { if (e.type === 'NOTICE') replies.push(e.message); });
    assert.equal(await readFile(db, 'utf8'), 'database');
    assert.equal(await readFile(transcript, 'utf8'), '{}\n');
    assert.deepEqual(await readdir(f.trash), []);
    assert.match(replies[0], /\.db-wal/);
  } finally { process.chdir(f.old); }
});
