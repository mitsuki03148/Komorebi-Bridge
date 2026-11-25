import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { translate } from '../src/i18n/index.ts';
import { zh } from '../src/i18n/zh.ts';

// These exact strings are protocol comparisons or text sent to the CLI, not UI copy.
const componentExceptions: Record<string, string[]> = {
  'LiveTerminal.tsx': ['權限設定', '工作階段選單'],
  'QuestionCard.tsx': ['回答你的問題', '回答你的問題：'],
};

test('phase 2 top-level component code has no unlisted Han text', () => {
  const files = readdirSync('src/components').filter(file => file.endsWith('.tsx'));
  for (const file of files) {
    let code = transformSync(readFileSync(`src/components/${file}`, 'utf8'), { loader: 'tsx', legalComments: 'none' }).code;
    for (const text of componentExceptions[file] ?? []) code = code.replaceAll(text, '');
    assert.doesNotMatch(code, /[\p{Script=Han}]/u, file);
  }
});

test('app and remaining data/util files contain no unlisted Han UI text', () => {
  let app = transformSync(readFileSync('src/App.tsx', 'utf8'), { loader: 'tsx', legalComments: 'none' }).code;
  // The guild brand is a proper name. These two sentences are sent to the agent with images.
  for (const text of ['木漏れ日ギルド', '請看看這', '張圖片。', '請看看這張圖片。']) app = app.replaceAll(text, '');
  assert.doesNotMatch(app, /[\p{Script=Han}]/u, 'src/App.tsx');
  const exceptions: Record<string, string> = {
    // Built-in character names and default payloads retain their original data for Bridge comparison;
    // UI consumers localize matching defaults at render time.
    'src/data/initialGuildData.ts': 'character and Bridge defaults',
    // These constants are used for stable setting IDs; UI labels use the dictionary.
    'src/utils/voice.ts': 'voice setting defaults and agent-related data',
    // These paths contain literal transcript protocol markers and Chinese regular expressions.
    'src/utils/transcriptText.ts': 'transcript image marker',
    'src/utils/bubbleRuns.ts': 'handoff protocol markers',
    'src/utils/bridgeNote.ts': 'Bridge roster note markers',
    'src/utils/questNotice.ts': 'file-trigger notice protocol markers',
    'src/utils/launchMode.ts': 'default mode string used by other paths',
  };
  for (const dir of ['src/data', 'src/utils']) {
    for (const file of readdirSync(dir).filter(name => name.endsWith('.ts'))) {
      const path = `${dir}/${file}`;
      if (exceptions[path]) continue;
      const code = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', legalComments: 'none' }).code;
      assert.doesNotMatch(code, /[\p{Script=Han}]/u, path);
    }
  }
});

test('phase 2 values fall back to Chinese, interpolating a whole dynamic message', async () => {
  const table = zh as Record<string, string>;
  assert.equal(translate('zh', 'archive.delete.selected', { count: 4 }), '刪除已選 (4)');
  assert.equal(table['room.successor.current'].replace('{room}', 'R5'), '已由「R5」接手：送來這裡的訊息會轉給它。');
  // A key missing from English shows the Chinese text and still fills in its values.
  const { en } = await import('../src/i18n/en.ts');
  const english = en as Record<string, string>;
  const saved = english['guild.modal.quota.fivehour.reset'];
  delete english['guild.modal.quota.fivehour.reset'];
  try { assert.equal(translate('en', 'guild.modal.quota.fivehour.reset', { time: '12:00' }), 'MP 5h　重置 12:00'); } finally { english['guild.modal.quota.fivehour.reset'] = saved; }
  assert.equal(translate('zh', 'guild.modal.new.turbofull', { label: zh['guild.modal.new.turbo'] }), zh['guild.modal.new.turbo'] + zh['guild.modal.new.turbodetail']);
});
