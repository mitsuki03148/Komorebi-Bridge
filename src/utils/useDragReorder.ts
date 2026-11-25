import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { indexAt, moveId } from './reorder';

interface Options {
  /** Ids in the order they show now. */
  ids: string[];
  /** Turn the touchmove guard on only while the list is on screen. */
  enabled: boolean;
  /** Called on every step while a row is dragged, so the list can show the new order. */
  onPreview: (ids: string[]) => void;
  /** Called once when the row is let go after it moved. `changed` tells if the order is different from the start. */
  onDrop: (ids: string[], changed: boolean) => void;
  /** Called when a row was held and let go without moving. */
  onHold?: (id: string) => void;
  /** Called when a row lifts, so a rival long-press timer can stop. */
  onLift?: () => void;
  holdMs?: number;
}

interface Drag {
  id: string;
  pointerId: number;
  type: string;
  x: number;
  y: number;
  lastY: number;
  grabOffset: number;
  lifted: boolean;
  moved: boolean;
  start: string[];
  current: string[];
  timer?: ReturnType<typeof setTimeout>;
  container: HTMLElement;
}

const rowSelector = '[data-group-id]';

function findRow(container: HTMLElement, id: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(rowSelector)].find(el => el.dataset.groupId === id);
}

function computeOffsetY(state: Drag, clientY: number): number {
  const rowEl = findRow(state.container, state.id);
  if (!rowEl) return 0;
  const containerRect = state.container.getBoundingClientRect();
  const desiredRelTop = clientY - containerRect.top - state.grabOffset;
  const slotRelTop = rowEl.offsetTop - state.container.scrollTop;
  return desiredRelTop - slotRelTop;
}

/**
 * Hold a row (touch: about 0.35 s; mouse: just drag) and move it to a new place in the list.
 * Rows carry data-group-id. Anything inside a row marked data-drag-ignore does not start a drag.
 */
export function useDragReorder({ ids, enabled, onPreview, onDrop, onHold, onLift, holdMs = 350 }: Options) {
  const options = useRef({ ids, onPreview, onDrop, onHold, onLift });
  options.current = { ids, onPreview, onDrop, onHold, onLift };
  const drag = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  // Once a row has lifted, the finger must move the row and not the page. Safari only honours this from a listener that is not passive.
  useEffect(() => {
    if (!enabled) return;
    const guard = (event: TouchEvent) => { if (drag.current?.lifted && event.cancelable) event.preventDefault(); };
    document.addEventListener('touchmove', guard, { passive: false });
    return () => document.removeEventListener('touchmove', guard);
  }, [enabled]);
  useEffect(() => () => clearTimeout(drag.current?.timer), []);

  // Re-sync visual translation in the same frame whenever list order updates mid-drag.
  useLayoutEffect(() => {
    const state = drag.current;
    if (!state?.lifted) return;
    setDragOffsetY(computeOffsetY(state, state.lastY));
  }, [ids]);

  const finish = () => { clearTimeout(drag.current?.timer); drag.current = null; setDraggingId(null); setDragOffsetY(0); };
  const lift = (state: Drag) => {
    state.lifted = true;
    const rowEl = findRow(state.container, state.id);
    state.grabOffset = rowEl ? state.lastY - rowEl.getBoundingClientRect().top : 20;
    setDraggingId(state.id);
    setDragOffsetY(computeOffsetY(state, state.lastY));
    options.current.onLift?.();
    try { state.container.setPointerCapture?.(state.pointerId); } catch { /* The pointer may be gone already. */ }
  };

  const dragProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current || !(event.target instanceof Element)) return;
      if (event.target.closest('[data-drag-ignore]')) return;
      const row = event.target.closest<HTMLElement>(rowSelector);
      if (!row?.dataset.groupId) return;
      const id = row.dataset.groupId;
      const order = options.current.ids;
      const state: Drag = { id, pointerId: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, lastY: event.clientY, grabOffset: 0,
        lifted: false, moved: false, start: order, current: order, container: event.currentTarget };
      drag.current = state;
      if (event.pointerType !== 'mouse') state.timer = setTimeout(() => lift(state), holdMs);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      state.lastY = event.clientY;
      const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
      if (!state.lifted) {
        if (state.type === 'mouse' && distance > 6) lift(state);
        else if (state.type !== 'mouse' && distance > 10) { clearTimeout(state.timer); drag.current = null; } // The finger is scrolling the list.
        if (!state.lifted) return;
      }
      setDragOffsetY(computeOffsetY(state, event.clientY));
      if (distance > 10) state.moved = true;
      if (!state.moved) return;
      const rows = [...state.container.querySelectorAll<HTMLElement>(rowSelector)]
        .filter(row => row.dataset.groupId !== state.id && state.start.includes(row.dataset.groupId ?? ''));
      const next = moveId(state.current, state.id, indexAt(rows.map(row => { const box = row.getBoundingClientRect(); return box.top + box.height / 2; }), event.clientY));
      if (next.join('\0') === state.current.join('\0')) return;
      state.current = next;
      options.current.onPreview(next);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const { lifted, moved, id, start, current } = state;
      finish();
      if (!lifted) return;
      if (moved) options.current.onDrop(current, current.join('\0') !== start.join('\0'));
      else options.current.onHold?.(id);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const { moved, start } = state;
      finish();
      if (moved) options.current.onPreview(start);
    },
    // A long press on Android also asks for a context menu. While a row is lifted, that must not open the group menu.
    onContextMenuCapture: (event: React.MouseEvent) => {
      if (drag.current?.lifted && drag.current.type !== 'mouse') { event.preventDefault(); event.stopPropagation(); }
    },
  };
  return { dragProps, draggingId, dragOffsetY };
}
