export const maxAttachments = 4;
export const maxFiles = 2;
export const maxFileBytes = 10 * 1024 * 1024;
export const maxImageAttachmentBytes = 3 * 1024 * 1024;
export const maxFileNameInput = 1024;
export const attachmentFolderName = 'Komorebi Attachments';
export const maxEncodedFileBytes = Math.ceil(maxFileBytes / 3) * 4;
// Two maximum-size files plus two maximum-size images is the largest allowed combination.
// Reserve space for JSON-escaped filenames, MIME types, and the existing prompt envelope.
const maxEncodedImageBytes = Math.ceil(maxImageAttachmentBytes / 3) * 4;
export const maxUploadFrameBytes = maxFiles * (maxEncodedFileBytes + maxFileNameInput * 6) +
  (maxAttachments - maxFiles) * maxEncodedImageBytes + 1_048_576;

export const nativeImageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export const isImageAttachment = (file: Pick<File, 'type'>) => [...nativeImageTypes, 'image/heic', 'image/heif'].includes(file.type);

export function attachmentCountIssue(images: number, files: number) {
  if (files > maxFiles) return 'files';
  if (images + files > maxAttachments) return 'total';
}

export function selectionCountIssue(selection: readonly Pick<File, 'type'>[]) {
  const images = selection.filter(isImageAttachment).length;
  return attachmentCountIssue(images, selection.length - images);
}

export type FileUpload = { name: string; mime?: string; data: string };
const blockedExtension = /\.(?:app|sh|command|pkg|dmg|exe|bat)$/i;
const unsafeNameChars = /[\\/:：=*?"<>|`、\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu;
const uuid4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const storedFileName = new RegExp(`^${uuid4}_([\\s\\S]+)$`);
const utf8 = new TextEncoder();

/** A plain path component. Check the final extension before shortening the name, so truncation cannot hide it. */
export function cleanUploadName(raw: string): string | undefined {
  if (!raw || raw.length > maxFileNameInput) return;
  const trimmed = raw.normalize('NFC').trim();
  const cleaned = trimmed.replace(unsafeNameChars, '_').replace(/^[.\s]+/, '').trimEnd();
  if (!cleaned || blockedExtension.test(trimmed) || blockedExtension.test(cleaned)) return;
  // Leave room under the filesystem's component limit for UUID + separator.
  const extension = cleaned.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned;
  let short = '', count = 0, bytes = utf8.encode(extension).length;
  for (const char of stem) {
    const width = utf8.encode(char).length;
    if (count + extension.length >= 120 || bytes + width > 210) break;
    short += char;
    count++;
    bytes += width;
  }
  const name = short.trimEnd() + extension;
  return name && !blockedExtension.test(name) ? name : undefined;
}

export function originalUploadName(stored: string): string | undefined {
  const name = stored.match(storedFileName)?.[1];
  return name && cleanUploadName(name) === name ? name : undefined;
}

export function requireFileUploadSupport(files: readonly File[], supported: boolean) {
  return supported || files.every(isImageAttachment);
}

/** Only the snapshot on the actual socket may authorise sending file fields. */
export function sendFileUpload(socket: Pick<WebSocket, 'readyState' | 'send'> | null, supportedSocket: object | null, envelope: object, encodedAttachments: string) {
  if (!socket || socket.readyState !== 1) return 'unavailable';
  if (supportedSocket !== socket) return 'unsupported';
  socket.send(JSON.stringify(envelope).slice(0, -1) + ',' + encodedAttachments.slice(1));
  return 'sent';
}

export function readBlobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onabort = () => reject(new Error('read cancelled'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || result.indexOf(',') < 0) reject(new Error('read failed'));
      else resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
