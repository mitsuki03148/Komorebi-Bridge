import { t } from '../i18n';
/** Where the highlighted row of a CLI menu sits compared with what the terminal panel shows. */
export type Placement = 'visible' | 'above' | 'below';

export function placement(top: number, bottom: number, scrollTop: number, viewport: number): Placement {
  if (bottom <= scrollTop) return 'above';
  if (top >= scrollTop + viewport) return 'below';
  return 'visible';
}

/** The scroll position that brings a row into view with the least movement; an already visible row does not move it. */
export function leastScroll(top: number, bottom: number, scrollTop: number, viewport: number): number {
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport);
  return scrollTop;
}

/** The panel follows new output only while it was already at the end, so reading further up is never interrupted. */
export const wasAtEnd = (scrollHeight: number, scrollTop: number, viewport: number) => scrollHeight - scrollTop - viewport < 24;

/**
 * What to do with the panel's scroll position after the screen changed.
 * A menu that has just opened is lined up once; after that, moving through its options never moves the panel.
 */
export function scrollAfterUpdate({ opening, newMenu, menuOpen, atEnd, current, highlight, viewport, scrollHeight }: {
  opening: boolean; newMenu: boolean; menuOpen: boolean; atEnd: boolean; current: number; viewport: number; scrollHeight: number;
  highlight?: { top: number; bottom: number };
}): number {
  if (opening || newMenu) return highlight ? leastScroll(highlight.top, highlight.bottom, current, viewport) : scrollHeight;
  if (menuOpen) return current;
  return atEnd ? scrollHeight : current;
}

/** The picked row as a short label: the marker characters dropped, spaces tidied, long text cut. */
export function selectionLabel(row: string, max = 60) {
  const text = row.replace(/^[\s›>▸▶●○◉◯❯*→\-]+/, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A one-line reminder of how to work a menu, from the keys that are on offer. */
export function menuHint(keys: string[]) {
  const parts: string[] = [];
  if (keys.includes('up') || keys.includes('down')) parts.push(t('utils.terminal.move'));
  if (keys.includes('left') || keys.includes('right')) parts.push('←→');
  if (keys.includes('enter')) parts.push(t('utils.terminal.confirm'));
  if (keys.includes('escape')) parts.push(t('utils.terminal.escape'));
  return parts.join(' · ');
}
