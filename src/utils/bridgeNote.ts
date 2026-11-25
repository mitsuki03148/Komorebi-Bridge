// Bridge adds a roster (or single-room) note after the Founder's first prompt. Keep it out of the way: the words the Founder wrote, then a folded note.
// Keep the historical prefix: the attachment transcript parser recognizes it too.
export const groupRosterPrefix = '我哋而家係協作狀態。崗位／原生 Session ID：';
const marker = /\s*=====\s*(?=我哋而家係協作狀態|呢間係單人房)/;

/** A native transcript can echo a prompt with an appended Bridge note. */
export const startsWithBridgeNote = (text: string) => text.search(marker) === 0;

export function splitBridgeNote(text: string): { main: string; note: string } {
  const at = text.search(marker);
  if (at < 0) return { main: text, note: '' };
  return { main: text.slice(0, at).trimEnd(), note: text.slice(at).replace(marker, '').trim() };
}

/** The note as short lines: one per member group, one per sentence block. */
export function noteLines(note: string): string[] {
  return note.split(/　+|(?<=[。])\s+/).map(line => line.trim()).filter(Boolean);
}
