/** Encode the original file bytes and large JSON payload without blocking the composer. */
export function prepareFileUpload(files: File[], attachments: { mime: string; data: string }[]) {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./fileUpload.worker.ts', import.meta.url), { type: 'module' });
    const failed = () => { worker.terminate(); reject(new Error('file upload read failed')); };
    worker.onerror = failed;
    worker.onmessageerror = failed;
    worker.onmessage = event => {
      worker.terminate();
      if (typeof event.data === 'string') resolve(event.data);
      else reject(new Error('file upload read failed'));
    };
    try { worker.postMessage({ files, attachments }); }
    catch { failed(); }
  });
}
