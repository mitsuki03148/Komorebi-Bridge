import { useT } from '../i18n/useLang';
import { Check, Copy } from 'lucide-react';
import type { TerminalLogEntry } from '../types/guild';
import { useCopyFeedback } from '../utils/roomUi';

export function CopyTurnButton({ entry }: { entry: TerminalLogEntry }) {
  const { t } = useT();
  const { copy, status } = useCopyFeedback(2500);
  const text = [entry.text, entry.codeBlock].filter(Boolean).join('\n\n');

  const label = status === 'copied' ? t('copy.done') : status === 'error' ? t('copy.error') : t('copy.turn');
  return (
    <button type="button" onClick={() => void copy(text)} aria-label={label} title={label}
      className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-full text-[#8C7A6E] hover:bg-[#F3ECE1] hover:text-[#4A3E36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#689B73]">
      {status === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4 shrink-0" />}
      <span role="status" className={status === 'error' ? 'max-w-40 whitespace-normal text-left text-xs text-[#8D3F48] dark:text-[#F09AA6]' : 'sr-only'}>{status === 'idle' ? '' : label}</span>
    </button>
  );
}
