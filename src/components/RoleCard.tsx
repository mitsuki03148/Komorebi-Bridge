import { useT } from '../i18n/useLang';
import { AlertTriangle } from 'lucide-react';
import type { CharacterProfile, CLIModelId } from '../types/guild';
import { fiveHourQuota, formatPct, weeklyQuota } from '../utils/roomUi';
import { burstPetals } from '../utils/petals';
import { WorkingSpark } from './WorkingIndicator';
import { AvatarExpression } from './AvatarExpression';

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
  const hp = formatPct(weeklyQuota(character));
  const mp = formatPct(fiveHourQuota(character));
  return (
    <button
      type="button"
      data-cli={modelId}
      aria-pressed={active}
      aria-label={unread ? t('role.status.unread', { name: character.characterName, hp, mp }) : t('role.status', { name: character.characterName, hp, mp })}
      onClick={event => { if (!active) burstPetals(event.currentTarget, { count: 3 }); onSelect(); }}
      className="guild-selection px-2 py-1.5 rounded-2xl border border-[#E5DAC9] dark:border-[#313958] bg-[#FBF8F3] dark:bg-[#192036] text-left flex items-center gap-2 overflow-hidden cursor-pointer disabled:cursor-default"
    >
      <span className="relative block w-8 h-8 min-[375px]:w-9 min-[375px]:h-9 shrink-0">
        <span className="relative block h-full w-full overflow-hidden rounded-2xl border border-[#E7DACA] dark:border-[#364062] bg-[#FBF7EF] dark:bg-[#212945]">
          <img src={character.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-2xl object-contain" />
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
        <span className="mt-0.5 flex flex-col font-mono text-[10px] font-bold tabular-nums leading-[1.15]">
          <span className="truncate text-[#C85A68] dark:text-[#EFA4B2]" title={t('role.weekly')}>HP {hp}</span>
          <span className="truncate text-[#5B82A6] dark:text-[#8FB4DB]" title={t('role.fivehour')}>MP {mp}</span>
        </span>
      </span>
    </button>
  );
}
