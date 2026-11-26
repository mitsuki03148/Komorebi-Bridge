/** Wire/storage keys stay stable across interface languages. */
export const groupRolePresets = ['implement', 'review', 'debug', 'art-copy', 'native-test', 'clerk', 'cybersecurity', 'fund-manager', 'economist', 'behavioural-analyst', 'quant-researcher', 'trading-strategist', 'risk-manager', 'trader', 'independent-auditor'] as const;
export type GroupRolePreset = typeof groupRolePresets[number];
export const groupRoleCategories = [
  { key: 'engineering', roles: ['implement', 'review', 'debug', 'art-copy', 'native-test', 'clerk', 'cybersecurity'] },
  { key: 'investment', roles: ['fund-manager', 'economist', 'behavioural-analyst', 'quant-researcher', 'trading-strategist', 'risk-manager', 'trader', 'independent-auditor'] },
  { key: 'media', roles: [] },
  { key: 'finance', roles: [] },
  { key: 'general', roles: [] },
] as const satisfies readonly { key: string; roles: readonly GroupRolePreset[] }[];
export type GroupMemberRole = { key: string; label?: string; direction?: string };
export const groupRoleDirectionMax = 300;
export const groupRoleDirectionLines = 6;

/** Newlines are allowed; other control and formatting characters are stripped on input. */
export function normalizeRoleDirection(value: unknown): string | undefined {
  // Hearts and presentation selectors are reserved as direction-block delimiters.
  // Check before stripping format controls, so a disguised delimiter is never silently altered.
  if (typeof value !== 'string' || Array.from(value).length > groupRoleDirectionMax || /[\u2764\ufe0e\ufe0f]/u.test(value.normalize('NFKC'))) return;
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ch => ch === '\n' ? '\n' : '');
  if (normalized.split('\n').length > groupRoleDirectionLines) return;
  return normalized.trim() ? normalized : '';
}

export type GroupRoleChoice = { preset: GroupRolePreset } | { custom: string } | null;

const aliases = new Map<string, GroupRolePreset>([
  ['implementation', 'implement'], ['實作', 'implement'], ['実装', 'implement'],
  ['審查', 'review'], ['レビュー', 'review'],
  ['debugger', 'debug'], ['除錯', 'debug'], ['デバッグ', 'debug'],
  ['debug & refactor', 'debug'], ['除錯重構', 'debug'], ['デバッグ・リファクタ', 'debug'],
  ['art copy', 'art-copy'], ['美術文案', 'art-copy'], ['デザイン・文案', 'art-copy'],
  ['native test', 'native-test'], ['ネイティブテスト', 'native-test'],
  ['文員', 'clerk'], ['事務', 'clerk'],
  ['cyber security', 'cybersecurity'], ['資安', 'cybersecurity'], ['セキュリティ', 'cybersecurity'],
]);

export const isGroupRolePreset = (value: unknown): value is GroupRolePreset =>
  typeof value === 'string' && groupRolePresets.some(key => key === value);

function roleName(value: unknown) {
  if (typeof value !== 'string' || value.length > 256 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return;
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (Array.from(name).length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} -]*$/u.test(name)) return;
  return name;
}

/** A complete preset or custom name, never a partial match or the reserved @orchestrator. */
export function groupRoleKey(value: unknown) {
  if (typeof value !== 'string' || value.length > 256 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return;
  const key = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if (key === 'orchestrator') return;
  return aliases.get(key) ?? (isGroupRolePreset(key) ? key : roleName(key));
}

export function groupRoleFromChoice(value: unknown): GroupMemberRole | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return;
  if ('preset' in value && isGroupRolePreset(value.preset)) return { key: value.preset };
  if ('custom' in value) {
    const key = groupRoleKey(value.custom);
    if (!key) return;
    if (isGroupRolePreset(key)) return { key };
    const label = roleName(value.custom);
    if (label) return { key, label };
  }
}

/** Only canonical records are accepted; malformed optional metadata does not invalidate group membership. */
export function savedGroupRole(value: unknown): GroupMemberRole | undefined {
  if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' || Array.isArray(value)) return;
  const keys = Object.keys(value);
  if (keys.some(key => !['key', 'label', 'direction'].includes(key))) return;
  const direction = 'direction' in value ? normalizeRoleDirection(value.direction) : '';
  if (direction === undefined || ('direction' in value && direction !== value.direction)) return;
  if (isGroupRolePreset(value.key)) {
    // An investment key may already exist as a custom role in an older group.
    if (groupRoleCategories[1].roles.some(key => key === value.key) && 'label' in value && typeof value.label === 'string'
      && roleName(value.label) === value.label && groupRoleKey(value.label) === value.key) {
      return { key: value.key, label: value.label, ...(direction ? { direction } : {}) };
    }
    // 'debug' used to be a custom role the Founder named himself (key debug, label Debug). It is a preset now, so that record is read as the preset.
    // 'cybersecurity' was a custom role too (key cybersecurity, label Cybersecurity) before it became a preset.
    if ('label' in value && !((value.key === 'debug' || value.key === 'cybersecurity') && typeof value.label === 'string' && value.label.toLowerCase() === value.key)) return;
    return { key: value.key, ...(direction ? { direction } : {}) };
  }
  if (!('label' in value) || typeof value.label !== 'string') return;
  const role = groupRoleFromChoice({ custom: value.label });
  if (role?.key === value.key && role?.label === value.label) return { ...role, ...(direction ? { direction } : {}) };
}
