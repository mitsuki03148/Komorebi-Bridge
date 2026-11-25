const extension = '(?:png|jpe?g|webp|gif|heic|heif)';
const imageExtension = new RegExp(`\\.${extension}$`, 'i');
const maxPerMessage = 12;

const isRemote = (value: string) => /^(?:https?:|data:|blob:)/i.test(value);

function clean(value: string) {
  let path = value.trim();
  if (/^file:\/\//i.test(path)) {
    try { path = decodeURIComponent(path.replace(/^file:\/\//i, '')); } catch { return undefined; }
  }
  path = path.replace(/^<|>$/g, '').replace(/[?#].*$/, (tail) => (imageExtension.test(path.slice(0, path.length - tail.length)) ? '' : tail));
  return imageExtension.test(path) && !isRemote(path) && path.length <= 1024 && !/[\x00-\x1f]/.test(path) ? path : undefined;
}

/**
 * Image file paths a message mentions, in order of appearance: markdown image or link targets,
 * `backticked` paths (spaces allowed), file:// URLs, and bare absolute or ~/ paths.
 * Relative paths count only inside markdown or backticks, where they are clearly paths.
 */
export function extractImagePaths(text: string): string[] {
  const found: string[] = [];
  const add = (value: string | undefined) => {
    const path = value === undefined ? undefined : clean(value);
    if (path && !found.includes(path)) found.push(path);
  };
  const sources: { index: number; value: string }[] = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\((<[^>\n]+>|[^)\s]+(?:\s+[^)\s"]+)*)(?:\s+"[^"]*")?\)/g)) sources.push({ index: match.index, value: match[1] });
  for (const match of text.matchAll(/`([^`\n]+)`/g)) sources.push({ index: match.index, value: match[1] });
  for (const match of text.matchAll(/file:\/\/[^\s"'`<>)\]]+/gi)) sources.push({ index: match.index, value: match[0] });
  for (const match of text.matchAll(new RegExp(`(?<![\\w:/.])(~?\\/(?:[^\\s"'\`<>()\\[\\]{}|*?\\\\]+\\/)*[^\\s"'\`<>()\\[\\]{}|*?\\\\/]+\\.${extension})(?!\\w)`, 'gi'))) {
    sources.push({ index: match.index, value: match[1] });
  }
  for (const source of sources.sort((a, b) => a.index - b.index)) add(source.value);
  return found.slice(0, maxPerMessage);
}

export function imageFileName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
