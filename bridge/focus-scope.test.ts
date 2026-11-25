import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { tabTarget } from '../src/utils/focusScope';

test('Tab stays inside a dialog: the last item wraps to the first, Shift+Tab from the first goes to the last, from outside it comes in', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(tabTarget(items, 'c', false), 'a');
  assert.equal(tabTarget(items, 'a', true), 'c');
  assert.equal(tabTarget(items, 'b', false), undefined, 'inside the list the browser moves on its own');
  assert.equal(tabTarget(items, 'b', true), undefined);
  assert.equal(tabTarget(items, null, false), 'a');
  assert.equal(tabTarget(items, 'outside', true), 'c');
  assert.equal(tabTarget([], 'x', false), undefined);
});

test('a dialog takes the focus when it opens, keeps Tab inside, and gives the focus back to what opened it', async () => {
  class FakeElement {
    tabIndex = 0; style: Record<string, string> = {}; offsetParent = {}; children: FakeElement[] = []; handlers: Record<string, (event: any) => void> = {};
    attrs = new Map<string, string>(); focused = false; isConnected = true;
    constructor(readonly name: string) {}
    hasAttribute(name: string) { return this.attrs.has(name); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    closest() { return null; }
    getClientRects() { return [1]; }
    contains(other: unknown) { return other === this || this.children.includes(other as FakeElement); }
    querySelector() { return null; }
    querySelectorAll() { return this.children; }
    addEventListener(type: string, handler: (event: any) => void) { this.handlers[type] = handler; }
    removeEventListener(type: string) { delete this.handlers[type]; }
    focus() { (globalThis as any).document.activeElement = this; this.focused = true; }
  }
  const g = globalThis as any;
  const previous = { document: g.document, HTMLElement: g.HTMLElement };
  g.HTMLElement = FakeElement;
  const opener = new FakeElement('opener');
  g.document = { activeElement: opener };
  try {
    const { focusScope } = await import('../src/utils/focusScope');
    const dialog = new FakeElement('dialog'), first = new FakeElement('first'), last = new FakeElement('last');
    dialog.children = [first, last];
    const cleanup = focusScope(dialog as any);
    assert.equal(g.document.activeElement, first, 'focus moved into the dialog');
    assert.equal(dialog.tabIndex, -1, 'the dialog itself can take focus');
    let prevented = 0;
    last.focus();
    dialog.handlers.keydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented++; } });
    assert.equal(g.document.activeElement, first, 'Tab from the last item wraps to the first');
    dialog.handlers.keydown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented++; } });
    assert.equal(g.document.activeElement, last, 'Shift+Tab from the first goes to the last');
    dialog.handlers.keydown({ key: 'a', preventDefault: () => { prevented++; } });
    assert.equal(prevented, 2, 'other keys are left alone');
    assert.equal(typeof cleanup, 'function');
    (cleanup as () => void)();
    assert.equal(g.document.activeElement, opener, 'closing returns the focus to the opener');
    assert.equal(dialog.handlers.keydown, undefined, 'and the key handler is removed');
  } finally { g.document = previous.document; g.HTMLElement = previous.HTMLElement; }
});

test('every dialog uses the focus scope', async () => {
  for (const [file, count] of [['src/App.tsx', 5], ['src/components/SettingsModals.tsx', 1], ['src/components/ImagePreviews.tsx', 1], ['src/components/GroupChat.tsx', 1], ['src/components/GuildModals.tsx', 3]] as const) {
    const text = await readFile(file, 'utf8');
    assert.equal((text.match(/ref=\{focusScope\}/g) ?? []).length, count, file);
    assert.equal((text.match(/role="dialog"/g) ?? []).length >= count, true, `${file} marks each as a dialog`);
  }
});
