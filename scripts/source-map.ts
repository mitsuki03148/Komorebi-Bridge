// Contents
// Read tracked source files — Find section names and their existing descriptions.
// Update the source map — Replace only the generated block or check its freshness.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Read tracked source files
// Use Git's index for the file list and the worktree for current source text.
const start = '<!-- source-map:start -->';
const end = '<!-- source-map:end -->';

function sourcePaths(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter(path => /^(?:(?:src|bridge|scripts)\/|[^/]+$)/.test(path) &&
      (/\.(?:[cm]?js|jsx|ts|tsx|css|py|sh|command)$/.test(path) || /^scripts\/[^/.]+$/.test(path)) &&
      !/(?:^|\/)(?:fixtures|__tests__)\//.test(path) &&
      !/(?:\.test\.|\.spec\.|(?:^|\/)test[-_.])/.test(path)).sort();
}

function sections(source: string): string[] {
  const lines = source.split(/\r?\n/);
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith('//')) break;
    if (/^\/\/\s*Contents\s*:?\s*$/i.test(line)) { header = i; break; }
  }
  if (header < 0) return [];
  const names: string[] = [];
  let after = header + 1;
  for (; after < lines.length; after++) {
    const match = /^\s*\/\/\s*(?:-\s*)?(\S.*)$/.exec(lines[after]);
    if (!match) break;
    names.push(match[1]);
  }
  return names.map(name => {
    if (name.includes(' — ')) return name;
    for (let i = after; i < lines.length; i++) {
      const match = /^\s*\/\/\s*(.*?)\s*$/.exec(lines[i]);
      if (!match) continue;
      const label = match[1].replace(/^─+\s*/, '').replace(/\s*─+$/, '');
      if (label.startsWith(`${name}: `)) return `${name} — ${label.slice(name.length + 2)}`;
      if (label !== name) continue;
      const next = /^\s*\/\/\s*(\S.*)$/.exec(lines[i + 1] ?? '');
      if (next && !names.includes(next[1]) && !/^─/.test(next[1])) return `${name} — ${next[1]}`;
      break;
    }
    return name;
  });
}

function inventory(): string {
  const organized: string[] = [];
  const pending: string[] = [];
  for (const path of sourcePaths()) {
    const found = sections(readFileSync(path, 'utf8'));
    if (!found.length) pending.push(`- \`${path}\``);
    else organized.push(`### \`${path}\`\n\n${found.map(line => `- ${line}`).join('\n')}`);
  }
  return ['## 檔案目錄', ...organized, '### 未整理', pending.join('\n') || '（沒有）'].join('\n\n');
}

// Update the source map
// Keep all hand-written content outside the two markers byte-for-byte.
function main(): void {
  const check = process.argv.slice(2);
  if (check.some(arg => arg !== '--check') || check.length > 1) throw new Error('Usage: source-map [--check]');
  const file = readFileSync('SOURCE-MAP.md', 'utf8');
  const first = file.indexOf(start);
  const last = file.indexOf(end);
  if (first < 0 || last < first + start.length || file.indexOf(start, first + start.length) !== -1 || file.indexOf(end, last + end.length) !== -1) {
    throw new Error('SOURCE-MAP.md 必須有一組正確的 source-map 標記。');
  }
  const updated = file.slice(0, first + start.length) + '\n\n' + inventory() + '\n\n' + file.slice(last);
  if (check.length) {
    if (updated !== file) { console.error('請跑 npm run source-map'); process.exitCode = 1; }
  } else if (updated !== file) writeFileSync('SOURCE-MAP.md', updated);
}

main();
