const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
export interface LineRange { start: number; end: number }

/** A link to a file at one commit, so it keeps pointing at the same text. A line range adds #L10 or #L10-L20. */
export function blobLink(owner: string, repo: string, sha: string, path: string, lines?: LineRange) {
  const range = lines ? (lines.start === lines.end ? `#L${lines.start}` : `#L${Math.min(lines.start, lines.end)}-L${Math.max(lines.start, lines.end)}`) : '';
  return `https://github.com/${owner}/${repo}/blob/${sha}/${encodePath(path)}${range}`;
}
export const treeLink = (owner: string, repo: string, sha: string, path: string) => `https://github.com/${owner}/${repo}/tree/${sha}${path ? '/' + encodePath(path) : ''}`;
export const commitLink = (owner: string, repo: string, sha: string) => `https://github.com/${owner}/${repo}/commit/${sha}`;
export const compareLink = (owner: string, repo: string, base: string, head: string) => `https://github.com/${owner}/${repo}/compare/${base}...${head}`;
export const issueLink = (owner: string, repo: string, number: number, commentId?: number) =>
  `https://github.com/${owner}/${repo}/issues/${number}${commentId === undefined ? '' : `#issuecomment-${commentId}`}`;

/**
 * Picking lines by tapping their numbers: the first tap picks one line, the next extends it to a range, a third tap starts again,
 * and tapping the only picked line clears it. Called without `tapped` flag it only says that a first tap would start a pick.
 */
export function lineSelection(current: LineRange | undefined, line: number, tapped?: boolean): LineRange | undefined | 'start' {
  if (!tapped) return 'start';
  if (!current) return { start: line, end: line };
  if (current.start === current.end) return current.start === line ? undefined : { start: Math.min(current.start, line), end: Math.max(current.start, line) };
  return { start: line, end: line };
}

export interface PatchRow { kind: 'hunk' | 'context' | 'add' | 'del' | 'note'; text: string; oldLine?: number; newLine?: number }

/** The lines of a unified diff for one file, each with its kind and its line number before and after. */
export function parsePatch(patch: string | undefined): PatchRow[] {
  if (!patch) return [];
  const rows: PatchRow[] = [];
  let oldLine = 0, newLine = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); rows.push({ kind: 'hunk', text: line }); continue; }
    if (line.startsWith('\\')) { rows.push({ kind: 'note', text: line }); continue; }
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), oldLine: undefined, newLine: newLine++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), oldLine: oldLine++, newLine: undefined });
    else rows.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ });
  }
  return rows;
}
