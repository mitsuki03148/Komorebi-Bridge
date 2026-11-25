import { useEffect, useRef, useState } from 'react';
import { lockAxis, scrollsSideways, swipePreview, swipeSpec, type SwipePreview } from './groupSwipe';

interface Options {
  enabled: boolean;
  /** Group ids in the order they are listed. */
  ids: string[];
  currentId: string | undefined;
  onSwitch: (groupId: string) => void;
}

interface Touch { x: number; y: number; lock?: 'x' | 'y'; root: HTMLElement }

/** Rubber-band horizontal displacement for tactile drag resistance, capped around ±58px. */
const swipeOffset = (dx: number) => Math.sign(dx) * Math.tanh(Math.abs(dx) / 115) * 58;

/**
 * Phone only. Pull the group view sideways and hold: the group it would go to is previewed. Pull back under the line and
 * nothing happens; the switch happens only when the finger is lifted over the line.
 */
export function useGroupSwipe({ enabled, ids, currentId, onSwitch }: Options) {
  const latest = useRef({ ids, currentId, onSwitch });
  latest.current = { ids, currentId, onSwitch };
  const touch = useRef<Touch | null>(null);
  const shown = useRef<SwipePreview | undefined>(undefined);
  const [preview, setPreview] = useState<SwipePreview | undefined>(undefined);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [enterDirection, setEnterDirection] = useState<'next' | 'previous' | undefined>(undefined);
  const enterTimer = useRef<number | undefined>(undefined);

  const show = (next: SwipePreview | undefined) => {
    const before = shown.current;
    shown.current = next;
    if (next?.targetId !== before?.targetId || next?.committed !== before?.committed) {
      setPreview(next);
    }
  };
  const stop = () => { touch.current = null; setDragging(false); setDragX(0); show(undefined); };

  // Once the pull has turned out sideways, the page must not scroll with it. Safari honours this only from a listener that is not passive.
  useEffect(() => {
    if (!enabled) return;
    const guard = (event: TouchEvent) => { if (touch.current?.lock === 'x' && event.cancelable) event.preventDefault(); };
    document.addEventListener('touchmove', guard, { passive: false });
    return () => document.removeEventListener('touchmove', guard);
  }, [enabled]);
  useEffect(() => { if (!enabled || !currentId) stop(); }, [enabled, currentId]);
  useEffect(() => () => { if (enterTimer.current) window.clearTimeout(enterTimer.current); }, []);

  const handlers = {
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      if (!enabled || !latest.current.currentId || event.touches.length !== 1 || !(event.target instanceof Element)) { touch.current = null; return; }
      const { clientX: x, clientY: y } = event.touches[0];
      const edge = swipeSpec.edge;
      if (x < edge || x > window.innerWidth - swipeSpec.rightEdge) return;
      if (event.target.closest('input,textarea,select,[contenteditable],[data-no-swipe]') || document.querySelector('[aria-modal="true"]')) return;
      if (scrollsSideways(event.target, event.currentTarget)) return;
      touch.current = { x, y, root: event.currentTarget };
    },
    onTouchMove: (event: React.TouchEvent<HTMLElement>) => {
      const start = touch.current;
      if (!start || event.touches.length !== 1) { if (start) stop(); return; }
      const dx = event.touches[0].clientX - start.x, dy = event.touches[0].clientY - start.y;
      start.lock ??= lockAxis(dx, dy);
      if (start.lock !== 'x') { if (start.lock === 'y') stop(); return; }
      if (latest.current.ids.length >= 2) {
        setDragging(true);
        setDragX(swipeOffset(dx));
      }
      show(swipePreview(latest.current.ids, latest.current.currentId!, dx));
    },
    onTouchEnd: () => {
      const target = shown.current;
      const switchTo = target?.committed ? target.targetId : undefined;
      const dir = target?.committed ? target.direction : undefined;
      stop();
      if (switchTo && dir) {
        setEnterDirection(dir);
        if (enterTimer.current) window.clearTimeout(enterTimer.current);
        enterTimer.current = window.setTimeout(() => setEnterDirection(undefined), 300);
        latest.current.onSwitch(switchTo);
      }
    },
    onTouchCancel: () => stop(),
  };
  return { handlers, preview, dragX, dragging, enterDirection };
}
