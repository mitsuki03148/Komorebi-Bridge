import { t } from '../i18n';
export type ImageSize = 'original' | 'large' | 'medium' | 'small';
export const maxImageBytes = 3 * 1024 * 1024;
export const maxSourceBytes = 30 * 1024 * 1024;

export async function prepareImage(file: File, size: ImageSize): Promise<Blob> {
  if (size === 'original') {
    if (file.size > maxImageBytes) throw new Error(t('utils.image.original.large'));
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(t('utils.image.convert'));
    return file;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(t('utils.image.read')));
      element.src = url;
    });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 50_000_000) throw new Error(t('utils.image.dimensions'));
    const maximum = { large: 2048, medium: 1600, small: 1024 }[size];
    const scale = Math.min(1, maximum / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('utils.image.process'));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.type === 'image/jpeg' && blob.size <= maxImageBytes) return blob;
    }
    throw new Error(t('utils.image.compressed.large'));
  } finally { URL.revokeObjectURL(url); }
}
