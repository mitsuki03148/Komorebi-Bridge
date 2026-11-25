import type { Lang } from './index';
import type { CharacterProfile, CLIModelId } from '../types/guild';

const EN_NAMES: Record<CLIModelId, string> = {
  AGY: 'Hitomi',
  CODEX: 'Hikaru',
  CLAUDE: 'Hibiki',
};

const ZH_NAMES: Record<CLIModelId, string> = {
  AGY: '瞳',
  CODEX: '光',
  CLAUDE: '響',
};

/** Returns the character's localized display name (`Hitomi`/`Hikaru`/`Hibiki` in English; `瞳`/`光`/`響` in Chinese & Japanese). */
export function localizeCharacterName(modelId: CLIModelId, currentName: string, lang: Lang): string {
  if (lang === 'en') {
    return currentName === ZH_NAMES[modelId] || currentName === EN_NAMES[modelId]
      ? EN_NAMES[modelId]
      : currentName;
  }
  return currentName === EN_NAMES[modelId] ? ZH_NAMES[modelId] : currentName;
}

/** Returns a shallow-copied character map with localized `characterName` values for the active UI language. */
export function localizeCharacters(
  characters: Record<CLIModelId, CharacterProfile>,
  lang: Lang,
): Record<CLIModelId, CharacterProfile> {
  return {
    AGY: { ...characters.AGY, characterName: localizeCharacterName('AGY', characters.AGY.characterName, lang) },
    CODEX: { ...characters.CODEX, characterName: localizeCharacterName('CODEX', characters.CODEX.characterName, lang) },
    CLAUDE: { ...characters.CLAUDE, characterName: localizeCharacterName('CLAUDE', characters.CLAUDE.characterName, lang) },
  };
}

/** Localizes a speaker/handoff party label such as `光` or `光 · R5` when shown in English. */
export function localizePartyLabel(label: string, lang: Lang): string {
  if (lang !== 'en') return label;
  return label.replace(/^(瞳|光|響)(?=$| · |\s)/, (_, name: string) =>
    name === '瞳' ? 'Hitomi' : name === '光' ? 'Hikaru' : 'Hibiki',
  );
}

/** Localizes the "工作台" label, completion prefix, and CLI status lines in system capsules. */
export function localizeWorkbenchLabel(text: string, lang: Lang): string {
  if (lang === 'en') {
    if (text === '已離開房間 · CLI 已結束' || text === '已離開房間，CLI 已結束') return 'Left the room · CLI stopped';
    if (text === 'CLI 已結束') return 'CLI stopped';
    const exited = /^CLI 已結束（(.+)）$/.exec(text);
    if (exited) return `CLI stopped (${exited[1]})`;
    return text
      .replace(/^工作台 #(\d+) 完成：/, 'WorkBench #$1 completed: ')
      .replace(/工作台/g, 'WorkBench')
      .replace(/^(WorkBench #\d+ completed: )(瞳|光|響)(?= · |\s)/, (_, prefix: string, name: string) =>
        `${prefix}${name === '瞳' ? 'Hitomi' : name === '光' ? 'Hikaru' : 'Hibiki'}`,
      );
  }
  if (lang === 'ja') {
    if (text === '已離開房間 · CLI 已結束' || text === '已離開房間，CLI 已結束') return 'ルームを退出 · CLI 終了';
    if (text === 'CLI 已結束') return 'CLI 終了';
    const exited = /^CLI 已結束（(.+)）$/.exec(text);
    if (exited) return `CLI 終了（${exited[1]}）`;
    return text
      .replace(/^工作台 #(\d+) 完成：/, '作業卓 #$1 完了：')
      .replace(/工作台/g, '作業卓');
  }
  return text;
}
