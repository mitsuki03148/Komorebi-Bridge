const selector = 'a[href],button,input,select,textarea,[tabindex]';

/** The things in a dialog that Tab can reach, in order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(item =>
    !item.hasAttribute('disabled') && item.tabIndex >= 0 && item.getAttribute('type') !== 'hidden' && !item.closest('[inert]') &&
    (item.offsetParent !== null || item === document.activeElement || item.getClientRects().length > 0));
}

/**
 * Where Tab (or Shift+Tab) must go to stay inside a dialog: from its last item to its first, from its first back to its last,
 * and from outside it to an end. Undefined means the browser's own move is fine.
 */
export function tabTarget<T>(items: T[], active: T | null, backwards: boolean): T | undefined {
  if (!items.length) return undefined;
  const first = items[0], last = items[items.length - 1];
  const index = active === null ? -1 : items.indexOf(active);
  if (index === -1) return backwards ? last : first;
  if (!backwards && active === last) return first;
  if (backwards && active === first) return last;
  return undefined;
}

/**
 * A ref for a dialog's element: on opening, focus moves into it; Tab stays inside; on closing, focus returns to what opened it.
 * (Escape is handled by each dialog already.) It sets up when the element appears and cleans up when it goes away.
 */
export function focusScope(node: HTMLElement | null) {
  if (!node) return;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!node.hasAttribute('tabindex')) node.tabIndex = -1;
  node.style.outline = 'none';
  if (!node.contains(document.activeElement)) {
    const target = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(node)[0] ?? node;
    target.focus({ preventScroll: true });
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = focusableIn(node);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = items.length ? tabTarget(items, active, event.shiftKey) : node;
    if (target) { event.preventDefault(); target.focus(); }
  };
  node.addEventListener('keydown', onKey);
  return () => {
    node.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
