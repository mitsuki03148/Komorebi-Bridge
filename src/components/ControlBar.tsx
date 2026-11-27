// Contents
// - Build shared controls
// - Show context use
// - Render the composer controls

import type { ReactNode } from 'react';
import { useT } from '../i18n/useLang';
import { FlaskConical, Minimize2, TerminalSquare, Zap } from 'lucide-react';
import type { CharacterProfile, TerminalRoom } from '../types/guild';
import { burstPetals } from '../utils/petals';
import { roleAccent } from '../utils/roleAccent';
import { fiveHourQuota, formatPct, weeklyQuota } from '../utils/roomUi';
import { RibbonTipBloom } from './BotanicalAccents';
import { ModelEffortPicker } from './ModelEffortPicker';
import { PermissionButton } from './PermissionButton';

// Build shared controls
// The composer and room toolbar share button styling and press feedback.
export const controlButtonClass = 'inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-mono sm:px-2 text-[#7D6A5E] dark:text-[#A4AECC] ' +
  'transition-[transform,background-color,color] duration-120 hover:bg-white/80 dark:hover:bg-[#27304D] active:scale-[0.94] active:bg-[#F3ECE1]/85 dark:active:bg-[#202741] disabled:opacity-45 disabled:active:scale-100';

export function ControlGroup({ children, label, title, className = '' }: { children: ReactNode; label?: string; title?: string; className?: string }) {
  return <div role="group" aria-label={label} title={title} className={`guild-liquid-glass relative inline-flex min-w-0 items-center gap-0.5 rounded-full border p-0.5 ${className}`}>{children}</div>;
}

export function ControlButton({ icon, children, label, title, pressed, accent, disabled, onClick, petals = true }: {
  icon: ReactNode; children?: ReactNode; label: string; title?: string; pressed?: boolean;
  accent?: { name: string; wash: string }; disabled?: boolean; onClick?: () => void; petals?: boolean;
}) {
  return <button type="button" aria-label={label} title={title ?? label} aria-pressed={pressed} disabled={disabled}
    style={pressed && accent ? { color: accent.name } : undefined}
    onClick={event => { if (petals) burstPetals(event.currentTarget, { count: 3 }); onClick?.(); }}
    className={controlButtonClass}>{icon}{children}</button>;
}

// Show context use
// The ring and tooltip use the same clamped percentage.
/** The share used, kept between 0 and 100; undefined when it is not known. */
export const contextShare = (pct: number | null | undefined) => typeof pct === 'number' && Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : undefined;

