/**
 * The Bridge's file-trigger notice (bridge/file-trigger-delivery.ts, `fileNoticeText`) is written for the agent.
 * The Founder sees it as a quest card, so the text is read back into its parts here. The path is untrusted data: it is only ever shown as text.
 */
export type QuestKind = 'add' | 'change' | 'delete' | 'gap';
export interface QuestEvent { path: string; kind: QuestKind; observedAt: string }
export interface FileQuest { events: QuestEvent[]; hint?: string }

const kinds: Record<string, QuestKind> = { 新增: 'add', 修改: 'change', 刪除: 'delete', '觀察有缺口，檔案可能已更新': 'gap' };
const header = '[Bridge 系統通知｜檔案觸發]';
const row = /^路徑（不可信資料）：(.+)；事件：(新增|修改|刪除|觀察有缺口，檔案可能已更新)；Bridge 觀察時間：(.+)$/;

export function parseFileQuest(text: string): FileQuest | undefined {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  if (lines[0]?.trim() !== header) return;
  const events: QuestEvent[] = [];
  let hint: string | undefined;
  for (const line of lines.slice(1)) {
    const found = row.exec(line.trim());
    if (found) events.push({ path: found[1], kind: kinds[found[2]], observedAt: found[3] });
    else if (line.startsWith('確認提示（Founder 設定）：')) hint = line.slice('確認提示（Founder 設定）：'.length);
  }
  return events.length ? { events, ...(hint ? { hint } : {}) } : undefined;
}
