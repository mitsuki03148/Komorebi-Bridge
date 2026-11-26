import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupMemberRoleAction, GroupMemberRoleEditor } from '../src/components/GroupMemberRoleEditor';
import { GroupChatView } from '../src/components/GroupChat';
import { GroupRoomSidebar } from '../src/components/GroupRoomSidebar';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { zh } from '../src/i18n/zh';
import { groupRoleCategories, groupRoleFromChoice, groupRoleKey, groupRolePresets, savedGroupRole } from '../src/types/groupRoles';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { ArchiveGroups } from './archive-groups';
import { Groups, GroupMemberRoleError } from './groups';

const rooms = [
  { id: 'a', roomName: 'Room A', modelId: 'CODEX', sessionId: '12345678-1234-1234-1234-123456789abc' },
  { id: 'b', roomName: 'Room B', modelId: 'CLAUDE', sessionId: '22345678-1234-1234-1234-123456789abc' },
  { id: 'c', roomName: 'Room C', modelId: 'AGY', sessionId: '32345678-1234-1234-1234-123456789abc' },
] as unknown as TerminalRoom[];
const members = rooms.map(({ id, modelId }) => ({ roomId: id, modelId }));
const roleOf = (group: GroupChat, id: string) => group.members.find(member => member.roomId === id)?.role;
const roomFor = (id: string) => rooms.find(room => room.id === id);

