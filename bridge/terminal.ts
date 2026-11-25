import { randomUUID } from 'node:crypto';
import type { CLIModelId, EffortLevel, PendingApproval } from '../src/types/guild';

export interface ApprovalPrompt {
  fingerprint: string;
  card: PendingApproval;
  yes: string;
  no: string;
  additional: Record<string, string>;
  numbered: Record<string, string>;
}

const numberedOption = /^\s*(?:\(selected\)\s*)?[›>❯]?\s*([1-9])\.\s+(.*\S)\s*$/;

function choiceId(label: string, key: string) {
  if (/switch to auto mode/i.test(label)) return 'auto';
  if (/don['’]t ask again/i.test(label)) return 'remember';
  return `option-${key}`;
}

const trustHeading = /(?:Do you trust the contents of this (?:project|directory)\?|Permission Required: Accessing workspace:|Trust this folder\?)/i;
const approvalHeadings = {
  AGY: /^\s*(?:Requesting permission for:|Do you want to (?:apply|allow)|Apply this (?:edit|change)\?)/i,
  CODEX: /^\s*(?:Would you like to (?:run|make|apply|allow)|Do you trust the contents of this directory\?)/i,
  CLAUDE: /^\s*(?:Permission Required:|This mode should only be used in a sandboxed)/i,
};

export function approvalPrompt(model: CLIModelId, screen: string): ApprovalPrompt | undefined {
  if (isComposer(model, screen)) return;
  const lines = screen.split('\n');
  const header = lines.findLastIndex(line => trustHeading.test(line) || approvalHeadings[model].test(line));
  if (header < 0) return;
  const folderHeader = model === 'CODEX' && /Trust this folder\?/i.test(lines[header])
    ? lines.slice(0, header).findLastIndex(line => /^\s*Folder access\s*$/i.test(line)) : -1;
  const body = lines.slice(folderHeader >= 0 ? folderHeader : header);
  const isTrust = trustHeading.test(lines[header]);
  const text = body.join('\n').trim();
  const yesLine = body.findIndex(line =>
    /^\s*(?:\(selected\)\s*)?[›>❯]?\s*(?:(?:1|y)\.\s*)?(?:Yes(?:$|, (?:I trust this folder|proceed|run command|apply|allow|continue))|Allow once)(?:\s*\([^)]*\))?\s*$/i.test(line));
  const noLine = body.findIndex((line, index) => index > yesLine &&
    /^\s*(?:\(selected\)\s*)?[›>❯]?\s*(?:(?:[1-9]|n)\.\s*)?(?:No(?:[,. ]|$)|Deny\b|Reject\b|Cancel\b)/i.test(line));
  let yes: string;
  let no: string;
  const additional: ApprovalPrompt['additional'] = {};
  const numbered: ApprovalPrompt['numbered'] = {};
  const additionalChoices: NonNullable<PendingApproval['additionalChoices']> = [];
  const addChoice = (key: string, label: string, response: string) => {
    const id = choiceId(label, key);
    numbered[key] = response;
    if (additional[id]) return;
    additional[id] = response;
    additionalChoices.push({ id, key, label });
  };
  const codexTrust = model === 'CODEX' && isTrust && /Trust this folder\?/i.test(text) &&
    /^\s*[›>❯]?\s*1\.\s*Trust and continue\s*$/im.test(text) &&
    /^\s*[›>❯]?\s*2\.\s*Back to Agent Command Center\s*$/im.test(text) && /enter continue\s*·\s*esc back/i.test(text);
  if (model === 'CLAUDE' && /This mode should only be used in a sandboxed/i.test(text) &&
      /^\s*y\.\s*Yes, I accept\s*$/im.test(text) && /^\s*n\.\s*No, exit\s*$/im.test(text) && /Enter y\/n:/i.test(text)) {
    yes = 'y\r';
    no = 'n\r';
  } else if (codexTrust) {
    const selected = body.findIndex(line => /^\s*[›>❯]\s*[12]\.\s*/.test(line));
    if (selected < 0) return;
    const onFirst = /^\s*[›>❯]\s*1\./.test(body[selected]);
    yes = (onFirst ? '' : '\x1b[A') + '\r';
    no = (onFirst ? '\x1b[B' : '') + '\r';
  } else if (model === 'CLAUDE' && isTrust && /\bEnter y\/n:/i.test(text) && yesLine >= 0 && noLine > yesLine) {
    yes = 'y\r';
    no = 'n\r';
  } else if (model === 'CLAUDE' && /Select with numbers \[1-[1-9]\]/i.test(text) && yesLine >= 0 && noLine > yesLine) {
    const first = body[yesLine].match(numberedOption);
    const last = body[noLine].match(numberedOption);
    if (!first || first[1] !== '1' || !/^Yes$/i.test(first[2]) || !last || !/^No\b/i.test(last[2])) return;
    yes = '1\r';
    no = last[1] + '\r';
    numbered['1'] = yes;
    numbered[last[1]] = no;
    if (!isTrust) {
      for (const line of body.slice(yesLine + 1, noLine)) {
        const option = line.match(numberedOption);
        if (option) addChoice(option[1], option[2], option[1] + '\r');
      }
    }
  } else if (yesLine >= 0 && noLine > yesLine && /(?:enter (?:to confirm|confirm|continue)|esc to cancel|↑\/↓ Navigate)/i.test(text)) {
    const options = body.slice(yesLine, noLine + 1).filter(line => /^\s*[›>❯]?\s*(?:[1-9]\.\s*|Yes, I trust this folder|No, exit)/i.test(line));
    const current = options.findIndex(line => /^\s*[›>❯]/.test(line));
    if (current < 0 || options.length < 2) return;
    // Only the explicit one-time response is selected. Intermediate entries may grant persistent access.
    yes = '\x1b[A'.repeat(current) + '\r';
    no = '\x1b[B'.repeat(options.length - 1 - current) + '\r';
    const move = (index: number) => (index > current ? '\x1b[B'.repeat(index - current) : '\x1b[A'.repeat(current - index)) + '\r';
    options.forEach((line, index) => {
      const key = line.match(/^\s*[›>❯]?\s*([1-9])\./)?.[1];
      if (!key) return;
      if (index === 0 || index === options.length - 1) numbered[key] = move(index);
      else if (!isTrust) addChoice(key, line.replace(/^\s*[›>❯]?\s*\d+\.\s*/, '').trim(), move(index));
    });
  } else if (model === 'AGY' && /(?:\(y\/n\)|\[y\/n\]|\by\s+to (?:allow|approve)[^\n]*\bn\s+to (?:deny|reject))/i.test(text)) {
    yes = 'y';
    no = 'n';
  } else return;

  const diffLines = body.flatMap(line => {
    const match = line.match(/^\s*[│║]?\s*(?:(\d+)\s+)?([+-])\s?(.*\S.*)$/);
    if (!match || /^[\s-]+$/.test(match[3])) return [];
    return [{ type: match[2] === '+' ? 'add' as const : 'del' as const, lineNum: match[1] ?? '', content: match[3] }];
  });
  return {
    fingerprint: body.map(line => line.replace(/^([\s│║]*)[›>❯]/, '$1 ').trim()).join('\n'),
    yes, no, additional, numbered,
    card: {
      id: randomUUID(), title: /This mode should only be used in a sandboxed/i.test(text) ? '確認啟用全權模式' : isTrust ? 'CLI 要求信任工作目錄' : 'CLI 等待一次性授權',
      type: isTrust ? 'workspace_trust' : diffLines.length ? 'file_edit' : 'shell_command',
      reason: isTrust ? '請核對目錄，再決定可不可以給 CLI 信任。' : '請核對終端原文，再決定這次操作。',
      commandOrFile: text, riskLevel: isTrust ? 'elevated' : 'normal',
      diffLines, requestedAt: new Date().toLocaleTimeString(), additionalChoices,
    },
  };
}

export function visibleMenu(model: CLIModelId, screen: string, requested: string | undefined) {
  if (!screen.trim() || isComposer(model, screen) || hasWorkingIndicator(screen) || (model === 'AGY' && agyQuestionScreen(screen))) return;
  const menu = (title: string, confirm: boolean) => ({ title, confirm });
  if (model === 'AGY' && /^\s*[>›❯]?\s*Project\s*$/im.test(screen) &&
      /Shared with Antigravity/i.test(screen) && /^\s*[>›❯]?\s*Global\s*$/im.test(screen) &&
      /Keyboard:.*↑\s*\/\s*↓\s*Navigate.*enter\s+Save.*esc\s+Close/i.test(screen)) {
    return menu('規則設定', true);
  }
  const command = requested?.split(' ')[0];
  if (command === '/config') return menu('CLI 設定', true);
  if (command === '/permissions') return menu('權限設定', true);
  if ((command === '/model' || command === '/effort') &&
    /^\s*(?:[╭│┌└]\s*)?(?:Select (?:a )?model|Switch Model|Set Model|Choose (?:a )?model|Select (?:a )?reasoning|Select Reasoning|Set Effort|Select effort)/im.test(screen)) {
    return menu('模型／推理力度', true);
  }
  if (command === '/resume' &&
    /^\s*(?:[╭│┌└]\s*)?(?:Resume (?:a|from) (?:previous )?(?:session|conversation)|Select a session|Session Picker|Resume Session|Recent conversations)/im.test(screen)) {
    return menu('工作階段選單', true);
  }
  if (command === '/usage') {
    if (model === 'CODEX' && /^\s*(?:Usage|Usage limit resets|Redeem reset|Earned resets?)\s*$/im.test(screen)) {
      return menu('Codex 用量及 Reset', true);
    }
    if (model !== 'CODEX' && /(?:Models & Quota|^\s*Current session|^\s*Current week)/im.test(screen)) {
      return menu('用量', false);
    }
  }
  if (command === '/remote-control' && /(?:Enable Remote Control|Disconnect Remote Control|Select with numbers|esc (?:close|back|cancel))/i.test(screen)) {
    return menu('Remote Control', true);
  }
  if (command === '/review' && /(?:Review presets|Select a review)/i.test(screen)) return menu('Review', true);
  // Claude's question card with several questions ends here: nothing is sent until y.
  if (answersReview(model, screen)) return menu('提交答案', true);
  const footer = screen.split('\n').slice(-10).join('\n');
  if (!/(?:permission required|trust this|approve|allow this|do you want to (?:allow|run|apply))/i.test(screen) &&
      (numberedMenuChoices(model, screen).size > 0 && /select with numbers/i.test(footer) ||
       command && /(?:enter (?:to )?(?:confirm|select)|↑\s*\/\s*↓\s+navigate)/i.test(footer))) return menu('CLI 選單', true);
  if (requested) return menu('CLI 畫面', false);
}

export function numberedMenuChoices(model: CLIModelId, screen: string) {
  const footer = screen.split('\n').slice(-10).join('\n');
  const options = [...screen.matchAll(/^[ \t│║]*([›>❯])?[ \t]*(?:\(selected\)[ \t]*)?([1-9])[.)][ \t]+\S[^\n]*/gm)];
  const choices = new Map<string, string>();
  if (/select with numbers/i.test(footer) || model === 'CLAUDE') {
    const submit = /select with numbers[^\n]*then enter to submit/i.test(footer) ? '\r' : '';
    for (const option of options) choices.set(option[2], option[2] + submit);
  } else if (/enter (?:to )?(?:confirm|select|open)/i.test(footer)) {
    // Only translate digits into arrows for one contiguous, visibly selected list.
    const selected = options.findIndex(option => option[1]);
    if (selected < 0 || options.filter(option => option[1]).length !== 1 ||
        options.some((option, index) => Number(option[2]) !== index + 1 ||
          index > 0 && option.index !== options[index - 1].index + options[index - 1][0].length + 1)) return choices;
    options.forEach((option, index) => choices.set(option[2],
      (index < selected ? '\x1b[A' : '\x1b[B').repeat(Math.abs(index - selected)) + '\r'));
  }
  return choices;
}

