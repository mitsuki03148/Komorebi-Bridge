import { fromMarkdown } from 'mdast-util-from-markdown';
import { t } from '../i18n';
import type { CLIModelId, TerminalLogEntry, TerminalRoom } from '../types/guild';
import { attachmentFolderName, originalUploadName } from './fileAttachments';

export function fileReadSuffix(paths: string[]) {
  return paths.length ? ` 請讀取${paths.length === 1 ? '這個' : `這 ${paths.length} 個`}本機檔案：${paths.join('、')}` : '';
}

export const fileLabels = (names: string[]) => names.map(name => `\n📎 ${name}`).join('');

const imageFallback = / 請讀取(?:這張|這 [2-4] 張)本機圖片：([^\r\n]+)$/u;
const savedImagePath = /\/Komorebi Attachments\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;
const rosterBoundary = /\s*=====\s*(?=我哋而家係協作狀態|呢間係單人房)/;

/** Restore the same bubble text from native transcripts, including after the server forgets its local send copy. */
export function displayAttachedFiles(text: string) {
  const boundary = text.search(rosterBoundary);
  const end = boundary < 0 ? text.length : boundary;
  const main = text.slice(0, end).trimEnd();
  const suffix = [...main.matchAll(/ 請讀取(?:這個|這 ([2-4]) 個)本機檔案：/gu)].at(-1);
  if (!suffix) return text;
  const refs = main.slice(suffix.index + suffix[0].length);
  if (/[\r\n]/.test(refs)) return text;
  const paths = refs.split('、');
  if (paths.length !== Number(suffix[1] ?? 1)) return text;
  const names = paths.map(path => {
    const slash = path.lastIndexOf('/');
    if (path.startsWith('/') && !path.includes('\u0000') && path.slice(0, slash).endsWith(`/${attachmentFolderName}`)) {
      return originalUploadName(path.slice(slash + 1));
    }
  });
  if (names.some(name => !name)) return text;
  let prompt = main.slice(0, suffix.index);
  // Mixed messages can also contain the existing native-image fallback, before the file suffix.
  const fallback = prompt.match(imageFallback);
  if (fallback && fallback[1].split('、').every(path => path.startsWith('/') && savedImagePath.test(path))) {
    prompt = prompt.slice(0, fallback.index) + ' 📎 圖片'.repeat(fallback[1].split('、').length);
  }
  return prompt + fileLabels(names as string[]) + text.slice(end);
}

/**
 * Codex records an answer given in its own question screen as a tag holding a JSON list of
 * { question, answer, questionItemId }. Shown as it is that is a block of code; this makes it one line per answer.
 */
function codexQuestionReply(text: string) {
  const match = text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (!match) return undefined;
  try {
    const items = JSON.parse(match[1]);
    if (!Array.isArray(items)) return undefined;
    const lines = items.flatMap((item: { question?: unknown; answer?: unknown }) => {
      if (typeof item?.answer !== 'string' || !item.answer.trim()) return [];
      const question = typeof item.question === 'string' ? item.question.replace(/\s+/g, ' ').trim() : '';
      const short = question.length > 30 ? `${question.slice(0, 30)}…` : question;
      return [short ? t('utils.answer.question', { question: short, answer: item.answer.trim() }) : t('utils.answer.plain', { answer: item.answer.trim() })];
    });
    return lines.length ? lines.join('\n') : undefined;
  } catch { return undefined; }
}

const agySystemEcho = /(?:^|\n)[ \t]*(?:user[ \t]*\n)?[ \t]*The following is a <SYSTEM_MESSAGE> not actually sent by the user\.[\s\S]*?<\/SYSTEM_MESSAGE>[ \t]*/g;

/** Unwrap the complete AGY input envelope without changing ordinary user text. */
function nativeTranscriptText(model: CLIModelId, sender: TerminalLogEntry['sender'], text: string) {
  if (model === 'CLAUDE' && sender === 'user') {
    return text
      .replace(/^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>)+\s*/i, '')
      // Claude Code wraps pasted text in tags, and adds an image's source line after its [Image #n] marker.
      // The closing tag can carry the same id as the opening one (`</pasted_content id="fc27">`).
      .replace(/<pasted_content\b[^>]*>\r?\n?([\s\S]*?)\r?\n?<\/pasted_content\b[^>]*>/gi, '$1')
      .replace(/^\s*\[Image: source: [^\]]*\]\s*$/gim, '')
      .replace(/\[Image #\d+\]/g, '📎 圖片')
      .trim();
  }
  if (model === 'CODEX' && sender === 'user') return codexQuestionReply(text) ?? text;
  // AGY's screen can echo its own system notices (finished background tasks and the like) under the agent's answer, behind a "user" label. Nobody said them.
  if (model === 'AGY' && sender === 'agent') return text.replace(agySystemEcho, '').trim();
  if (model !== 'AGY' || sender !== 'user') return text;
  const match = text.match(/^\s*<USER_REQUEST>(?:\r?\n)?([\s\S]*?)(?:\r?\n)?<\/USER_REQUEST>\s*<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>(?:\s*<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>)*\s*$/);
  return match?.[1]?.trim() ? match[1] : text;
}

