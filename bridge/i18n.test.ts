import assert from 'node:assert/strict';
import test from 'node:test';
import { en } from '../src/i18n/en.ts';
import { ja } from '../src/i18n/ja.ts';
import { zh } from '../src/i18n/zh.ts';
import { getLang, languages, setLang, subscribeLang, t, translate } from '../src/i18n/index.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

test('the three languages are offered and Chinese is the start language', () => {
  assert.deepEqual(languages, ['zh', 'en', 'ja']);
  assert.equal(getLang(), 'zh');
});

test('a key shows the text of the chosen language, and Chinese where a translation is missing', () => {
  assert.equal(translate('en', 'settings.language.title'), 'Interface language');
  assert.equal(translate('ja', 'settings.language.title'), '表示言語');
  assert.equal(translate('zh', 'settings.language.title'), '介面語言');
  const text = (en as Record<string, string>)['settings.language.note'];
  delete (en as Record<string, string>)['settings.language.note'];
  try { assert.equal(translate('en', 'settings.language.note'), zh['settings.language.note']); }
  finally { (en as Record<string, string>)['settings.language.note'] = text; }
});

test('{name} values are filled in, and an unknown one is left as written', () => {
  const table = zh as Record<string, string>;
  table['test.hello'] = 'Hi {name}, {n} new';
  try {
    assert.equal(translate('zh', 'test.hello' as never, { name: 'Hikari', n: 3 }), 'Hi Hikari, 3 new');
    assert.equal(translate('zh', 'test.hello' as never, { name: 'Hikari' }), 'Hi Hikari, {n} new');
  } finally { delete table['test.hello']; }
});

test('every translation uses the same {values} as the Chinese text, and has no key the Chinese table lacks', () => {
  for (const [lang, table] of [['en', en], ['ja', ja]] as const) {
    for (const [key, text] of Object.entries(table)) {
      assert.ok(key in zh, `${lang}: ${key} is not in zh`);
      assert.equal(placeholders(text), placeholders((zh as Record<string, string>)[key]), `${lang}: ${key} changes the {values}`);
    }
  }
});

test('changing the language tells listeners once and changes t()', () => {
  let calls = 0;
  const stop = subscribeLang(() => { calls++; });
  try {
    setLang('ja'); setLang('ja');
    assert.equal(calls, 1);
    assert.equal(t('settings.language.title'), '表示言語');
  } finally { setLang('zh'); stop(); }
  assert.equal(t('settings.language.title'), '介面語言');
});
