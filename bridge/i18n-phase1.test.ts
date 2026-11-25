import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { zh } from '../src/i18n/zh.ts';
import { translate } from '../src/i18n/index.ts';

const phase1Files = [
  'src/components/ControlBar.tsx',
  'src/components/PermissionButton.tsx',
  'src/components/SettingsModals.tsx',
  'src/components/github/GitHubPanel.tsx',
  'src/components/github/SearchPicker.tsx',
  'src/components/github/views.tsx',
  'src/components/drive/DrivePanel.tsx',
  'src/components/drive/views.tsx',
];

test('phase 1 owned component code contains no untranslated Han literals', () => {
  for (const path of phase1Files) {
    const code = transformSync(readFileSync(path, 'utf8'), { loader: 'tsx', legalComments: 'none' }).code;
    assert.doesNotMatch(code, /[\p{Script=Han}]/u, path);
  }
});

test('top bar has no untranslated Han literals except the guild brand', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const header = app.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  assert.ok(header);
  const code = transformSync(`const Header = () => (${header});`, { loader: 'tsx', legalComments: 'none' }).code.replace('木漏れ日ギルド', '');
  assert.doesNotMatch(code, /[\p{Script=Han}]/u);
});

test('a phase 1 key missing from English shows the Chinese text, and the English text interpolates', async () => {
  const { en } = await import('../src/i18n/en.ts');
  const table = en as Record<string, string>;
  const saved = table['drive.empty'];
  delete table['drive.empty'];
  try { assert.equal(translate('en', 'drive.empty'), zh['drive.empty']); } finally { table['drive.empty'] = saved; }
  assert.notEqual(translate('en', 'topbar.group.members', { count: 3 }), zh['topbar.group.members'].replace('{count}', '3'));
  assert.match(translate('en', 'topbar.group.members', { count: 3 }), /3/);
});
