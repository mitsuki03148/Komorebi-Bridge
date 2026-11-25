import { randomUUID } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { attachmentFolderName, cleanUploadName, maxEncodedFileBytes, maxFileBytes, maxImageAttachmentBytes } from '../src/utils/fileAttachments';

export const attachmentLimit = maxImageAttachmentBytes;
export const attachmentDirectory = join(homedir(), 'Documents', attachmentFolderName);
export type ImageAttachment = { mime: string; data: string };

export async function saveAttachment(value: unknown, directory = attachmentDirectory) {
  if (!value || typeof value !== 'object') throw new Error('圖片資料無效。');
  const { mime, data } = value as Partial<ImageAttachment>;
  if (typeof data !== 'string' || data.length > Math.ceil(attachmentLimit / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('圖片無效或大於 3 MB。');
  }
  const bytes = Buffer.from(data, 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const extension = mime === 'image/png' && png ? 'png' : mime === 'image/jpeg' && jpeg ? 'jpg' : mime === 'image/webp' && webp ? 'webp' : undefined;
  if (!extension || bytes.length > attachmentLimit) throw new Error('只支援 PNG、JPEG 或 WebP 圖片，最大 3 MB。');
  await ensureDirectory(directory);
  const path = join(directory, `${randomUUID()}.${extension}`);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return path;
}

async function ensureDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('附件資料夾無效。');
}

function decodeFileUpload(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('檔案資料無效。');
  const { name, mime, data } = value as Record<string, unknown>;
  const safeName = typeof name === 'string' ? cleanUploadName(name) : undefined;
  if (!safeName) throw new Error('檔案名稱無效，或副檔名不受支援。');
  if (mime !== undefined && (typeof mime !== 'string' || mime.length > 255)) throw new Error('檔案類型無效。');
  if (typeof data !== 'string' || !data.length || data.length > maxEncodedFileBytes) throw new Error('檔案不可為空或大於 10 MB。');
  if (data.length % 4 !== 0) throw new Error('檔案編碼無效。');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > maxFileBytes) throw new Error('檔案不可為空或大於 10 MB。');
  // Buffer is otherwise lenient about characters, padding and trailing data.
  if (bytes.toString('base64') !== data) throw new Error('檔案編碼無效。');
  return { safeName, bytes };
}

export async function saveFileAttachments(values: unknown[], directory = attachmentDirectory, onSaved?: (path: string) => void) {
  // Validate the entire batch before saving any file.
  const decoded = values.map(decodeFileUpload);
  if (!decoded.length) return [];
  await ensureDirectory(directory);
  const paths: string[] = [];
  for (const { safeName, bytes } of decoded) {
    const path = join(directory, `${randomUUID()}_${safeName}`);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    paths.push(path);
    onSaved?.(path);
  }
  return paths;
}
