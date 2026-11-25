import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { CLIModelId } from '../types/guild';

/** Soft petals and twinkles shown while a CLI is working on the last prompt. */
export function WorkingIndicator({ modelId, name, elapsed, stalled, background, onShowTerminal }: {
  modelId: CLIModelId; name: string; elapsed?: string;
  /** The CLI is waiting on background tasks (shells, terminals) it started. */
  background?: boolean;
  /** How long the screen has been unchanged, when that suggests the CLI may be stuck. */
  stalled?: string;
  onShowTerminal?: () => void;
}) {
  const { t } = useT();
  // The "may be stuck" card can be closed; it stays closed for this stretch and comes back the next time the room stalls.
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (!stalled) setClosed(false); }, [stalled]);
  if (stalled && closed) return null;
  if (stalled) return (
    <div role="status" aria-live="polite" data-cli={modelId} className="guild-working guild-working--stalled">
      <span aria-hidden="true">⚠</span>
      <span className="guild-working__text">{t('working.stalled', { name, stalled })}</span>
      {onShowTerminal && <button type="button" onClick={onShowTerminal} className="guild-working__action">{t('working.terminal')}</button>}
      <button type="button" aria-label={t('working.dismiss')} title={t('working.dismiss')} onClick={() => setClosed(true)} className="guild-working__close"><X aria-hidden="true" /></button>
    </div>
  );
  return (
    <div role="status" aria-live="polite" data-cli={modelId} className="guild-working">
      <span className="guild-working__bloom" aria-hidden="true">
        <Petal className="guild-working__petal" />
        <Twinkle className="guild-working__star" />
        <Petal className="guild-working__petal guild-working__petal--small" />
        <Twinkle className="guild-working__star guild-working__star--late" />
      </span>
      <span className="guild-working__text">{elapsed ? t(background ? 'working.background.elapsed' : 'working.active.elapsed', { name, elapsed }) : t(background ? 'working.background' : 'working.active', { name })}</span>
    </div>
  );
}

const organicPetals: readonly [number, string][] = [
  [0, 'M10 9.4 C7.1 8.1 6.5 3.6 8.9 1.6 C9.6 1.2 10 1.9 10 2.3 C10 1.9 10.5 1.2 11.2 1.6 C13.5 3.5 12.9 8.1 10 9.4 Z'],
  [71, 'M10 9.4 C7.3 8.2 6.8 3.9 9.0 1.9 C9.6 1.5 10 2.1 10 2.4 C10 2.1 10.4 1.5 11.0 1.9 C13.2 3.8 12.7 8.2 10 9.4 Z'],
  [145, 'M10 9.4 C7.0 8.0 6.6 3.5 8.8 1.5 C9.5 1.1 10 1.8 10 2.2 C10 1.8 10.5 1.1 11.2 1.5 C13.4 3.5 13.0 8.0 10 9.4 Z'],
  [215, 'M10 9.4 C7.2 8.2 6.7 3.8 9.0 1.8 C9.6 1.4 10 2.0 10 2.3 C10 2.0 10.4 1.4 11.0 1.8 C13.3 3.8 12.8 8.2 10 9.4 Z'],
  [289, 'M10 9.4 C7.1 8.1 6.5 3.7 8.9 1.7 C9.6 1.3 10 1.9 10 2.3 C10 1.9 10.5 1.3 11.1 1.7 C13.5 3.7 12.9 8.1 10 9.4 Z'],
];

function Petal({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className}>
      {organicPetals.map(([angle, d]) => (
        <path key={angle} d={d} transform={`rotate(${angle} 10 10)`} />
      ))}
      <circle cx="9.8" cy="9.9" r="2.05" className="guild-working__heart" />
      <circle cx="11.1" cy="9.2" r="0.7" fill="#FFFDF7" opacity="0.85" />
    </svg>
  );
}

function Twinkle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className}>
      <path d="M10 1.5 C10.9 7 13 9.1 18.5 10 C13 10.9 10.9 13 10 18.5 C9.1 13 7 10.9 1.5 10 C7 9.1 9.1 7 10 1.5 Z" />
    </svg>
  );
}

/** A single small twinkle marking a room whose CLI is working; amber and still when it may be stuck. */
export function WorkingSpark({ stalled = false, background = false }: { stalled?: boolean; background?: boolean }) {
  const { t } = useT();
  return (
    <span className={`guild-spark${stalled ? ' guild-spark--stalled' : ''}`} role="img" aria-label={stalled ? t('working.stalled.short') : t(background ? 'working.background.short' : 'working.active.short')}>
      <Twinkle className="guild-spark__star" />
    </span>
  );
}
