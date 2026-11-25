import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Usage {
  fiveHour?: number;
  weekly?: number;
  vouchers?: number;
  /** Epoch milliseconds when each window refreshes, when the CLI reports it. */
  fiveHourResetsAt?: number;
  weeklyResetsAt?: number;
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function zoneParts(timestamp: number, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, offset: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp };
}

/** Turns a wall-clock time in an IANA zone into epoch milliseconds. */
function zonedEpoch(year: number, month: number, day: number, hour: number, minute: number, zone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneParts(guess, zone).offset;
  return guess - zoneParts(first, zone).offset;
}

/** Reads "resets Nov 12 at 1:39pm (Europe/London)" or "resets 5:40pm (Europe/London)" after a Claude usage label. */
export function parseClaudeReset(text: string, label: string, now = Date.now()): number | undefined {
  const match = text.match(new RegExp(label + ':[^\\n]*?resets\\s+(?:([A-Za-z]{3,9})\\s+(\\d{1,2})\\s+at\\s+|(?:at\\s+)?)(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)(?:\\s*\\(([^)]+)\\))?', 'i'));
  if (!match) return undefined;
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] = match;
  const zone = zoneText?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hour = (Number(hourText) % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  const minute = Number(minuteText ?? 0);
  try {
    const today = zoneParts(now, zone);
    if (monthName) {
      const month = months.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
      if (!month) return undefined;
      let at = zonedEpoch(today.year, month, Number(dayText), hour, minute, zone);
      if (at < now - 30 * 86_400_000) at = zonedEpoch(today.year + 1, month, Number(dayText), hour, minute, zone);
      return at;
    }
    const at = zonedEpoch(today.year, today.month, today.day, hour, minute, zone);
    return at < now - 60_000 ? at + 86_400_000 : at;
  } catch {
    return undefined;
  }
}

function epoch(value: unknown, unit: 'ms' | 's' = 'ms') {
  const parsed = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value * (unit === 's' ? 1000 : 1) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function percent(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

export function parseAgyUsage(result: any, model: string): Usage {
  const groups = result?.command?.data?.groups;
  if (!Array.isArray(groups)) return {};
  const groupName = /argon/i.test(model) ? 'Gemini 4 Argon' :
    /claude|gpt/i.test(model) ? 'Claude and GPT models' : 'Gemini Models';
  const buckets = groups.find((group: any) => group.name?.toLowerCase() === groupName.toLowerCase())?.buckets;
  if (!Array.isArray(buckets)) return {};
  const remaining = (window: string) => {
    const fraction = buckets.find((bucket: any) => bucket.window === window)?.remaining_fraction;
    return percent(typeof fraction === 'number' ? Math.round(fraction * 10000) / 100 : undefined);
  };
  const resets = (window: string) => epoch(buckets.find((bucket: any) => bucket.window === window)?.reset_time);
  const fiveHourResetsAt = resets('5h'), weeklyResetsAt = resets('weekly');
  return {
    fiveHour: remaining('5h'), weekly: remaining('weekly'),
    ...(fiveHourResetsAt !== undefined && { fiveHourResetsAt }), ...(weeklyResetsAt !== undefined && { weeklyResetsAt }),
  };
}

export function parseClaudeUsage(result: any): Usage {
  const text = typeof result?.result === 'string' ? result.result : '';
  const remaining = (label: string) => {
    const match = text.match(new RegExp(label + ':\\s*(\\d+(?:\\.\\d+)?)% used', 'i'));
    const used = percent(match ? Number(match[1]) : undefined);
    return used === undefined ? undefined : 100 - used;
  };
  const fiveHourResetsAt = parseClaudeReset(text, 'Current session'), weeklyResetsAt = parseClaudeReset(text, 'Current week \\(all models\\)');
  return {
    fiveHour: remaining('Current session'), weekly: remaining('Current week \\(all models\\)'),
    ...(fiveHourResetsAt !== undefined && { fiveHourResetsAt }), ...(weeklyResetsAt !== undefined && { weeklyResetsAt }),
  };
}

export function parseCodexUsage(result: any): Usage {
  const snapshot = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  const windows = [snapshot?.primary, snapshot?.secondary].filter(Boolean);
  const remaining = (duration: number) => {
    const used = percent(windows.find((window: any) => window.windowDurationMins === duration)?.usedPercent);
    return used === undefined ? undefined : 100 - used;
  };
  const count = result?.rateLimitResetCredits?.availableCount;
  const weekly = remaining(10080);
  const resets = (duration: number) => epoch(windows.find((window: any) => window.windowDurationMins === duration)?.resetsAt, 's');
  const fiveHourResetsAt = resets(300), weeklyResetsAt = resets(10080);
  return {
    fiveHour: remaining(300) ?? (weekly !== undefined && windows.every((window: any) => window.windowDurationMins !== null) ? 100 : undefined), weekly,
    vouchers: Number.isSafeInteger(count) && count >= 0 ? count : undefined,
    ...(fiveHourResetsAt !== undefined && { fiveHourResetsAt }), ...(weeklyResetsAt !== undefined && { weeklyResetsAt }),
  };
}

export async function agyUsage(cwd: string, model: string) {
  const env = { ...process.env };
  delete env.KOMOREBI_PAIRING_KEY;
  const { stdout } = await run('agy', ['-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'],
    { cwd, env, timeout: 20_000, maxBuffer: 512_000 });
  return parseAgyUsage(JSON.parse(stdout), model);
}

export async function claudeUsage(cwd: string) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.KOMOREBI_PAIRING_KEY;
  const { stdout } = await run('claude', ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'],
    { cwd, env, timeout: 20_000, maxBuffer: 512_000 });
  return parseClaudeUsage(JSON.parse(stdout));
}

export function codexUsage(cwd: string): Promise<Usage> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    delete env.KOMOREBI_PAIRING_KEY;
    const child = spawn('codex', ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let finished = false;
    const finish = (error?: Error, result?: Usage) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(result ?? {});
    };
    const timer = setTimeout(() => finish(new Error('Codex 用量查詢逾時')), 20_000);
    child.on('error', error => finish(error));
    child.on('exit', () => finish(new Error('Codex 用量查詢已結束')));
    child.stdin.on('error', error => finish(error));
    child.stdout.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 1_000_000) return finish(new Error('Codex 用量回應過大'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result) {
            child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
            child.stdin.write(JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: {} }) + '\n');
          } else if (message.id === 2 && message.result) {
            finish(undefined, parseCodexUsage(message.result));
          } else if ((message.id === 1 || message.id === 2) && message.error) {
            finish(new Error('Codex 用量查詢失敗'));
          }
        } catch { /* Ignore non-JSON diagnostic output. */ }
      }
    });
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'komorebi', version: '1.0.0' } } }) + '\n');
  });
}
