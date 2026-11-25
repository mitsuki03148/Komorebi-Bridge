import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useLang';
import { ShieldCheck } from 'lucide-react';
import type { TerminalRoom } from '../types/guild';
import { autoModeLabel } from '../utils/launchMode';
import { burstPetals } from '../utils/petals';
import { roleAccent } from '../utils/roleAccent';
import { useConfirm } from './ConfirmDialog';

/**
 * The shield button. Where the Bridge can remember a room's permission mode it opens a small menu
 * (switch the no-approval mode, or open the CLI's own /permissions); otherwise it just opens /permissions.
 */
export function PermissionButton({ room, autoMode, onMode, onPermissions, disabled, className }: {
  room: TerminalRoom;
  autoMode?: boolean;
  onMode?: (auto: boolean) => void;
  onPermissions: () => void;
  disabled?: boolean;
  className: string;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8 });
  const root = useRef<HTMLSpanElement>(null);
  const menuAvailable = Boolean(onMode) && autoMode !== undefined;
  useEffect(() => { setOpen(false); }, [room.id, room.live]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const label = room.modelId === 'AGY' ? autoModeLabel(room.modelId) : t('bottombar.permission.auto');
  const on = autoMode === true;
  const toggleOpen = () => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 248));
      setPlace(rect.top > window.innerHeight / 2 ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
    }
    setOpen(value => !value);
  };
  const change = async () => {
    setOpen(false);
    if (room.live) {
      const ok = await confirm({
        title: t('confirm.title.permission'),
        message: t('bottombar.permission.confirm', { mode: on ? t('bottombar.permission.return') : label }),
        confirmLabel: t('confirm.action.switch'),
        tone: 'warn',
      });
      if (!ok) return;
    }
    onMode?.(!on);
    // Switching on is the moment worth a few petals.
    if (!on && root.current) burstPetals(root.current, { count: 5 });
  };

  if (!menuAvailable) {
    return <button type="button" aria-label={t('bottombar.permission.title')} title={t('bottombar.permission.title')} disabled={disabled} onClick={onPermissions} className={className}><ShieldCheck size={14} /></button>;
  }
  return (
    <span ref={root} className="inline-flex shrink-0">
      <button type="button" aria-label={t('bottombar.permission.state.aria', { label, state: on ? t('bottombar.permission.on') : t('bottombar.permission.off') })} title={t('bottombar.permission.state', { label, state: on ? t('bottombar.permission.on') : t('bottombar.permission.off') })} aria-haspopup="menu" aria-expanded={open}
        onClick={toggleOpen} style={on ? { color: roleAccent[room.modelId].name } : undefined} className={className}><ShieldCheck size={14} /></button>
      {open && (
        <div role="menu" style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom }}
          className="guild-pop-in origin-bottom z-50 flex w-60 flex-col gap-1 rounded-2xl border border-[#DFD3C3] dark:border-[#343D5E] bg-[#FFFDF9] dark:bg-[#1B2238] p-2 text-[11px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF] shadow-xl">
          <button type="button" role="menuitemcheckbox" aria-checked={on} onClick={change} className="rounded-xl px-3 py-2 text-left hover:bg-[#F3ECE1] dark:hover:bg-[#27304D]">
            {on ? t('bottombar.permission.menu.on', { label }) : t('bottombar.permission.menu.off', { label })}
            <span className="mt-0.5 block text-[10px] font-normal text-[#7D6D61]">{room.live ? t('bottombar.permission.remember.live') : t('bottombar.permission.remember')}</span>
          </button>
          <button type="button" role="menuitem" disabled={!room.live || disabled} onClick={() => { setOpen(false); onPermissions(); }}
            className="rounded-xl px-3 py-2 text-left hover:bg-[#F3ECE1] disabled:opacity-50">{t('bottombar.permission.open')}</button>
        </div>
      )}
    </span>
  );
}