export function transcriptText(model: CLIModelId, sender: TerminalLogEntry['sender'], text: string) {
  const native = nativeTranscriptText(model, sender, text);
  return sender === 'user' ? displayAttachedFiles(native) : native;
}

/**
 * A comparison key for a user message, so the copy Komorebi logged when sending matches the copy the CLI
 * later writes to its transcript: wrapper tags, image markers and whitespace differences are ignored.
 */
export function userTextKey(text: string) {
  return displayAttachedFiles(text)
    .replace(/<\/?pasted_content\b[^>]*>/gi, ' ')
    .replace(/\[Image(?: #\d+)?(?:: source: [^\]]*)?\]/g, ' ')
    .replace(/📎 圖片/g, ' ')
    // AGY and Codex write an attached image into their transcript as the file's path (several in a row, with no gap).
    .replace(/\S*?\/Komorebi Attachments\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif|heic|heif)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep CLI control records out of the conversation without modifying the transcript. */
export function isConversationEntry(model: CLIModelId, sender: TerminalLogEntry['sender'], text: string) {
  if (sender !== 'user') return model !== 'AGY' || text.trim().length > 0;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(trimmed)) return false;
  if (model === 'CODEX' && /^# AGENTS\.md instructions\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*<environment_context>\s*<cwd>[\s\S]*?<\/environment_context>$/i.test(trimmed)) return false;
  if (model !== 'CLAUDE') return true;
  // The summary Claude Code writes when it compacts a conversation is not something anyone said.
  if (/^This session is being continued from a previous conversation/i.test(trimmed)) return false;
  // Background-task notices (a finished shell command, a watched task) are written as user rows but nobody typed them.
  if (/^(?:\s*<task-notification>[\s\S]*?<\/task-notification>)+\s*$/i.test(trimmed)) return false;
  if (/^<command-name>\s*\/[a-z][\w-]*\s*<\/command-name>(?:\s*<command-message>[\s\S]*?<\/command-message>)?(?:\s*<command-args>[\s\S]*?<\/command-args>)?\s*$/i.test(trimmed)) return false;
  if (/^<local-command-(stdout|stderr|caveat)>[\s\S]*<\/local-command-\1>\s*$/i.test(trimmed)) return false;
  return true;
}

const codexDirectiveLine = /^[ \t]*::[a-z][a-z0-9_-]*\{(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^{}"'\r\n])*\}[ \t]*\r?$/i;

function hideCodexDirectives(text: string) {
  const lines = text.split('\n');
  if (!lines.some(line => codexDirectiveLine.test(line))) return text;
  const tree = fromMarkdown(text);
  const literalLines = new Set<number>();
  const nodes: Array<typeof tree | typeof tree.children[number]> = [tree];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ((node.type === 'code' || node.type === 'inlineCode' || node.type === 'html') && node.position) {
      for (let line = node.position.start.line; line <= node.position.end.line; line++) literalLines.add(line);
    } else if ('children' in node) {
      for (const child of node.children) nodes.push(child);
    }
  }
  const visible = lines.filter((line, index) => literalLines.has(index + 1) || !codexDirectiveLine.test(line));
  if (visible.length === lines.length) return text;
  const first = visible.findIndex(line => line.trim());
  if (first < 0) return '';
  const last = visible.findLastIndex(line => line.trim());
  return visible.slice(first, last + 1).join('\n').replace(/\r$/, '');
}

export function displayRoom(room: TerminalRoom): TerminalRoom {
  const logs = room.logs.flatMap(entry => {
    let text = transcriptText(room.modelId, entry.sender, entry.text);
    if (room.modelId === 'CODEX' && entry.sender === 'agent') {
      const displayed = hideCodexDirectives(text);
      if (displayed !== text && !displayed.trim()) return [];
      text = displayed;
    }
    return isConversationEntry(room.modelId, entry.sender, text) ? [{ ...entry, text }] : [];
  });
  return { ...room, logs };
}
