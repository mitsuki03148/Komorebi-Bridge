import { Check, Minus, X } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { TaskStep, TaskStepStatus } from '../types/guild';
import { CornerFloralSprig, RibbonTipBloom } from './BotanicalAccents';

/** Tiny hand-drawn five-petal blossom badge for completed checklist steps. */
function DonePetalBadge() {
  return (
    <span
      aria-hidden="true"
      className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F5DCE2] text-[#A44D64] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:bg-[#4B2C3A] dark:text-[#F4B4C4]"
    >
      <Check className="h-3 w-3 stroke-[2.6]" />
    </span>
  );
}

/** Gently breathing rosebud dot for the currently active step. */
function ActiveBudBadge() {
  return (
    <span aria-hidden="true" className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="absolute inset-0.5 rounded-full bg-[#E89AAC]/35 animate-pulse motion-reduce:animate-none dark:bg-[#E89AAC]/25" />
      <span className="relative h-2.5 w-2.5 rounded-full bg-[#D96D86] ring-2 ring-[#FDE8EE] dark:bg-[#EB8EA5] dark:ring-[#3E2430]" />
    </span>
  );
}

function StepIcon({ status }: { status: TaskStepStatus }) {
  switch (status) {
    case 'done':
      return <DonePetalBadge />;
    case 'in_progress':
      return <ActiveBudBadge />;
    case 'skipped':
      return (
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#DEC9CF] bg-[#F7EFF1] text-[#9E8790] dark:border-[#4D3D47] dark:bg-[#2A2229] dark:text-[#9F8C96]">
          <Minus className="h-3 w-3 stroke-[2.2]" />
        </span>
      );
    case 'failed':
      return (
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F8DADF] text-[#B34358] dark:bg-[#4C2430] dark:text-[#F49CAE]">
          <X className="h-3 w-3 stroke-[2.5]" />
        </span>
      );
    default:
      return (
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-[#D6AEB8] bg-white/60 dark:border-[#6C5060] dark:bg-[#231B24]" />
        </span>
      );
  }
}

/**
 * Inline girly Cath Kidston–style stationery checklist card for AGY `update_steps`.
 * Updates in place per turn and stays in the conversation history.
 */
export function StepsChecklistCard({
  steps,
  name,
  time,
}: {
  steps: TaskStep[];
  name?: string;
  time?: string;
}) {
  const { t } = useT();
  const total = steps.length;
  const doneCount = steps.filter(s => s.status === 'done').length;
  const allDone = total > 0 && steps.every(s => s.status === 'done' || s.status === 'skipped');
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <article
      data-sender="steps"
      data-steps-card={allDone ? 'done' : 'active'}
      aria-label={`${t('steps.title')} ${doneCount}/${total}`}
      className="relative mr-auto my-1.5 w-full max-w-[88%] sm:max-w-[26rem] overflow-hidden rounded-[22px] border-[1.5px] border-[#E4BCC6] dark:border-[#5D4152] bg-[linear-gradient(165deg,#FFFDFB_0%,#FDF3F5_58%,#F9EAEF_100%)] dark:bg-[linear-gradient(165deg,#2B222C_0%,#241D28_58%,#1E1823_100%)] shadow-[2px_3px_0_rgba(176,112,132,0.16),0_8px_20px_-10px_rgba(148,88,108,0.22),inset_0_1.5px_0_rgba(255,255,255,0.92)] dark:shadow-[2px_3px_0_rgba(8,6,14,0.5),0_10px_22px_-10px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(246,196,210,0.1)]"
    >
      {/* Inner delicate stationery stitch frame */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-1.5 rounded-[16px] border border-dashed border-[#E8BDC7]/75 dark:border-[#6A4A5B]/55"
      />
      {/* Corner Cath Kidston wild-rose sprig & tiny sparkle */}
      <CornerFloralSprig modelId="AGY" size={22} className="absolute top-1.5 right-2 opacity-90" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-3 text-[10px] leading-none text-[#D692A3] dark:text-[#B97D92]"
      >
        ✦
      </span>

      <div className="relative px-3.5 py-3 sm:px-4">
        {/* Header ribbon */}
        <div className="flex items-center justify-between gap-2 pr-5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#EBC5CE] bg-white/85 px-2.5 py-0.5 font-display text-[11px] font-bold tracking-wide text-[#9A4C63] shadow-[0_1px_0_rgba(180,110,130,0.12)] dark:border-[#69485A] dark:bg-[#352432]/90 dark:text-[#F2B8C8]">
              <span aria-hidden="true" className="text-[10px] text-[#DC8096]">✿</span>
              <span>{t('steps.title')}</span>
            </span>
            {name && (
              <span className="truncate text-[11px] font-semibold text-[#A5677B] dark:text-[#D9A7B8]">
                {name}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              data-steps-progress={`${doneCount}/${total}`}
              className={`rounded-full px-2 py-0.5 tabular-nums text-[10.5px] font-bold ${
                allDone
                  ? 'bg-[#E7F2E8] text-[#4C7B58] dark:bg-[#22352A] dark:text-[#9FD3AA]'
                  : 'bg-[#F8E4E9] text-[#A25269] dark:bg-[#3E2735] dark:text-[#F0B2C3]'
              }`}
            >
              {allDone ? t('steps.done') : `${doneCount} / ${total}`}
            </span>
            {time && (
              <span className="tabular-nums text-[10px] text-[#B08A95] dark:text-[#9E8898]">
                {time}
              </span>
            )}
          </div>
        </div>

        {/* Watercolor rose progress ribbon with moving blossom tip */}
        <div className="relative mt-2.5 mb-2.5 h-[5px] w-full rounded-full bg-[#F1DFE4]/90 dark:bg-[#3B2B36]">
          <div
            data-steps-bar={pct}
            style={{ width: `${pct}%` }}
            className="h-full rounded-full bg-[linear-gradient(90deg,#F1B7C4_0%,#DE7E94_100%)] transition-[width] duration-300 motion-reduce:transition-none dark:bg-[linear-gradient(90deg,#C9778D_0%,#E999AD_100%)]"
          />
          <RibbonTipBloom kind="hp" pct={pct} subtle />
        </div>

        {/* Checklist rows */}
        <ol className="space-y-1.5">
          {steps.map((step, index) => {
            const active = step.status === 'in_progress';
            const done = step.status === 'done';
            const skipped = step.status === 'skipped';
            const failed = step.status === 'failed';
            return (
              <li
                key={index}
                data-step-status={step.status}
                className={`flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-[12.5px] leading-snug transition-colors ${
                  active
                    ? 'border border-[#EBBEC9] bg-white/88 shadow-[0_1px_3px_rgba(176,102,124,0.12)] dark:border-[#6C495B] dark:bg-[#362635]/90'
                    : failed
                      ? 'border border-[#EBB6C0] bg-[#FDF1F3]/90 dark:border-[#6B3846] dark:bg-[#39212A]/85'
                      : 'border border-transparent bg-white/45 dark:bg-[#2A202B]/55'
                }`}
              >
                <StepIcon status={step.status} />
                <span
                  className={`min-w-0 flex-1 break-words pt-0.5 ${
                    active
                      ? 'font-semibold text-[#4A2F38] dark:text-[#F9EBF0]'
                      : done
                        ? 'text-[#9A7E87] line-through decoration-[#D9AEB9] dark:text-[#9D8894] dark:decoration-[#6D5260]'
                        : skipped
                          ? 'italic text-[#A48C94] dark:text-[#8E7B86]'
                          : failed
                            ? 'font-medium text-[#9F3D50] dark:text-[#F4A2B2]'
                            : 'text-[#624B53] dark:text-[#D5C5CE]'
                  }`}
                >
                  {step.title}
                </span>
                {active && (
                  <span className="mt-0.5 shrink-0 rounded-full bg-[#FCE9EE] px-1.5 py-px text-[9.5px] font-bold text-[#B35A73] dark:bg-[#4A2D3C] dark:text-[#F3B7C7]">
                    {t('steps.inProgress')}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}
