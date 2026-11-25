/** Put the groups in the order of `ids`. Groups not listed keep their relative order at the end; unknown ids are ignored. */
export function applyOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const listed = [...new Set(ids)].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const seen = new Set(listed.map(item => item.id));
  return [...listed, ...items.filter(item => !seen.has(item.id))];
}

/** Move one id to `index` (clamped). An id that is not in the list leaves it unchanged. */
export function moveId(ids: string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const rest = ids.filter(item => item !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}

/** Where a dragged row belongs: how many of the other rows (given by their middle line) sit above the pointer. */
export function indexAt(middles: number[], y: number): number {
  return middles.filter(middle => middle < y).length;
}
