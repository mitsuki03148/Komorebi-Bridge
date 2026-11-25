import { t } from '../i18n';
import type { PendingApproval } from '../types/guild';

export type ApprovalChoice = NonNullable<PendingApproval['additionalChoices']>[number];

export function approvalChoiceLabel(choice: ApprovalChoice) {
  const prefix = choice.id === 'auto' ? t('utils.approval.auto') : choice.id === 'remember' ? t('utils.approval.remember') : '';
  const option = `${choice.key ? `${choice.key}. ` : ''}${choice.label}`;
  return prefix ? t('utils.approval.choice', { prefix, option }) : option;
}

export function approvalChoiceConfirmation(choice: ApprovalChoice, cli: string) {
  if (choice.id === 'auto') return t('utils.approval.confirm.auto', { cli });
  if (choice.id === 'remember') return t('utils.approval.confirm.remember', { cli });
  return t('utils.approval.confirm.other', { cli, choice: approvalChoiceLabel(choice) });
}
