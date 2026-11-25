import { RefreshCw } from 'lucide-react';
import { PULL_THRESHOLD } from '../utils/pullRefresh';

/** The small round mark that follows a pull-down; it spins while the refresh runs. */
export function PullIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  const height = refreshing ? 34 : pull;
  if (height <= 0) return null;
  const ready = pull >= PULL_THRESHOLD * 0.8;
  return <div aria-hidden="true" data-pull-indicator style={{ height }} className="flex shrink-0 items-center justify-center overflow-hidden transition-[height] duration-150">
    <span className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#E2D6C5] bg-white shadow-xs ${ready || refreshing ? 'text-[#689B73]' : 'text-[#B5A79A]'}`}>
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} style={refreshing ? undefined : { transform: `rotate(${Math.min(180, pull * 2.4)}deg)` }} />
    </span>
  </div>;
}
