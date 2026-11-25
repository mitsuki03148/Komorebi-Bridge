// The Drive panel's window onto Google Drive for desktop: browse, read, copy a link, move, and save a text file. It works on the folder
// Drive for desktop mounts on this Mac, so there is no Google sign-in here. Nothing deletes, overwrites another item, or creates a file.
import { appendFile, lstat, mkdir, readdir, realpath, stat, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, relative, isAbsolute, sep } from 'node:path';
import { driveItemId, pythonIo, showInFinder, type DriveIo } from './drive-io';
// Only the tool's own old backups are ever removed; nothing in Drive is deleted.
import { unlink as removeBackup } from 'node:fs/promises';

export interface DriveEnv {
  home: string;
  /** Where backups and the log are kept. */
  workspace: string;
  io?: DriveIo;
  itemId?: (path: string) => Promise<string | undefined>;
  reveal?: (path: string) => Promise<void>;
  now?: () => number;
}

export const driveTextLimit = 400_000;
const backupsKept = 20;
const textual = /\.(?:md|markdown|txt|log|json|csv|yaml|yml|toml)$/i;
const nativeKinds: Record<string, string> = { gdoc: 'document', gsheet: 'spreadsheets', gslides: 'presentation', gform: 'forms', gdraw: 'drawings', gtable: 'tables', gjam: 'jamboard', gsite: 'sites', gmap: 'maps' };
const nativeExt = /\.(gdoc|gsheet|gslides|gform|gdraw|gtable|gjam|gsite|gmap)$/i;
const accountName = /^[A-Za-z0-9._@+-]{1,120}$/;
const fail = (message: string): never => { throw new Error(message); };
const obj = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

export class Drive {
  private readonly io: DriveIo;
  private readonly now: () => number;

  constructor(private readonly env: DriveEnv) {
    this.io = env.io ?? pythonIo;
    this.now = env.now ?? Date.now;
  }

