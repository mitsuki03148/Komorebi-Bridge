import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { test } from 'node:test';
import { maxImageBytes, prepareImage } from '../src/utils/prepareImage';

test('original respects the 3 MB limit and large images are resized with a quality fallback', async () => {
  const small = new File([new Uint8Array(20)], 'small.png', { type: 'image/png' }) as unknown as globalThis.File;
  const large = new File([new Uint8Array(maxImageBytes + 1)], 'large.jpg', { type: 'image/jpeg' }) as unknown as globalThis.File;
  assert.equal(await prepareImage(small, 'original'), small);
  await assert.rejects(prepareImage(large, 'original'), /3 MB/);
  const savedImage = globalThis.Image;
  const savedDocument = globalThis.document;
  const makeUrl = URL.createObjectURL;
  const revokeUrl = URL.revokeObjectURL;
  const qualities: number[] = [];
  const canvas: any = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob(callback: (blob: Blob) => void, _type: string, quality: number) {
      qualities.push(quality);
      callback(new Blob([new Uint8Array(quality === 0.86 ? maxImageBytes + 1 : 50)], { type: 'image/jpeg' }));
    } };
  try {
    globalThis.Image = class { naturalWidth = 4000; naturalHeight = 2000; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); } } as unknown as typeof Image;
    globalThis.document = { createElement: () => canvas } as unknown as Document;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    const result = await prepareImage(large, 'medium');
    assert.deepEqual([canvas.width, canvas.height], [1600, 800]);
    assert.deepEqual(qualities, [0.86, 0.7]);
    assert.equal(result.type, 'image/jpeg');
    assert.ok(result.size <= maxImageBytes);
  } finally {
    globalThis.Image = savedImage;
    globalThis.document = savedDocument;
    URL.createObjectURL = makeUrl;
    URL.revokeObjectURL = revokeUrl;
  }
});
