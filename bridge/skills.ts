import { cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Where each CLI looks for its own global skills, under the home folder. */
export const skillTargets = { claude: '.claude/skills', codex: '.codex/skills', agy: '.gemini/config/skills' } as const;
export type SkillCli = keyof typeof skillTargets;
const allClis = Object.keys(skillTargets) as SkillCli[];

export interface SkillEnv { /** The folder that holds the shared skills. */ shared: string; home: string }
export type LinkStatus = 'linked' | 'missing' | 'copy' | 'other' | 'broken';
export interface SkillRow { name: string; description: string; status: Record<SkillCli, LinkStatus> }

const validName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const placeOf = (env: SkillEnv, cli: SkillCli, name: string) => join(env.home, skillTargets[cli], name);

function frontmatter(text: string) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const read = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block)?.[1].trim().replace(/^["']|["']$/g, '');
  return { name: read('name'), description: read('description') };
}

/** The shared skill's name and description, after checking it is a skill every CLI can load. */
async function sharedSkill(env: SkillEnv, name: string) {
  if (!validName.test(name)) throw new Error('技能名稱只可以用英文字母、數字、. _ -，而且不可以以符號開頭。');
  const dir = join(env.shared, name);
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`共用資料夾入面找不到「${name}」：${dir}`);
  const text = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => { throw new Error(`「${name}」缺少 SKILL.md。`); });
  const meta = frontmatter(text);
  if (!meta.name) throw new Error(`「${name}」的 SKILL.md 開頭要有 name。`);
  if (!meta.description) throw new Error(`「${name}」的 SKILL.md 開頭要有 description。`);
  if (meta.name !== name) throw new Error(`「${name}」的資料夾名稱同 SKILL.md 入面的 name（${meta.name}）不一致。`);
  return { dir, description: meta.description };
}

async function statusOf(env: SkillEnv, cli: SkillCli, name: string): Promise<LinkStatus> {
  const path = placeOf(env, cli, name);
  const info = await lstat(path).catch(() => undefined);
  if (!info) return 'missing';
  if (!info.isSymbolicLink()) return 'copy';
  if ((await readlink(path)) !== join(env.shared, name)) return 'other';
  return (await stat(path).catch(() => undefined)) ? 'linked' : 'broken';
}

/** Every skill in the shared folder, and for each CLI whether it is linked, missing, a separate copy, or taken by something else. */
export async function listSkills(env: SkillEnv): Promise<SkillRow[]> {
  const entries = await readdir(env.shared, { withFileTypes: true }).catch(() => []);
  const rows: SkillRow[] = [];
  for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = await readFile(join(env.shared, entry.name, 'SKILL.md'), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const status = {} as Record<SkillCli, LinkStatus>;
    for (const cli of allClis) status[cli] = await statusOf(env, cli, entry.name);
    rows.push({ name: entry.name, description: frontmatter(text).description ?? '', status });
  }
  return rows;
}

export type LinkResult = 'linked' | 'already' | 'conflict';

/** Link a shared skill into each CLI's folder. Whatever is already there that is not this link is left as it is. */
export async function linkSkill(env: SkillEnv, name: string, clis: SkillCli[] = allClis): Promise<{ cli: SkillCli; result: LinkResult; path: string }[]> {
  const { dir } = await sharedSkill(env, name);
  const out: { cli: SkillCli; result: LinkResult; path: string }[] = [];
  for (const cli of clis) {
    const path = placeOf(env, cli, name);
    const status = await statusOf(env, cli, name);
    if (status === 'linked') { out.push({ cli, result: 'already', path }); continue; }
    if (status !== 'missing') { out.push({ cli, result: 'conflict', path }); continue; }
    await mkdir(dirname(path), { recursive: true });
    await symlink(dir, path);
    out.push({ cli, result: 'linked', path });
  }
  return out;
}

export type UnlinkResult = 'removed' | 'kept' | 'none';

/** Remove the links that point at the shared skill. A real folder or another link is kept; the shared skill itself is never touched. */
export async function unlinkSkill(env: SkillEnv, name: string, clis: SkillCli[] = allClis): Promise<{ cli: SkillCli; result: UnlinkResult; path: string }[]> {
  if (!validName.test(name)) throw new Error('技能名稱只可以用英文字母、數字、. _ -，而且不可以以符號開頭。');
  const out: { cli: SkillCli; result: UnlinkResult; path: string }[] = [];
  for (const cli of clis) {
    const path = placeOf(env, cli, name);
    const status = await statusOf(env, cli, name);
    if (status === 'missing') out.push({ cli, result: 'none', path });
    else if (status === 'linked' || status === 'broken') { await rm(path); out.push({ cli, result: 'removed', path }); }
    else out.push({ cli, result: 'kept', path });
  }
  return out;
}

/**
 * Move a skill one CLI has as its own folder into the shared folder, and leave a link in its place.
 * Refuses when the shared folder already has one of that name, so two different copies are never merged or overwritten.
 */
export async function adoptSkill(env: SkillEnv, name: string, from: SkillCli) {
  if (!validName.test(name)) throw new Error('技能名稱只可以用英文字母、數字、. _ -，而且不可以以符號開頭。');
  const source = placeOf(env, from, name);
  const info = await lstat(source).catch(() => undefined);
  if (!info) throw new Error(`${from} 入面找不到「${name}」。`);
  if (info.isSymbolicLink()) throw new Error(`「${name}」在 ${from} 已經是共用（連結）。`);
  if (!info.isDirectory()) throw new Error(`「${name}」不是資料夾。`);
  const target = join(env.shared, name);
  if (await lstat(target).catch(() => undefined)) throw new Error(`共用資料夾已經有「${name}」，不會覆蓋。先自己決定留邊份。`);
  await mkdir(env.shared, { recursive: true });
  try { await rename(source, target); }
  catch { await cp(source, target, { recursive: true, errorOnExist: true }); await rm(source, { recursive: true }); }
  try { await sharedSkill(env, name); }
  catch (error) { await rename(target, source).catch(() => {}); throw error; }
  await symlink(target, source);
  return target;
}
