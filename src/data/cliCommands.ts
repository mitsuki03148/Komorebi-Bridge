import { t } from '../i18n';
import type { CLIModelId } from '../types/guild';

export interface CLISlashCommandItem {
  cmd: string;
  desc: string;
  tag: string;
  argsHint?: string;
  immediateExecute: boolean;
}

const command = (cmd: string, desc: string, tag: string, argsHint?: string): CLISlashCommandItem =>
  ({ cmd, desc, tag, argsHint, immediateExecute: true });

function createSlashCommands(): Record<CLIModelId, CLISlashCommandItem[]> {
const compact = command('/compact', t('slash.compact.description'), 'Context');
const model = command('/model', t('slash.model.description'), t('slash.model.tag'));
const effort = command('/effort', t('slash.effort.description'), t('slash.effort.tag'), 'low | medium | high | xhigh | max');
const resume = command('/resume', t('slash.resume.description'), t('slash.resume.tag'));
const clear = command('/clear', t('slash.clear.description'), t('slash.clear.tag'));
const status = command('/status', t('slash.status.description'), t('slash.status.tag'));
const config = command('/config', t('slash.config.description'), t('slash.config.tag'));
const permissions = command('/permissions', t('slash.permissions.description'), t('slash.permissions.tag'));
const diff = command('/diff', t('slash.diff.description'), 'Git');
const review = command('/review', t('slash.review.description'), 'Review');
const rc = command('/rc', t('slash.remote.description'), 'Remote Control');

return {
  AGY: [
    compact, model, effort, resume, clear, config, permissions,
    command('/usage', t('slash.usage.agy'), t('slash.usage.quota')), rc,
    command('/help', t('slash.help.description'), t('slash.help.tag')),
  ],
  CODEX: [
    compact, model, { ...effort, desc: t('slash.effort.codex'), argsHint: 'low | medium | high | xhigh | max | ultra' },
    status, diff, review, resume, permissions,
    { ...command('/rc', t('slash.remote.codex'), 'Remote Control', 'on | off'), immediateExecute: false },
    { ...clear, desc: t('slash.clear.codex') },
    command('/app', t('slash.app.description'), 'Mac App'),
    command('/usage', t('slash.usage.codex'), t('slash.usage.tag')),
  ],
  CLAUDE: [
    compact, model, effort, status, diff, review, resume, clear, config, permissions,
    { ...rc, desc: t('slash.remote.claude') },
    command('/usage', t('slash.usage.claude'), t('slash.usage.tag')),
    command('/limit-reset', t('slash.reset.claude'), 'Reset'),
    command('/cost', t('slash.cost.description'), t('slash.cost.tag')),
    command('/doctor', t('slash.doctor.description'), t('slash.doctor.tag')),
  ],
};
}

// Build on access so changing language never freezes the first language loaded.
export const CLI_SLASH_COMMANDS: Record<CLIModelId, CLISlashCommandItem[]> = {
  get AGY() { return createSlashCommands().AGY; },
  get CODEX() { return createSlashCommands().CODEX; },
  get CLAUDE() { return createSlashCommands().CLAUDE; },
};

export function matchSlashCommands(modelId: CLIModelId, draft: string) {
  const query = draft.trimStart().toLowerCase();
  if (!query.startsWith('/') || /\s/.test(query)) return [];
  return CLI_SLASH_COMMANDS[modelId].filter(item => item.cmd.includes(query) || item.desc.toLowerCase().includes(query.slice(1)));
}

export const CLAUDE_USAGE_URL = 'https://claude.ai/settings/usage';
