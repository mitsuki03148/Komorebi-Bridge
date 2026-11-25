import { useState } from 'react';
import { Tag } from 'lucide-react';
import type { I18nKey } from '../i18n';
import { useT } from '../i18n/useLang';
import { groupRoleFromChoice, groupRolePresets, isGroupRolePreset, groupRoleDirectionMax, groupRoleDirectionLines, normalizeRoleDirection, type GroupMemberRole, type GroupRoleChoice, type GroupRolePreset } from '../types/groupRoles';
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
  const field = 'w-full min-h-11 rounded-xl border border-[#E2D6C5] bg-white px-3 text-[16px] text-[#4A3E36] focus-visible:outline-2 focus-visible:outline-[#965069] dark:border-[#364062] dark:bg-[#141A2C] dark:text-[#ECE7DF]';
  // With the keyboard open, the sheet takes only the free part of the screen and scrolls inside it.
  return <div className="guild-backdrop-in fixed inset-x-0 z-[85] flex items-end justify-center bg-[#3A2E27]/28 p-4 backdrop-blur-xs dark:bg-[#090C16]/68 sm:items-center"
    style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={focusScope} role="dialog" aria-modal="true" aria-labelledby="member-role-title" onSubmit={event => { event.preventDefault(); if (!pending && canSave) onSave(choice, directionSupported ? (parsed ? normalizedDirection : '') : undefined); }}
      style={area ? { maxHeight: Math.max(220, area.height - 32) } : undefined}
      className="guild-sheet-in max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-[28px] border border-[#E5D7C6] bg-[#FFFDF9] p-4 text-[#4A3E36] shadow-xl dark:border-[#343D5E] dark:bg-[#171D31] dark:text-[#ECE7DF]">
      <div>
        <h2 id="member-role-title" className="font-display text-base font-bold">{t('group.memberRole.edit')}</h2>
        <p className="break-words text-sm text-[#6E5D52] dark:text-[#B5BED6]">{roomName}</p>
      </div>
      {lead && leadRole && onClearLeadRole && <div className="flex items-center gap-2 rounded-xl border border-[#E2D6C5] px-3 py-2 text-xs dark:border-[#364062]">
        <span className="min-w-0 flex-1">{t('group.memberRole.leadOldRole', { role: memberRoleLabel(leadRole, t) })}</span>
        <button type="button" disabled={pending} onClick={onClearLeadRole} className="min-h-9 shrink-0 rounded-full border border-[#E2D6C5] px-3 font-semibold dark:border-[#364062]">{t('group.memberRole.leadOldRoleRemove')}</button>
      </div>}
      {lead && <p className="rounded-xl border border-[#E2D6C5] bg-[#FBF6EC] px-3 py-2 text-sm font-bold dark:border-[#364062] dark:bg-[#1E253D]">♛ {t('group.memberRole.orchestrator')}</p>}
      {!lead && <label className="block space-y-1 text-xs font-semibold">
        <span>{t('group.memberRole.label')}</span>
        <select data-autofocus className={field} value={selection} disabled={pending}
          onChange={event => setSelection(event.target.value as typeof selection)}>
          <option value="none">{t('group.memberRole.none')}</option>
          {groupRolePresets.map(key => <option key={key} value={key}>{t(`group.memberRole.${key}`)}</option>)}
          <option value="custom">{t('group.memberRole.custom')}</option>
        </select>
      </label>}
      {!lead && selection === 'custom' && <label className="block space-y-1 text-xs font-semibold">
        <span>{t('group.memberRole.customName')}</span>
        <input className={field} value={name} onFocus={event => showWhenKeyboardOpens(event.currentTarget)} onChange={event => setName(event.target.value)} maxLength={64}
          autoComplete="off" disabled={pending} aria-describedby="member-role-hint" aria-invalid={name.length > 0 && !valid ? 'true' : undefined} />
        <span id="member-role-hint" className="block font-normal text-[#6E5D52] dark:text-[#B5BED6]">{t('group.memberRole.hint')}</span>
      </label>}
      {parsed && !lead && <p className="break-all font-mono text-xs text-[#6E5D52] dark:text-[#B5BED6]">@{parsed.key}</p>}
      {directionSupported && <section className="space-y-2 border-t border-[#E2D6C5] pt-3 dark:border-[#364062]">
        <label htmlFor="member-role-direction" className="block text-xs font-semibold">{t('group.memberRole.direction')}</label>
        <p id="member-role-direction-hint" className="text-xs text-[#6E5D52] dark:text-[#B5BED6]">{t('group.memberRole.directionHint')}</p>
        {selection === 'none' && <p className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{t('group.memberRole.directionChoose')}</p>}
        <textarea id="member-role-direction" className={`${field} min-h-24 resize-y py-2`} value={direction} disabled={pending || !parsed}
          aria-describedby="member-role-direction-hint member-role-direction-count" aria-invalid={Boolean(parsed) && !directionValid || undefined}
          onFocus={event => showWhenKeyboardOpens(event.currentTarget)} onChange={event => setDirection(event.target.value)} />
        <p id="member-role-direction-count" className={!directionValid ? 'text-xs text-[#9F4856] dark:text-[#F09AA6]' : 'text-xs text-[#6E5D52] dark:text-[#B5BED6]'}>
          {t('group.memberRole.directionCount', { count: directionCount, max: groupRoleDirectionMax, lines: groupRoleDirectionLines })}
        </p>
        {parsed && !directionValid && <p role="alert" className="text-xs text-[#9F4856] dark:text-[#F09AA6]">{t('group.memberRole.directionInvalid')}</p>}
      </section>}
      <p role="alert" className={error ? 'text-xs text-[#9F4856] dark:text-[#F09AA6]' : 'sr-only'}>{error}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-[#E2D6C5] px-4 text-sm dark:border-[#364062]">{t('common.cancel')}</button>
        <button type="submit" disabled={pending || !canSave} className="min-h-11 rounded-full bg-[#4A3E36] px-4 text-sm font-bold text-white disabled:opacity-50 dark:bg-[#785266]">
          {pending ? t('group.memberRole.saving') : t('common.save')}
        </button>
      </div>
    </form>
  </div>;
}
