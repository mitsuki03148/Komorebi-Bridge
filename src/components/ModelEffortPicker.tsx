import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cpu, Gauge } from 'lucide-react';
import type { CharacterProfile, EffortLevel, TerminalRoom } from '../types/guild';
import { barModelName, shortModelName } from '../utils/roomUi';
import { useT } from '../i18n/useLang';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const allEfforts: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export function ModelEffortPicker({ room, character, kind, onSend, mobile = false, disabled = false }: {
  room: TerminalRoom; character: CharacterProfile; kind: 'model' | 'effort';
  onSend: (roomId: string, command: string, mobile?: boolean) => void; mobile?: boolean; disabled?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [, setViewportTick] = useState(0);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    // Keep the fixed mobile menu above the software keyboard as the visual viewport changes.
    const viewport = window.visualViewport;
    if (!open || !mobile || !viewport) return;
    const update = () => setViewportTick(value => value + 1);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [open, mobile]);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); }, [room.id]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

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
  const choose = (command: string) => { setOpen(false); onSend(room.id, command, mobile); };
  const buttonClass = `flex items-center gap-1.5 min-w-0 max-w-full rounded-full text-[#6E5D52] dark:text-[#B5BED6] transition-[transform,background-color] duration-150 hover:bg-white/80 dark:hover:bg-[#27304D] active:scale-95 ${mobile ? 'min-h-8 px-1.5 py-1 text-[10px] sm:px-2' : 'min-h-8 px-2.5 py-1 text-xs'}`;
  const itemClass = 'block w-full px-3 py-2.5 text-left text-xs text-[#4A3E36] dark:text-[#ECE7DF] hover:bg-[#F3ECE1] dark:hover:bg-[#27304D] focus:bg-[#F3ECE1] dark:focus:bg-[#27304D] focus:outline-none';
  return <div ref={root} className="relative min-w-0">
    <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title={disabled ? t('picker.off') : kind === 'model' ? displayModel : room.effortLevel && (room.effortSource === 'session' || !room.live) ? t('picker.effort.last') : t('picker.effort')} onClick={() => setOpen(!open)} className={`${buttonClass} disabled:opacity-50`}>
      {!mobile && (kind === 'model' ? <Cpu className="w-3.5 h-3.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" /> : <Gauge className="w-3.5 h-3.5 shrink-0 text-[#689B73] dark:text-[#8FB897]" />)}
      <span className={`truncate ${kind === 'effort' && room.effortLevel && (room.effortSource === 'session' || !room.live) ? 'opacity-70' : ''}`}>
        {kind === 'model' ? (barModelName(room.modelId, model?.label ?? shortModelName(room.modelId, displayModel)) || t('picker.model')) : (room.effortLevel ?? t('picker.effort.short'))}
      </span>
    </button>
    {open && root.current && createPortal(<div ref={menuRef} role="menu" data-picker-menu aria-label={kind === 'model' ? t('picker.menu.model') : t('picker.menu.effort')}
      // Drawn on the page itself, not inside the bar: a tall composer above the bar sits in a layer of its own and used to cover the menu.
      style={{ position: 'fixed', left: Math.max(12, root.current.getBoundingClientRect().left), bottom: Math.max(8, window.innerHeight - root.current.getBoundingClientRect().top + 8) }}
      className="guild-pop-in origin-bottom-left max-w-[calc(100vw-1.5rem)] z-[80] w-56 max-h-60 overflow-y-auto rounded-2xl border border-[#DFD3C3] dark:border-[#343D5E] bg-[#FFFDF9] dark:bg-[#1B2238] shadow-xl">
      <div className="px-3 py-2 text-[11px] text-[#8D7B6E] dark:text-[#98A3C2]">{kind === 'model' ? t('picker.menu.model') : t('picker.menu.effort')}</div>
      {kind === 'model' && !useNativeModel && options.map(option => <button role="menuitem" type="button" className={itemClass} key={option.id} onClick={() => choose(`/model ${option.id}`)}>{option.label}{model?.id === option.id ? ' ✓' : ''}</button>)}
      {kind === 'model' && room.modelId === 'AGY' && agyFamilies.map(family => <button role="menuitem" type="button" className={itemClass} key={family} onClick={() => choose(`/model ${family}`)}>{familyLabel(family)}{normalize(family) === selected ? ' ✓' : ''}</button>)}
      {kind === 'model' && useNativeModel && <button role="menuitem" type="button" className={itemClass} onClick={() => choose('/model')}>{t('picker.open.model')}</button>}
      {kind === 'effort' && efforts.map(level => <button role="menuitem" type="button" className={itemClass} key={level} onClick={() => choose(`/effort ${level}`)}>{level}{room.effortLevel === level ? ' ✓' : ''}</button>)}
      {kind === 'effort' && efforts.length === 0 && room.modelId !== 'AGY' && <button role="menuitem" type="button" className={itemClass} onClick={() => choose('/effort')}>{t('picker.open.effort')}</button>}
    </div>, document.body)}
  </div>;
}
