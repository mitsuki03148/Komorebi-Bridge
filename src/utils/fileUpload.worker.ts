import type { FileUpload } from './fileAttachments';
import { readBlobBase64 } from './fileAttachments';

self.onmessage = async ({ data }: MessageEvent<{ files: File[]; attachments: { mime: string; data: string }[] }>) => {
  try {
    const files: FileUpload[] = [];
    for (const file of data.files) {
      files.push({ name: file.name, ...(file.type ? { mime: file.type } : {}), data: await readBlobBase64(file) });
    }
    self.postMessage(JSON.stringify({ files, ...(data.attachments.length ? { attachments: data.attachments } : {}) }));
  } catch {
    self.postMessage(null);
  }
};
