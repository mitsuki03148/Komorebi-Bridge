import { isIPv4 } from 'node:net';

export type Scope = 'local' | 'tailnet' | 'serve';

export function tailnetAddress(ip: string) {
  if (!isIPv4(ip)) return false;
  const [first, second] = ip.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

type Headers = Record<string, string | string[] | undefined>;

/** Headers a reverse proxy (including Tailscale Serve and Funnel) adds; a request carrying any of them did not come from this Mac. */
const proxyHeaders = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-headers-info'];

export const isProxied = (headers: Headers) => proxyHeaders.some(name => headers[name] !== undefined);

/**
 * Who a connection may be treated as.
 *  - local: a program on this Mac talking to localhost directly, with no proxy in between.
 *  - tailnet: a tailnet device connecting straight to this Mac's Tailscale address.
 *  - serve: Tailscale Serve forwarding an HTTPS request from the tailnet to localhost. It arrives from 127.0.0.1,
 *    so it must carry this Mac's own Serve host name and a Tailscale identity. Funnel (public) requests carry no
 *    identity and are refused.
 * Only local is trusted without the pairing key.
 */
export function accessScope(input: {
  peer: string; local: string; host: string | undefined; headers: Headers; port: number;
  tailscaleIp: string | null; serveHost: string | null;
}): Scope | undefined {
  const { peer, local, host, headers, port, tailscaleIp, serveHost } = input;
  const loopback = peer === '127.0.0.1' || peer === '::1';
  if (loopback && !isProxied(headers) && (host === `localhost:${port}` || host === `127.0.0.1:${port}`)) return 'local';
  if (tailscaleIp && local === tailscaleIp && tailnetAddress(peer) && host === `${tailscaleIp}:${port}`) return 'tailnet';
  const identity = headers['tailscale-user-login'];
  if (loopback && serveHost && host === serveHost && typeof identity === 'string' && identity.trim() !== '') return 'serve';
}

/** The browser's Origin must match the page's own address: http for local and tailnet IP access, https for Serve. */
export function originAllowed(scope: Scope | undefined, origin: string | undefined, host: string | undefined) {
  if (!scope || !origin || !host) return false;
  return origin === `${scope === 'serve' ? 'https' : 'http'}://${host}`;
}
