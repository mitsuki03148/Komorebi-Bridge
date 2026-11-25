import { useEffect, type MutableRefObject, type RefObject } from 'react';

/** How far from the bottom a reader may be and still count as reading the newest messages. */
export const followThreshold = 200;

/** Whether a scrolling box is at its bottom, give or take the threshold. */
export const nearBottom = (box: { scrollHeight: number; scrollTop: number; clientHeight: number }) =>
  box.scrollHeight - box.scrollTop - box.clientHeight < followThreshold;

/** The user's own new message always takes them to the bottom, wherever they were. */
export const ownMessageJump = (previousId: string | undefined, latest: { id: string; sender: string } | undefined) =>
  Boolean(latest && latest.id !== previousId && latest.sender === 'user');

/**
 * Keeps a box that follows its newest message at the bottom when its content gets taller without a new message:
 * a picture or code block that loads late, a card that appears above the message box and shrinks the view, a changed window.
 * `key` is whatever replaces the box (the room), so it is watched again.
 */
export function useStayAtBottom(box: RefObject<HTMLElement | null>, following: MutableRefObject<boolean>, key?: string) {
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let frame = 0;
    const stick = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (following.current) element.scrollTop = element.scrollHeight; });
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(stick);
    resize?.observe(element);
    const mutation = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(stick);
    mutation?.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener('load', stick, true);
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect(); element.removeEventListener('load', stick, true); };
  }, [box, following, key]);
}
