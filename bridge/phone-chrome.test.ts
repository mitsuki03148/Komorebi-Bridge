import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('the phone page keeps the plain status bar and the plain full-height app that had no band under the controls', async () => {
  const html = await readFile('index.html', 'utf8')
  assert.doesNotMatch(html, /viewport-fit=cover|black-translucent/)
  const app = await readFile('src/App.tsx', 'utf8')
  assert.doesNotMatch(app, /app-height|app-shift|useKeepInView|data-status-scrim/)
  assert.match(app, /className="h-dvh w-full overflow-hidden flex flex-col/)
  assert.match(app, /<div className="pointer-events-none absolute inset-0 z-0 opacity-20">/)
  assert.match(app, /<header className="relative z-40 sticky top-0 [^"]*" style=\{\{ position: 'sticky', top: 0 \}\}>/)
})
