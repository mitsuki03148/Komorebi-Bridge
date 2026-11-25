import type { CharacterProfile, CLIModelId } from '../types/guild';
import { t } from '../i18n';

export const GUILD_HALL_BANNER = '/src/assets/images/komorebi_room_bg_1794406018049.jpg';
export const GUILD_HALL_NIGHT_BANNER = '/avatars/guild-bg-night.webp';
export const PORTRAIT_URLS: Record<CLIModelId, string> = {
  AGY: '/avatars/hitomi-bust.webp',
  CODEX: '/avatars/hikaru-bust.webp',
  CLAUDE: '/avatars/hibiki-bust.webp',
};

/** Translate the built-in hint at render time while preserving Bridge-provided hints. */
export function quotaHint(character: CharacterProfile) {
  const keys = { AGY: 'quota.hint.agy', CODEX: 'quota.hint.codex', CLAUDE: 'quota.hint.claude' } as const;
  return character.hp5h.resetCommandHint === INITIAL_CHARACTERS[character.id].hp5h.resetCommandHint
    ? t(keys[character.id])
    : character.hp5h.resetCommandHint;
}

export const INITIAL_CHARACTERS: Record<'AGY' | 'CODEX' | 'CLAUDE', CharacterProfile> = {
  AGY: {
    id: 'AGY',
    characterName: '瞳',
    japaneseRomaji: 'Hitomi',
    roleTitle: 'Antigravity',
    genderBadge: '',
    cliToolName: 'AGY (Antigravity)',
    avatarUrl: PORTRAIT_URLS.AGY,
    themeColorHex: '#E07A86',
    availableSubModels: [],
    hp5h: {
      current: null,
      usedPercent: null,
      resetVouchers: null,
      resetCommandHint: '用 /usage 查各模型配額',
    },
    mpWeekly: {
      current: null,
      usedPercent: null,
      resetDayText: '—',
      tokensUsed: '—',
      tokensLimit: '—',
    },
    localSync: {
      cliStateDir: '~/.gemini/antigravity/brain',
      appSupportDir: '~/.gemini/antigravity-cli/brain',
      syncedFilesCount: 0,
      lastSyncedAt: '—',
      syncStatus: 'watching',
      latestSyncedFile: '—',
    },
    remoteCommand: 'agy --remote-control',
    companionAppName: 'AGY Brain Sync & Tailscale Web',
    quotes: {
      waiting_approval: 'CLI 等待你確認。',
      running: 'CLI 運作中。',
      idle: '隨時準備好接收新任務～',
    },
    usageHistory: [],
  },
  CODEX: {
    id: 'CODEX',
    characterName: '光',
    japaneseRomaji: 'Hikaru',
    roleTitle: 'OpenAI Codex',
    genderBadge: '',
    cliToolName: 'Codex CLI & Mac App',
    avatarUrl: PORTRAIT_URLS.CODEX,
    themeColorHex: '#6B9372',
    availableSubModels: [],
    hp5h: {
      current: null,
      usedPercent: null,
      resetVouchers: null,
      resetCommandHint: '用 /status 查額度 · /usage 兌換 Earned Reset',
    },
    mpWeekly: {
      current: null,
      usedPercent: null,
      resetDayText: '—',
      tokensUsed: '—',
      tokensLimit: '—',
    },
    localSync: {
      cliStateDir: '~/.codex/sessions',
      appSupportDir: '~/Library/Application Support/Codex',
      syncedFilesCount: 0,
      lastSyncedAt: '—',
      syncStatus: 'watching',
      latestSyncedFile: '—',
    },
    remoteCommand: 'codex app .',
    companionAppName: 'Codex Mac App (/app) & ChatGPT iOS',
    quotes: {
      waiting_approval: 'CLI 等待你確認。',
      running: 'CLI 運作中。',
      idle: '筆記已經整理好，隨時待命。',
    },
    usageHistory: [],
  },
  CLAUDE: {
    id: 'CLAUDE',
    characterName: '響',
    japaneseRomaji: 'Hibiki',
    roleTitle: 'Claude Code',
    genderBadge: '',
    cliToolName: 'Claude Code CLI',
    avatarUrl: PORTRAIT_URLS.CLAUDE,
    themeColorHex: '#6B8EB8',
    availableSubModels: [],
    hp5h: {
      current: null,
      usedPercent: null,
      resetVouchers: null,
      resetCommandHint: '用 /usage 查額度 · Settings → Usage 兌換 Reset',
    },
    mpWeekly: {
      current: null,
      usedPercent: null,
      resetDayText: '—',
      tokensUsed: '—',
      tokensLimit: '—',
    },
    localSync: {
      cliStateDir: '~/.claude/projects',
      appSupportDir: '~/Library/Application Support/Claude',
      syncedFilesCount: 0,
      lastSyncedAt: '—',
      syncStatus: 'watching',
      latestSyncedFile: '—',
    },
    remoteCommand: 'claude --remote-control',
    companionAppName: 'Claude iOS App / claude.ai/code',
    quotes: {
      waiting_approval: 'CLI 等待你確認。',
      running: 'CLI 運作中。',
      idle: '古籍索引已同步完成，隨時可以 claude --resume。',
    },
    usageHistory: [],
  },
};
