import { useT } from '../i18n/useLang';
import { AlertTriangle } from 'lucide-react';
import type { CharacterProfile, CLIModelId } from '../types/guild';
import { fiveHourQuota, formatPct, weeklyQuota } from '../utils/roomUi';
import { burstPetals } from '../utils/petals';
import { WorkingSpark } from './WorkingIndicator';
import { AvatarExpression } from './AvatarExpression';

const clampPct = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;

/** Phone role switcher card: avatar, name, and both quotas (HP = weekly, MP = 5 hours) at a glance. */
export function RoleCard({ character, modelId, active, waiting, work, unread = false, onSelect }: {
  character: CharacterProfile;
  modelId: CLIModelId;
  active: boolean;
  waiting: boolean;
  work?: 'working' | 'stalled';
  unread?: boolean;
  onSelect: () => void;
}) {
  const { t } = useT();
  const hpVal = clampPct(weeklyQuota(character));
  const mpVal = clampPct(fiveHourQuota(character));
  const hp = formatPct(hpVal);
  const mp = formatPct(mpVal);
  return (
    <button
      type="button"
      data-cli={modelId}
      aria-pressed={active}
      aria-label={unread ? t('role.status.unread', { name: character.characterName, hp, mp }) : t('role.status', { name: character.characterName, hp, mp })}
      onClick={event => { if (!active) burstPetals(event.currentTarget, { count: 3 }); onSelect(); }}
      className={`guild-selection px-2 py-1.5 rounded-[18px] border border-[#E5DAC9]/85 dark:border-[#364062]/85 bg-[#FBF8F3]/80 dark:bg-[#192036]/80 backdrop-blur-md text-left flex items-center gap-2 overflow-hidden cursor-pointer disabled:cursor-default transition-all duration-150 ${
        active
          ? 'shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--selection-edge)_55%,transparent),inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-[0_8px_22px_-8px_color-mix(in_srgb,var(--selection-edge)_48%,transparent),inset_0_1px_0_rgba(255,255,255,0.12)]'
          : 'opacity-82 hover:opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
      }`}
    >
      <span className="relative block w-8 h-8 min-[375px]:w-9 min-[375px]:h-9 shrink-0">
        <span
          style={active ? { borderColor: 'var(--selection-edge)' } : undefined}
          className={`relative block h-full w-full overflow-hidden rounded-full border-[1.5px] bg-[#FBF7EF] dark:bg-[#212945] transition-all duration-150 ${
            active
              ? 'shadow-[0_0_12px_-2px_color-mix(in_srgb,var(--selection-edge)_65%,transparent)]'
              : 'border-[#E7DACA] dark:border-[#364062]'
          }`}
        >
          <img src={character.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-contain" />
          <AvatarExpression modelId={modelId} src={character.avatarUrl} working={Boolean(work)} unread={unread} />
        </span>
        {unread && <span aria-hidden="true" className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 h-2.5 w-2.5 rounded-full bg-[#D9828B] ring-1 ring-white dark:ring-[#192036]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-xs font-bold font-display text-[#4A3E36] dark:text-[#ECE7DF] flex items-center gap-0.5 leading-tight">
          <span className="truncate">{character.characterName}</span>
          {work && <WorkingSpark stalled={work === 'stalled'} />}
          {waiting && <AlertTriangle className="w-2.5 h-2.5 text-[#D68631] shrink-0" />}
        </span>
        <span className="mt-0.5 flex flex-col gap-0.5 font-mono text-[9.5px] font-bold tabular-nums leading-[1.1]">
          <span className="block">
            <span className="block truncate text-[#C85A68] dark:text-[#EFA4B2]" title={t('role.weekly')}>HP {hp}</span>
            <span aria-hidden="true" className="mt-[1.5px] block h-[2.5px] w-full overflow-hidden rounded-full bg-[#EADFD3]/70 dark:bg-[#2A324E]/80">
              {hpVal !== undefined && <span className="block h-full rounded-full bg-gradient-to-r from-[#D97786] via-[#E5919B] to-[#F0B4AA] transition-[width] duration-300" style={{ width: `${hpVal}%` }} />}
            </span>
          </span>
          <span className="block">
            <span className="block truncate text-[#5B82A6] dark:text-[#8FB4DB]" title={t('role.fivehour')}>MP {mp}</span>
            <span aria-hidden="true" className="mt-[1.5px] block h-[2.5px] w-full overflow-hidden rounded-full bg-[#EADFD3]/70 dark:bg-[#2A324E]/80">
              {mpVal !== undefined && <span className="block h-full rounded-full bg-gradient-to-r from-[#648EB5] via-[#7CA7CC] to-[#9AC2B8] transition-[width] duration-300" style={{ width: `${mpVal}%` }} />}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
