import { useT } from '../i18n/useLang';
import { MessageCircleQuestion, ShieldAlert, Sparkles, X } from 'lucide-react';

/** A room waiting for the Founder: an approval (the default) or a question. `approvalId` is the key the bubble is closed by. */
export interface ApprovalAlert { roomId: string; approvalId: string; label: string; kind?: 'approval' | 'question' }
export interface ToastAlert { id: number; message: string; roomId?: string }

/**
 * The stack of alerts under the header. Each room waiting for an approval keeps its own bubble until it
 * is handled or closed, so several rooms asking at once cannot hide one another; other toasts fade out.
 */
export function RoomAlerts({ approvals, toasts, onOpenRoom, onDismissApproval, onCloseToast }: {
  approvals: ApprovalAlert[];
  toasts: ToastAlert[];
  onOpenRoom: (roomId: string) => void;
  onDismissApproval: (approvalId: string) => void;
  onCloseToast: (id: number) => void;
}) {
  const { t } = useT();
  if (approvals.length === 0 && toasts.length === 0) return null;
  const shown = approvals.slice(0, 3);
  const hidden = approvals.length - shown.length;
  const bubble = 'flex max-w-full items-center gap-1 rounded-full border pl-4 pr-2 py-1 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF] shadow-lg';
  const close = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8C7A6E] dark:text-[#98A3C2]';
  return (
    <div data-room-alerts className="pointer-events-none fixed left-1/2 top-16 z-[70] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:max-w-sm sm:translate-x-0 sm:flex-col-reverse sm:items-end">
      {shown.map(alert => (
        <div key={alert.approvalId} className={`${bubble} pointer-events-auto border-[#E8B278] dark:border-[#785B38] bg-[#FFF6EB] dark:bg-[#2B2219]`}>
          <button type="button" aria-label={t('alerts.openroom.label', { message: alert.label })} title={t('alerts.openroom')} onClick={() => onOpenRoom(alert.roomId)}
            className="flex min-h-9 min-w-0 items-center gap-2 text-left">
            {alert.kind === 'question' ? <MessageCircleQuestion className="h-4 w-4 shrink-0 text-[#D68631]" aria-hidden="true" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-[#D68631]" aria-hidden="true" />}
            <span className="min-w-0">{alert.label}</span>
          </button>
          <button type="button" aria-label={t('alerts.approval.hide')} onClick={() => onDismissApproval(alert.approvalId)} className={close}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      {hidden > 0 && <div role="status" className={`${bubble} pointer-events-auto border-[#E8B278] dark:border-[#785B38] bg-[#FFF6EB] dark:bg-[#2B2219] py-2 pr-4`}>{t('alerts.more', { count: hidden })}</div>}
      {toasts.map(toast => (
        <div key={toast.id} className={`${bubble} pointer-events-auto border-[#E5B8B0] dark:border-[#364062] bg-white/95 dark:bg-[#1B2238]/95`}>
          {toast.roomId ? (
            <button type="button" aria-label={t('alerts.openroom.label', { message: toast.message })} title={t('alerts.openroom')} onClick={() => { onCloseToast(toast.id); onOpenRoom(toast.roomId!); }}
              className="flex min-h-9 min-w-0 items-center gap-2 text-left">
              <Sparkles className="h-4 w-4 shrink-0 text-[#D9828B]" aria-hidden="true" />
              <span className="min-w-0">{toast.message}</span>
            </button>
          ) : (
            <span className="flex min-h-9 min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[#D9828B]" aria-hidden="true" />
              <span className="min-w-0">{toast.message}</span>
            </span>
          )}
          <button type="button" aria-label={t('alerts.close')} onClick={() => onCloseToast(toast.id)} className={close}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
