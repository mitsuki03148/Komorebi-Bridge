import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_DISPLAY_NAME } from '../src/brand';

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function png(path: string) {
  const bytes = readFileSync(join(root, 'public', path.replace(/^\//, '')));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path} is not a PNG`);
  // IHDR: width, height, bit depth, colour type (2 = RGB, 6 = RGBA)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}
const href = (rel: string) => html.match(new RegExp(`<link rel="${rel}"[^>]*href="([^"]+)"`))?.[1];

test('the page uses the public name and points at its icons and manifest', () => {
  assert.ok(html.includes(`<title>${DEFAULT_DISPLAY_NAME}</title>`));
  assert.ok(html.includes(`name="apple-mobile-web-app-title" content="${DEFAULT_DISPLAY_NAME}"`));
  assert.equal(href('apple-touch-icon'), '/icons/apple-touch-icon.png');
  assert.equal(href('icon'), '/icons/favicon-32.png');
  assert.equal(href('manifest'), '/manifest.webmanifest');
});

test('the home screen icon is an opaque 180px square, because iOS fills transparent pixels with black', () => {
  const touch = png(href('apple-touch-icon')!);
  assert.deepEqual([touch.width, touch.height], [180, 180]);
  assert.equal(touch.colourType, 2, 'the icon has an alpha channel');
  const tab = png(href('icon')!);
  assert.deepEqual([tab.width, tab.height], [32, 32]);
});

test('the manifest names the app and lists icons that exist at the sizes it declares', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, DEFAULT_DISPLAY_NAME);
  assert.equal(manifest.short_name, DEFAULT_DISPLAY_NAME);
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon: { sizes: string }) => icon.sizes).sort(), ['192x192', '512x512']);
  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const [size] = icon.sizes.split('x').map(Number);
    const info = png(icon.src);
    assert.deepEqual([info.width, info.height], [size, size], icon.src);
    assert.equal(info.colourType, 2, `${icon.src} has an alpha channel`);
    assert.equal(icon.type, 'image/png');
  }
});
