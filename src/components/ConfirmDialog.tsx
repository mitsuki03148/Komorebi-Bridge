import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle, ShieldAlert } from 'lucide-react';
import { useT } from '../i18n/useLang';
import { focusScope } from '../utils/focusScope';
import { useEscape } from '../utils/roomUi';

export type ConfirmTone = 'default' | 'warn' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

const toneMeta: Record<ConfirmTone, {
  iconBg: string;
  iconText: string;
  confirmBg: string;
  Icon: typeof AlertTriangle;
}> = {
  danger: {
    iconBg: 'bg-[#FCE8EB] text-[#B84E60] border-[#F0C8CF]',
    iconText: 'text-[#B84E60]',
    confirmBg: 'bg-[#B95264] hover:bg-[#A44455] text-white shadow-[0_2px_8px_-2px_rgba(185,82,100,0.42)]',
    Icon: AlertTriangle,
  },
  warn: {
    iconBg: 'bg-[#FFF3DC] text-[#A86B22] border-[#EBD1A0]',
    iconText: 'text-[#A86B22]',
    confirmBg: 'bg-[#9E6A2C] hover:bg-[#895A22] text-white shadow-[0_2px_8px_-2px_rgba(158,106,44,0.38)]',
    Icon: ShieldAlert,
  },
  default: {
    iconBg: 'bg-[#F3ECE1] text-[#7D6554] border-[#DFD3C3]',
    iconText: 'text-[#7D6554]',
    confirmBg: 'bg-[#8F5269] hover:bg-[#7A4459] text-white shadow-[0_2px_8px_-2px_rgba(143,82,105,0.36)]',
    Icon: HelpCircle,
  },
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onCancel,
  onConfirm,
}: ConfirmOptions & {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useT();
  const titleId = useId();
  const bodyId = useId();
  useEscape(open, onCancel);
  if (!open) return null;

  const meta = toneMeta[tone];
  const { Icon } = meta;
  const heading = title ?? t('confirm.title.default');
  const cancelText = cancelLabel ?? t('common.cancel');
  const confirmText = confirmLabel ?? t('confirm.action.confirm');
  const dangerFirst = tone === 'danger';

  return (
    <div
      className="guild-backdrop-in fixed inset-0 z-[120] flex items-end justify-center bg-[#4A3E36]/35 dark:bg-[#090C16]/68 p-4 backdrop-blur-[2px] sm:items-center"
      onClick={event => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        ref={focusScope}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-confirm-tone={tone}
        className="guild-dialog-in w-full max-w-sm rounded-3xl border border-[#DFD3C3] dark:border-[#343D5E] bg-[#FFFDF9] dark:bg-[#192036] p-5 text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_22px_50px_-14px_rgba(74,62,54,0.36)] dark:shadow-[0_24px_54px_-14px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${meta.iconBg}`}>
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF]">
              {heading}
            </h2>
            <p id={bodyId} className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-[#6B5A4E] dark:text-[#A4AECC]">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            data-confirm-cancel
            data-autofocus={dangerFirst ? '' : undefined}
            onClick={onCancel}
            className="guild-tap min-h-10 flex-1 rounded-full border border-[#E2D6C5] bg-[#F6F0E7] px-4 py-2 text-xs font-bold text-[#6E5D52] hover:bg-[#EFE6D9] sm:flex-initial"
          >
            {cancelText}
          </button>
          <button
            type="button"
            data-confirm-accept
            data-autofocus={!dangerFirst ? '' : undefined}
            onClick={onConfirm}
            className={`guild-tap min-h-10 flex-1 rounded-full px-4 py-2 text-xs font-bold sm:flex-initial ${meta.confirmBg}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Provides an async Guild-styled confirmation dialog in place of `window.confirm`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const active = queue[0];
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setQueue(current => [...current, { ...options, resolve }]);
    });
  }, []);

  useEffect(() => () => {
    for (const item of queueRef.current) item.resolve(false);
  }, []);

  const settle = (accepted: boolean) => {
    setQueue(current => {
      const [head, ...rest] = current;
      head?.resolve(accepted);
      return rest;
    });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={Boolean(active)}
        title={active?.title}
        message={active?.message ?? ''}
        confirmLabel={active?.confirmLabel}
        cancelLabel={active?.cancelLabel}
        tone={active?.tone}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

/** Asks for confirmation using the nearest `ConfirmProvider`, falling back cleanly outside the full app shell. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return useCallback((options: ConfirmOptions) => {
    if (ctx) return ctx(options);
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return Promise.resolve(window.confirm(options.message));
    }
    return Promise.resolve(false);
  }, [ctx]);
}
