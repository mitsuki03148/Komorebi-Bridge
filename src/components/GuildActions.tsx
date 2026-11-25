import { useT } from '../i18n/useLang';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { sendFeedback } from '../utils/petals';
import { roleAccent } from '../utils/roleAccent';
import type { CLIModelId } from '../types/guild';
import { ArrowUp, Check, Sparkles } from 'lucide-react';

/**
 * Normal Send icon: a shooting star flying toward the upper-right in a paper-plane triangle silhouette
 * (a bright tilted star head at upper-right with three flared, tapered wing-like comet trails to the lower-left).
 */
function PlaneIcon({ size = 18 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="drop-shadow-[0_1px_1px_rgba(70,25,38,0.22)]">
    {/* Upper-right tilted 4-point star head */}
    <path d="M20.6 3.4 C18.4 6.1 18.3 6.8 20.4 9.8 C17.4 7.7 16.7 7.6 13.8 9.8 C15.9 6.9 15.8 6.2 13.7 3.2 C16.7 5.3 17.4 5.2 20.6 3.4 Z" />
    {/* Center main comet tail + upper and lower wing trails forming a paper-plane triangle silhouette */}
    <path d="M15.4 8.2 Q 9.6 13.2 3.8 19.6" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" />
    <path d="M13.6 6.2 Q 8.4 8.4 3.4 11.8" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" opacity="0.88" />
    <path d="M17.2 10.0 Q 15.0 15.2 11.6 20.2" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" opacity="0.88" />
    <circle cx="7.4" cy="12.2" r="0.8" opacity="0.72" />
  </svg>;
}

/**
 * Mid-turn Steer icon: proportioned like a vertical upward arrow (↑), with a 4-point star replacing the arrowhead at top
 * and a single hand-drawn gently wavy thin tail straight below it.
 */
function ShootingStarIcon({ size = 18 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="drop-shadow-[0_1px_1px_rgba(70,25,38,0.22)]">
    {/* Top star head (in place of the ↑ arrowhead) */}
    <path d="M12 2.1 C12.7 5.2 13.5 6.0 16.6 6.7 C13.5 7.4 12.7 8.2 12 11.3 C11.3 8.2 10.5 7.4 7.4 6.7 C10.5 6.0 11.3 5.2 12 2.1 Z" />
    {/* Single hand-drawn wavy thin vertical stem/tail below the star */}
    <path d="M12 10.6 C 10.1 13.2, 13.9 16.0, 11.6 18.7 Q 11.0 20.0 12.1 21.4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>;
}

export function GuildActionButton({ kind, iconOnly = false, role, steer = false, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind: 'send' | 'approve';
  iconOnly?: boolean;
  /** True when sending while the CLI is actively working (mid-turn steer). */
  steer?: boolean;
  /** The role the message goes to: the send disc takes that role's colour, the same in a single room and a group. */
  role?: CLIModelId;
}) {
  const { t } = useT();
  const press = (event: MouseEvent<HTMLButtonElement>) => { if (kind === 'send' && !props.disabled) sendFeedback(event.currentTarget); props.onClick?.(event); };
  // The icon-only send button in the message box: a layered wax-and-glass disc with a specular top rim, inner cushion, and tactile press travel.
  if (kind === 'send' && iconOnly) {
    return (
      <button type="submit" aria-label={steer ? t('guild.action.steer') : t('guild.action.send')} {...props} onClick={press} data-composer-send data-send-mode={steer ? 'steer' : 'send'} data-send-role={role}
        style={role ? (props.disabled
          ? { backgroundImage: `linear-gradient(135deg, ${roleAccent[role].sendDisabled.from}, ${roleAccent[role].sendDisabled.to})`, boxShadow: 'none' }
          : {
              backgroundImage: `radial-gradient(circle at 30% 22%, rgba(255,255,255,0.34) 0%, transparent 54%), linear-gradient(145deg, ${roleAccent[role].send.from} 0%, ${roleAccent[role].send.to} 100%)`,
              boxShadow: `inset 0 1.5px 1px rgba(255,255,255,0.48), inset 0 -2px 2.5px rgba(55,22,32,0.24), 0 2px 0 rgba(88,42,56,0.22), 0 5px 12px -3px ${roleAccent[role].send.shadow}`,
            })
          : undefined}
        className={`guild-send-disc relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#D88B96] to-[#C2707D] text-white shadow-[0_4px_10px_-4px_rgba(176,92,106,0.6)] transition-[transform,filter,box-shadow,opacity] duration-150 active:translate-y-[1.5px] active:scale-[0.92] enabled:hover:-translate-y-[0.5px] enabled:hover:brightness-[1.04] disabled:from-[#E9DADB] disabled:to-[#E0CFD1] disabled:text-white/85 disabled:shadow-none ${className}`}>
        <span aria-hidden="true" className="guild-send-disc__rim pointer-events-none absolute inset-[1.5px] rounded-full" />
        <span className="guild-action__icon relative inline-flex translate-x-[0.5px] -translate-y-[0.5px]" aria-hidden="true">{steer ? <ShootingStarIcon /> : <PlaneIcon />}</span>
      </button>
    );
  }
  const Icon = kind === 'send' ? ArrowUp : Check;
  return (
    <button type={kind === 'send' ? 'submit' : 'button'} aria-label={iconOnly ? (kind === 'send' ? t('guild.action.send') : t('guild.action.approve')) : undefined} {...props} onClick={press} className={`guild-action guild-action--${kind} ${iconOnly ? 'guild-action--icon-only' : ''} ${className}`}>
      <span className="guild-action__icon" aria-hidden="true"><Icon size={kind === 'send' ? 16 : 13} strokeWidth={kind === 'send' ? 2.4 : 2} /></span>
      {!iconOnly && <span>{children ?? (kind === 'send' ? t('guild.action.send') : t('guild.action.approve'))}</span>}
    </button>
  );
}

/** A round float over the bottom of the conversation: only an arrow, with a small dot when something new came in. */
export function ScrollToLatestButton({ onClick, newMessages }: { onClick: () => void; newMessages?: boolean }) {
  const { t } = useT();
  return <button type="button" onClick={onClick} aria-label={newMessages ? t('guild.scroll.new') : t('guild.scroll.latest')} data-scroll-latest
    className="absolute bottom-full left-1/2 z-20 mb-2 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[#E2D3C1] dark:border-[#364062] bg-[#FFFDF9]/95 dark:bg-[#1B2238]/95 text-[#8C6D58] dark:text-[#C5CDE3] shadow-[0_4px_12px_-4px_rgba(90,70,50,0.35)] dark:shadow-[0_6px_16px_-4px_rgba(0,0,0,0.55)] transition-transform active:scale-90">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
    {newMessages && <span aria-hidden="true" data-new-dot className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border border-white bg-[#E48FA2]" />}
  </button>;
}

/** Stop: same tactile cushion disc & press travel as Send, with a soft role-tinted surface and a hand-drawn stop seal inside. */
export function ComposerStopButton({ onStop, disabled, hidden = false, role }: { onStop: () => void; disabled?: boolean; /** Nothing is running, so there is nothing to stop: the box gets the room back. */ hidden?: boolean; role?: CLIModelId }) {
  const { t } = useT();
  if (hidden) return null;
  const accent = role ? roleAccent[role] : undefined;
  return <button type="button" onClick={onStop} disabled={disabled} aria-label={t('guild.action.stop')} title={t('guild.action.stop')} data-composer-stop data-stop-role={role}
    className="guild-halt-disc group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[transform,filter,box-shadow,opacity] duration-150 active:translate-y-[1.5px] active:scale-[0.92] enabled:hover:-translate-y-[0.5px] disabled:opacity-35">
    <span aria-hidden="true" style={accent ? { backgroundColor: accent.soft } : undefined} className="guild-halt-disc__surface absolute inset-0 rounded-full bg-[#FDECEF]" />
    <span aria-hidden="true" className="guild-send-disc__rim pointer-events-none absolute inset-[1.5px] rounded-full" />
    <svg viewBox="0 0 24 24" width="15" height="15" style={accent ? { color: accent.name } : undefined} className="relative text-[#C46F7F] drop-shadow-[0_1px_0_rgba(255,255,255,0.65)]" fill="currentColor" aria-hidden="true">
      {/* Crisp square stop block (rx=2.2 so corners stay unmistakably square rather than a record dot), with a hand-drawn specular crease and tiny corner star */}
      <rect x="6" y="6" width="12" height="12" rx="2.2" />
      <path d="M8.5 8.8 L 8.5 13.2" fill="none" stroke="rgba(255,252,248,0.6)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M18.2 3.8 C18.45 5.1 18.8 5.45 20.1 5.7 C18.8 5.95 18.45 6.3 18.2 7.6 C17.95 6.3 17.6 5.95 16.3 5.7 C17.6 5.45 17.95 5.1 18.2 3.8 Z" />
    </svg>
  </button>;
}

/**
 * Single 3-state composer primary action button:
 * - Running + no deliverable draft (or blocked from steering) -> Stop
 * - Running + has draft + steerable -> Steer (shooting star)
 * - Idle -> Send (paper plane, disabled when empty/blocked)
 */
export function ComposerActionButton({
  running,
  canInterrupt = true,
  hasDraft,
  blocked,
  pending,
  role,
  onStop,
  title,
}: {
  running: boolean;
  canInterrupt?: boolean;
  hasDraft: boolean;
  blocked?: string;
  pending?: boolean;
  role?: CLIModelId;
  onStop: () => void;
  title?: string;
}) {
  const { t } = useT();
  const canSteer = running && hasDraft && !blocked;
  const showStop = running && canInterrupt && !canSteer && !(pending && hasDraft);
  if (showStop) {
    return <span className="mb-0.5 flex shrink-0"><ComposerStopButton role={role} onStop={onStop} /></span>;
  }
  return (
    <span className="mb-0.5 flex shrink-0">
      <GuildActionButton
        kind="send"
        iconOnly
        role={role}
        steer={canSteer}
        disabled={Boolean(pending) || Boolean(blocked) || !hasDraft}
        title={canSteer ? t('guild.action.steer') : title}
      />
    </span>
  );
}

export function ApprovalSeal() {
  return <span className="guild-seal" aria-hidden="true"><Sparkles size={16} /></span>;
}
