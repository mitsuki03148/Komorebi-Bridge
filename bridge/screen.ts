import type { IBufferCell, Terminal } from '@xterm/headless';
import type { TerminalStyleRun } from '../src/types/guild';

const basicColors = [
  '#1c1c1c', '#cd3131', '#0dbc79', '#e5b567', '#528bff', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#777777', '#f14c4c', '#23d18b', '#f5f543', '#7da6ff', '#d670d6', '#29b8db', '#ffffff',
];
const levels = [0, 95, 135, 175, 215, 255];
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function paletteColor(index: number) {
  if (index < 16) return basicColors[index];
  if (index < 232) {
    const cube = index - 16;
    return hex(levels[Math.floor(cube / 36)] * 65536 + levels[Math.floor(cube / 6) % 6] * 256 + levels[cube % 6]);
  }
  return hex((8 + (index - 232) * 10) * 65793);
}

function cellStyle(cell: IBufferCell) {
  const foreground = cell.isFgDefault() ? undefined : cell.isFgRGB() ? hex(cell.getFgColor()) : paletteColor(cell.getFgColor());
  const background = cell.isBgDefault() ? undefined : cell.isBgRGB() ? hex(cell.getBgColor()) : paletteColor(cell.getBgColor());
  return {
    foreground: cell.isInverse() ? background ?? 'var(--terminal-bg)' : foreground,
    background: cell.isInverse() ? foreground ?? 'var(--terminal-fg)' : background,
    bold: Boolean(cell.isBold()) || undefined,
    underline: Boolean(cell.isUnderline()) || undefined,
  };
}

export function readTerminalScreen(terminal: Terminal, rows: number) {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  const styles: TerminalStyleRun[] = [];
  const scratch = buffer.getNullCell?.();
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row);
    const text = line?.translateToString(true) ?? '';
    for (let col = 0, index = 0; line && col < line.length && index < text.length; col++) {
      const cell = line.getCell(col, scratch);
      if (!cell || !cell.getWidth()) continue;
      const start = offset + index;
      index += cell.getChars().length || 1;
      if (cell.isAttributeDefault()) continue;
      const style = cellStyle(cell);
      if (!Object.values(style).some(Boolean)) continue;
      const end = offset + Math.min(index, text.length);
      const previous = styles.at(-1);
      if (previous?.end === start && previous.foreground === style.foreground && previous.background === style.background &&
          previous.bold === style.bold && previous.underline === style.underline) previous.end = end;
      else styles.push({ start, end, ...style });
    }
    lines.push(text);
    offset += text.length + 1;
  }
  const screen = lines.join('\n').trimEnd();
  return { screen, styles: styles.filter(run => run.start < screen.length).map(run => ({ ...run, end: Math.min(run.end, screen.length) })) };
}