/** Claude's last step of a question card with several questions: "Review your answers", then "Enter y/n:". */
export function answersReview(model: CLIModelId, screen: string) {
  if (model !== 'CLAUDE') return false;
  const lines = screen.split('\n').slice(-16).join('\n');
  return /^\s*Review your answers\s*$/im.test(lines) && /^\s*y\.\s*Submit answers\s*$/im.test(lines) &&
    /^\s*n\.\s*Cancel\s*$/im.test(lines) && /Enter y\/n:[ \t]*\w*[ \t]*$/im.test(lines);
}

export function modelConfirmationChoices(model: CLIModelId, screen: string) {
  if (model !== 'CLAUDE') return false;
  if (answersReview(model, screen)) return true;
  const lines = screen.split('\n').slice(-12).join('\n');
  return /^\s*Switch model\?\s*$/im.test(lines) &&
    /^\s*y\.\s*Yes,\s*switch to\s+\S/im.test(lines) &&
    /^\s*n\.\s*No,\s*go back\s*$/im.test(lines) && /Enter y\/n:\s*$/im.test(lines);
}

export function hasWorkingIndicator(screen: string) {
  const tail = screen.split('\n').slice(-14).join('\n');
  // AGY draws a braille spinner in front of whatever it is doing ("Reading file...", "Running command...", "Searching..."),
  // so the spinner glyph itself is the signal and the verb does not need to be known.
  return /(?:esc to interrupt|ctrl\+c to interrupt|\bWorking(?: \(|…|\.{3})|\bThinking(?:…|\.{3})|\bRunning(?: command)?(?:…|\.{3}))/i.test(tail)
    || /^[ \t]*[\u2801-\u28ff][ \t]+\S[^\n]*(?:…|\.{3})[ \t]*$/m.test(tail);
}

/**
 * How many background tasks the CLI says are still running, read from its footer or completion line:
 * Codex "· 1 background terminal running · /ps to view", Claude "· 1 shell · ↓ to manage" or "1 shell still running",
 * AGY "· 1 task(s) · /tasks". Each needs its own wording around the number, so a message that only mentions one does not count.
 */
export function backgroundTasks(model: CLIModelId, screen: string): number {
  const tail = screen.split('\n').slice(-14).join('\n');
  const count = (pattern: RegExp) => Number(tail.match(pattern)?.[1] ?? 0);
  if (model === 'CODEX') return count(/\b(\d+) background terminals? running\b[^\n]*\/ps to view/i);
  if (model === 'CLAUDE') return count(/·\s*(\d+) shells?\s*·\s*↓ to manage/i) || count(/\b(\d+) shells? still running\b/i);
  return count(/\b(\d+) task\(s\)\s*·\s*\/tasks\b/i);
}

const agyDivider = /^[ \t]*─{8,}[ \t]*$/;
const agyContinuationLimit = 12;
const composerFooterRows = 9;
const agyMenuHint = /(?:\b(?:enter (?:to )?(?:confirm|continue|open|select)|select with numbers|esc (?:to )?(?:back|close))\b|↑\s*\/\s*↓\s*navigate)/i;

export function agyComposer(screen: string, continuationLimit = agyContinuationLimit): string | undefined {
  const lines = screen.split('\n').slice(-(composerFooterRows + continuationLimit + 2));
  for (let row = lines.length - 1; row > 0; row--) {
    const prompt = lines[row].match(/^[ \t]*>[ \t]*(.*)$/);
    if (!prompt || !agyDivider.test(lines[row - 1])) continue;
    const end = lines.findIndex((line, index) => index > row && agyDivider.test(line));
    if (end <= row || end - row - 1 > continuationLimit || end < lines.length - composerFooterRows) return;
    const footer = lines.slice(end + 1);
    // AGY keeps the box visible while it works. A lone "esc to cancel" is its stop hint.
    if (agyMenuHint.test(footer.join('\n')) || footer.some(line => trustHeading.test(line) || approvalHeadings.AGY.test(line))) return;
    return [prompt[1], ...lines.slice(row + 1, end)].map(line => line.trim()).filter(Boolean).join(' ');
  }
}

function claudeComposer(screen: string): string | undefined {
  const lines = screen.split('\n');
  const last = lines.findLastIndex(line => line.trim() !== '');
  if (last < 0) return;
  if (/^[ \t]*\$[ \t]*$/.test(lines[last])) return '';
  // The live draft follows Claude's double-space (sometimes NBSP) marker at the screen edge.
  // Require nearby CLI chrome as well: an output example at the bottom can also start with "$".
  const draft = lines[last].match(/^\$[ \u00a0]{2,}(\S.*)$/);
  if (!draft) return;
  const chrome = lines.slice(Math.max(0, last - 7), last);
  if (chrome.some(line => /^\s*\x60{3}|^\s*~{3}/.test(line))) return;
  if (chrome.some(line => /^\s*.*\(shift\+tab to cycle\)(?:\s*·.*)?\s*$/i.test(line)) || hasWorkingIndicator(chrome.join('\n'))) {
    return draft[1].trim();
  }
}

/**
 * The text in the live input box, or undefined when the box cannot be found.
 */
export function composerText(model: CLIModelId, screen: string): string | undefined {
  if (model === 'AGY') return agyComposer(screen);
  if (model === 'CLAUDE') return claudeComposer(screen);
  const footer = screen.split('\n').slice(-9).join('\n');
  const prompt = /^[ \t]*›(?:[ \t]+([^\n]*))?$/gm;
  const last = [...footer.matchAll(prompt)].at(-1);
  return last ? (last[1] ?? '').trim() : undefined;
}

export function isComposer(model: CLIModelId, screen: string) {
  if (model !== 'CODEX') return composerText(model, screen) !== undefined;
  const footer = screen.split('\n').slice(-9).join('\n');
  const prompt = /^[ \t]*›(?:[ \t]+(?![ \t]|[1-9][.)][ \t]).*)?[ \t]*$/gm;
  const current = [...footer.matchAll(prompt)].at(-1);
  if (!current) return false;
  const afterPrompt = footer.slice(current.index + current[0].length);
  const menuHint = /(?:\b(?:enter (?:to )?(?:confirm|continue|open|select)|select with numbers|esc (?:to )?(?:back|close|cancel))\b|↑\s*\/\s*↓\s*navigate)/i;
  if (menuHint.test(afterPrompt)) return false;
  return /^[ \t]*(?:GPT|o[134])[^\n]*·/im.test(afterPrompt);
}

