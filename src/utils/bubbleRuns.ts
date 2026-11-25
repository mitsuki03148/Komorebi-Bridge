import { t, getLang, localeOf } from '../i18n';
import type { TerminalLogEntry } from '../types/guild';

export interface BubbleItem { entry: TerminalLogEntry; key: string; header: boolean; day?: string; /** How many times the same system line came in a row (shown as ×N). */ count?: number }

/** A message another agent handed to a room starts with this tag; it is not something the user said. */
export const handoffTag = /^\[交接｜來自 ([^\]]+)\]\s*/;
/** A workbench ticket handed to a room (or the notice that one was finished) arrives as `[交接｜來自 X] [工作台 #N…`. A group already shows it as a small line, so the long text is not shown again, and a bare `[工作台 #N…` ticket line is hidden the same way, in groups and single rooms.
 * The "你的工作台有 N 張新工單" wake message is not hidden but shown as one small line (`benchWakeAsLine`): it is the sign that a room was handed work and woken. The Bridge's own "工單提示：" reminder to a stuck ticket is traffic between agents and is hidden. */
export const isBenchWakeNotice = (entry: TerminalLogEntry) => entry.sender === 'user' && /^\[交接｜來自 工作台\]\s*工單提示：/.test(entry.text);
export const isBenchDelivery = (entry: TerminalLogEntry) => isBenchWakeNotice(entry) ||
  (entry.sender === 'user' && /^(?:\[交接｜來自 [^\]]+\]\s*)?\[工作台 #\d+/.test(entry.text));
/**
 * The Bridge's "你的工作台有 N 張新工單：#813 …。內容會自動附上；如未見到：/path/… bench mine --from …" wake message is written for the agent.
 * The Founder sees it as one small line ("工作台：新工單 #813 …"), not as a chat bubble with the command in it.
 */
export function benchWakeAsLine(entry: TerminalLogEntry): TerminalLogEntry {
  if (entry.sender !== 'user') return entry;
  const match = /^\[交接｜來自 工作台\]\s*你的工作台有 \d+ 張新工單：([\s\S]*?)(?:。內容會自動附上|$)/.exec(entry.text);
  if (!match) return entry;
  const list = match[1].replace(/\s+/g, ' ').trim();
  return { ...entry, sender: 'system', text: `工作台：新工單 ${list.length > 90 ? `${list.slice(0, 89)}…` : list}` };
}
/** Who is speaking: the user, an agent, a system line, or (for a handoff) the agent who handed the work over. */
const speakerOf = (entry: TerminalLogEntry) => entry.sender === 'user' ? (entry.text.match(handoffTag)?.[1] ? `handoff:${entry.text.match(handoffTag)![1]}` : 'user') : entry.sender;

const runGapMs = 5 * 60_000;
const timeOf = (entry: TerminalLogEntry) => (entry.createdAt ? Date.parse(entry.createdAt) : NaN);
const dayKey = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; };

/** 今日 / 昨日 / 11月12日 */
export function dayLabel(at: number, now = Date.now()) {
  const diff = (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000;
  if (diff === 0) return t('utils.day.today');
  if (diff === 1) return t('utils.day.yesterday');
  const date = new Date(at);
  return getLang() === 'zh' ? t('utils.day.monthdate', { month: date.getMonth() + 1, day: date.getDate() }) : new Intl.DateTimeFormat(localeOf(getLang()), { month: 'long', day: 'numeric' }).format(date);
}

/**
 * Decides, for each message, whether it shows its name and time (the first of a run by the same speaker),
 * and where a new day starts. `key` tells speakers apart: a member room in a group, or the room itself.
 */
export function bubbleRuns(all: { entry: TerminalLogEntry; key: string }[], now = Date.now()): BubbleItem[] {
  // The same system line repeated in a stretch of system lines (rooms closing and reopening) becomes one line with a count.
  const items: { entry: TerminalLogEntry; key: string; count?: number }[] = [];
  let stretch: Map<string, number> | undefined;
  for (const item of all) {
    if (item.entry.sender !== 'system') { stretch = undefined; items.push(item); continue; }
    stretch ??= new Map();
    const id = `${item.key}\u0000${item.entry.text}`;
    const at = stretch.get(id);
    if (at === undefined) { stretch.set(id, items.length); items.push({ ...item, count: 1 }); }
    else { const earlier = items[at]; items[at] = { entry: item.entry, key: earlier.key, count: (earlier.count ?? 1) + 1 }; }
  }
  return items.map(({ entry, key, count }, index) => {
    const before = items[index - 1];
    const at = timeOf(entry);
    const beforeAt = before ? timeOf(before.entry) : NaN;
    let header = true;
    if (before && entry.sender !== 'system' && before.entry.sender !== 'system' && speakerOf(before.entry) === speakerOf(entry) && before.key === key &&
        Number.isFinite(at) && Number.isFinite(beforeAt) && at - beforeAt >= 0 && at - beforeAt < runGapMs) header = false;
    let day: string | undefined;
    if (Number.isFinite(at)) {
      if (before && Number.isFinite(beforeAt)) { if (dayKey(at) !== dayKey(beforeAt)) day = dayLabel(at, now); }
      else if (!before && dayKey(at) !== dayKey(now)) day = dayLabel(at, now);
    }
    // A new day always starts a new run, so the name and time show again after midnight.
    if (day) header = true;
    return { entry, key, header, day, count: count && count > 1 ? count : undefined };
  });
}
