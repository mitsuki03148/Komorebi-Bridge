import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { AttachmentLedger, sweepAttachments, trashAttachments } from './attachment-trash';
import { Rooms } from './rooms';
import { saveFileAttachments } from './attachments';

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'komorebi-trash-'));
  const directory = join(base, 'Attachments'), trash = join(base, '.Trash');
  await mkdir(directory); await mkdir(trash);
  return { base, directory, trash, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('uploaded images are moved to the Trash, never deleted; only Komorebi\'s own names are touched, a clash in the Trash keeps both', async () => {
  const { directory, trash, cleanup } = await setup();
  try {
    await writeFile(join(directory, `${id(1)}.jpg`), 'a');
    await writeFile(join(directory, `${id(2)}.png`), 'b');
    await writeFile(join(directory, 'my-photo.jpg'), 'mine');
    await writeFile(join(trash, `${id(2)}.png`), 'already there');
    const result = await trashAttachments([`${id(1)}.jpg`, `${id(2)}.png`, 'my-photo.jpg', '../escape.jpg', `${id(9)}.jpg`], directory, trash);
    assert.deepEqual(result.moved.sort(), [`${id(1)}.jpg`, `${id(2)}.png`]);
    assert.deepEqual(result.missing, [`${id(9)}.jpg`]);
    assert.deepEqual(await readdir(directory), ['my-photo.jpg'], 'a file Komorebi did not name is left alone');
    const inTrash = await readdir(trash);
    assert.equal(inTrash.length, 3, 'the clash was kept, not overwritten');
    assert.ok(inTrash.includes(`${id(1)}.jpg`));
    // A trash that cannot be written to leaves the file where it is.
    await writeFile(join(directory, `${id(3)}.jpg`), 'c');
    const blocked = await trashAttachments([`${id(3)}.jpg`], directory, join(trash, 'does', 'not', 'exist'));
    assert.deepEqual(blocked.failed, [`${id(3)}.jpg`]);
    assert.ok((await readdir(directory)).includes(`${id(3)}.jpg`), 'nothing is lost when the Trash is not reachable');
  } finally { await cleanup(); }
});

test('images untouched for 14 days go to the Trash; newer ones and other files stay', async () => {
  const { directory, trash, cleanup } = await setup();
  try {
    const now = Date.parse('2026-11-30T00:00:00Z');
    const put = async (name: string, ageDays: number) => { const path = join(directory, name); await writeFile(path, 'x'); const when = new Date(now - ageDays * 86_400_000); await utimes(path, when, when); };
    await put(`${id(1)}.jpg`, 20); await put(`${id(2)}.jpg`, 14.5); await put(`${id(3)}.jpg`, 13); await put('notes.txt', 90);
    const result = await sweepAttachments(14, directory, trash, now);
    assert.deepEqual(result.moved.sort(), [`${id(1)}.jpg`, `${id(2)}.jpg`]);
    assert.deepEqual((await readdir(directory)).sort(), [`${id(3)}.jpg`, 'notes.txt']);
    assert.deepEqual(await sweepAttachments(14, join(directory, 'missing'), trash, now), { moved: [], failed: [], missing: [] }, 'no folder, nothing to do');
  } finally { await cleanup(); }
});

test('deleting archived rooms moves the images sent to them to the Trash, and says so', async () => {
  const { base, directory, trash, cleanup } = await setup();
  const cwd = process.cwd();
  process.chdir(base);
  try {
    const events: any[] = [];
    const rooms = new Rooms(base, event => events.push(event), async () => join(directory, `${id(7)}.jpg`));
    const ledger = new AttachmentLedger(join(base, 'ledger.json'));
    rooms.attachmentLedger = ledger;
    rooms.trashImages = files => trashAttachments(files, directory, trash);
    await writeFile(join(directory, `${id(7)}.jpg`), 'mine');
    await writeFile(join(directory, `${id(8)}.jpg`), 'other room');
    ledger.record(`${id(7)}.jpg`, 'gone');
    ledger.record(`${id(8)}.jpg`, 'stays');
    assert.deepEqual(new AttachmentLedger(join(base, 'ledger.json')).filesFor(['gone']), [`${id(7)}.jpg`], 'the ledger is saved');
    const room = { id: 'gone', modelId: 'CODEX', roomName: '要刪', repoPath: '/tmp', logs: [], live: false } as any;
    rooms.rooms.set(room.id, room);
    (rooms as any).archivedKeys = new Set(['gone']);
    const replies: any[] = [];
    await rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['gone'] }, event => replies.push(event));
    assert.deepEqual((await readdir(directory)), [`${id(8)}.jpg`], 'only the deleted room\'s image went');
    assert.ok((await readdir(trash)).includes(`${id(7)}.jpg`), 'it is in the Trash');
    assert.match(replies.find(event => event.type === 'NOTICE').message, /1 張上傳圖片已移到垃圾桶/);
    assert.deepEqual(ledger.filesFor(['gone']), [], 'and forgotten');
  } finally { process.chdir(cwd); await cleanup(); }
});