/** Compare one pasted line against every visible row in the Codex input box. */
export function codexDraftMatches(screen: string, message: string) {
  if (message.includes('\n') || !isComposer('CODEX', screen)) return false;
  const footer = screen.split('\n').slice(-9);
  const prompt = footer.findLastIndex(line => /^[ \t]*›(?:[ \t]|$)/.test(line));
  const model = footer.findIndex((line, row) => row > prompt && /^[ \t]*(?:GPT|o[134]).*·/i.test(line));
  if (prompt < 0 || model <= prompt) return false;
  const draft = [footer[prompt].replace(/^[ \t]*›[ \t]*/, ''), ...footer.slice(prompt + 1, model)];
  let offset = 0;
  for (const row of draft.map(line => line.trim()).filter(Boolean)) {
    if (offset > 0 && message[offset] === ' ' && !message.startsWith(row, offset)) offset++;
    if (!message.startsWith(row, offset)) return false;
    offset += row.length;
  }
  return offset > 0 && offset === message.length;
}

export function activeModel(model: CLIModelId, screen: string) {
  const effort = '(low|medium|high|xhigh|max|ultra)';
  const pattern = model === 'AGY'
    // The footer reads "auto · Gemini 4 Hydrogen · medium", or with no mode in front of the name in the default mode;
    // it can share the line with "? for shortcuts", so the name starts at a line start or after a wide gap and has only single spaces inside.
    ? new RegExp('(?:^|\\s{2,})(?:(?:auto|plan|accept-edits|ask|default) · )?(\\S+(?: \\S+)*?) · ' + effort + '\\s*$', 'im')
    : model === 'CODEX'
      // The footer reads "GPT-6.1 Terra high · ~/project", or "GPT-6.1 Terra high Fast · ~/project" with Fast on:
      // a model name may contain spaces, so it ends at the effort word.
      ? new RegExp('^\\s*((?:gpt|o[134])[\\w.-]*(?: [\\w.-]+)*?)\\s+' + effort + '(?:\\s+Fast)?\\s+·', 'im')
      : new RegExp('^\\s*((?:Claude )?(?:Sonnet|Opus|Haiku|Fable|Mythos) [\\d.]+) with ' + effort + ' effort', 'im');
  const match = screen.match(pattern);
  const switched = model === 'CLAUDE' ? [...screen.matchAll(/^\s*Set model to ((?:Claude )?(?:Sonnet|Opus|Haiku|Fable|Mythos) \d+(?:\.\d+)*|claude-[a-z0-9.-]+)(?=\s|$)/gim)].at(-1) : undefined;
  const effortChanged = model === 'CLAUDE' ? [...screen.matchAll(/^\s*Set effort level to (low|medium|high|xhigh|max|ultra)\b/gim)].at(-1) : undefined;
  const name = switched && (!match || switched.index > match.index!) ? switched[1] : match?.[1];
  const selectedEffort = effortChanged && (!match || effortChanged.index > match.index!) ? effortChanged[1] : match?.[2];
  return { name, effort: selectedEffort?.toLowerCase() as EffortLevel | undefined };
}

