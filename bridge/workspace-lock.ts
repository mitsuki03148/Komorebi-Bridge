// One Bridge writer per workspace. The OS releases this advisory lock on process exit, even after a crash.
import { closeSync, constants, fstatSync, ftruncateSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';

const darwinExclusiveLock = 0x20; // O_EXLOCK from macOS fcntl.h.
const marker = 'komorebi-workspace-lock-v1';

/** macOS may allow a wildcard and a loopback listener to bind the same port. */
export async function assertLoopbackPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`EADDRINUSE: port ${port} already has a listener.`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`Cannot check port ${port}.`)); });
    socket.once('error', error => {
      socket.destroy();
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

export function lockWorkspace(workspace: string, host: string, port: number) {
  return lockDirectory(workspace, '.komorebi-bridge.lock', 'Workspace', host, port);
}

export function lockCheckout(checkout: string, host: string, port: number) {
  return lockDirectory(checkout, '.env.komorebi-checkout.lock', 'Checkout', host, port);
}

function lockDirectory(directory: string, file: string, label: string, host: string, port: number) {
  if (process.platform !== 'darwin') throw new Error('Workspace locking currently requires macOS.');
  const path = join(directory, file);
  let fd: number;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW | darwinExclusiveLock, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EAGAIN' && (error as NodeJS.ErrnoException).code !== 'EWOULDBLOCK') throw error;
    let owner = 'unknown owner';
    try {
      const reader = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = fstatSync(reader);
        if (info.isFile() && info.nlink === 1 && info.size <= 1024) {
          const bytes = Buffer.alloc(info.size);
          readSync(reader, bytes, 0, bytes.length, 0);
          const value = JSON.parse(bytes.toString('utf8'));
          if (value.kind === marker && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.host === 'string' &&
              /^[a-zA-Z0-9.:_-]{1,100}$/.test(value.host) && Number.isSafeInteger(value.port)) owner = `PID ${value.pid}, ${value.host}:${value.port}`;
        }
      } finally { closeSync(reader); }
    } catch { /* A process may still be writing its diagnostic owner record. */ }
    throw new Error(`${label} already in use by another Bridge (${owner}).`);
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > 1024) throw new Error('Invalid workspace lock file.');
    if (info.size) {
      const bytes = Buffer.alloc(info.size);
      readSync(fd, bytes, 0, bytes.length, 0);
      const saved = JSON.parse(bytes.toString('utf8'));
      if (saved.kind !== marker) throw new Error('Invalid workspace lock file.');
    }
    const owner = JSON.stringify({ kind: marker, pid: process.pid, host, port });
    ftruncateSync(fd, 0);
    writeSync(fd, owner, 0, 'utf8');
  } catch (error) { closeSync(fd); throw error; }
  let closed = false;
  return () => { if (!closed) { closed = true; closeSync(fd); } };
}