test('the attachment sweep moves only generated file names, retains collisions, and refuses symbolic-link sources', async () => {
  const { base, directory, trash, cleanup } = await setup();
  try {
    const old = new Date('2026-10-01');
    const now = Date.parse('2026-11-30');
    const [first, fresh] = await saveFileAttachments([{ name: 'README', data: 'b2xk' }, { name: 'fresh.csv', data: 'bmV3' }], directory);
    const unrelated = ['personal.pdf', 'my-uuid_notes.txt', `${id(1)}_.hidden`, `${id(2)}_script.sh`, `${id(3).replace('-4000-', '-2000-')}_Report.txt`];
    for (const name of unrelated) {
      await writeFile(join(directory, name), 'untouched');
      await utimes(join(directory, name), old, old);
    }
    await utimes(first, old, old);
    await utimes(fresh, new Date(now), new Date(now));
    const symlinkName = `${id(10)}_Linked.txt`;
    await symlink(join(directory, unrelated[0]), join(directory, symlinkName));
    await writeFile(join(trash, basename(first)), 'prior');
    const folded = join(base, 'folder-alias');
    await symlink(directory, folded);
    assert.deepEqual((await sweepAttachments(14, folded, trash, now)).moved, []);
    assert.deepEqual((await trashAttachments([basename(first)], folded, trash)).failed, [basename(first)]);
    const result = await sweepAttachments(14, directory, trash, now);
    assert.deepEqual(result.moved, [basename(first)]);
    assert.deepEqual((await readdir(directory)).sort(), [...unrelated, basename(fresh), symlinkName].sort());
    assert.equal(await readFile(join(trash, basename(first)), 'utf8'), 'prior');
    const recovered = (await readdir(trash)).find(name => name !== basename(first))!;
    assert.equal(await readFile(join(trash, recovered), 'utf8'), 'old');
    assert.deepEqual((await trashAttachments([symlinkName], directory, trash)).failed, [symlinkName]);
    assert.equal(await readFile(join(directory, unrelated[0]), 'utf8'), 'untouched');
  } finally { await cleanup(); }
});

test('archiving keeps ordinary files; deleting archived rooms trashes only recorded attachments for those rooms', async () => {
  const { base, directory, trash, cleanup } = await setup();
  const cwd = process.cwd();
  process.chdir(base);
  try {
    const [first, second] = await saveFileAttachments([{ name: 'plan.txt', data: 'YQ==' }, { name: 'budget.csv', data: 'Yg==' }], directory);
    const unrelated = join(directory, 'Personal.txt');
    await writeFile(unrelated, 'personal');
    const rooms = new Rooms(base, () => {});
    const ledger = new AttachmentLedger(join(base, 'ledger.json'));
    rooms.attachmentLedger = ledger;
    rooms.trashImages = names => trashAttachments(names, directory, trash);
    ledger.record(first, 'gone');
    ledger.record(second, 'stays');
    ledger.record(unrelated, 'gone');
    assert.deepEqual(new AttachmentLedger(join(base, 'ledger.json')).filesFor(['gone']), [basename(first)]);
    const room = { id: 'gone', modelId: 'CODEX', roomName: '測試', repoPath: '/tmp', logs: [], live: false } as any;
    rooms.rooms.set(room.id, room);
    await rooms.handle({ type: 'ARCHIVE', roomId: 'gone', archived: true }, () => {});
    assert.equal(await readFile(first, 'utf8'), 'a');
    assert.deepEqual(await readdir(trash), []);
    const replies: string[] = [];
    await rooms.handle({ type: 'DELETE_ARCHIVED', roomIds: ['gone'] }, event => { if (event.type === 'NOTICE') replies.push(event.message); });
    assert.match(replies[0], /1 個附件已移到垃圾桶/);
    assert.deepEqual(ledger.filesFor(['gone']), []);
    assert.deepEqual(ledger.filesFor(['stays']), [basename(second)]);
    assert.deepEqual(await readdir(trash), [basename(first)]);
    assert.deepEqual((await readdir(directory)).sort(), [basename(second), 'Personal.txt'].sort());
    assert.equal(await readFile(join(trash, basename(first)), 'utf8'), 'a');
  } finally { process.chdir(cwd); await cleanup(); }
});
