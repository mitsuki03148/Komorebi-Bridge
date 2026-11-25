import { useT } from '../i18n/useLang';
import { useState } from 'react';

/**
 * Under an approval's buttons: reject and tell the CLI why in one go. The plain reject button stays as it was;
 * this fold only opens when the reader wants to give a reason, which is then sent as the next message.
 */
export function RejectReason({ disabled, onSubmit, className = '' }: { disabled?: boolean; onSubmit: (reason: string) => void; className?: string }) {
  const { t } = useT();
  const [reason, setReason] = useState('');
  return <details data-reject-reason className={`text-xs ${className}`}>
    <summary className="w-fit cursor-pointer list-none text-[11px] font-semibold text-[#8C7A6E] underline decoration-dotted underline-offset-2 [&::-webkit-details-marker]:hidden">{t('reject.explain')}</summary>
    <form className="mt-1.5 flex items-center gap-1.5" onSubmit={event => {
      event.preventDefault();
      const text = reason.trim();
      if (!text || disabled) return;
      // The text stays until the approval is answered: the card goes away then, and a failed reject leaves the reason to try again.
      onSubmit(text);
    }}>
      <input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder={t('reject.placeholder')} aria-label={t('reject.reason')}
        className="min-h-9 min-w-0 flex-1 rounded-xl border border-[#E2D6C5] bg-white px-2.5 text-base text-[#4A3E36] sm:text-xs" />
      <button type="submit" disabled={disabled || !reason.trim()} className="min-h-9 shrink-0 rounded-full border border-[#F3C6CD] bg-[#FCE8EB] px-3 font-semibold text-[#C85A68] disabled:opacity-45">{t('reject.send')}</button>
    </form>
  </details>;
}
