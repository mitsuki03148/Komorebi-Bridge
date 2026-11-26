// Track test-created temporary directories and remove them after this test file.
import { mkdtempSync as makeTempSync } from 'node:fs';
import { mkdtemp as makeTemp, rm } from 'node:fs/promises';
import { relative, resolve, isAbsolute } from 'node:path';
import { after } from 'node:test';

const created: string[] = [];

function track(dir: string) {
  const evidence = process.env.RSI_TIDY_EVIDENCE;
  if (evidence) {
    const path = relative(resolve(evidence), resolve(dir));
    if (path === '' || (!path.startsWith('..') && !isAbsolute(path))) return dir;
  }
  created.push(dir);
  return dir;
}

after(async () => {
  for (const dir of created.reverse()) await rm(dir, { recursive: true, force: true });
});

export async function mkdtemp(prefix: string): Promise<string> {
  return track(await makeTemp(prefix));
}

export function mkdtempSync(prefix: string): string {
  return track(makeTempSync(prefix));
}