/**
 * Whether Codex's Fast mode (service tier "priority") is on: the footer reads "GPT-6.1-Sol high Fast · ~/project" with it on and
 * "GPT-6.1-Sol high · ~/project" with it off. Undefined when the footer is not on screen.
 */
export function codexFastMode(screen: string): boolean | undefined {
  const match = screen.match(/^\s*(?:gpt|o[134])[\w.-]*(?: [\w.-]+)*?\s+(?:low|medium|high|xhigh|max|ultra)(\s+Fast)?\s+·/im);
  return match ? Boolean(match[1]) : undefined;
}

export function readUsage(model: CLIModelId, screen: string, selectedModel: string) {
  let scope = screen;
  if (model === 'AGY') {
    const groups = screen.split(/(?=^\s*(?:GEMINI MODELS|CLAUDE AND GPT MODELS|GEMINI 4 ARGON)\s*$)/m);
    const heading = /^Gemini 4 Argon/i.test(selectedModel) ? 'GEMINI 4 ARGON' : /^Gemini/i.test(selectedModel) ? 'GEMINI MODELS' :
      /^(Claude|GPT)/i.test(selectedModel) ? 'CLAUDE AND GPT MODELS' : '';
    scope = heading ? groups.find(group => group.trimStart().startsWith(heading)) ?? '' : '';
  }
  const extract = (label: string) => {
    const match = scope.match(new RegExp('(?:' + label + ')([^\\n]*(?:\\n[^\\n]*){0,2})', 'i'));
    const value = match?.[1].match(/(\d+(?:\.\d+)?)\s*%\s*(used|left|remaining)?/i);
    if (!value) return;
    const used = value[2]?.toLowerCase() === 'used' ||
      (model === 'CLAUDE' && !value[2]);
    const number = Number(value[1]);
    if (number <= 100) return used ? 100 - number : number;
  };
  const hp = extract(model === 'AGY' ? '(?:Gemini 4 Argon )?Five Hour Limit(?: Remaining)?' : model === 'CLAUDE' ? 'Current session' : '5h limit');
  const mp = extract(model === 'AGY' ? '(?:Gemini 4 Argon )?Weekly Limit(?: Remaining)?' : model === 'CLAUDE' ? 'Current week \\(all models\\)' : 'Weekly limit');
  let vouchers: number | undefined;
  if (model === 'CODEX') {
    const resets = screen.match(/(?:earned|banked|available) resets?\s*[:=]\s*(\d+)|\b(\d+) (?:earned|banked|usage limit) resets?\b/i);
    if (resets) vouchers = Number(resets[1] ?? resets[2]);
    else if (/You don.t have any usage limit resets available/i.test(screen)) vouchers = 0;
  }
  return { hp, mp, vouchers };
}

export interface QuestionPanel {
  options: { n: number; label: string }[];
  /** The number the highlight (›) is on. */
  selected?: number;
  /** The number of the free-text choice ("Other"). */
  other?: number;
}

/** Whether Codex has a question open for answering on screen (its footer line reads "enter submit …"). */
export const questionOpen = (screen: string) => /enter submit/i.test(screen.split('\n').slice(-12).join('\n'));

/** The numbered choices of an open question, with the highlighted one and the "Other" one. */
export function questionPanel(screen: string): QuestionPanel | undefined {
  const lines = screen.split('\n');
  const end = lines.findLastIndex(line => /enter submit/i.test(line));
  if (end < 0) return;
  const options: QuestionPanel['options'] = [];
  let selected: number | undefined;
  for (let index = end - 1; index >= 0; index--) {
    const match = lines[index].match(/^\s*(›)?\s*(\d+)\.\s+(.+?)\s*$/);
    if (match) {
      options.unshift({ n: Number(match[2]), label: match[3] });
      if (match[1]) selected = Number(match[2]);
    } else if (options.length) break;
  }
  if (!options.length) return;
  return { options, selected, other: options.find(option => /^other\b/i.test(option.label))?.n };
}

export interface AgyQuestionOption {
  n: number;
  label: string;
  checked?: boolean;
}

