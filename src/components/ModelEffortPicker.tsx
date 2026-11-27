// Contents
// - Normalize model names and label effort levels
// - Keep the picker menu in sync
// - Find the options for this room
// - Choose a model with a tap or a slide
// - Choose an effort level on the track
// - Place and render the picker

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cpu, Gauge, Sparkles } from 'lucide-react';
import type { CharacterProfile, EffortLevel, TerminalRoom } from '../types/guild';
import { barModelName, shortModelName } from '../utils/roomUi';
import { useT } from '../i18n/useLang';

// Normalize model names and label effort levels
// CLI model names can arrive with different case and punctuation.
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const allEfforts: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const effortShort: Record<EffortLevel, string> = {
  low: 'low',
  medium: 'med',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'ultra',
};

// Keep the picker menu in sync
// Room changes, disabled controls and outside input can close the menu.
export function ModelEffortPicker({ room, character, kind, onSend, mobile = false, disabled = false }: {
  room: TerminalRoom; character: CharacterProfile; kind: 'model' | 'effort';
  onSend: (roomId: string, command: string) => void; mobile?: boolean; disabled?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);
  const [dragEffortIndex, setDragEffortIndex] = useState<number | null>(null);
  const [, setViewportTick] = useState(0);

  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const hoveredCmdRef = useRef<string | null>(null);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { setOpen(false); setHoveredCmd(null); setDragEffortIndex(null); }, [room.id]);

  useEffect(() => {
    // Keep the fixed mobile menu above the software keyboard as the visual viewport changes.
    const viewport = window.visualViewport;
    if (!open || !mobile || !viewport) return;
    const update = () => setViewportTick(value => value + 1);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [open, mobile]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  // Find the options for this room
  // Each CLI reports model names and supported efforts in its own format.
  const displayModel = room.modelId === 'CLAUDE'
    ? room.selectedSubModel.replace(/\s+and saved as your default\b.*$/i, '')
    : room.selectedSubModel;
  const selected = normalize(displayModel);
  const options = character.modelOptions ?? [];
  const model = options.find(option => [option.id, option.label].some(value => normalize(value) === selected ||
    (room.modelId === 'CLAUDE' && selected.startsWith(normalize(value)))));

  let efforts: EffortLevel[] = [];
  if (room.modelId === 'CODEX') efforts = model?.efforts ?? [];
  if (room.modelId === 'CLAUDE' && /(?:opus|sonnet|haiku|fable)/i.test(room.selectedSubModel)) {
    efforts = allEfforts.filter(level => level !== 'ultra' && (level !== 'xhigh' || !/4\.6/.test(room.selectedSubModel)));
  }
  if (room.modelId === 'AGY') {
    efforts = allEfforts.filter(level => character.availableSubModels.some(id =>
      id.endsWith(`-${level}`) && normalize(id.slice(0, -(level.length + 1))) === selected));
  }

  // AGY: each room has its own model, so the menu is ours (the CLI's own /model would change every room).
  const agyFamilies = room.modelId === 'AGY'
    ? [...new Set(character.availableSubModels.map(id => id.replace(/-(?:low|medium|high|xhigh|max)$/, '')))]
    : [];
  const familyLabel = (family: string) => family.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const useNativeModel = room.modelId !== 'AGY' && options.length === 0;

  // Choose a model with a tap or a slide
  // Sending a choice clears the gesture state for either picker.
  const choose = (command: string) => {
    setOpen(false);
    setHoveredCmd(null);
    hoveredCmdRef.current = null;
    setDragEffortIndex(null);
    onSend(room.id, command);
  };

  // Hold-and-slide gesture for Model picker (keeps normal tap-to-open intact).
  const handleModelPointerDown = (downEvent: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || kind !== 'model' || open) return;
    if (downEvent.pointerType === 'mouse' && downEvent.button !== 0) return;

    const startX = downEvent.clientX;
    const startY = downEvent.clientY;
    let holdOpened = false;

    const hitTestOption = (x: number, y: number): string | null => {
      const menu = menuRef.current;
      if (!menu) return null;
      const buttons = menu.querySelectorAll<HTMLButtonElement>('[data-model-option]');
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (x >= rect.left - 10 && x <= rect.right + 10 && y >= rect.top && y <= rect.bottom) {
          return btn.dataset.cmd ?? null;
        }
      }
      return null;
    };

    const activateHold = () => {
      if (holdOpened) return;
      holdOpened = true;
      setOpen(true);
    };

    const holdTimer = window.setTimeout(activateHold, 160);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = startY - moveEvent.clientY;
      if (!holdOpened && (dy > 10 || Math.hypot(dx, dy) > 14)) {
        window.clearTimeout(holdTimer);
        activateHold();
      }
      if (holdOpened) {
        const hit = hitTestOption(moveEvent.clientX, moveEvent.clientY);
        if (hit !== hoveredCmdRef.current) {
          hoveredCmdRef.current = hit;
          setHoveredCmd(hit);
        }
      }
    };

    const cleanup = () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    const onUp = (upEvent: PointerEvent) => {
      cleanup();
      if (!holdOpened) return;
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      const finalHit = hitTestOption(upEvent.clientX, upEvent.clientY) ?? hoveredCmdRef.current;
      if (finalHit) {
        choose(finalHit);
      } else {
        setOpen(false);
        setHoveredCmd(null);
        hoveredCmdRef.current = null;
      }
    };

    const onCancel = () => {
      cleanup();
      if (holdOpened) {
        setOpen(false);
        setHoveredCmd(null);
        hoveredCmdRef.current = null;
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // Choose an effort level on the track
  // Dragging previews a stop and releasing sends that effort to the room.
  const currentEffortIdx = Math.max(0, efforts.findIndex(level => level === room.effortLevel));
  const activeEffortIdx = dragEffortIndex ?? (room.effortLevel ? currentEffortIdx : 0);
  const effortPct = efforts.length > 1 ? (activeEffortIdx / (efforts.length - 1)) * 100 : 100;

  const indexFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || efforts.length <= 1) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(ratio * (efforts.length - 1));
  };

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (efforts.length === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragEffortIndex(indexFromClientX(event.clientX));
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragEffortIndex === null) return;
    setDragEffortIndex(indexFromClientX(event.clientX));
  };

  const handleTrackPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragEffortIndex === null) return;
    const finalIdx = indexFromClientX(event.clientX);
    const chosen = efforts[finalIdx];
    setDragEffortIndex(finalIdx);
    if (chosen) {
      window.setTimeout(() => choose(`/effort ${chosen}`), 85);
    } else {
      setDragEffortIndex(null);
    }
  };

  // Place and render the picker
  // The menu follows the trigger but renders above the composer.
  const menuWidth = kind === 'effort' && efforts.length > 0 ? 256 : 232;
  const anchorRect = open && root.current ? root.current.getBoundingClientRect() : null;
  const menuLeft = anchorRect
    ? Math.max(12, Math.min(anchorRect.left, window.innerWidth - menuWidth - 12))
    : 12;
  const menuBottom = anchorRect
    ? Math.max(8, window.innerHeight - anchorRect.top + 10)
    : 56;

  const buttonClass = `group flex items-center gap-1 min-w-0 max-w-full rounded-full transition-all duration-150 active:scale-95 select-none ${
    open
      ? 'bg-[#FCF0F4]/95 text-[#7A3851] ring-1 ring-[#E4B8C7]/85 shadow-[0_0_12px_-2px_rgba(217,130,139,0.45)] dark:bg-[#2E223A]/95 dark:text-[#F7C6D6] dark:ring-[#F0A4B6]/65 dark:shadow-[0_0_14px_-2px_rgba(240,164,182,0.5)]'
      : 'text-[#6E5D52] dark:text-[#DCE2F2] hover:bg-white/80 dark:hover:bg-[#27304D]'
  } ${mobile ? 'min-h-7 px-2 py-0.5 text-[10.5px] sm:px-2.5' : 'min-h-8 px-2.5 py-1 text-xs'}`;

  const modelOptionList: { id: string; label: string; cmd: string; active: boolean }[] = kind === 'model'
    ? room.modelId === 'AGY'
      ? [
          ...options.map(option => ({ id: option.id, label: option.label, cmd: `/model ${option.id}`, active: model?.id === option.id })),
          ...agyFamilies.map(family => ({ id: `agy-${family}`, label: familyLabel(family), cmd: `/model ${family}`, active: normalize(family) === selected })),
        ]
      : !useNativeModel
        ? options.map(option => ({ id: option.id, label: option.label, cmd: `/model ${option.id}`, active: model?.id === option.id }))
        : []
    : [];

  return <div ref={root} className="relative min-w-0">
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      title={disabled ? t('picker.off') : kind === 'model' ? displayModel : room.effortLevel && (room.effortSource === 'session' || !room.live) ? t('picker.effort.last') : t('picker.effort')}
      style={kind === 'model' ? { touchAction: 'none' } : undefined}
      onPointerDown={handleModelPointerDown}
      onClick={() => {
        if (suppressClickRef.current) return;
        setOpen(prev => !prev);
      }}
      className={`${buttonClass} disabled:opacity-50`}
    >
      {!mobile && (kind === 'model' ? <Cpu className="w-3.5 h-3.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" /> : <Gauge className="w-3.5 h-3.5 shrink-0 text-[#689B73] dark:text-[#8FB897]" />)}
      <span className={`truncate font-medium ${kind === 'effort' && room.effortLevel && (room.effortSource === 'session' || !room.live) ? 'opacity-70' : ''}`}>
        {kind === 'model' ? (barModelName(room.modelId, model?.label ?? shortModelName(room.modelId, displayModel)) || t('picker.model')) : (room.effortLevel ?? t('picker.effort.short'))}
      </span>
      <ChevronDown className={`h-2.5 w-2.5 shrink-0 opacity-55 transition-transform duration-150 ${open ? 'rotate-180 opacity-90' : ''}`} aria-hidden="true" />
    </button>

    {open && root.current && createPortal(<div ref={menuRef} role="menu" data-picker-menu aria-label={kind === 'model' ? t('picker.menu.model') : t('picker.menu.effort')}
      // Drawn on the page itself, not inside the bar: a tall composer above the bar sits in a layer of its own and used to cover the menu.
      style={{ position: 'fixed', left: menuLeft, bottom: menuBottom, width: menuWidth }}
      className="guild-pop-in origin-bottom-left max-w-[calc(100vw-1.5rem)] z-[80] max-h-72 overflow-y-auto rounded-[22px] border border-[#E7C2CF]/85 bg-[#FFFDF9]/95 p-1.5 shadow-[0_18px_40px_-10px_rgba(74,62,54,0.24),0_0_20px_-4px_rgba(217,130,139,0.28),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl dark:border-[#F0A4B6]/45 dark:bg-[#192036]/94 dark:shadow-[0_20px_44px_-12px_rgba(0,0,0,0.68),0_0_26px_-4px_rgba(240,164,182,0.38),inset_0_1px_0_rgba(255,255,255,0.1)]">

      {kind === 'model' && (
        <>
          <div className="mb-1 flex items-center justify-between border-b border-[#EFE6DA]/80 px-2.5 pb-1.5 pt-1 dark:border-[#2B3350]/80">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[#8D7B6E] dark:text-[#A4AECC]">
              <Sparkles className="h-3 w-3 text-[#D47A92] dark:text-[#EFA4B2]" aria-hidden="true" />
              {t('picker.menu.model')}
            </span>
          </div>
          <div className="space-y-0.5">
            {modelOptionList.map(opt => {
              const isHovered = hoveredCmd === opt.cmd;
              return (
                <button
                  key={opt.id}
                  role="menuitem"
                  type="button"
                  data-model-option
                  data-cmd={opt.cmd}
                  onClick={() => choose(opt.cmd)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-all duration-120 active:scale-[0.98] focus:outline-none ${
                    isHovered
                      ? 'scale-[1.01] bg-[#F9E3EB] text-[#7A3851] shadow-2xs ring-1 ring-[#E4B8C7] dark:bg-[#382948] dark:text-[#F8D6E3] dark:ring-[#78547D]'
                      : opt.active
                        ? 'bg-[#FCF0F4] text-[#7A3851] ring-1 ring-[#EAD0DA]/80 dark:bg-[#2A2136] dark:text-[#F4C4D4] dark:ring-[#5E4564]/80'
                        : 'text-[#4A3E36] hover:bg-[#F5EFE6]/90 dark:text-[#ECE7DF] dark:hover:bg-[#252D49]'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.active && (
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#C86475]/15 text-[#A24D6D] dark:bg-[#EFA4B2]/20 dark:text-[#F4C4D4]">
                      <Check className="h-2.5 w-2.5" aria-hidden="true" />
                    </span>
                  )}
                </button>
              );
            })}
            {useNativeModel && (
              <button role="menuitem" type="button" onClick={() => choose('/model')}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-medium text-[#4A3E36] transition hover:bg-[#F5EFE6] dark:text-[#ECE7DF] dark:hover:bg-[#252D49]">
                {t('picker.open.model')}
              </button>
            )}
          </div>
        </>
      )}

      {kind === 'effort' && efforts.length > 0 && (
        <div className="px-2.5 py-2">
          <div className="mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#C87B9B] dark:text-[#EFA4B2]" aria-hidden="true" />
            <span className="text-[11.5px] font-semibold tracking-wide text-[#7D6A5E] dark:text-[#C5CDE3]">
              {t('picker.menu.effort')}
            </span>
          </div>

          <div
            ref={trackRef}
            data-effort-slider
            style={{ touchAction: 'none' }}
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
            onPointerCancel={() => setDragEffortIndex(null)}
            className="relative mx-2 flex h-7 cursor-pointer items-center select-none"
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFE5DA] shadow-inner dark:bg-[#272F4B]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#E8C5D0] via-[#D47A92] to-[#9E5278] transition-[width] duration-100 dark:from-[#8C84B8] dark:via-[#C97C9F] dark:to-[#F0A8BE]"
                style={{ width: `${effortPct}%` }}
              />
            </div>

            {efforts.map((level, index) => {
              const pos = efforts.length > 1 ? (index / (efforts.length - 1)) * 100 : 100;
              const passed = index <= activeEffortIdx;
              return (
                <span
                  key={level}
                  aria-hidden="true"
                  style={{ left: `${pos}%` }}
                  className={`pointer-events-none absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
                    passed ? 'bg-white/85 dark:bg-[#FFF0F5]/90' : 'bg-[#D6C7B8] dark:bg-[#444F75]'
                  }`}
                />
              );
            })}

            <span
              aria-hidden="true"
              style={{ left: `${effortPct}%` }}
              className={`pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#C86475] bg-white shadow-[0_2px_10px_rgba(200,100,117,0.45)] transition-[left,transform] duration-100 dark:border-[#F4B4C6] dark:bg-[#FFF5F8] dark:shadow-[0_0_16px_rgba(240,164,182,0.72)] ${
                dragEffortIndex !== null ? 'scale-115' : ''
              }`}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-0.5">
            {efforts.map((level, index) => {
              const isSelected = index === activeEffortIdx;
              return (
                <button
                  key={level}
                  role="menuitem"
                  type="button"
                  onClick={() => choose(`/effort ${level}`)}
                  className={`min-w-0 flex-1 rounded-lg py-1 text-center font-mono text-[10.5px] transition-all active:scale-95 ${
                    isSelected
                      ? 'font-bold text-[#8E435F] dark:text-[#F7C6D6]'
                      : 'text-[#968376] hover:text-[#4A3E36] dark:text-[#8E98B8] dark:hover:text-[#ECE7DF]'
                  }`}
                >
                  {effortShort[level] ?? level}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {kind === 'effort' && efforts.length === 0 && room.modelId !== 'AGY' && (
        <button role="menuitem" type="button" onClick={() => choose('/effort')}
          className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-medium text-[#4A3E36] transition hover:bg-[#F5EFE6] dark:text-[#ECE7DF] dark:hover:bg-[#252D49]">
          {t('picker.open.effort')}
        </button>
      )}
    </div>, document.body)}
  </div>;
}
