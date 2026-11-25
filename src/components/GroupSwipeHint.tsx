import { Sparkles } from 'lucide-react';
import type { SwipePreview } from '../utils/groupSwipe';

/**
 * While a sideways pull is held on the phone: a soft sunlit mist and a floating frosted-glass pill preview
 * which group letting go would open, glowing rose-pink once the pull crosses the switch threshold.
 */
export function GroupSwipeHint({ preview, groups, currentId }: { preview?: SwipePreview; groups: { id: string; name: string }[]; currentId: string }) {
  if (!preview) return null;
  const target = groups.find(group => group.id === preview.targetId);
  if (!target) return null;
  const committed = preview.committed;

  return (
    <div
      role="status"
      aria-live="polite"
      data-group-swipe-hint
      className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#FBF8F3]/14 dark:bg-[#0D1222]/25 backdrop-blur-[1.5px]"
    >
      <div
        className={`relative flex max-w-[82vw] items-center gap-2 rounded-full border px-5 py-2.5 backdrop-blur-xl transition-all duration-200 ease-out ${
          committed
            ? 'scale-[1.04] border-[#D48BA5]/75 dark:border-[#EFA4B2]/70 bg-[#FCE8F0]/60 dark:bg-[#3A2438]/78 text-[#6D324B] dark:text-[#FADCE4] shadow-[0_14px_34px_-8px_rgba(173,94,126,0.28),inset_0_1px_0_rgba(255,255,255,0.88)] dark:shadow-[0_14px_34px_-8px_rgba(0,0,0,0.55)]'
            : 'scale-100 border-white/80 dark:border-[#364062]/80 bg-[#FFFDF9]/56 dark:bg-[#192038]/75 text-[#5C4B41] dark:text-[#ECE7DF] shadow-[0_10px_28px_-8px_rgba(120,95,80,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.55)]'
        }`}
      >
        <Sparkles
          size={14}
          aria-hidden="true"
          className={`shrink-0 transition-all duration-200 ${
            committed ? 'scale-110 text-[#C4668A] dark:text-[#F4B4C2]' : 'scale-90 text-[#C9A4B2]/75 dark:text-[#A4AECC]'
          }`}
        />
        <span className="min-w-0 truncate font-display text-base font-semibold tracking-wide [text-shadow:0_1px_8px_rgba(255,255,255,0.85)] dark:[text-shadow:0_1px_8px_rgba(0,0,0,0.65)]">
          {target.name}
        </span>
      </div>

      <div
        aria-hidden="true"
        className="mt-2.5 flex items-center gap-1.5 rounded-full border border-white/75 dark:border-[#364062]/80 bg-[#FFFDF9]/50 dark:bg-[#192038]/72 px-2.5 py-1.5 shadow-[0_4px_14px_-4px_rgba(120,95,80,0.14)] backdrop-blur-md"
      >
        {groups.map(group => {
          const isTarget = group.id === target.id && committed;
          const isCurrent = group.id === currentId;
          return (
            <span
              key={group.id}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                isTarget
                  ? 'w-5 bg-[#B96284] shadow-[0_0_8px_rgba(185,98,132,0.45)]'
                  : isCurrent
                    ? 'w-2.5 bg-[#9E8778]/75'
                    : 'w-1.5 bg-[#C8B8AB]/65'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
