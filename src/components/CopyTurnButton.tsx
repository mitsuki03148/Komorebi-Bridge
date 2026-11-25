import { useT } from '../i18n/useLang';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { TerminalLogEntry } from '../types/guild';

export function CopyTurnButton({ entry }: { entry: TerminalLogEntry }) {
  const { t } = useT();
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const text = [entry.text, entry.codeBlock].filter(Boolean).join('\n\n');
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // Fall back to selection-based copying where clipboard access is unavailable.
      }
    }
    if (!copied) {
      const input = document.createElement('textarea');
      input.value = text;
      input.readOnly = true;
      input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
      document.body.appendChild(input);
      try {
        input.focus({ preventScroll: true });
        input.select();
        input.setSelectionRange(0, input.value.length);
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        input.remove();
      }
    }
    setStatus(copied ? 'copied' : 'error');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2500);
  };

  const label = status === 'copied' ? t('copy.done') : status === 'error' ? t('copy.error') : t('copy.turn');
  return (
    <button type="button" onClick={copy} aria-label={label} title={label}
      className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-[#8C7A6E] hover:bg-[#F3ECE1] hover:text-[#4A3E36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#689B73]">
      {status === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only" aria-live="polite">{status === 'idle' ? '' : label}</span>
    </button>
  );
}