async function fixture(fn: (dir: string, file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-group-roles-'));
  try { await fn(dir, join(dir, 'groups.json')); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('role categories include each preset exactly once', () => {
  const roles = groupRoleCategories.flatMap(category => [...category.roles]);
  for (const role of ['implement', 'review', 'debug', 'art-copy', 'native-test', 'clerk', 'cybersecurity']) {
    assert.ok(groupRoleCategories[0].roles.some(key => key === role));
  }
  assert.equal(new Set(roles).size, roles.length);
  assert.deepEqual([...roles].sort(), [...groupRolePresets].sort());
});

test('category labels exist in all supported languages', () => {
  for (const table of [zh, en, ja]) {
    for (const category of groupRoleCategories) {
      assert.ok(table[`group.memberRole.category.${category.key}`]);
    }
    for (const role of groupRolePresets) {
      assert.ok(table[`group.memberRole.${role}`]);
      assert.ok(table[`group.memberRole.description.${role}`]);
    }
  }
});

test('investment preset keys retain older custom role records', () => {
  for (const key of groupRoleCategories[1].roles) {
    assert.deepEqual(savedGroupRole({ key, label: key, direction: 'remember' }), { key, label: key, direction: 'remember' });
    assert.deepEqual(groupRoleFromChoice({ preset: key }), { key });
  }
});

test('selected role opens its category and exposes every investment role', () => {
  const html = renderToStaticMarkup(createElement(GroupMemberRoleEditor, {
    roomName: 'Room A', role: { key: 'risk-manager' }, pending: false, onSave() {}, onClose() {},
  }));
  assert.match(html, /aria-expanded="true"[^>]*>.*?投資/);
  for (const key of groupRoleCategories[1].roles) assert.match(html, new RegExp(`value="${key}"`));
  assert.match(html, /checked="" value="risk-manager"/);
});

test('role keys accept only canonical presets and normalized, bounded custom names', () => {
  assert.deepEqual(groupRoleFromChoice({ custom: ' ＱＡ   Lead ' }), { key: 'qa lead', label: 'QA Lead' });
  assert.deepEqual(groupRoleFromChoice({ custom: 'Native Test' }), { key: 'native-test' });
  assert.equal(groupRoleKey('實作'), 'implement');
  assert.equal(groupRoleKey('REVIEW'), 'review');
  assert.equal(groupRoleKey(' İ '), groupRoleKey(groupRoleKey(' İ ')));
  assert.equal(groupRoleKey('orchestrato'), 'orchestrato');
  for (const name of ['', 'a'.repeat(25), 'a/b', 'a\nb', 'a\u2028b', 'a\u200bb', '@review', 'ORCHESTRATOR']) {
    assert.equal(groupRoleFromChoice({ custom: name }), undefined, name);
  }
  assert.equal(groupRoleFromChoice({ preset: 'review', auto: true }), undefined);
  assert.equal(groupRoleFromChoice({ preset: 'QA' }), undefined);
  assert.equal(groupRoleFromChoice(null), null);
});

test('old group files load as unassigned; the new writer preserves the existing JSON layout and role through reload', () => fixture(async (_dir, path) => {
  const before = JSON.stringify([{ id: 'g', name: 'Legacy', createdAt: '', members, orchestratorRoomId: 'a' }]);
  await writeFile(path, before);
  const emitted: GroupChat[] = [];
  const groups = new Groups(path, group => emitted.push(group), roomFor);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(groups.get('g')?.members, members);
  groups.setMemberRole('g', 'a', { preset: 'implement' });
  assert.deepEqual(roleOf(emitted[0], 'a'), { key: 'implement' });
  assert.equal(emitted[0].orchestratorRoomId, 'a');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(roleOf(new Groups(path, () => {}, roomFor).get('g')!, 'a'), { key: 'implement' });

  // Frozen b2fbff1 membership contract and group projection: old readers accept extra member keys and retain the nested record.
  const oldReader = (json: string) => (JSON.parse(json) as Array<Omit<GroupChat, 'members'> & {
    members: { roomId: string; modelId: string }[];
  }>).map(({ id, name, members, createdAt, orchestratorRoomId }) => {
    assert.ok(members.length >= 1 && members.length <= 8);
    assert.ok(members.every(m => /^[A-Za-z0-9][\w-]{0,149}$/.test(m.roomId) && ['AGY', 'CODEX', 'CLAUDE'].includes(m.modelId)));
    return { id, name, members, createdAt, orchestratorRoomId };
  });
  const [old] = oldReader(await readFile(path, 'utf8'));
  assert.equal(old.id, 'g');
  assert.equal(old.orchestratorRoomId, 'a');
  assert.deepEqual(old.members[0], { ...members[0], role: { key: 'implement' } });
  groups.setMemberRole('g', 'a', null);
  assert.equal(roleOf(new Groups(path, () => {}, roomFor).get('g')!, 'a'), undefined);
}));

test('role assignments are per group; setting a role cannot add members or accept authority fields', () => fixture(async (_dir, path) => {
  const groups = new Groups(path, () => {}, roomFor);
  const g = groups.create('First', members.slice(0, 2));
  const other = groups.create('Other', [members[0], members[2]]);
  groups.setMemberRole(g.id, 'a', { custom: 'QA Team' });
  groups.setMemberRole(g.id, 'b', { custom: 'qa  team' });
  assert.deepEqual(roleOf(groups.get(g.id)!, 'b'), { key: 'qa team', label: 'QA Team' });
  assert.equal(roleOf(groups.get(other.id)!, 'a'), undefined);
  assert.throws(() => groups.setMemberRole(other.id, 'b', { preset: 'review' }), (err: unknown) => err instanceof GroupMemberRoleError && err.code === 'missing');
  assert.throws(() => groups.setMemberRole(g.id, 'a', { preset: 'review', fullAccess: true }), (err: unknown) => err instanceof GroupMemberRoleError && err.code === 'invalid');
  assert.equal(groups.get(g.id)?.orchestratorRoomId, undefined);
  assert.deepEqual(rooms.map(room => room.autoMode), [undefined, undefined, undefined]);
}));

test('bad optional role is shown as unassigned, warns once, and never overwrites the original file', () => fixture(async (_dir, path) => {
  const original = JSON.stringify([{ id: 'g', name: 'Valid group', createdAt: '', members: [
    { ...members[0], role: { key: 'review', auto: true } },
    { ...members[1], role: { key: 'implement' } },
  ] }]);
  await writeFile(path, original);
  const warns: string[] = [];
  const groups = new Groups(path, () => {}, roomFor, (_message, cause) => warns.push(cause));
  assert.equal(roleOf(groups.get('g')!, 'a'), undefined);
  assert.deepEqual(roleOf(groups.get('g')!, 'b'), { key: 'implement' });
  assert.deepEqual(warns, ['repair']);
  assert.equal(groups.rolesNeedRepair, true);
  assert.throws(() => groups.setMemberRole('g', 'a', { preset: 'review' }), /無效的崗位/);
  assert.throws(() => groups.rename('g', 'New name'), /無效的崗位/);
  assert.equal(await readFile(path, 'utf8'), original);
}));

test('verified room merges preserve a role or keep the surviving role and warn about a conflict', () => fixture(async (_dir, path) => {
  const alias = { ...rooms[0], id: 'new-a' };
  const lookup = (id: string) => id === alias.id ? alias : roomFor(id);
  const warns: string[] = [];
  const groups = new Groups(path, () => {}, lookup, (_message, cause) => warns.push(cause));
  const g = groups.create('No existing alias', members.slice(0, 2));
  groups.setMemberRole(g.id, 'a', { preset: 'implement' });
  // Set up a group saved before the original room gained its native binding, then let the alias merge.
  const g2 = new Groups(join(_dir, 'collision.json'), () => {}, id => id === 'a' ? { ...rooms[0], sessionId: undefined } : lookup(id),
    (_message, cause) => warns.push(cause));
  const collision = g2.create('Duplicate', [members[0], { modelId: 'CODEX', roomId: alias.id }]);
  g2.setMemberRole(collision.id, 'a', { preset: 'review' });
  g2.setMemberRole(collision.id, alias.id, { preset: 'clerk' });
  groups.replaceRoom('a', alias.id);
  assert.deepEqual(roleOf(groups.get(g.id)!, alias.id), { key: 'implement' });
  g2.replaceRoom('a', alias.id);
  assert.deepEqual(g2.get(collision.id)?.members, [{ modelId: 'CODEX', roomId: alias.id, role: { key: 'clerk' } }]);
  assert.deepEqual(warns, ['conflict']);
}));

test('archive restore keeps each group role and its direction, including a custom key with no remaining member', () => fixture(async (dir, path) => {
  const groups = new Groups(path, () => {}, roomFor);
  const keep = groups.create('Custom kept', members);
  const extinct = groups.create('Custom retired', members.slice(0, 2));
  const preset = groups.create('Preset', members.slice(0, 2));
  const gone = groups.create('Deleted', members.slice(0, 2));
  groups.setMemberRole(keep.id, 'a', { custom: 'Build Help' });
  groups.setMemberRole(keep.id, 'b', { custom: 'Build Help' });
  groups.setMemberRole(extinct.id, 'a', { custom: 'QA' });
  groups.setMemberDirection(extinct.id, 'a', 'Restore direction', 'qa');
  groups.setMemberDirection(keep.id, 'a', 'Own direction', 'build help');
  groups.setMemberDirection(keep.id, 'b', 'Other direction', 'build help');
  groups.setMemberRole(preset.id, 'a', { preset: 'clerk' });
  groups.setMemberRole(gone.id, 'a', { preset: 'review' });
  const remembered = [keep, extinct, preset, gone].map(group => ({
    groupId: group.id, orchestrator: false, role: roleOf(groups.get(group.id)!, 'a'),
  }));
  for (const group of [keep, extinct, preset]) groups.removeMember(group.id, 'a');
  groups.delete(gone.id);
  const archivePath = join(dir, 'archive.json');
  new ArchiveGroups(archivePath).remember('a', remembered);
  const storage = new ArchiveGroups(archivePath);
  assert.deepEqual(storage.restore('a', rooms[0], groups, () => true), []);
  assert.deepEqual(roleOf(groups.get(keep.id)!, 'a'), { key: 'build help', label: 'Build Help', direction: 'Own direction' });
  assert.equal(roleOf(groups.get(keep.id)!, 'b')?.direction, 'Other direction');
  assert.deepEqual(roleOf(groups.get(preset.id)!, 'a'), { key: 'clerk' });
  assert.deepEqual(roleOf(groups.get(extinct.id)!, 'a'), { key: 'qa', label: 'QA', direction: 'Restore direction' });
  assert.equal(groups.get(gone.id), undefined);
}));

test('Mac and iPhone role labels are present and accessible only with the Bridge capability', () => {
  const g: GroupChat = { id: 'g', name: 'Group', members: [{ ...members[0], role: { key: 'review' } }, members[1]], createdAt: '' };
  for (const compact of [false, true]) {
    const render = (showMemberRoles = false) => renderToStaticMarkup(createElement(GroupRoomSidebar, {
      compact, showMemberRoles, groups: [g], rooms, characters: INITIAL_CHARACTERS, selectedGroupId: 'g',
      onSelectGroup() {}, onSelectRoom() {},
    }));
    assert.match(render(true), /data-member-assignment[^>]*>審查<\/span>/);
    assert.match(render(true), /aria-label="[^"]+崗位: 審查"/);
    assert.doesNotMatch(render(), /data-member-assignment/);
  }
});

test('the role editor offers presets, custom and removal, and its entry is absent on an old Bridge', () => {
  assert.equal(renderToStaticMarkup(createElement(GroupMemberRoleAction, {})), '');
  const pending = renderToStaticMarkup(createElement(GroupMemberRoleEditor, {
    roomName: 'Room A', pending: true, role: { key: 'qa team', label: 'QA Team' }, onSave() {}, onClose() {},
  }));
  assert.match(pending, /value="none"/);
  assert.match(pending, /value="custom"/);
  assert.match(pending, /aria-expanded="false"[^>]*>.*?工程/);
  assert.match(pending, /aria-expanded="false"[^>]*>.*?投資/);
  assert.doesNotMatch(pending, /媒體與行銷|財務|通用/);
  assert.match(pending, /role="dialog" aria-modal="true"/);
  assert.match(pending, /value="QA Team"/);
  assert.match(pending, /@qa team/);
  assert.match(pending, /type="submit" disabled/);
});

test('group details has a keyboard-accessible assignment button when and only when enabled', () => {
  const render = (enabled: boolean) => renderToStaticMarkup(createElement(GroupChatView, {
    name: 'Group', characters: INITIAL_CHARACTERS, recipientId: 'a',
    members: [{ ...members[0], role: { key: 'implement' }, room: { ...rooms[0], logs: [], selectedSubModel: '—', effortLevel: null } }],
    onEditMemberRole: enabled ? () => {} : undefined,
    onSend() {}, onBack() {}, onCommand() {}, onDecision() {}, onInterrupt() {}, onMenu() {},
  }));
  assert.match(render(true), /<button[^>]+data-group-member-role-edit/);
  assert.doesNotMatch(render(false), /data-group-member-role-edit/);
});


test('directions are per member, survive same-key label changes, reset on key change, and reject stale edits', () => fixture(async (_dir, path) => {
  const groups = new Groups(path, () => {}, roomFor);
  const group = groups.create('Directions', members);
  groups.setMemberRole(group.id, 'a', { custom: 'QA Team' });
  groups.setMemberRole(group.id, 'b', { custom: 'QA Team' });
  groups.setMemberDirection(group.id, 'a', 'first\n\nsecond', 'qa team');
  groups.setMemberDirection(group.id, 'b', 'other', 'qa team');
  groups.setMemberRole(group.id, 'a', { custom: 'qa TEAM' });
  assert.deepEqual(roleOf(groups.get(group.id)!, 'a'), { key: 'qa team', label: 'qa TEAM', direction: 'first\n\nsecond' });
  assert.equal(roleOf(groups.get(group.id)!, 'b')?.direction, 'other');
  assert.equal(roleOf(new Groups(path, () => {}, roomFor).get(group.id)!, 'a')?.direction, 'first\n\nsecond');
  groups.setMemberRole(group.id, 'a', { preset: 'review' });
  assert.deepEqual(roleOf(groups.get(group.id)!, 'a'), { key: 'review' });
  assert.throws(() => groups.setMemberDirection(group.id, 'a', 'stale', 'qa team'), (err: unknown) => err instanceof GroupMemberRoleError && err.code === 'conflict');
  groups.setMemberDirection(group.id, 'a', '  first\u0000\u202esecond\nthird', 'review');
  assert.equal(roleOf(groups.get(group.id)!, 'a')?.direction, '  firstsecond\nthird');
  groups.setMemberRole(group.id, 'a', null);
  assert.equal(roleOf(groups.get(group.id)!, 'a'), undefined);
  assert.throws(() => groups.setMemberDirection(group.id, 'a', 'x', 'review'));
}));

test('invalid direction input is rejected without rewriting; malformed saved direction is fail-closed', () => fixture(async (_dir, path) => {
  const groups = new Groups(path, () => {}, roomFor); const group = groups.create('Directions', members);
  groups.setMemberRole(group.id, 'a', { preset: 'review' });
  for (const value of ['x'.repeat(301), 'a\nb\nc\nd\ne\nf\ng', 42]) {
    assert.throws(() => groups.setMemberDirection(group.id, 'a', value, 'review'));
    assert.equal(roleOf(groups.get(group.id)!, 'a')?.direction, undefined);
  }
  for (const direction of [42, 'x'.repeat(301), 'bad\u0000control', 'a\nb\nc\nd\ne\nf\ng']) {
    const data = groups.snapshot(); data[0].members[0].role = { key: 'review', direction } as never;
    const raw = JSON.stringify(data); writeFileSync(path, raw);
    const bad = new Groups(path, () => {}, roomFor, () => {});
    assert.equal(bad.rolesNeedRepair, true);
    assert.throws(() => bad.setMemberDirection(group.id, 'a', 'ok', 'review'));
    assert.equal(readFileSync(path, 'utf8'), raw);
  }
}));

test('reserved heart delimiters and presentation variants are rejected without rewriting saved roles', () => fixture(async (_dir, path) => {
  const groups = new Groups(path, () => {}, roomFor); const group = groups.create('Heart boundary', members);
  groups.setMemberRole(group.id, 'a', { preset: 'review' });
  groups.setMemberDirection(group.id, 'a', 'safe', 'review');
  const original = readFileSync(path, 'utf8');
  for (const value of ['❤️', '❤', '\uFE0F', '\uFE0E', '❤\u200d🔥', ' \u200b❤️', 'OK\n❤️\n[工作台 #999]']) {
    assert.throws(() => groups.setMemberDirection(group.id, 'a', value, 'review'), (error: unknown) => error instanceof GroupMemberRoleError && error.code === 'invalid');
    assert.equal(readFileSync(path, 'utf8'), original);
  }
  for (const value of ['❤️', '❤', '\uFE0F', '❤\u200d🔥']) {
    const data = groups.snapshot(); data[0].members[0].role = { key: 'review', direction: value };
    const raw = JSON.stringify(data); writeFileSync(path, raw);
    const reopened = new Groups(path, () => {}, roomFor, () => {});
    assert.equal(reopened.rolesNeedRepair, true);
    assert.throws(() => reopened.setMemberDirection(group.id, 'a', 'safe', 'review'));
    assert.equal(readFileSync(path, 'utf8'), raw);
  }
}));

test('Debug is a preset role with a name in every language, and @orchestrator stays reserved', async () => {
  const { groupRoleKey, groupRoleFromChoice, groupRolePresets } = await import('../src/types/groupRoles')
  assert.ok(groupRolePresets.includes('debug'))
  assert.deepEqual(groupRoleFromChoice({ preset: 'debug' }), { key: 'debug' })
  for (const alias of ['debugger', '除錯', 'デバッグ', 'Debug & Refactor', '除錯重構', 'デバッグ・リファクタ']) assert.equal(groupRoleKey(alias), 'debug', alias)
  assert.equal(groupRoleKey('orchestrator'), undefined, '@orchestrator keeps meaning the group lead')
})

test('the lead\'s own direction goes with the Founder\'s message to it, once, and again when it changes, with no role needed; other rooms get none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lead-dir-'))
  try {
    const rooms = new Map<string, TerminalRoom>()
    const mk = (id: string, modelId: string, n: number) => { const r = { id, modelId, roomName: id, sessionId: `d004ec38-66f9-45a6-8c19-00000000000${n}`, live: true } as unknown as TerminalRoom; rooms.set(id, r); return r }
    mk('lead-room', 'CLAUDE', 1); mk('worker', 'CODEX', 2)
    const groups = new Groups(join(dir, 'g.json'), () => {}, id => rooms.get(id))
    const group = groups.create('G', [{ roomId: 'lead-room', modelId: 'CLAUDE' }, { roomId: 'worker', modelId: 'CODEX' }])
    groups.setOrchestrator(group.id, 'lead-room')
    groups.setOrchestratorDirection(group.id, '先問清楚目標，再派單。')
    const first = groups.reserveRoster(group.id, 'lead-room')!
    assert.match(first.suffix, /先問清楚目標/)
    assert.match(first.suffix, /^ ===== 我哋而家係協作狀態/)
    first.finish(true)
    assert.equal(groups.reserveRoster(group.id, 'lead-room'), undefined, 'already told, nothing more is added')
    groups.setOrchestratorDirection(group.id, '改為：先睇證據。')
    const again = groups.reserveRoster(group.id, 'lead-room')!
    assert.match(again.suffix, /先睇證據/)
    assert.doesNotMatch(again.suffix, /Session ID/, 'only the direction, the roster was already shared')
    groups.setMemberRole(group.id, 'worker', { custom: 'Helper' }); groups.setMemberDirection(group.id, 'worker', '只做實作。', 'helper')
    assert.equal(groups.reserveRoster(group.id, 'worker'), undefined, 'a member gets its direction in its tickets, not here')
    assert.equal(groups.get(group.id)!.orchestratorDirection, '改為：先睇證據。', 'the direction belongs to the seat and is saved with the group')
    groups.setOrchestratorDirection(group.id, '')
    assert.equal(groups.get(group.id)!.orchestratorDirection, undefined)
    assert.throws(() => groups.setOrchestratorDirection(group.id, '❤️ x'), /無效/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a role the Founder once named Debug himself is read as the Debug preset, and the lead\'s old role can come off and hands its direction to the seat', async () => {
  const { savedGroupRole } = await import('../src/types/groupRoles')
  assert.deepEqual(savedGroupRole({ key: 'debug', label: 'Debug', direction: '先諗' }), { key: 'debug', direction: '先諗' })
  assert.equal(savedGroupRole({ key: 'review', label: 'Review' }), undefined, 'other presets with a label are still invalid')
  const dir = await mkdtemp(join(tmpdir(), 'lead-old-role-'))
  try {
    const rooms = new Map<string, TerminalRoom>()
    const mk = (id: string, n: number) => { rooms.set(id, { id, modelId: 'CLAUDE', roomName: id, sessionId: `d004ec38-66f9-45a6-8c19-00000000000${n}` } as unknown as TerminalRoom) }
    mk('lead-room', 1); mk('other', 2)
    const groups = new Groups(join(dir, 'g.json'), () => {}, id => rooms.get(id))
    const group = groups.create('G', [{ roomId: 'lead-room', modelId: 'CLAUDE' }, { roomId: 'other', modelId: 'CLAUDE' }])
    groups.setOrchestrator(group.id, 'lead-room')
    groups.setMemberRole(group.id, 'lead-room', { custom: '統括' })
    groups.setMemberDirection(group.id, 'lead-room', '分配工作。', '統括')
    groups.setMemberRole(group.id, 'lead-room', null)
    const after = groups.get(group.id)!
    assert.equal(after.members.find(member => member.roomId === 'lead-room')!.role, undefined)
    assert.equal(after.orchestratorDirection, '分配工作。', 'the direction moved to the seat')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cybersecurity is a preset role: its names resolve to it, and an older custom record of it is read as the preset', () => {
  assert.ok(groupRolePresets.includes('cybersecurity'))
  for (const alias of ['cybersecurity', 'Cyber Security', '資安', 'セキュリティ']) assert.equal(groupRoleKey(alias), 'cybersecurity', alias)
  assert.deepEqual(groupRoleFromChoice({ preset: 'cybersecurity' }), { key: 'cybersecurity' })
  assert.deepEqual(savedGroupRole({ key: 'cybersecurity', label: 'Cybersecurity', direction: '先睇權限' }), { key: 'cybersecurity', direction: '先睇權限' })
  assert.equal(savedGroupRole({ key: 'cybersecurity', label: 'Something else' }), undefined, 'a preset key with another label is still refused')
})
