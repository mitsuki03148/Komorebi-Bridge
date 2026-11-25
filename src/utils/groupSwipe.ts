/** Numbers for the phone swipe between groups, in CSS pixels. */
export const swipeSpec = {
  /** A touch that starts this close to a screen edge is left to the system (its back gesture). */
  edge: 24,
  /** The right edge holds the pull-out tab of the changes-and-files layer (28 px wide), so it keeps a little more room. */
  rightEdge: 32,
  /** How far a finger must move before it is called sideways or not. */
  lock: 8,
  /** Sideways has to beat up-and-down by this much. */
  ratio: 1.6,
  /** From this far on the target group is previewed (faintly). */
  show: 32,
  /** One step: from this far the preview becomes firm and releasing switches. Each further step goes one group on. */
  step: 60,
} as const;

/** Whether a touch that has moved (dx, dy) is a sideways swipe, a scroll, or not decided yet. */
export function lockAxis(dx: number, dy: number): 'x' | 'y' | undefined {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < swipeSpec.lock) return undefined;
  return ax > ay * swipeSpec.ratio ? 'x' : 'y';
}

export interface SwipePreview { targetId: string; committed: boolean; direction: 'next' | 'previous' }

/**
 * Where a sideways pull of dx would take the user. Pulling left (negative dx) goes to the next group, right to the previous;
 * the list is a loop, so the last group is followed by the first. A pull never goes all the way round back to where it began.
 * `committed` is false while the pull is shorter than one step: the target is shown but letting go does nothing.
 */
export function swipePreview(ids: string[], currentId: string, dx: number): SwipePreview | undefined {
  const index = ids.indexOf(currentId);
  const distance = Math.abs(dx);
  if (index < 0 || distance < swipeSpec.show) return undefined;
  const direction = dx < 0 ? 'next' : 'previous';
  if (ids.length < 2) return undefined;
  const steps = Math.min(ids.length - 1, Math.max(1, Math.floor(distance / swipeSpec.step)));
  const target = (((index + (direction === 'next' ? steps : -steps)) % ids.length) + ids.length) % ids.length;
  return { targetId: ids[target], committed: distance >= swipeSpec.step, direction };
}

/** True when the element, or an ancestor below `root`, scrolls sideways (a wide table, a code block, the member row). */
export function scrollsSideways(element: Element | null, root: Element): boolean {
  for (let node = element; node && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}