  /** One change at a time per item, so two requests to this Bridge cannot read the same state and both win. */
  private readonly busy = new Map<string, Promise<unknown>>();
  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.busy.get(key) ?? Promise.resolve();
    const run = before.catch(() => {}).then(work);
    const tail = run.catch(() => {});
    this.busy.set(key, tail);
    try { return await run; } finally { if (this.busy.get(key) === tail) this.busy.delete(key); }
  }

  private cloudDir() { return join(this.env.home, 'Library/CloudStorage'); }

  private async accounts() {
    const names = (await readdir(this.cloudDir()).catch(() => [] as string[])).filter(name => name.startsWith('GoogleDrive-') && !name.startsWith('.'));
    const found = await Promise.all(names.map(async name => {
      const email = name.slice('GoogleDrive-'.length);
      const root = join(this.cloudDir(), name);
      // The account that has a shared team folder in My Drive is the one worked in; it comes first.
      const entries = await readdir(join(root, 'My Drive'), { withFileTypes: true }).catch(() => []);
      return { id: email, root, team: entries.some(entry => entry.isSymbolicLink() && /team/i.test(entry.name)) };
    }));
    return found.filter(item => accountName.test(item.id)).sort((a, b) => Number(b.team) - Number(a.team) || a.id.localeCompare(b.id));
  }

  /** Check a path inside an account and return where it really is. Hidden items are refused, except the folder Drive keeps shared folders in. */
  private async resolve(account: unknown, rel: unknown, options: { mustExist?: boolean } = {}) {
    if (typeof account !== 'string' || !accountName.test(account)) fail('找不到這個帳戶。');
    const found = (await this.accounts()).find(item => item.id === account);
    if (!found) return fail('找不到這個帳戶。');
    if (typeof rel !== 'string' || rel.length > 2000 || /[\u0000-\u001f\\]/.test(rel)) return fail('路徑無效。');
    const segments = rel === '' ? [] : rel.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) return fail('路徑無效。');
    const rootReal = await realpath(found.root).catch(() => fail('Drive 未掛載。'));
    const full = join(rootReal, ...segments);
    const real = await realpath(full).catch(() => (options.mustExist === false ? full : fail('找不到。')));
    const inside = relative(rootReal, real);
    if (inside.startsWith('..') || isAbsolute(inside)) return fail('不在 Drive 範圍。');
    const hidden = inside.split(sep).filter(Boolean);
    if (hidden.some((segment, index) => segment.startsWith('.') && !(index === 0 && segment === '.shortcut-targets-by-id'))) return fail('不開放隱藏項目。');
    return { rootReal, real, rel, segments };
  }

  private async log(entry: Record<string, unknown>) {
    try { await appendFile(join(this.env.workspace, '.komorebi-drive-log.jsonl'), JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry }) + '\n'); }
    catch { /* The log is a record, not a gate. */ }
  }

  async call(op: string, raw: unknown): Promise<unknown> {
    const params = obj(raw);
    switch (op) {
      case 'accounts': return { accounts: (await this.accounts()).map(item => ({ id: item.id })) };
      case 'list': {
        const { real, segments } = await this.resolve(params.account, params.path);
        if (!(await stat(real)).isDirectory()) fail('不是資料夾。');
        const names = (await readdir(real)).filter(name => !name.startsWith('.')).slice(0, 2000);
        const entries = (await Promise.all(names.map(async name => {
          const info = await stat(join(real, name)).catch(() => undefined);
          if (!info) return undefined;
          const type = info.isDirectory() ? 'dir' : nativeExt.test(name) ? 'native' : 'file';
          return { name, type, size: info.size, modified: info.mtime.toISOString(), textual: type === 'file' && textual.test(name) };
        }))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        entries.sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        return { path: segments.join('/'), parent: segments.length ? segments.slice(0, -1).join('/') : null, entries };
      }
      case 'read': {
        const { real, segments } = await this.resolve(params.account, params.path);
        const info = await stat(real);
        if (!info.isFile()) fail('不是檔案。');
        if (!textual.test(real)) fail('只可以開啟文字檔。');
        const bytes = await this.io.read(real, driveTextLimit + 1);
        if (bytes.includes(0)) fail('二進位檔案。');
        const truncated = info.size > driveTextLimit;
        return { path: segments.join('/'), text: bytes.subarray(0, driveTextLimit).toString('utf8'), truncated, size: info.size, mtimeMs: info.mtimeMs, editable: !truncated };
      }
      case 'link': {
        const { real } = await this.resolve(params.account, params.path);
        const info = await stat(real);
        const id = await (this.env.itemId ?? driveItemId)(real);
        if (!id) fail('取不到連結（可能尚未同步）。');
        const name = basename(real);
        const kind = nativeExt.test(name) ? nativeKinds[name.split('.').pop()!.toLowerCase()] : undefined;
        const url = info.isDirectory() ? `https://drive.google.com/drive/folders/${id}`
          : kind ? `https://docs.google.com/${kind}/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`;
        return { url, localPath: real };
      }
      case 'path': {
        const { real } = await this.resolve(params.account, params.path);
        return { localPath: real };
      }
      case 'reveal': {
        const { real } = await this.resolve(params.account, params.path);
        await (this.env.reveal ?? showInFinder)(real);
        return {};
      }
      case 'write': {
        const { real, segments } = await this.resolve(params.account, params.path);
        if (!textual.test(real)) fail('只可以編輯文字檔。');
        const text = typeof params.text === 'string' ? params.text : fail('內容無效。');
        const data = Buffer.from(text, 'utf8');
        if (data.length > driveTextLimit) fail('內容太大。');
        const base = obj(params.base);
        // The check of the base and the write are one step per file: a second save on the same base finds the file changed.
        return this.exclusive(`file:${real}`, async () => {
          const info = await stat(real).catch(() => undefined);
          if (!info?.isFile()) return fail('找不到這個檔案。');
          if (base.mtimeMs !== info.mtimeMs || base.size !== info.size) fail('檔案已被更改，請重新開啟。');
          const old = await this.io.read(real, driveTextLimit + 1);
          if (old.length > driveTextLimit) fail('檔案太大，不能編輯。');
          await this.backup(params.account as string, segments.join('/'), old);
          await this.io.write(real, data);
          const after = await stat(real);
          if (after.size !== data.length) fail('檔案只寫入了一部分，內容未完整保存。舊內容已備份，請再儲存一次。');
          await this.log({ op: 'write', account: params.account, path: segments.join('/'), bytes: data.length });
          return { mtimeMs: after.mtimeMs, size: after.size };
        });
      }
      case 'move': {
        const from = await this.resolve(params.account, params.from);
        if (from.segments.length <= 1) fail('不可以移動根項目。');
        const name = from.segments[from.segments.length - 1];
        const parent = await this.resolve(params.account, from.segments.slice(0, -1).join('/'));
        const source = join(parent.real, name);
        const sourceInfo = await lstat(source).catch(() => undefined);
        if (!sourceInfo) fail('找不到。');
        if (sourceInfo!.isSymbolicLink()) fail('不可以移動捷徑。');
        const to = await this.resolve(params.account, params.to);
        if (!(await stat(to.real).catch(() => undefined))?.isDirectory()) fail('目標不是資料夾。');
        if (sourceInfo!.isDirectory() && (to.real === source || to.real.startsWith(source + sep))) fail('不可以移到自己裡面。');
        if (parent.real === to.real) fail('已在這個資料夾。');
        const target = join(to.real, name);
        // Moves take turns (one key, so they can never wait on each other in a circle); the system call then refuses to replace anything.
        return this.exclusive('move', async () => {
          if (await lstat(target).catch(() => undefined)) fail('目標已有同名項目。');
          if (!(await lstat(source).catch(() => undefined))) fail('找不到。');
          const outcome = await this.io.move?.(source, target) ?? 'unsupported';
          if (outcome === 'exists') fail('目標已有同名項目。');
          if (outcome === 'unsupported') await rename(source, target);
          const path = [...to.segments, name].join('/');
          await this.log({ op: 'move', account: params.account, from: from.segments.join('/'), to: path });
          return { path };
        });
      }
      default: return fail('不支援的操作。');
    }
  }

  /** Keep what was in a file before a save, so a bad save can be undone by hand; the newest 20 per file stay. */
  private async backup(account: string, path: string, content: Buffer) {
    const dir = join(this.env.workspace, '.komorebi-drive-backups', createHash('sha1').update(`${account}/${path}`).digest('hex').slice(0, 16));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${this.now()}.bak`), content);
    const files = (await readdir(dir)).filter(name => name.endsWith('.bak')).sort((a, b) => Number(a.slice(0, -4)) - Number(b.slice(0, -4)));
    for (const old of files.slice(0, Math.max(0, files.length - backupsKept))) await removeBackup(join(dir, old)).catch(() => {});
  }
}

export const defaultDriveEnv = (workspace: string): DriveEnv => ({ home: homedir(), workspace });
