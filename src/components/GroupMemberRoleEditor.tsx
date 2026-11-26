import { useState } from 'react';
import { ChevronDown, ChevronRight, Tag } from 'lucide-react';
import { groupRoleIcons } from './groupRoleIcons';
import type { I18nKey } from '../i18n';
import { useT } from '../i18n/useLang';
import { groupRoleFromChoice, groupRoleCategories, isGroupRolePreset, groupRoleDirectionMax, groupRoleDirectionLines, normalizeRoleDirection, type GroupMemberRole, type GroupRoleChoice, type GroupRolePreset } from '../types/groupRoles';
import { focusScope } from '../utils/focusScope';
import { useEscape } from '../utils/roomUi';
import { showWhenKeyboardOpens, useKeyboardViewport } from '../utils/useKeyboardViewport';

export const memberRoleLabel = (role: GroupMemberRole | undefined, t: (key: I18nKey) => string) =>
  role?.label ?? (role && isGroupRolePreset(role.key) ? t(`group.memberRole.${role.key}`) : t('group.memberRole.none'));

export function GroupMemberRoleAction({ onEdit, role }: { role?: GroupMemberRole; onEdit?: () => void }) {
  const { t } = useT();
  if (!onEdit) return null;
  const label = memberRoleLabel(role, t);
  return <button type="button" onClick={onEdit} data-group-member-role-edit
    className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99]">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F7F1E8] dark:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6]">
      <Tag size={14} aria-hidden="true" />
    </span>
    <span className="shrink-0 text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('group.memberRole.edit')}</span>
    <span className="min-w-0 flex-1 truncate text-right text-xs font-semibold text-[#8C7A6E] dark:text-[#98A3C2]" title={label}>{label}</span>
  </button>;
}

