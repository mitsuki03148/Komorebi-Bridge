import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { Markdown, hastText } from '../src/components/Markdown';
import { RightRoomWorkspace } from '../src/components/RightRoomWorkspace';
import { INITIAL_CHARACTERS } from '../src/data/initialGuildData';
import type { TerminalRoom } from '../src/types/guild';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test('common Markdown becomes formatted text', () => {
  const html = render('# 標題\n\n**粗體** 同 *斜體* 同 ~~刪除~~ 同 `code`\n\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n> 引用\n\n---\n\n| 名 | 值 |\n|---|---|\n| a | 1 |\n\n- [x] 做完\n- [ ] 未做');
  assert.match(html, /<h3[^>]*>標題<\/h3>/);
  assert.match(html, /<strong[^>]*>粗體<\/strong>/);
  assert.match(html, /<em[^>]*>斜體<\/em>/);
  assert.match(html, /<del[^>]*>刪除<\/del>/);
  assert.match(html, /<code[^>]*>code<\/code>/);
  assert.match(html, /<ul[^>]*>[\s\S]*<li[^>]*>一<\/li>/);
  assert.match(html, /<ol[^>]*>[\s\S]*<li[^>]*>甲<\/li>/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<hr/);
  assert.match(html, /<table[\s\S]*<th[^>]*>名<\/th>[\s\S]*<td[^>]*>1<\/td>/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.match(html, /type="checkbox"[^>]*checked/);
});

test('fenced code keeps its layout and is not reformatted inside', () => {
  const html = render('看一下：\n\n```ts\nconst a = **1**;\n  if (a) {}\n```');
  assert.match(html, /<pre[^>]*>[\s\S]*<code[^>]*>const a = \*\*1\*\*;\n  if \(a\) \{\}\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /<strong/);
});

test('links are limited to the web and mail, and nothing from the message runs or loads', () => {
  const link = render('[官網](https://example.com/a?b=1) 同 [信](mailto:a@b.com)');
  assert.match(link, /<a href="https:\/\/example\.com\/a\?b=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(link, /<a href="mailto:a@b\.com"/);
  for (const text of ['[x](javascript:alert(1))', '[x](out/cat.png)', '[x](/Users/a/b.txt)', '[x](data:text/html;base64,AAAA)']) {
    assert.doesNotMatch(render(text), /<a /, text);
    assert.doesNotMatch(render(text), /href=/, text);
  }
  const image = render('![cat](https://tracker.example.com/pixel.png) 同 ![](out/a.png)');
  assert.doesNotMatch(image, /<img/);
  assert.doesNotMatch(image, /tracker\.example\.com/);
  assert.match(image, /［圖片：cat］/);
  const html = render('<script>alert(1)</script> <img src=x onerror="alert(1)"> <b>粗</b>');
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('plain text keeps its line breaks and looks the same as before', () => {
  const html = render('第一行\n第二行\n\n第二段');
  assert.match(html, /<p[^>]*whitespace-pre-wrap[^>]*>第一行\n第二行<\/p>/);
  assert.match(html, /<p[^>]*>第二段<\/p>/);
  assert.equal(render('沒有任何符號的一句').replace(/<[^>]+>/g, ''), '沒有任何符號的一句');
});

test('a very long message renders quickly', () => {
  const text = Array.from({ length: 800 }, (_, i) => `## 第 ${i} 節\n\n- **項目** \`${i}\` 同 [連結](https://example.com/${i})\n`).join('\n');
  assert.ok(text.length > 40_000);
  // CPU time keeps this regression check independent of other processes waiting for the same machine.
  const started = process.cpuUsage();
  const html = render(text);
  const cpu = process.cpuUsage(started);
  assert.ok((cpu.user + cpu.system) / 1_000 < 3_000, 'render must use less than 3 seconds of CPU time');
  assert.equal((html.match(/<h3|<h4/g) ?? []).length, 800);
});

test('only the agent side is formatted; what the user typed stays literal', () => {
  const room = (sender: 'agent' | 'user') => ({ id: 'r', modelId: 'CLAUDE', roomName: '測試', repoPath: '/tmp', gitBranch: 'main', selectedSubModel: 'Opus 5.5',
    effortLevel: null, contextUsagePct: null, progressPercent: null, status: 'idle', currentActionSummary: '', bubbleSnippet: '', updatedAt: '',
    remoteControl: {}, live: true, ready: true, logs: [{ id: 'l', sender, text: '**粗體** 同 `code`', timestamp: '10:00' }] }) as unknown as TerminalRoom;
  const html = (sender: 'agent' | 'user') => renderToStaticMarkup(createElement(RightRoomWorkspace, {
    room: room(sender), character: INITIAL_CHARACTERS.CLAUDE, onApprove() {}, onAdditionalApproval() {}, onInterrupt() {}, onReject() {},
    onSendPrompt() {}, onSubmitDraft() {}, attachmentPicker: null, attachmentPreview: null, hasAttachment: false,
    promptInput: '', setPromptInput() {}, onRunCompact() {}, terminal: null, terminalOpen: false, onToggleTerminal() {}, controls: null, onRedeemResetVoucher() {},
  }));
  assert.match(html('agent'), /<strong[^>]*>粗體<\/strong>/);
  assert.match(html('user'), /\*\*粗體\*\* 同 `code`/);
  assert.doesNotMatch(html('user'), /<strong/);
});

test('lists keep their bullets, nest without blank gaps, and only task items lose the bullet', () => {
  const html = render('- 一\n- 二\n  - 二之一\n- [x] 完成\n- [ ] 未完成');
  assert.equal((html.match(/<ul/g) ?? []).length, 2);
  assert.match(html, /<ul[^>]*list-disc/);
  assert.equal((html.match(/task-list-item[^>]*>|list-none/g) ?? []).length >= 2, true);
  assert.doesNotMatch(html, /<li[^>]*whitespace-pre-wrap/);
  assert.match(html, /<li[^>]*>一<\/li>/);
});

test('a code block shows its language and a copy button outside the scrolling code', () => {
  const html = render('```bash\nsecurity add-generic-password -U -s "Komorebi OpenAI TTS" -a "openai" -w\n```');
  assert.match(html, /aria-label="複製程式碼"/);
  assert.match(html, />複製</);
  assert.match(html, /<span[^>]*>bash<\/span>/);
  assert.match(html, /<pre[^>]*overflow-x-auto[^>]*>[\s\S]*security add-generic-password/);
  // The button sits before the pre, so it does not scroll sideways with long lines.
  assert.ok(html.indexOf('複製程式碼') < html.indexOf('<pre'));
  assert.match(render('```\n沒有語言\n```'), /<span[^>]*>程式碼<\/span>/);
  assert.equal((render('`行內` 同 **粗**').match(/複製程式碼/g) ?? []).length, 0);
});

test('the copied text is exactly the code, without the fence, markup or the final newline', () => {
  const node = { type: 'element', tagName: 'pre', children: [{ type: 'element', tagName: 'code', properties: { className: ['language-ts'] },
    children: [{ type: 'text', value: 'const a = 1;\n' }, { type: 'text', value: 'if (a) {}\n' }] }] };
  assert.equal(hastText(node), 'const a = 1;\nif (a) {}\n');
  assert.equal(hastText(undefined), '');
});
