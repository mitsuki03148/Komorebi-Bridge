import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { codexModelsFromCache, Rooms } from './rooms'
import type { ServerEvent } from '../src/types/bridge'

const levels = (...efforts: string[]) => efforts.map(effort => ({ effort }))
const cache = (...models: object[]) => JSON.stringify({ fetched_at: '2026-11-17T19:35:24Z', models })
const sol62 = { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list', supported_reasoning_levels: levels('low', 'high', 'ultra', 'unknown') }
const hidden = { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', supported_reasoning_levels: levels('low') }

test('the Codex model list takes listed models only, and keeps the efforts the picker knows', () => {
  const { availableSubModels, modelOptions } = codexModelsFromCache(cache(sol62, hidden, { slug: 'gpt-6.2-astra', visibility: 'list' }))
  assert.deepEqual(availableSubModels, ['gpt-6.2-sol', 'gpt-6.2-astra'])
  assert.deepEqual(modelOptions[0], { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', efforts: ['low', 'high', 'ultra'] })
  assert.deepEqual(modelOptions[1], { id: 'gpt-6.2-astra', label: 'gpt-6.2-astra', efforts: [] }, 'no name or levels: the slug is the label')
  assert.throws(() => codexModelsFromCache('{}'))
})

test('a model Codex adds to its cache reaches the picker on the next round, without a Bridge restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-models-'))
  const before = process.env.CODEX_HOME
  process.env.CODEX_HOME = home
  try {
    const events: ServerEvent[] = []
    const rooms = new Rooms(home, event => events.push(event))
    const refresh = () => (rooms as any).refreshCodexModels() as Promise<void>
    const updates = () => events.filter(event => event.type === 'SYNC_UPDATE')
    await refresh()
    assert.equal(updates().length, 0, 'no cache yet: nothing changes and nothing breaks')
    await writeFile(join(home, 'models_cache.json'), cache({ ...sol62, slug: 'gpt-6.1-sol' }))
    await refresh()
    assert.equal(updates().length, 1)
    assert.deepEqual(rooms.characters.CODEX.availableSubModels, ['gpt-6.1-sol'])
    await refresh()
    assert.equal(updates().length, 1, 'unchanged cache sends no update')
    await writeFile(join(home, 'models_cache.json'), cache(sol62, { ...sol62, slug: 'gpt-6.1-sol' }))
    await refresh()
    assert.equal(updates().length, 2)
    assert.deepEqual(rooms.characters.CODEX.modelOptions?.map(option => option.id), ['gpt-6.2-sol', 'gpt-6.1-sol'])
    await writeFile(join(home, 'models_cache.json'), '{ half written')
    await refresh()
    assert.deepEqual(rooms.characters.CODEX.availableSubModels, ['gpt-6.2-sol', 'gpt-6.1-sol'], 'a half-written file keeps the last good list')
    assert.equal(updates().length, 2)
  } finally {
    if (before === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = before
    await rm(home, { recursive: true, force: true })
  }
})
