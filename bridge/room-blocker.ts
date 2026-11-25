import type { TerminalRoom } from '../src/types/guild';
import { agyComposer, composerText } from './terminal';

export const blockerText = {
  draft: '工作台工單仍留在輸入框，請查看終端',
  locked: '對話正在其他程式開啟，請查看終端',
  answers: '正在等你確認答案，請查看終端',
};

export function roomBlocker(room: TerminalRoom) {
  const screen = room.screen ?? '';
  const tail = screen.split('\n').slice(-40).join('\n').trimEnd();
  if (room.modelId === 'CODEX' && /This conversation is open in another app/.test(tail) &&
      /r retry\s+f fork[^\n]*transcript\s*$/i.test(tail)) return 'locked';
  if (room.modelId === 'CLAUDE' && /^\s*y\. Submit answers\s*\n\s*n\. Cancel\s*\n\s*Enter y\/n:\s*$/m.test(tail) &&
      tail.endsWith('Enter y/n:')) return 'answers';

  let draft = room.modelId === 'AGY' ? agyComposer(screen, 36) : composerText(room.modelId, screen);
  if (room.modelId === 'CODEX') {
    // A wrapped ticket can put its prompt above the normal nine-line footer.
    const rows = tail.split('\n');
    const prompt = rows.findLastIndex(line => /^\s*›/.test(line));
    const lines = rows.slice(prompt);
    if (prompt < 0 || !lines.slice(1).every(line => /^\s|^$/.test(line)) ||
        !lines.slice(1).some(line => /^\s*(?:GPT|o[134]).*·/i.test(line))) return;
    draft = lines[0].trimStart().slice(1).trim();
  }
  if (/^\[(?:工作台 #\d+|交接｜來自 工作台\])/.test(draft ?? '')) return 'draft';
}
