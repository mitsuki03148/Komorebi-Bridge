// One folder of skills that 響, 光 and 瞳 all use. Each skill lives once, in the shared folder, and each CLI's own skills folder
// holds a link to it, so a change is made in one place.
//
//   komorebi-skills list                           every shared skill, and where it is linked
//   komorebi-skills link <name> [claude|codex|agy]...   link a shared skill (all three CLIs unless some are named)
//   komorebi-skills unlink <name> [claude|codex|agy]... remove the links (the shared skill stays)
//   komorebi-skills adopt <name> <claude|codex|agy>    move that CLI's own skill into the shared folder and link it back
//   komorebi-skills where                          the shared folder and each CLI's skills folder
//
// The shared folder is $KOMOREBI_SKILLS, workspace/skills, or the repository's skills folder.
// Nothing is ever overwritten: a folder or another link that is already in a CLI's skills folder is reported and left alone.
// A CLI loads its skills when a session starts, so a change shows in rooms opened after it.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeConfig } from '../bridge/config';
import { adoptSkill, linkSkill, listSkills, skillTargets, unlinkSkill, type SkillCli } from '../bridge/skills';

const shared = bridgeConfig(process.env, fileURLToPath(new URL('..', import.meta.url))).skills;
const env = { shared, home: homedir() };
const [command, ...rest] = process.argv.slice(2);
const names = Object.keys(skillTargets) as SkillCli[];
const fail = (message: string, code = 1): never => { console.error(message); process.exit(code); };
const usage = (message: string) => fail(`${message}\n用法見 scripts/komorebi-skills.ts 開頭。`, 2);
const clisFrom = (words: string[]) => {
  const bad = words.filter(word => !names.includes(word as SkillCli));
  if (bad.length) usage(`未知嘅 CLI：${bad.join('、')}（只有 ${names.join('、')}）。`);
  return words.length ? words as SkillCli[] : undefined;
};
const label: Record<string, string> = { linked: '已連結', missing: '未連結', copy: '自己有一份', other: '連去別處', broken: '連結壞咗', already: '本來就連咗', conflict: '已有嘢，冇覆蓋', removed: '已移除', kept: '唔係呢個連結，冇郁', none: '冇' };

try {
  if (command === 'where') {
    console.log(`共用資料夾：${shared}`);
    for (const cli of names) console.log(`  ${cli.padEnd(6)} ${join(env.home, skillTargets[cli])}`);
  } else if (command === 'list') {
    const rows = await listSkills(env);
    if (!rows.length) console.log(`共用資料夾入面未有技能：${shared}\n放一個資料夾（入面要有 SKILL.md），或者用 adopt 由某個 CLI 搬過嚟。`);
    for (const row of rows) {
      console.log(`${row.name} — ${row.description}`);
      console.log('  ' + names.map(cli => `${cli}：${label[row.status[cli]]}`).join('　'));
    }
  } else if (command === 'link' || command === 'unlink') {
    const [name, ...clis] = rest;
    if (!name) usage(`${command} 要指明技能名稱。`);
    const results = await (command === 'link' ? linkSkill(env, name, clisFrom(clis)) : unlinkSkill(env, name, clisFrom(clis)));
    for (const item of results) console.log(`${item.cli.padEnd(6)} ${label[item.result]}  ${item.path}`);
    if (results.some(item => item.result === 'conflict')) process.exitCode = 3;
  } else if (command === 'adopt') {
    const [name, from] = rest;
    if (!name || !from) usage('adopt 要指明技能名稱同邊個 CLI（claude／codex／agy）。');
    if (!names.includes(from as SkillCli)) usage(`未知嘅 CLI：${from}。`);
    console.log(`已搬入共用資料夾：${await adoptSkill(env, name, from as SkillCli)}\n之後用 komorebi-skills link ${name} 連結其他 CLI。`);
  } else usage('指令只有 list / link / unlink / adopt / where。');
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }
