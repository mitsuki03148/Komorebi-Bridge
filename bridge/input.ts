import type { CLIModelId } from '../src/types/guild';

const shellCommand = /^(?:[\s"'(>]+)?(?:\S+\/)?(?:sudo|rm|mv|cp|chmod|chown|curl|wget|ssh|scp|bash|zsh|sh|fish|kill|pkill|export|cat|ls|cd|dd|mkfs|brew|eval|exec|env|osascript|whoami|pwd|touch|sed|awk|xargs|killall|python[23]?|node|perl|ruby|npm|pnpm|npx|git|gh|hub|echo|printf|find|grep|open)(?=\s|$)/i;
export const maxInputLength = 100_000;
const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;

export function checkedInput(modelId: CLIModelId, input: unknown): string {
  if (typeof input !== 'string') throw new Error('輸入無效。');
  if (input.length > maxInputLength) throw new Error(`輸入太長（上限 ${maxInputLength.toLocaleString('en-US')} 字元），請分段送出。`);
  if (control.test(input)) throw new Error('輸入包含終端控制字元，請移除後再送。');
  const text = input.trim();
  // "!" is the CLI's own shell escape, so it is never accepted. Anything else that does not start with "/" is plain text for the agent,
  // also when it reads like a command ("git status ..."): it is only a message, nothing here runs it.
  if (!text || /^!/.test(text)) throw new Error('不可以直接輸入系統 shell 指令。');
  if (!text.startsWith('/')) return text.replace(/\r\n?/g, '\n');
  // A slash line that names a system program (/usr/bin/git, /bin/bash) stays refused; a leading path such as /Users/... is prose.
  if (shellCommand.test(text)) throw new Error('不可以直接輸入系統 shell 指令。');
  if (/^\/[^\s/]+\//.test(text)) return text.replace(/\r\n?/g, '\n');

  const [command, ...args] = text.split(/\s+/);
  if (!/^\/[a-z][a-z0-9_-]*$/i.test(command) || shellCommand.test(command.slice(1)) || /^\/(?:shell|terminal|run|execute)$/i.test(command)) {
    throw new Error('請輸入原生 CLI 指令；直接系統指令仍然不允許。');
  }
  const argument = args.join(' ');
  if (shellCommand.test(argument)) throw new Error('不可以直接執行系統 shell 指令。');

  if (command === '/rc' && modelId === 'CODEX') {
    if (!argument) throw new Error('用 /rc on 或 /rc off 調整整部 Mac 的 Codex Remote Control。');
    return `/rc ${argument}`;
  }
  if (command === '/rc') {
    if (argument && !(modelId === 'AGY' && argument === 'off')) throw new Error('這個 Remote Control 參數不適用。');
    return argument ? '/remote-control off' : '/remote-control';
  }
  if (modelId === 'CODEX' && command === '/clear') return '/new';
  if (modelId === 'CODEX' && command === '/effort') {
    if (argument && !/^(low|medium|high|xhigh|max|ultra)$/.test(argument)) throw new Error('推理力度不適用。');
    return argument ? `/model --reasoning=${argument}` : '/model';
  }
  return argument ? `${command} ${argument}` : command;
}
