import { t } from '../i18n';
/** A short name for a Google Docs / Sheets / Slides / Drive address, so a long link can show as a small chip. */
export function googleLabel(url: string): string | undefined {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return undefined; }
  if (!/^https?:$/.test(parsed.protocol)) return undefined;
  const path = parsed.pathname;
  if (parsed.hostname === 'docs.google.com') {
    if (path.startsWith('/document')) return t('utils.google.doc');
    if (path.startsWith('/spreadsheets')) return t('utils.google.sheet');
    if (path.startsWith('/presentation')) return t('utils.google.slides');
    if (path.startsWith('/forms')) return t('utils.google.form');
    return t('utils.google.doc');
  }
  if (parsed.hostname === 'drive.google.com') return path.includes('/folders') ? t('utils.google.folder') : t('utils.google.drive');
  return undefined;
}

/** The Codex citation tag `:codex-file-citation{path="…" purpose="…"}`: a web address becomes a plain link, a file path becomes inline code. */
export function rewriteCitations(text: string): string {
  if (!text.includes(':codex-file-citation{')) return text;
  return text.replace(/:codex-file-citation\{[^}]*?path="([^"]+)"[^}]*\}/g, (_all, target: string) =>
    /^https?:\/\//i.test(target) ? `<${target}>` : `\`${target}\``);
}
