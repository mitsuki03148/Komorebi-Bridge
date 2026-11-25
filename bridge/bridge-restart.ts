import type { Scope } from './access';

type RestartCode = 'unsupported' | 'busy' | 'cooldown' | 'failed';
export type RestartResult = { ok: true } | { ok: false; code: RestartCode };
export type RestartOptions = {
  platform: string;
  serviceName: string | undefined;
  scriptPath: string;
  runLaunchctl: (args: string[]) => Promise<unknown>;
  now: () => number;
  jobState: () => Promise<'present' | 'absent' | 'unknown'>;
  notify: () => void;
  log: (scope: Scope) => void;
};

/** A service marker gates this feature; the limit is deliberately process-local. */
export function isRestartSupported(platform: string, serviceName: string | undefined) {
  return platform === 'darwin' && serviceName === 'com.komorebi.bridge';
}

/** launchctl list must succeed and have a complete, recognisable table. */
export function restartJobState(output: string): 'present' | 'absent' | 'unknown' {
  const lines = output.trim().split(/\r?\n/);
  if (!/^PID\s+Status\s+Label$/.test(lines[0]?.trim() ?? '')) return 'unknown';
  let present = false;
  for (const line of lines.slice(1)) {
    const row = line.trim().split(/\s+/);
    if (row.length !== 3 || !/^(?:-|\d+)$/.test(row[0]) || !/^-?\d+$/.test(row[1])) return 'unknown';
    if (row[2] === 'com.komorebi.bridge-restart') present = true;
  }
  return present ? 'present' : 'absent';
}

export class BridgeRestartController {
  readonly supported: boolean;
  private busy = false;
  private lastAttempt: number | undefined;
  private submittedAt: number | undefined;
  private checking = false;
  constructor(private readonly options: RestartOptions) {
    this.supported = isRestartSupported(options.platform, options.serviceName);
  }

  async requestRestart(scope: Scope): Promise<RestartResult> {
    if (!this.supported) return { ok: false, code: 'unsupported' };
    if (this.busy) {
      // Check once per user request, never poll. Unknown leaves the existing job untouched.
      if (this.checking || this.submittedAt === undefined || this.options.now() - this.submittedAt < 90_000) return { ok: false, code: 'busy' };
      this.checking = true;
      let state: 'present' | 'absent' | 'unknown' = 'unknown';
      try { state = await this.options.jobState(); } catch { /* unknown means busy */ }
      finally { this.checking = false; }
      if (state !== 'absent') return { ok: false, code: 'busy' };
      this.busy = false;
      this.submittedAt = undefined;
    }
    const now = this.options.now();
    if (this.lastAttempt !== undefined && now - this.lastAttempt < 60_000) return { ok: false, code: 'cooldown' };
    this.busy = true;
    this.lastAttempt = now;
    try {
      this.options.log(scope);
      this.options.notify();
      try { await this.options.runLaunchctl(['remove', 'com.komorebi.bridge-restart']); } catch { /* a prior job may not exist */ }
      await this.options.runLaunchctl(['submit', '-l', 'com.komorebi.bridge-restart', '--', '/bin/zsh', this.options.scriptPath]);
      // A later retry checks job existence before replacing a submitted job.
      this.submittedAt = this.options.now();
      return { ok: true };
    } catch {
      this.busy = false;
      return { ok: false, code: 'failed' };
    }
  }
}
