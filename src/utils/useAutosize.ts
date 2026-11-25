import { useLayoutEffect, useRef } from 'react';

/** The tallest a composer grows: about twice the old fixed height, and never more than a third of the screen. */
export const COMPOSER_MAX_PX = 224;

/** Height for a textarea whose content needs `scrollHeight`, and whether it then has to scroll. */
export function fitHeight(scrollHeight: number, viewportHeight: number, maxPx = COMPOSER_MAX_PX) {
  const max = Math.max(48, Math.min(maxPx, Math.round(viewportHeight * 0.35)));
  return { height: Math.min(scrollHeight, max), scrolls: scrollHeight > max };
}

/** The height an input box should take: none set (one line) while empty, so its hint can never make it taller. */
export function boxHeight(value: string, scrollHeight: number, viewportHeight: number): { height?: number; scrolls: boolean } {
  if (!value) return { scrolls: false };
  return fitHeight(scrollHeight, viewportHeight);
}

/** Makes a textarea grow with what is typed, so long text is easier to read and scroll through. */
export function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    const { height, scrolls } = boxHeight(value, element.scrollHeight, window.innerHeight);
    if (height !== undefined) element.style.height = `${height}px`;
    element.style.overflowY = scrolls ? 'auto' : 'hidden';
  }, [value]);
  return ref;
}
