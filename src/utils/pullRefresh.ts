import { useCallback, useEffect, useRef, useState } from 'react';

/** How far (px) the finger must pull before letting go refreshes. */
export const PULL_THRESHOLD = 60;
const PULL_MAX = 96;

/** The distance the indicator moves for a finger travel `dy`: it follows at about half speed and slows near the top. */
export const pullDistance = (dy: number) => (dy <= 0 ? 0 : Math.min(PULL_MAX, Math.round(PULL_MAX * (1 - Math.exp(-dy / 140)))));
/** A pull counts once the damped distance reaches the line. */
export const pullCommits = (distance: number) => distance >= PULL_THRESHOLD * 0.8;

/**
 * Pull down from the top of a scrolling list to refresh it. Pass the returned `ref` to the scrolling element.
 * The pull starts only when the list is already at its top and the finger moves down more than sideways.
 */
export function usePullToRefresh(onRefresh: () => void, enabled = true) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
  useEffect(() => {
    if (!element || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let shown = 0;
    let lock: 'y' | 'x' | undefined;
    const set = (value: number) => { if (value !== shown) { shown = value; setPull(value); } };
    const down = (event: TouchEvent) => {
      const touch = event.touches[0];
      const field = event.target instanceof HTMLElement && event.target.closest('input,textarea,select');
      start = element.scrollTop <= 0 && event.touches.length === 1 && !field && touch ? { x: touch.clientX, y: touch.clientY } : null;
      lock = undefined;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      if (!lock && Math.max(Math.abs(dx), Math.abs(dy)) > 8) lock = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.4 ? 'y' : 'x';
      if (lock !== 'y' || element.scrollTop > 0) { if (lock === 'x') start = null; set(0); return; }
      if (event.cancelable) event.preventDefault();
      set(pullDistance(dy));
    };
    const up = () => {
      const commit = pullCommits(shown);
      start = null; lock = undefined; set(0);
      if (commit) { setRefreshing(true); latest.current(); window.setTimeout(() => setRefreshing(false), 700); }
    };
    element.addEventListener('touchstart', down, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', up);
    element.addEventListener('touchcancel', up);
    return () => {
      element.removeEventListener('touchstart', down);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', up);
      element.removeEventListener('touchcancel', up);
    };
  }, [element, enabled]);
  return { ref, pull, refreshing };
}
