/** The public display name; the Bridge may provide a local override at runtime. */
export const DEFAULT_DISPLAY_NAME = 'Komorebi Bridge';

declare global { interface Window { __KOMOREBI_DISPLAY_NAME__?: string } }

export const displayName = () => typeof window === 'undefined' ? DEFAULT_DISPLAY_NAME : window.__KOMOREBI_DISPLAY_NAME__ || DEFAULT_DISPLAY_NAME;

export function brandHtml(template: string, name: string) {
  const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const value = JSON.stringify(name).replace(/</g, '\\u003c');
  return template.replaceAll(DEFAULT_DISPLAY_NAME, () => escaped).replace('</head>', () => `<script>window.__KOMOREBI_DISPLAY_NAME__=${value}</script></head>`);
}

export function brandManifest<T extends object>(manifest: T, name: string) {
  return { ...manifest, name, short_name: name, description: name };
}
