import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Crumbs, DriveRows, FileCard, MenuSheet, TextView, displayName, fileSize, nativeLabel, type DriveEntry } from '../src/components/drive/views';
import { DrivePanel } from '../src/components/drive/DrivePanel';

const noop = () => {};
const NOW = Date.parse('2026-11-15T12:00:00Z');
const entry = (extra: Partial<DriveEntry> & { name: string }): DriveEntry => ({ type: 'file', size: 2048, modified: '2026-11-15T11:00:00Z', textual: false, ...extra });

test('folders and files list with an icon, a name, a size and an age; Google documents lose their extension and say what they are', () => {
  const html = renderToStaticMarkup(createElement(DriveRows, { now: NOW, onOpen: noop, onMenu: noop, entries: [
    entry({ name: 'Docs', type: 'dir', size: 0 }), entry({ name: '筆記.md', textual: true }), entry({ name: 'photo.jpg', size: 3_000_000 }),
    entry({ name: 'DemoProject 規格.gdoc', type: 'native', size: 177 }), entry({ name: 'Q3.gsheet', type: 'native' }),
  ] }));
  assert.match(html, /data-drive-row="dir" data-name="Docs"/);
  assert.match(html, /data-drive-row="file" data-name="筆記\.md"/);
  assert.match(html, />筆記\.md</);
  assert.match(html, /2 KB · 1 小時前/);
  assert.match(html, /2\.9 MB/);
  assert.match(html, />DemoProject 規格</, 'no .gdoc shown');
  assert.match(html, /Google 文件/);
  assert.match(html, /Google 試算表/);
  assert.match(html, /aria-label="更多：Docs"/);
  assert.match(renderToStaticMarkup(createElement(DriveRows, { entries: [], onOpen: noop })), /沒有項目/);
  assert.equal(displayName(entry({ name: 'a.gdoc', type: 'native' })), 'a');
  assert.equal(nativeLabel('x.gslides'), 'Google 簡報');
  assert.equal(fileSize(500), '500 B');
  assert.equal(fileSize(1_572_864), '1.5 MB');
});

test('the path is shown as clickable steps from Drive', () => {
  const html = renderToStaticMarkup(createElement(Crumbs, { path: 'My Drive/Team/09 Agents', onOpen: noop }));
  assert.match(html, />Drive</);
  assert.match(html, />My Drive</);
  assert.match(html, />09 Agents</);
});

