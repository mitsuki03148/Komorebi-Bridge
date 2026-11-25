import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { googleLabel, rewriteCitations } from '../src/utils/googleLinks.ts';

test('Google addresses get a short label, other addresses do not', () => {
  assert.equal(googleLabel('https://docs.google.com/document/d/abc/edit'), 'Google 文件');
  assert.equal(googleLabel('https://docs.google.com/spreadsheets/d/abc/edit'), 'Google 試算表');
  assert.equal(googleLabel('https://docs.google.com/presentation/d/abc/edit'), 'Google 簡報');
  assert.equal(googleLabel('https://drive.google.com/drive/folders/abc'), 'Google 雲端硬碟資料夾');
  assert.equal(googleLabel('https://example.com/document/d/abc'), undefined);
  assert.equal(googleLabel('javascript:alert(1)'), undefined);
});

test('a Codex citation tag becomes a link or inline code', () => {
  const url = 'https://docs.google.com/document/d/1cTe0/edit';
  assert.equal(rewriteCitations(`見 :codex-file-citation{path="${url}" purpose="output"}。`), `見 <${url}>。`);
  assert.equal(rewriteCitations(':codex-file-citation{path="/Volumes/K/a.md" purpose="output"}'), '`/Volumes/K/a.md`');
  assert.equal(rewriteCitations('沒有標籤'), '沒有標籤');
});

test('on state of the shield and the small controls is the icon colour only, without a filled circle', () => {
  const bar = readFileSync(new URL('../src/components/ControlBar.tsx', import.meta.url), 'utf8');
  const shield = readFileSync(new URL('../src/components/PermissionButton.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(bar, /backgroundColor: accent\.wash/);
  assert.doesNotMatch(shield, /!bg-\[#FDECEF\]/);
});