export function GroupMemberRoleEditor({ roomName, role, pending, error, onClose, onSave, directionSupported, leadRole, onClearLeadRole }: {
  roomName: string;
  role?: GroupMemberRole;
  /** The lead's own old role (set before the lead had a seat of its own), which can be taken off. */
  leadRole?: GroupMemberRole;
  onClearLeadRole?: () => void;
  pending: boolean;
  directionSupported?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (choice: GroupRoleChoice, direction?: string) => void;
}) {
  const { t } = useT();
  const [selection, setSelection] = useState<GroupRolePreset | 'none' | 'custom'>(
    role ? isGroupRolePreset(role.key) ? role.key : 'custom' : 'none');
  const [expanded, setExpanded] = useState<string[]>(() => {
    const category = groupRoleCategories.find(group => group.roles.some(key => key === role?.key));
    return category ? [category.key] : [];
  });
  const [name, setName] = useState(role?.label ?? '');
  const [direction, setDirection] = useState(role?.direction ?? '');
  // The lead's seat is its own role: the crown makes it, nothing is chosen, only the direction is written.
  const lead = role?.key === 'orchestrator';
  const choice: GroupRoleChoice = selection === 'none' ? null : selection === 'custom' ? { custom: name } : { preset: selection };
  const parsed = lead ? role : groupRoleFromChoice(choice);
  const valid = parsed !== undefined;
  const sameRole = lead || (parsed === null ? !role : Boolean(parsed && role && parsed.key === role.key && parsed.label === role.label));
  const normalizedDirection = normalizeRoleDirection(direction);
  const directionCount = Array.from(direction).length;
  const directionValid = normalizedDirection !== undefined;
  const directionDirty = Boolean(parsed) && (normalizedDirection === undefined || normalizedDirection !== (role?.direction ?? ''));
  const canSave = valid && (!directionSupported || !parsed || directionValid) && (!sameRole || (directionSupported && directionDirty));
  useEscape(true, onClose);
  const area = useKeyboardViewport();
  const field = 'w-full min-h-11 rounded-xl border border-[#E4D8C8] bg-white px-3 text-[16px] sm:text-sm text-[#4A3E36] placeholder:text-[#A39286] transition-colors focus-visible:border-[#A24D6D] focus-visible:outline-2 focus-visible:outline-[#A24D6D]/35 dark:border-[#313B5C] dark:bg-[#13192B] dark:text-[#ECE7DF] dark:placeholder:text-[#7783A3] dark:focus-visible:border-[#D489A4] dark:focus-visible:outline-[#D489A4]/35';
  const HeaderIcon = !lead && selection !== 'none' && selection !== 'custom' ? groupRoleIcons[selection] : Tag;
  const radioDot = (checked: boolean) => (
    <span aria-hidden="true" className={checked
      ? 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#A24D6D] bg-[#A24D6D] shadow-[0_1px_4px_rgba(162,77,109,0.35)] transition-colors dark:border-[#D489A4] dark:bg-[#B86A87]'
      : 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#D5C5B5] bg-white/80 transition-colors dark:border-[#465175] dark:bg-[#161D31]'}>
      {checked && <span className="h-1.5 w-1.5 rounded-full bg-[#FFFDF9]" />}
    </span>
  );
  const rowTone = (checked: boolean) => checked
    ? 'bg-[#FCF0F4] ring-1 ring-inset ring-[#E9C4D2] dark:bg-[#2A2136] dark:ring-[#754E66]/70'
    : 'hover:bg-[#F3ECE2]/85 dark:hover:bg-[#1B233B]';
  // With the keyboard open, the sheet takes only the free part of the screen and scrolls inside it.
  return <div className="guild-backdrop-in fixed inset-x-0 z-[85] flex items-end justify-center bg-[#3A2E27]/28 p-4 backdrop-blur-xs dark:bg-[#090C16]/70 sm:items-center"
    style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="member-role-title" onSubmit={event => { event.preventDefault(); if (!pending && canSave) onSave(choice, directionSupported ? (parsed ? normalizedDirection : '') : undefined); }}
      style={area ? { maxHeight: Math.max(220, area.height - 32) } : undefined}
      className="guild-sheet-in max-h-[85dvh] w-full max-w-sm sm:max-w-[460px] space-y-3.5 overflow-y-auto rounded-[28px] border border-[#E7DAC9] bg-[#FFFDF9] p-4 sm:p-5 text-[#4A3E36] shadow-[0_20px_50px_-20px_rgba(74,62,54,0.25)] dark:border-[#2E3756] dark:bg-[#171D31] dark:text-[#ECE7DF] dark:shadow-[0_24px_60px_-20px_rgba(4,7,18,0.75)]">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FCF0F4] text-[#9F4E6B] ring-1 ring-inset ring-[#EED2DC] dark:bg-[#2E223A] dark:text-[#EBB3C6] dark:ring-[#563D55]">
          {lead ? <span className="text-base leading-none">♛</span> : <HeaderIcon size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="member-role-title" className="font-display text-base font-bold leading-tight">{t('group.memberRole.edit')}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="break-words text-sm text-[#6E5D52] dark:text-[#A9B4D0]">{roomName}</span>
            {parsed && !lead && <span className="inline-flex items-center rounded-full border border-[#EBD2DC] bg-[#FCF2F5] px-2 py-0.5 font-mono text-[11px] font-medium text-[#8C455F] break-all dark:border-[#4D374C] dark:bg-[#2A2034] dark:text-[#EAB6C8]">@{parsed.key}</span>}
          </div>
        </div>
      </div>
      {lead && leadRole && onClearLeadRole && <div className="flex items-center gap-2 rounded-2xl border border-[#E7DAC9] bg-[#FAF6EF] px-3 py-2 text-xs dark:border-[#313B5C] dark:bg-[#141A2C]">
        <span className="min-w-0 flex-1">{t('group.memberRole.leadOldRole', { role: memberRoleLabel(leadRole, t) })}</span>
        <button type="button" disabled={pending} onClick={onClearLeadRole} className="min-h-9 shrink-0 rounded-full border border-[#E2D6C5] bg-white px-3 font-semibold hover:bg-[#FAF5EE] dark:border-[#364062] dark:bg-[#1E253D] dark:hover:bg-[#262F4D]">{t('group.memberRole.leadOldRoleRemove')}</button>
      </div>}
      {lead && <p className="rounded-2xl border border-[#EBD2DC] bg-[#FCF2F5] px-3.5 py-2.5 text-sm font-bold text-[#7A3851] dark:border-[#4D374C] dark:bg-[#2A2034] dark:text-[#F0BFD0]">♛ {t('group.memberRole.orchestrator')}</p>}
      {!lead && <fieldset disabled={pending} className="space-y-2">
        <legend className="text-xs font-semibold text-[#6E5D52] dark:text-[#A9B4D0]">{t('group.memberRole.label')}</legend>
        <div className="relative max-h-60 sm:max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-[#EAE0D3] bg-[#FAF6EF]/80 p-1.5 dark:border-[#2A3350] dark:bg-[#121829]">
          <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-[#A24D6D]/50 dark:focus-within:ring-[#D489A4]/50 ${rowTone(selection === 'none')}`}>
            <input className="sr-only" data-autofocus type="radio" name="member-role" value="none" checked={selection === 'none'} onChange={() => setSelection('none')} />
            {radioDot(selection === 'none')}
            <span className={selection === 'none' ? 'font-semibold text-[#7A3851] dark:text-[#F2C6D6]' : ''}>{t('group.memberRole.none')}</span>
          </label>
          {groupRoleCategories.filter(category => category.roles.length > 0).map(category => {
            const open = expanded.includes(category.key);
            const Arrow = open ? ChevronDown : ChevronRight;
            return <div key={category.key} className="pt-1">
              <button type="button" aria-expanded={open} onClick={() => setExpanded(current => open ? current.filter(key => key !== category.key) : [...current, category.key])}
                className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold tracking-wide text-[#7A685B] transition-colors hover:bg-[#EFE8DD]/80 focus-visible:outline-2 focus-visible:outline-[#A24D6D] dark:text-[#9FAAC7] dark:hover:bg-[#1C243D]">
                <Arrow size={15} aria-hidden="true" className="shrink-0 opacity-80" />
                <span className="flex-1">{t(`group.memberRole.category.${category.key}`)}</span>
                <span className="rounded-full bg-[#EFE7DC] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#7A685B] dark:bg-[#212A45] dark:text-[#9FAAC7]">{category.roles.length}</span>
              </button>
              {open && <div className="mt-1 space-y-1">
                {category.roles.map(key => {
                  const Icon = groupRoleIcons[key];
                  const active = selection === key;
                  return <label key={key} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-[#A24D6D]/50 dark:focus-within:ring-[#D489A4]/50 ${rowTone(active)}`}>
                    <input className="sr-only" type="radio" name="member-role" value={key} checked={active} onChange={() => setSelection(key)} />
                    {radioDot(active)}
                    <span aria-hidden="true" className={active
                      ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F6DCE6] text-[#8E3F5B] transition-colors dark:bg-[#432B3F] dark:text-[#F2B8CC]'
                      : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#EFE7DC]/90 text-[#7A685B] transition-colors dark:bg-[#1E2640] dark:text-[#A8B3CF]'}>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block leading-snug font-semibold ${active ? 'text-[#73324B] dark:text-[#F7D2DF]' : ''}`}>{t(`group.memberRole.${key}`)}</span>
                      <span className="block text-xs font-normal leading-snug text-[#7A695D] dark:text-[#9BA6C4]">{t(`group.memberRole.description.${key}`)}</span>
                    </span>
                  </label>;
                })}
              </div>}
            </div>;
          })}
          <div className="pt-1">
            <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-[#A24D6D]/50 dark:focus-within:ring-[#D489A4]/50 ${rowTone(selection === 'custom')}`}>
              <input className="sr-only" type="radio" name="member-role" value="custom" checked={selection === 'custom'} onChange={() => setSelection('custom')} />
              {radioDot(selection === 'custom')}
              <span className={selection === 'custom' ? 'font-semibold text-[#7A3851] dark:text-[#F2C6D6]' : ''}>{t('group.memberRole.custom')}</span>
            </label>
          </div>
          <div aria-hidden="true" className="pointer-events-none sticky -bottom-1.5 -mx-1.5 h-5 bg-gradient-to-t from-[#FAF6EF] via-[#FAF6EF]/75 to-transparent dark:from-[#121829] dark:via-[#121829]/75" />
        </div>
      </fieldset>}
      {!lead && selection === 'custom' && <label className="block space-y-1.5 text-xs font-semibold text-[#5C4E45] dark:text-[#D5DCED]">
        <span>{t('group.memberRole.customName')}</span>
        <input className={field} value={name} onFocus={event => showWhenKeyboardOpens(event.currentTarget)} onChange={event => setName(event.target.value)} maxLength={64}
          autoComplete="off" disabled={pending} aria-describedby="member-role-hint" aria-invalid={name.length > 0 && !valid ? 'true' : undefined} />
        <span id="member-role-hint" className="block font-normal leading-relaxed text-[#7A695D] dark:text-[#9BA6C4]">{t('group.memberRole.hint')}</span>
      </label>}
      {directionSupported && <section className="space-y-2 border-t border-[#EFE7DC] pt-3.5 dark:border-[#27304C]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="member-role-direction" className="text-xs font-semibold text-[#5C4E45] dark:text-[#D5DCED]">{t('group.memberRole.direction')}</label>
          <span id="member-role-direction-count" className={!directionValid ? 'text-[11px] tabular-nums text-[#9F4856] dark:text-[#F09AA6]' : 'text-[11px] tabular-nums text-[#8A796D] dark:text-[#8E9AB8]'}>
            {t('group.memberRole.directionCount', { count: directionCount, max: groupRoleDirectionMax, lines: groupRoleDirectionLines })}
          </span>
        </div>
        <p id="member-role-direction-hint" className="text-xs leading-relaxed text-[#7A695D] dark:text-[#9AA6C4]">{t('group.memberRole.directionHint')}</p>
        {selection === 'none' && <p className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{t('group.memberRole.directionChoose')}</p>}
        <textarea id="member-role-direction" className={`${field} min-h-24 resize-y py-2.5 leading-relaxed`} value={direction} disabled={pending || !parsed}
          aria-describedby="member-role-direction-hint member-role-direction-count" aria-invalid={Boolean(parsed) && !directionValid || undefined}
          onFocus={event => showWhenKeyboardOpens(event.currentTarget)} onChange={event => setDirection(event.target.value)} />
        {parsed && !directionValid && <p role="alert" className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{t('group.memberRole.directionInvalid')}</p>}
      </section>}
      <p role="alert" className={error ? 'text-xs text-[#9F4856] dark:text-[#F09AA6]' : 'sr-only'}>{error}</p>
      <div className="flex justify-end gap-2 pt-0.5">
        <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-[#E2D6C5] px-4 text-sm font-medium text-[#6E5D52] transition-colors hover:bg-[#F5EEE4] dark:border-[#343E5F] dark:text-[#C8D0E4] dark:hover:bg-[#212A45]">{t('common.cancel')}</button>
        <button type="submit" disabled={pending || !canSave} className="min-h-11 rounded-full bg-[#9F4E6B] px-5 text-sm font-bold text-[#FFFDF9] shadow-[0_2px_10px_-3px_rgba(159,78,107,0.55)] transition-colors hover:bg-[#8E435E] disabled:bg-[#E7DDD2] disabled:text-[#9B8B7E] disabled:shadow-none dark:bg-[#B06380] dark:text-[#FFF8FA] dark:hover:bg-[#C0718E] dark:disabled:bg-[#252D46] dark:disabled:text-[#7884A3]">
          {pending ? t('group.memberRole.saving') : t('common.save')}
        </button>
      </div>
    </form>
  </div>;
}
