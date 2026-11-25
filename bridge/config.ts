// Runtime defaults shared by the Bridge and its local CLI helpers.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { DEFAULT_DISPLAY_NAME } from '../src/brand';

export function bridgeConfig(env: NodeJS.ProcessEnv = process.env, project = process.cwd(), home = homedir()) {
  const ui = env.KOMOREBI_UI || 'build';
  if (ui !== 'build' && ui !== 'dev') throw new Error('KOMOREBI_UI must be build or dev.');
  const workspace = resolve(env.KOMOREBI_WORKSPACE || join(home, 'Komorebi'));
  const workspaceSkills = join(workspace, 'skills');
  const skills = resolve(env.KOMOREBI_SKILLS || (existsSync(workspaceSkills) ? workspaceSkills : join(project, 'skills')));
  const enabled = new Set((env.KOMOREBI_PRIVATE_FEATURES || '').split(',').map(item => item.trim()));
  const host = env.KOMOREBI_HOST || '127.0.0.1';
  const loopback = host.toLowerCase() === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  return {
    workspace, skills, host, ui, tailscale: !loopback || env.KOMOREBI_TAILSCALE === '1',
    displayName: env.KOMOREBI_DISPLAY_NAME?.trim().slice(0, 80) || DEFAULT_DISPLAY_NAME,
    mount: env.KOMOREBI_MOUNT || undefined,
    features: { rsi: enabled.has('rsi'), inbox: enabled.has('inbox'), board: enabled.has('board'),
      fileTrigger: enabled.has('file-trigger'), persona: enabled.has('persona') },
  };
}

/** Do not advertise a direct tailnet address when the server only listens on loopback. */
export function tailnetUrl(host: string, port: number, ip: string | null, serveHost: string | null) {
  if (serveHost) return `https://${serveHost}`;
  return ip && (host === '0.0.0.0' || host === '::' || host === ip) ? `http://${ip}:${port}` : null;
}
