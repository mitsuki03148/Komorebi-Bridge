// Hand work to another agent's room through the Komorebi Bridge (it runs under that room's own permission mode).
//
//   komorebi-room task-context [--repo <checkout>] [--ref <commit>] [--grep <regex>]... [--bench <id> --from <room>] [file[:first-last] ...]
//   komorebi-room verify-gate --repo <checkout> [--base <commit>] [--lint <command>] [--test <command>]
//   komorebi-room list
//   komorebi-room quota                                              the allowance each character has left (HP weekly, MP 5-hour); `list` ends with it too
//   komorebi-room read <room> [--messages <n>] [--screen]            read a room's latest messages (read only; nothing is sent)
//   komorebi-room bench send <room|@role> --from <your room> [--group <id>] [--title <t>] [--reply-to <id>] [--repo <r>] [--ref <ref>]
//                     [--boundary <what you may change>] [--receipt <where to report>]
//                     [--worktree new]        create a separate checkout for a new task
//                     [--notify]               a notice only: nobody has to close it, it ends when the recipient reads it
//                     [--require-path <p>]...  check each path exists (relative ones under --repo) before the ticket goes out
//                     <message | ->
//   komorebi-room bench mine|overview --from <your room>
//   komorebi-room bench show|done <id> --from <your room> [--note <result>] [--receipt <commit or path>]
//   komorebi-room bench done <id> --from <room> --acceptance <JSON file or -> (see scripts/bench-acceptance.schema.json)
//   komorebi-room bench lesson-pending <id> --from <your room>   link a locally recorded proposal to your original ticket
//   komorebi-room bench cancel <id> --from <your room> [--note <reason>]   the sender calls off a ticket it sent that is still open
//   komorebi-room bench claim|release <scope> --from <your room> [--group <id>]
//     Workbench (group rooms only): a ticket goes into the recipient's own workbench; see Review/WORKBENCH/PLAN.md.
//   komorebi-room log [--last <n>] [--failed]                        what happened to recent `send` handoffs (outcome only, never the message)
//   komorebi-room send <room> [--from <your room>] [--native-test] [--allow-ask] [--wait <seconds>] <message | ->
//   komorebi-room native-test-room [show | set <room> [<fallback room>...] | clear]      (set / clear: only when the Founder asks)
//   komorebi-room send native-test --native-test <message>        sends to the first free native-test room
//
// <room> is a room name, part of a unique name, a Session ID, or a room id. "-" reads the message from stdin.
// Exit codes: 0 sent · 1 failed · 2 bad usage · 3 STOP (a rule stopped it: tell the Founder, do not wait).
import { boundedJson, searchWorktree, taskContext } from './task-context';
import { verifyGate } from './verify-gate';
import { acceptanceOptions } from './bench-acceptance';
import { readFile } from 'node:fs/promises';
import { mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { benchCommand, handoffLog, listRooms, quotaStatus, nativeTestRoom, readRoom, sendHandoff } from '../bridge/handoff';

const url = process.env.KOMOREBI_URL ?? `http://localhost:${process.env.KOMOREBI_PORT ?? 3000}`;
const [command, ...rest] = process.argv.slice(2);

const usage = (message: string) => { console.error(`${message}\n用法見 scripts/komorebi-room.ts 開頭。`); process.exit(2); };
const finish = (outcome: { code: number; lines: string[] }) => {
  for (const line of outcome.lines) (outcome.code === 0 ? console.log : console.error)(line);
  process.exit(outcome.code);
};
const readStdin = async () => { let text = ''; for await (const chunk of process.stdin) text += chunk; return text; };

if (command === 'task-context') {
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { repo: { type: 'string' }, ref: { type: 'string' }, grep: { type: 'string', multiple: true }, bench: { type: 'string' }, from: { type: 'string' } },
      allowPositionals: true,
    });
    if (values.repo === '' || values.ref === '') usage('--repo 同 --ref 須填值。');
    if (values.bench !== undefined && (!/^\d+$/.test(values.bench) || !values.from)) usage('--bench 要工單編號及 --from 房間。');
    const caller = process.env.KOMOREBI_CALLER_DIR ?? process.cwd();
    const context = await taskContext(resolve(caller, values.repo ?? '.'), positionals, values.ref);
    const [search, bench] = await Promise.all([
      searchWorktree(context.root, values.grep ?? []).catch(error => ({ error: error instanceof Error ? error.message : '搜尋失敗。' })),
      values.bench === undefined ? undefined : benchCommand(url, 'show', { from: values.from, id: Number(values.bench) }),
    ]);
    console.log(boundedJson({ ...context, ...(search ? { search } : {}), ...(bench ? { bench } : {}) }));
    if (bench && bench.code !== 0) process.exitCode = bench.code;
  } catch (error) {
    usage(error instanceof Error ? error.message : '讀不到工作樹。');
  }
} else if (command === 'verify-gate') {
  try {
    const { values } = parseArgs({ args: rest, options: { repo: { type: 'string' }, base: { type: 'string' }, lint: { type: 'string' }, test: { type: 'string' }, 'test-changed': { type: 'boolean' }, background: { type: 'boolean' }, from: { type: 'string' }, worker: { type: 'string' }, lock: { type: 'string' } } });
    if (!values.repo || values.base === '' || values.lint === '' || values.test === '') usage('verify-gate 要 --repo；所有已指定的選項都須填值。');
    if (values['test-changed'] && values.test) usage('--test-changed 不可同 --test 一齊用。');
    if ((values.background || values.worker) && !values.from) usage('--background 要 --from <自己 session>。');
    const caller = process.env.KOMOREBI_CALLER_DIR ?? process.cwd();
    const repo = resolve(caller, values.repo!);
    if (values.background) {
      const root = await realpath(execFileSync('git', ['--no-optional-locks', '-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
      const directory = process.env.KOMOREBI_GATE_DIR ?? '/Volumes/Komorebi/Review/verify-gate';
      await mkdir(directory, { recursive: true });
      const lock = join(directory, `${createHash('sha256').update(root).digest('hex')}.lock`);
      const handle = await open(lock, 'wx'); await handle.close();
      const resultPath = join(directory, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`);
      const args = ['--import', 'tsx', resolve(process.argv[1]), 'verify-gate', '--repo', root, '--worker', resultPath, '--lock', lock, '--from', values.from!];
      if (values.base) args.push('--base', values.base);
      if (values.lint) args.push('--lint', values.lint);
      if (values.test) args.push('--test', values.test);
      if (values['test-changed']) args.push('--test-changed');
      try {
        const child = spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: 'ignore' });
        await new Promise<void>((resolveChild, reject) => { child.once('spawn', resolveChild); child.once('error', reject); });
        child.unref();
      } catch (error) { await unlink(lock); throw error; }
      console.log(`已開始，完成會用工作台通知你；而家結束呢一輪，唔好 poll。結果：${resultPath}`);
    } else if (values.worker) {
      const root = await realpath(execFileSync('git', ['--no-optional-locks', '-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
      const directory = resolve(process.env.KOMOREBI_GATE_DIR ?? '/Volumes/Komorebi/Review/verify-gate');
      const expectedLock = join(directory, `${createHash('sha256').update(root).digest('hex')}.lock`);
      if (values.lock !== expectedLock || resolve(values.worker) !== join(directory, values.worker.split('/').at(-1)!)) throw new Error('背景驗證路徑無效。');
      try {
      let result: Awaited<ReturnType<typeof verifyGate>> | { ok: false; error: string };
      try { result = await verifyGate(repo, values.base, values.lint, values.test, values['test-changed']); }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : '驗證失敗。' }; }
      await writeFile(values.worker, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      const failure = 'error' in result ? result.error : [result.lint, result.test].filter(item => item.status === 'FAIL').map(item => 'tail' in item ? item.tail.split('\n').slice(0, 3).join(' ') : '').join(' ');
      const count = 'test' in result && 'tail' in result.test ? result.test.tail.match(/(?:ℹ\s*)?(?:tests|pass|fail)\s+\d+/gi)?.join(', ') ?? '測試數未知' : '測試數未知';
      const body = `verify-gate ${result.ok ? 'PASS' : 'FAIL'}；${count}${failure ? `；${failure.slice(0, 300)}` : ''}；結果：${values.worker}`;
      const notice = await benchCommand(url, 'send', { from: values.from, to: values.from, notify: true, source: 'verify-gate', body });
      if (notice.code !== 0) await writeFile(`${values.worker}.notice-error`, notice.lines.join('\n') + '\n', { flag: 'wx' });
      if (notice.code !== 0 || !result.ok) process.exitCode = 1;
      } finally { await unlink(expectedLock); }
    } else {
    const result = await verifyGate(repo, values.base, values.lint, values.test, values['test-changed']);
    console.log(boundedJson(result));
    if (!result.ok) process.exitCode = 1;
    }
  } catch (error) { console.error((error instanceof Error ? error.message : '驗證失敗。').slice(0, 1000)); process.exitCode = 1; }
} else if (command === '--help' || command === 'help') {
  console.log('task-context [--repo <path>] [--ref <commit>] [--grep <regex>]... [--bench <id> --from <room>] [file[:first-last] ...]');
  console.log('verify-gate --repo <path> [--base <commit>] [--lint <command>] [--test <command> | --test-changed] [--background --from <session>]');
  console.log('--grep 優先用 rg，沒有時用 git grep；兩者的忽略規則可能不同。--bench 沿用 bench show 的已讀行為。');
  console.log('verify-gate 執行指定的 shell 命令；命令本身可能改檔。');
} else if (command === 'list') finish(await listRooms(url));
else if (command === 'quota') finish(await quotaStatus(url));
else if (command === 'native-test-room') {
  const [action = 'show', ...queries] = rest;
  if (action !== 'show' && action !== 'set' && action !== 'clear') usage('native-test-room 只有 show / set / clear。');
  if (action === 'set' && !queries.length) usage('請指明房間。');
  finish(await nativeTestRoom(url, action as 'show' | 'set' | 'clear', queries));
} else if (command === 'read') {
  let messages: number | undefined; let screen = false;
  const words: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index];
    if (word === '--messages') messages = Number(rest[++index]);
    else if (word === '--screen') screen = true;
    else words.push(word);
  }
  if (words.length !== 1) usage('read 要一個房間。');
  if (messages !== undefined && !(messages >= 1 && messages <= 30)) usage('--messages 要 1–30。');
  finish(await readRoom(url, words[0], { messages, screen }));
} else if (command === 'log') {
  let last: number | undefined; let failedOnly = false;
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '--last') last = Number(rest[++index]);
    else if (rest[index] === '--failed') failedOnly = true;
    else usage('log 只有 --last <n> 同 --failed。');
  }
  if (last !== undefined && !(last >= 1 && last <= 200)) usage('--last 要 1–200。');
  finish(await handoffLog(url, { last, failedOnly }));
} else if (command === 'bench') {
  const [action, ...args] = rest;
  const options: Record<string, string> = {};
  const words: string[] = [];
  let acceptanceFile: string | undefined;
  let requireNotify = false;
  const requirePaths: string[] = [];
  const flags: Record<string, string> = { '--from': 'from', '--group': 'groupId', '--title': 'title', '--reply-to': 'replyTo', '--repo': 'repo', '--ref': 'ref', '--boundary': 'boundary', '--receipt': 'receipt', '--note': 'note', '--worktree': 'worktree' };
  for (let index = 0; index < args.length; index++) {
    const key = flags[args[index]];
    if (args[index] === '--notify') requireNotify = true;
    else if (args[index] === '--acceptance') { acceptanceFile = args[++index]; if (!acceptanceFile) usage('--acceptance 要 JSON 檔案或 -。'); }
    else if (args[index] === '--require-path') { if (args[index + 1] === undefined) usage('--require-path 要一個路徑。'); requirePaths.push(args[++index]); }
    else if (key) { if (args[index + 1] === undefined) usage(`${args[index]} 要一個值。`); options[key] = args[++index]; }
    else words.push(args[index]);
  }
  if (acceptanceFile !== undefined) {
    if (action !== 'done' || options.note !== undefined || options.receipt !== undefined) usage('--acceptance 只適用於 done，已包括 note 同 receipt。');
    try {
      const raw = acceptanceFile === '-' ? await readStdin() : await readFile(resolve(process.env.KOMOREBI_CALLER_DIR ?? process.cwd(), acceptanceFile), 'utf8');
      Object.assign(options, acceptanceOptions(raw));
    } catch (error) { usage(error instanceof Error ? error.message : '未能讀取驗收記錄。'); }
  }
  if (!options.from) usage('bench 要 --from <你自己的房名或 Session ID>。\n例：komorebi-room bench send <對方> --from "<你嘅房名>" --title "<標題>" "<內容>"');
  if (options.worktree !== undefined && (action !== 'send' || options.worktree !== 'new')) usage('--worktree 只可用於 bench send --worktree new。');
  if (options.groupId !== undefined && action !== 'send' && action !== 'claim' && action !== 'release') usage('--group 只可用於 bench send、claim 或 release。');
  const id = (value: string | undefined) => { if (!value || !/^\d+$/.test(value)) usage('請寫工單編號。'); return Number(value); };
  if (action === 'send') {
    const [to, ...message] = words;
    if (!to || !message.length) usage('bench send 要收件人同內容。');
    const body = message.length === 1 && message[0] === '-' ? (await readStdin()).trim() : message.join(' ');
    if (!body) usage('內容為空。');
    finish(await benchCommand(url, 'send', { ...options, to, body, ...(requireNotify ? { notify: true } : {}), ...(requirePaths.length ? { requirePaths } : {}), ...(options.replyTo ? { replyTo: id(options.replyTo) } : {}) }));
  } else if (action === 'show' || action === 'done' || action === 'cancel' || action === 'lesson-pending') finish(await benchCommand(url, acceptanceFile === undefined ? action : 'done-checked', { ...options, id: id(words[0]) }));
  else if (action === 'claim' || action === 'release') finish(await benchCommand(url, action, {
    ...options,
    scope: words.join(' '),
    ...(action === 'claim' ? { claimCwd: process.env.KOMOREBI_CALLER_DIR ?? process.cwd() } : {}),
  }));
  else if (action === 'mine' || action === 'overview') finish(await benchCommand(url, action, options));
  else usage('bench 動作只有 send / mine / show / done / lesson-pending / cancel / claim / release / overview。');
} else if (command === 'send') {
  let from: string | undefined; let wait: number | undefined; let nativeTest = false; let allowAsk = false;
  const words: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index];
    if (word === '--from') from = rest[++index];
    else if (word === '--wait') wait = Number(rest[++index]);
    else if (word === '--native-test') nativeTest = true;
    else if (word === '--allow-ask') allowAsk = true;
    else words.push(word);
  }
  const [query, ...message] = words;
  if (!query || !message.length) usage('send 要房間同訊息。');
  if (wait !== undefined && !(wait >= 1 && wait <= 1800)) usage('--wait 要 1–1800 秒。');
  const text = message.length === 1 && message[0] === '-' ? (await readStdin()).trim() : message.join(' ');
  if (!text) usage('訊息為空。');
  finish(await sendHandoff({ url, query, text, from, nativeTest, allowAsk, waitSeconds: wait }));
} else usage('指令只有 task-context / verify-gate / list / quota / read / send / log / bench / native-test-room。');
