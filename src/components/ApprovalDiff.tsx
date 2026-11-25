import { useT } from '../i18n/useLang';
import type { PendingApproval } from '../types/guild';

/** The change a CLI wants approval for, folded away on a phone so the approval buttons stay in reach. */
export function ApprovalDiff({ lines }: { lines: PendingApproval['diffLines'] }) {
  const { t } = useT();
  if (!lines.length) return null;
  return <details data-approval-diff className="rounded-xl border border-[#E2D6C5] bg-[#362D28] font-mono text-[10px] text-[#C8B7A6]">
    <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[#DFD3C3]">{t('approval.diff.lines', { count: lines.length })}</summary>
    <div className="max-h-48 space-y-0.5 overflow-auto p-1.5">
      {lines.map((line, index) => <div key={index} className={`flex gap-2 whitespace-pre rounded px-1.5 py-0.5 ${line.type === 'add' ? 'bg-emerald-500/20 text-emerald-200' : line.type === 'del' ? 'bg-rose-500/20 text-rose-200' : ''}`}>
        <span className="w-5 shrink-0 text-right opacity-60">{line.lineNum}</span>
        <span className="w-2 shrink-0 font-bold">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
        <span>{line.content}</span>
      </div>)}
    </div>
  </details>;
}
