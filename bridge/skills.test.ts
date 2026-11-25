import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { adoptSkill, linkSkill, listSkills, skillTargets, unlinkSkill, type SkillEnv } from './skills';

async function sandbox(run: (env: SkillEnv, home: string) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'komorebi-skills-')));
  const home = join(base, 'home'), shared = join(base, 'shared');
  await mkdir(home); await mkdir(shared);
  try { await run({ shared, home }, home); } finally { await rm(base, { recursive: true, force: true }); }
}
const skillMd = (name: string, extra = '') => `---\nname: ${name}\ndescription: A skill called ${name}.\n${extra}---\n\n# ${name}\n`;
async function shared(env: SkillEnv, name: string, md = skillMd(name)) {
  await mkdir(join(env.shared, name), { recursive: true });
  await writeFile(join(env.shared, name, 'SKILL.md'), md);
}
const place = (env: SkillEnv, cli: keyof typeof skillTargets, name: string) => join(env.home, skillTargets[cli], name);

test('the three CLIs each have their own global skills folder', () => {
  assert.deepEqual({ ...skillTargets }, { claude: '.claude/skills', codex: '.codex/skills', agy: '.gemini/config/skills' });
});

test('linking a shared skill makes a symlink in every CLI folder, creating a folder that is missing, and doing it twice is harmless', () => sandbox(async env => {
  await shared(env, 'web-guidance');
  const first = await linkSkill(env, 'web-guidance');
  assert.deepEqual(first.map(item => [item.cli, item.result]), [['claude', 'linked'], ['codex', 'linked'], ['agy', 'linked']]);
  for (const cli of ['claude', 'codex', 'agy'] as const) {
    assert.equal(await readlink(place(env, cli, 'web-guidance')), join(env.shared, 'web-guidance'));
    assert.match(await readFile(join(place(env, cli, 'web-guidance'), 'SKILL.md'), 'utf8'), /name: web-guidance/);
  }
  assert.deepEqual((await linkSkill(env, 'web-guidance')).map(item => item.result), ['already', 'already', 'already']);
}));

test('a skill can be linked for some CLIs only', () => sandbox(async env => {
  await shared(env, 'only-codex');
  const done = await linkSkill(env, 'only-codex', ['codex']);
  assert.deepEqual(done.map(item => item.cli), ['codex']);
  await assert.rejects(lstat(place(env, 'claude', 'only-codex')));
}));

test('a real folder or another link that is already there is never overwritten', () => sandbox(async env => {
  await shared(env, 'taken');
  await mkdir(place(env, 'claude', 'taken'), { recursive: true });
  await writeFile(join(place(env, 'claude', 'taken'), 'SKILL.md'), skillMd('taken', 'mine: yes\n'));
  await mkdir(join(env.home, skillTargets.codex), { recursive: true });
  await symlink('/somewhere/else', place(env, 'codex', 'taken'));
  const result = await linkSkill(env, 'taken');
  assert.deepEqual(result.map(item => [item.cli, item.result]), [['claude', 'conflict'], ['codex', 'conflict'], ['agy', 'linked']]);
  assert.match(await readFile(join(place(env, 'claude', 'taken'), 'SKILL.md'), 'utf8'), /mine: yes/);
  assert.equal(await readlink(place(env, 'codex', 'taken')), '/somewhere/else');
}));

test('only a real skill with a name and a description can be linked', () => sandbox(async env => {
  await assert.rejects(linkSkill(env, 'missing'), /共用資料夾/);
  await assert.rejects(linkSkill(env, '../escape'), /名稱/);
  await assert.rejects(linkSkill(env, '.hidden'), /名稱/);
  await mkdir(join(env.shared, 'empty'));
  await assert.rejects(linkSkill(env, 'empty'), /SKILL\.md/);
  await shared(env, 'nameless', '---\ndescription: x\n---\n');
  await assert.rejects(linkSkill(env, 'nameless'), /name/);
  await shared(env, 'wrongname', skillMd('other'));
  await assert.rejects(linkSkill(env, 'wrongname'), /不一致/);
}));

test('unlinking removes only the links that point at the shared skill', () => sandbox(async env => {
  await shared(env, 'x');
  await linkSkill(env, 'x', ['claude', 'codex']);
  await rm(place(env, 'codex', 'x'));
  await mkdir(place(env, 'codex', 'x'), { recursive: true });
  await writeFile(join(place(env, 'codex', 'x'), 'SKILL.md'), skillMd('x'));
  const result = await unlinkSkill(env, 'x');
  assert.deepEqual(result.map(item => [item.cli, item.result]), [['claude', 'removed'], ['codex', 'kept'], ['agy', 'none']]);
  await assert.rejects(lstat(place(env, 'claude', 'x')));
  assert.ok((await lstat(place(env, 'codex', 'x'))).isDirectory(), 'a real folder is left alone');
  assert.ok((await lstat(join(env.shared, 'x', 'SKILL.md'))).isFile(), 'the shared skill itself stays');
}));

test('the list shows, for every shared skill, where it is linked, missing, or taken by something else', () => sandbox(async env => {
  await shared(env, 'a'); await shared(env, 'b');
  await linkSkill(env, 'a');
  await mkdir(place(env, 'codex', 'b'), { recursive: true });
  await writeFile(join(place(env, 'codex', 'b'), 'SKILL.md'), skillMd('b'));
  await mkdir(join(env.shared, '.git'));
  const rows = await listSkills(env);
  assert.deepEqual(rows.map(row => row.name), ['a', 'b']);
  assert.deepEqual(rows[0].status, { claude: 'linked', codex: 'linked', agy: 'linked' });
  assert.deepEqual(rows[1].status, { claude: 'missing', codex: 'copy', agy: 'missing' });
  assert.match(rows[0].description, /A skill called a/);
}));

test('adopting moves one CLI\'s own skill into the shared folder and leaves a link in its place', () => sandbox(async env => {
  await mkdir(place(env, 'claude', 'mine'), { recursive: true });
  await writeFile(join(place(env, 'claude', 'mine'), 'SKILL.md'), skillMd('mine'));
  await writeFile(join(place(env, 'claude', 'mine'), 'notes.md'), 'extra file');
  await adoptSkill(env, 'mine', 'claude');
  assert.equal(await readFile(join(env.shared, 'mine', 'notes.md'), 'utf8'), 'extra file');
  assert.equal(await readlink(place(env, 'claude', 'mine')), join(env.shared, 'mine'));
  await assert.rejects(adoptSkill(env, 'mine', 'claude'), /已經是共用/);
  await mkdir(place(env, 'codex', 'mine'), { recursive: true });
  await writeFile(join(place(env, 'codex', 'mine'), 'SKILL.md'), skillMd('mine'));
  await assert.rejects(adoptSkill(env, 'mine', 'codex'), /共用資料夾已經有/);
  assert.ok((await lstat(place(env, 'codex', 'mine'))).isDirectory(), 'nothing of the other copy is touched');
}));

test('the command-line tool exists and uses the shared folder under the workspace', async () => {
  const wrapper = await readFile(new URL('../scripts/komorebi-skills', import.meta.url), 'utf8');
  assert.match(wrapper, /komorebi-skills\.ts/);
  const script = await readFile(new URL('../scripts/komorebi-skills.ts', import.meta.url), 'utf8');
  assert.match(script, /KOMOREBI_SKILLS|skills/);
  assert.match(script, /listSkills|linkSkill|adoptSkill|unlinkSkill/);
});
