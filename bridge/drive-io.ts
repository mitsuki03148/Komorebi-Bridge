import { execFile, spawn } from 'node:child_process';

/**
 * Drive for desktop keeps most files as online-only placeholders. A background process (this Bridge) cannot read one unless it asks
 * macOS to download it (setiopolicy_np), otherwise the read fails with "Resource deadlock avoided". A tiny Python program does that for
 * just the one read or write, so the setting does not spread to the CLIs the Bridge starts.
 */
const program = `
import ctypes, ctypes.util, os, sys
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
libc.setiopolicy_np(3, 0, 2)
mode, path = sys.argv[1], sys.argv[2]
if mode == "read":
    limit = int(sys.argv[3])
    with open(path, "rb") as handle:
        sys.stdout.buffer.write(handle.read(limit))
elif mode == "write":
    data = sys.stdin.buffer.read()
    fd = os.open(path, os.O_WRONLY | os.O_TRUNC)
    try:
        view = memoryview(data)
        while len(view):
            view = view[os.write(fd, view):]
    finally:
        os.close(fd)
elif mode == "move":
    target = sys.argv[3]
    try:
        move = libc.renamex_np
    except AttributeError:
        sys.exit(4)
    # RENAME_EXCL (4): the system itself refuses when the target exists, so two moves cannot both win.
    if move(os.fsencode(path), os.fsencode(target), 4) != 0:
        sys.exit(3 if ctypes.get_errno() == 17 else 5)
`;

export interface DriveIo {
  read(path: string, limit: number): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
  /** Move without ever replacing: 'exists' when the target is there. 'unsupported' leaves the caller to check first. */
  move?(source: string, target: string): Promise<'moved' | 'exists' | 'unsupported'>;
}

export const pythonIo: DriveIo = {
  read: (path, limit) => new Promise((resolve, reject) => {
    execFile('/usr/bin/python3', ['-c', program, 'read', path, String(limit)], { encoding: 'buffer', maxBuffer: limit + 1024, timeout: 60_000 }, (error, stdout) => {
      if (error) reject(new Error('讀不到檔案（可能尚未下載）。')); else resolve(stdout);
    });
  }),
  write: (path, data) => new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-c', program, 'write', path], { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', () => reject(new Error('寫不入檔案。')));
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('寫不入檔案。')); });
    child.stdin.end(data);
  }),
  move: (source, target) => new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-c', program, 'move', source, target], { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', () => reject(new Error('搬移失敗。')));
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve('moved'); else if (code === 3) resolve('exists'); else if (code === 4) resolve('unsupported'); else reject(new Error('搬移失敗。')); });
  }),
};

/** The id Drive for desktop keeps on each item (an extended attribute), which a link is built from. */
export const driveItemId = (path: string) => new Promise<string | undefined>(resolve => {
  execFile('/usr/bin/xattr', ['-p', 'com.google.drivefs.item-id#S', path], { timeout: 10_000 }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined));
});

export const showInFinder = (path: string) => new Promise<void>((resolve, reject) => {
  execFile('open', ['-R', path], { timeout: 5_000 }, error => (error ? reject(new Error('未能在 Finder 顯示。')) : resolve()));
});