export interface AgyQuestionPanel {
  index: number;
  total: number;
  title: string;
  multiSelect: boolean;
  writeInOpen: boolean;
  typed: string;
  options: AgyQuestionOption[];
  selected?: number;
  other?: number;
}

/**
 * Reads an open AGY `ask_question` screen ("Question k/N: ...", numbered options with optional `[ ]`/`[x]` checkboxes
 * and a final `Write-in...` choice, or the open `Your answer:` write-in text box).
 */
export function agyQuestionScreen(screen: string): AgyQuestionPanel | undefined {
  if (isComposer('AGY', screen) || hasWorkingIndicator(screen)) return;
  const lines = screen.split('\n');
  const footerAt = lines.findLastIndex(line =>
    /(?:↑\/↓ Navigate\s*·[^\n]*\besc Skip\b|\benter Submit\s*·\s*esc Back\b)/i.test(line),
  );
  if (footerAt < 0) return;
  let headerAt = -1;
  let headerMatch: RegExpMatchArray | null = null;
  for (let i = footerAt - 1; i >= 0; i--) {
    const match = lines[i].match(/^\s*Question\s+(\d+)\/(\d+):\s*(.*)$/);
    if (match) {
      headerAt = i;
      headerMatch = match;
      break;
    }
  }
  if (headerAt < 0 || !headerMatch) return;
  const index = Number(headerMatch[1]);
  const total = Number(headerMatch[2]);
  if (!index || !total || index > total) return;

  const optionPattern = /^\s*([>›❯])?\s*(\d+)\.\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/;
  const titleLines: string[] = [headerMatch[3].trim()];
  const options: AgyQuestionOption[] = [];
  let selected: number | undefined;
  let multiSelect = false;
  let row = headerAt + 1;
  for (; row < footerAt; row++) {
    if (optionPattern.test(lines[row])) break;
    if (lines[row].trim()) titleLines.push(lines[row].trim());
  }
  for (; row < footerAt; row++) {
    const match = lines[row].match(optionPattern);
    if (match) {
      const n = Number(match[2]);
      const checked = match[3] !== undefined ? match[3].toLowerCase() === 'x' : undefined;
      if (checked !== undefined) multiSelect = true;
      options.push({ n, label: match[4], ...(checked !== undefined ? { checked } : {}) });
      if (match[1]) selected = n;
    } else if (options.length && lines[row].trim()) {
      break;
    }
  }
  if (!options.length) return;
  const other = options.find(opt => /^write-in(?:\.{3}|…)?$/i.test(opt.label))?.n;
  const afterOptions = lines.slice(row, footerAt + 1);
  const yourAnswerAt = afterOptions.findIndex(line => /^\s*Your answer:\s*$/i.test(line));
  const writeInOpen = yourAnswerAt >= 0 && /\benter Submit\s*·\s*esc Back\b/i.test(lines[footerAt]);
  const typed = writeInOpen
    ? afterOptions.slice(yourAnswerAt + 1, -1).map(line => line.trim()).filter(Boolean).join(' ')
    : '';
  return {
    index,
    total,
    title: titleLines.filter(Boolean).join(' ').trim(),
    multiSelect,
    writeInOpen,
    typed,
    options,
    selected,
    other,
  };
}