test('a text file shows as a page when it is Markdown and as plain text otherwise; the buttons are 編輯, 原文, 複製連結, and Finder only on a computer', () => {
  const file = { path: 'a.md', text: '# 標題\n\n- 一', truncated: false, size: 20, mtimeMs: 1, editable: true };
  const view = (extra = {}) => renderToStaticMarkup(createElement(TextView, { name: 'a.md', file, editing: false, draft: '', onDraft: noop, onEdit: noop, onSave: noop, onCancel: noop, onBack: noop, onCopyLink: noop, ...extra }));
  const md = view();
  assert.match(md, /<h3[^>]*>標題</);
  assert.match(md, />編輯</);
  assert.match(md, />原文</);
  assert.match(md, />複製連結</);
  assert.doesNotMatch(md, /Finder/);
  assert.match(view({ onReveal: noop }), />在 Finder 顯示</);
  const txt = renderToStaticMarkup(createElement(TextView, { name: 'a.txt', file: { ...file, text: '# 不是標題' }, editing: false, draft: '', onDraft: noop, onEdit: noop, onSave: noop, onCancel: noop, onBack: noop, onCopyLink: noop }));
  assert.match(txt, /<pre[^>]*># 不是標題/);
  assert.doesNotMatch(txt, /<h3 /);
  assert.doesNotMatch(view({ file: { ...file, editable: false, truncated: true } }), />編輯</, 'a cut file cannot be edited');
  assert.match(view({ file: { ...file, editable: false, truncated: true } }), /不能編輯/);
});

test('editing gives a 16px box holding the text, a save that is off until something changed, and the reason when a save fails', () => {
  const file = { path: 'a.md', text: '原文', truncated: false, size: 6, mtimeMs: 1, editable: true };
  const edit = (extra = {}) => renderToStaticMarkup(createElement(TextView, { name: 'a.md', file, editing: true, draft: '原文', onDraft: noop, onEdit: noop, onSave: noop, onCancel: noop, onBack: noop, onCopyLink: noop, ...extra }));
  const same = edit();
  assert.match(same, /<form data-edit/);
  assert.match(same, /<textarea[^>]*text-base/);
  assert.match(same, /<button type="submit" disabled/);
  assert.doesNotMatch(edit({ draft: '新內容' }), /<button type="submit" disabled/);
  assert.match(edit({ draft: '新', saving: true }), /儲存中/);
  assert.match(edit({ draft: '新', error: '檔案已被更改，請重新開啟。' }), /role="alert"[^>]*>檔案已被更改/);
  assert.doesNotMatch(same, />編輯</, 'no edit button while editing');
});

test('the item menu offers link, path, move and cancel, and Finder only on a computer', () => {
  const sheet = (desktop: boolean) => renderToStaticMarkup(createElement(MenuSheet, { entry: entry({ name: 'a.md' }), desktop, onCopyLink: noop, onCopyPath: noop, onReveal: noop, onMove: noop, onClose: noop }));
  const phone = sheet(false);
  for (const label of ['複製連結', '複製路徑', '移動…', '取消']) assert.match(phone, new RegExp(`>${label}<`));
  assert.doesNotMatch(phone, /Finder/);
  assert.match(sheet(true), />在 Finder 顯示</);
  assert.doesNotMatch(phone, /刪除|重新命名/, 'no delete and no rename');
});

test('a card for a Google document or another file says what it is and offers to open it in Drive and to copy the link', () => {
  const html = renderToStaticMarkup(createElement(FileCard, { entry: entry({ name: '規格.gdoc', type: 'native' }), onBack: noop, onCopyLink: noop, onOpenLink: noop, linkUrl: 'https://docs.google.com/document/d/X/edit' }));
  assert.match(html, />規格</);
  assert.match(html, /Google 文件/);
  assert.match(html, />在 Google Drive 開啟</);
  assert.match(html, />複製連結</);
});

test('the Drive panel opens as a dialog with its title, close and refresh, and the app has its button first in the top rail', async () => {
  const html = renderToStaticMarkup(createElement(DrivePanel, { call: (() => new Promise(() => {})) as never, onClose: noop, desktop: true }));
  assert.match(html, /role="dialog"[^>]*aria-label="Drive"/);
  assert.match(html, /aria-label="重新整理"/);
  assert.match(html, /aria-label="關閉"/);
  assert.match(html, /aria-label="篩選名稱"/);
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const rail = app.slice(app.indexOf('Minimalist Komorebi Top Bar'), app.indexOf('Main Content Area'));
  assert.ok(rail.indexOf('aria-label="Drive"') > 0 && rail.indexOf('aria-label="Drive"') < rail.indexOf('aria-label="GitHub"'), 'Drive is the first button');
  assert.match(app, /new GhClient\([\s\S]*?'DRIVE'\)/);
  assert.match(app, /event\.type === 'DRIVE_RESULT'/);
  assert.match(app, /<DrivePanel call=\{driveRef\.current\.call\}/);
});

test('every text box in the Drive panel is 16px on a phone, and its text is written Chinese', async () => {
  const dir = new URL('../src/components/drive/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.tsx'))) {
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const tag of source.match(/<(?:input|textarea)\b[\s\S]*?\/>/g) ?? []) assert.match(tag, /\btext-base\b/, `${name}: ${tag.slice(0, 70)}`);
    const shown = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(shown, /[冇嘅唔喺咗呢哋啲嚟畀]/, `${name} has Cantonese in it`);
  }
  const server = (await readFile(new URL('../bridge/drive.ts', import.meta.url), 'utf8')).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(server, /[冇嘅唔喺咗呢哋啲嚟畀]/);
});