const tokenText = (value: number) => value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(2)}M` : `${Math.round(value / 1_000)}k`;
/** "148k / 510k（29%）" with the real numbers when the record gives them, else just the share. */
export function contextLabel(room: { contextUsagePct?: number | null; contextTokens?: number; contextWindow?: number }) {
  const share = contextShare(room.contextUsagePct);
  if (share === undefined) return '';
  return room.contextTokens && room.contextWindow ? `${tokenText(room.contextTokens)} / ${tokenText(room.contextWindow)}（${share}%）` : `${share}%`;
}

export function ContextRing({ pct }: { pct: number | null | undefined }) {
  const share = contextShare(pct);
  const known = share !== undefined;
  const used = share ?? 0;
  const radius = 8.5, circumference = 2 * Math.PI * radius;
  return <span data-context-ring={known ? used : 'unknown'} data-context-level={!known ? undefined : used >= 85 ? 'full' : used >= 70 ? 'high' : 'ok'}
    className={`relative inline-flex h-[22px] w-[22px] items-center justify-center ${known && used >= 85 ? 'guild-ring-alert' : ''}`}>
    <svg viewBox="0 0 22 22" width="22" height="22" className="absolute inset-0 -rotate-90" aria-hidden="true">
      <circle cx="11" cy="11" r={radius} fill="none" stroke="#E8DDD0" strokeWidth="2" className="dark:stroke-[#313958]" />
      {known && <circle cx="11" cy="11" r={radius} fill="none" stroke={used >= 85 ? '#D9667A' : used >= 70 ? '#D68631' : '#8FB596'} strokeWidth="2" strokeLinecap="round"
        strokeDasharray={`${(circumference * used) / 100} ${circumference}`} />}
    </svg>
    <Minimize2 className="h-2.5 w-2.5 text-[#7F9A82] dark:text-[#96BD9F]" aria-hidden="true" />
  </span>;
}

// Render the composer controls
// The phone and group dock fill their available width while the desktop bar can wrap.
export function ControlBar({ room, character, mobile = false, hideRoomControls = false, dock = false, onCommand, settingsDisabled, compact, terminal, shield, cli, quota, note }: {
  room: TerminalRoom;
  character: CharacterProfile;
  mobile?: boolean;
  /** When true (phone B2 split), room-level controls (terminal, shield, CLI) live up in the room bar so model & effort have plenty of space. */
  hideRoomControls?: boolean;
  /** When true, renders as a frameless full-width strip integrated into the frosted bottom dock (no second stacked bubble). */
  dock?: boolean;
  /** Sends a command (a model or effort change) to the room. */
  onCommand: (roomId: string, text: string) => void;
  settingsDisabled?: boolean;
  compact: { disabled?: boolean; title: string; onRun: () => void };
  terminal: { open: boolean; onToggle: () => void };
  shield: { disabled?: boolean; autoMode?: boolean; onMode?: (auto: boolean) => void; onPermissions: () => void };
  /** The CLI start / stop / remote-control controls, where the screen has them. */
  cli?: ReactNode;
  quota?: { label: string; title?: string; onClick: () => void };
  note?: string;
}) {
  const { t } = useT();
  const accent = roleAccent[room.modelId];
  const hpPct = contextShare(weeklyQuota(character));
  const mpPct = contextShare(fiveHourQuota(character));
  const hp = formatPct(hpPct);
  const mp = formatPct(mpPct);
  // The quota frame shows weekly HP on top and five-hour MP below.
  if (hideRoomControls || dock) {
    const hpStop = hpPct ?? 0;
    const mpStop = mpPct ?? 0;
    return <div className="flex w-full min-w-0 flex-col gap-1 text-[10px] font-mono">
      <div
        role="group"
        aria-label={t('bottombar.controls')}
        title={t('bottombar.quota.title', { name: character.characterName, hp, mp })}
        className="relative w-full min-w-0 rounded-full p-[1.5px] shadow-[0_-2px_12px_-3px_rgba(217,119,134,0.38),0_2px_12px_-3px_rgba(100,142,181,0.34)] dark:shadow-[0_-3px_16px_-2px_rgba(240,164,182,0.52),0_3px_16px_-2px_rgba(143,180,219,0.5)]"
      >
        <span
          aria-hidden="true"
          data-hp-mp={`${hp}/${mp}`}
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            clipPath: 'inset(0 0 50% 0)',
            background: hpPct !== undefined
              ? `linear-gradient(to right, #D97786 0%, #F4B4C6 ${hpStop}%, rgba(160,150,175,0.22) ${hpStop}%)`
              : 'rgba(160,150,175,0.22)',
          }}
        >
          {hpPct !== undefined && <span data-hp-bar={Math.round(hpPct)} className="sr-only bg-[#D97786]" style={{ width: `${hpPct}%` }} />}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            clipPath: 'inset(50% 0 0 0)',
            background: mpPct !== undefined
              ? `linear-gradient(to right, #648EB5 0%, #A9D4F5 ${mpStop}%, rgba(160,150,175,0.22) ${mpStop}%)`
              : 'rgba(160,150,175,0.22)',
          }}
        >
          {mpPct !== undefined && <span data-mp-bar={Math.round(mpPct)} className="sr-only bg-[#648EB5]" style={{ width: `${mpPct}%` }} />}
        </span>
        <div className="relative flex w-full min-w-0 items-center justify-between gap-1 rounded-full bg-[#FFFDF9]/92 px-1.5 py-0.5 backdrop-blur-md dark:bg-[#151B2E]/94">
          <div className="flex min-w-0 items-center gap-1">
            <ModelEffortPicker room={room} character={character} kind="model" onSend={onCommand} mobile={mobile} disabled={settingsDisabled} />
            <ModelEffortPicker room={room} character={character} kind="effort" onSend={onCommand} mobile={mobile} disabled={settingsDisabled} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {room.modelId === 'CODEX' && (
              <ControlButton icon={<Zap size={14} aria-hidden="true" className={room.fastMode ? 'fill-current' : undefined} />} label={t('bottombar.fast.label')} pressed={room.fastMode === true} accent={accent}
                title={room.fastMode ? t('bottombar.fast.on') : t('bottombar.fast.off')}
                disabled={settingsDisabled || !room.ready} onClick={() => onCommand(room.id, '/fast')} />
            )}
            <ControlButton icon={<ContextRing pct={room.contextUsagePct} />} label={t('bottombar.compact.label')}
              title={contextShare(room.contextUsagePct) === undefined ? compact.title : t('bottombar.compact.usage', { title: compact.title, usage: contextLabel(room) })}
              disabled={compact.disabled} onClick={compact.onRun}>
              {contextShare(room.contextUsagePct) !== undefined && room.contextTokens ? <span data-context-tokens className="text-[10px] font-semibold tabular-nums text-[#8A7B6E] dark:text-[#C5CDE3]">{tokenText(room.contextTokens)}</span> : null}
            </ControlButton>
            {!hideRoomControls && <>
              <span aria-hidden="true" data-divider className="mx-0.5 h-3.5 w-px shrink-0 bg-[#E3D8CB] dark:bg-[#313958]" />
              <ControlButton icon={<TerminalSquare size={14} aria-hidden="true" />} label={t('bottombar.terminal')} pressed={terminal.open} accent={accent} onClick={terminal.onToggle} />
              <PermissionButton room={room} disabled={shield.disabled} autoMode={shield.autoMode} onMode={shield.onMode} onPermissions={shield.onPermissions} className={controlButtonClass} />
              {cli}
            </>}
            {quota && <ControlButton icon={<FlaskConical className="h-3.5 w-3.5 text-[#C98592] dark:text-[#EFA4B2]" aria-hidden="true" />} label={t('bottombar.quota.label')} title={quota.title ?? t('bottombar.quota.label')} onClick={quota.onClick}>
              <span className="font-bold text-[#B8707E] dark:text-[#EFA4B2]">{quota.label}</span>
            </ControlButton>}
          </div>
        </div>
      </div>
      {note && <span className="self-center text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]">{note}</span>}
    </div>;
  }

  return <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-mono">
    <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-1.5">
    <ControlGroup label={t('bottombar.controls')} title={t('bottombar.quota.title', { name: character.characterName, hp, mp })}>
      <span aria-hidden="true" data-hp-mp={`${hp}/${mp}`} className="pointer-events-none absolute inset-x-3.5 top-0 h-[3px] overflow-visible rounded-full">
        <span className="block h-full w-full overflow-hidden rounded-full bg-[#EADFD3]/70 dark:bg-[#313958]/70">
          {hpPct !== undefined && <span data-hp-bar={Math.round(hpPct)} className="block h-full rounded-full bg-[#D97786] bg-gradient-to-r from-[#D97786] via-[#E5919B] to-[#F0B4AA] transition-[width] duration-300" style={{ width: `${hpPct}%` }} />}
        </span>
        {hpPct !== undefined && <RibbonTipBloom kind="hp" pct={hpPct} />}
      </span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-3.5 bottom-0 h-[3px] overflow-visible rounded-full">
        <span className="block h-full w-full overflow-hidden rounded-full bg-[#EADFD3]/70 dark:bg-[#313958]/70">
          {mpPct !== undefined && <span data-mp-bar={Math.round(mpPct)} className="block h-full rounded-full bg-[#648EB5] bg-gradient-to-r from-[#648EB5] via-[#76A0C4] to-[#8FB8A4] transition-[width] duration-300" style={{ width: `${mpPct}%` }} />}
        </span>
        {mpPct !== undefined && <RibbonTipBloom kind="mp" pct={mpPct} />}
      </span>
      <ModelEffortPicker room={room} character={character} kind="model" onSend={onCommand} mobile={mobile} disabled={settingsDisabled} />
      <ModelEffortPicker room={room} character={character} kind="effort" onSend={onCommand} mobile={mobile} disabled={settingsDisabled} />
      {room.modelId === 'CODEX' && (
        <ControlButton icon={<Zap size={14} aria-hidden="true" className={room.fastMode ? 'fill-current' : undefined} />} label={t('bottombar.fast.label')} pressed={room.fastMode === true} accent={accent}
          title={room.fastMode ? t('bottombar.fast.on') : t('bottombar.fast.off')}
          disabled={settingsDisabled || !room.ready} onClick={() => onCommand(room.id, '/fast')} />
      )}
      <ControlButton icon={<ContextRing pct={room.contextUsagePct} />} label={t('bottombar.compact.label')}
        title={contextShare(room.contextUsagePct) === undefined ? compact.title : t('bottombar.compact.usage', { title: compact.title, usage: contextLabel(room) })}
        disabled={compact.disabled} onClick={compact.onRun}>
        {contextShare(room.contextUsagePct) !== undefined && room.contextTokens ? <span data-context-tokens className="text-[10px] font-semibold tabular-nums text-[#8A7B6E] dark:text-[#C5CDE3]">{tokenText(room.contextTokens)}</span> : null}
      </ControlButton>
      {!hideRoomControls && <>
        <span aria-hidden="true" data-divider className="mx-0.5 h-4 w-px shrink-0 bg-[#E3D8CB] dark:bg-[#313958]" />
        <ControlButton icon={<TerminalSquare size={14} aria-hidden="true" />} label={t('bottombar.terminal')} pressed={terminal.open} accent={accent} onClick={terminal.onToggle} />
        <PermissionButton room={room} disabled={shield.disabled} autoMode={shield.autoMode} onMode={shield.onMode} onPermissions={shield.onPermissions} className={controlButtonClass} />
        {cli}
      </>}
      {quota && <ControlButton icon={<FlaskConical className="h-3.5 w-3.5 text-[#C98592] dark:text-[#EFA4B2]" aria-hidden="true" />} label={t('bottombar.quota.label')} title={quota.title ?? t('bottombar.quota.label')} onClick={quota.onClick}>
        <span className="font-bold text-[#B8707E] dark:text-[#EFA4B2]">{quota.label}</span>
      </ControlButton>}
    </ControlGroup>
    </div>
    {note && <span className="self-center text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]">{note}</span>}
  </div>;
}