/**
 * Claude Code asks "Resume this conversation?" when a conversation has been left alone for hours: option 1 reloads all of it
 * (which costs a lot of the usage limit), option 2 starts a new conversation. Nothing moves until someone answers.
 */
export function resumePrompt(model: CLIModelId, screen: string) {
  if (model !== 'CLAUDE') return false;
  const tail = screen.split('\n').slice(-14).join('\n');
  return /Resume this conversation\?/i.test(tail) && /^\s*1\.\s*Resume\b/im.test(tail) && /^\s*2\.\s*Start a new conversation/im.test(tail);
}

/**
 * The session id on Codex's /status card ("Session:  <uuid>"), or undefined. The line counts only inside the card itself
 * (its "OpenAI Codex (v…)" title and a "Directory:" line just above), so a session id printed by some tool output is not taken for it.
 * It does not matter whether /status was the last thing typed: the card stays on screen while later messages are sent.
 */
export function codexStatusSession(screen: string): string | undefined {
  const lines = screen.split('\n');
  const line = /^\s*[│║]?\s*Session:\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\s*[│║])?\s*$/i;
  for (let index = lines.length - 1; index >= 0; index--) {
    const found = lines[index].match(line);
    if (!found) continue;
    const card = lines.slice(Math.max(0, index - 16), index).join('\n');
    if (/OpenAI Codex \(v[\d.]+/.test(card) && /^\s*[│║]?\s*Directory:/m.test(card)) return found[1];
  }
}
