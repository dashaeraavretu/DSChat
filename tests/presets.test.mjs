#!/usr/bin/env node
/**
 * Zero-dependency tests for the preset data layer (src/services/presets.ts).
 *
 * Run with: node tests/presets.test.mjs
 *
 * Node 22 can strip TypeScript types natively, but its resolver does not map the
 * project's `./foo.js` specifiers to `./foo.ts`. A tiny synchronous resolve hook
 * (node:module registerHooks, Node >= 22.15) bridges that without any dependency.
 * localStorage is a plain in-memory implementation installed as a global before
 * each fresh import of the module; a query string busts Node's module cache.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})

const PRESETS_KEY = 'chat-demo:presets-v1'
const DEFAULT_KEY = 'chat-demo:default-preset'

const createMemoryStorage = () => {
  const data = new Map()
  return {
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(String(key), String(value))
    },
    removeItem: (key) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
    entries: () => [...data.entries()],
  }
}

let loadCount = 0

const loadModule = async (storage) => {
  globalThis.localStorage = storage
  loadCount += 1
  return import(`../src/services/presets.ts?case=${loadCount}`)
}

const importWithSeed = async (seed = {}) => {
  const storage = createMemoryStorage()
  for (const [key, value] of Object.entries(seed)) {
    storage.setItem(key, value)
  }
  return { module: await loadModule(storage), storage }
}

const basePreset = (id, name) => ({
  id,
  name,
  system: '',
  greeting: '',
  source: 'manual',
  updatedAt: 1,
})

const passes = []
const failures = []

const test = async (name, fn) => {
  try {
    await fn()
    passes.push(name)
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}`)
    console.log(error?.stack ?? error)
  }
}

console.log('preset data layer')

await test('empty storage starts with no presets and no default', async () => {
  const { module } = await importWithSeed()
  assert.deepEqual(module.usePresets.getState(), { presets: [], defaultId: null })
  assert.equal(module.getDefaultPreset(), undefined)
})

await test('corrupted JSON and non-array payloads fall back to empty', async () => {
  for (const raw of ['{not json', 'null', '"text"', '{"presets":[]}']) {
    const { module } = await importWithSeed({ [PRESETS_KEY]: raw })
    assert.deepEqual(module.usePresets.getState(), { presets: [], defaultId: null })
  }
})

await test('invalid entries are dropped and fields normalized', async () => {
  const raw = JSON.stringify([
    null,
    42,
    'text',
    {},
    { id: '', name: 'blank id' },
    { id: 'blank-name', name: '   ' },
    { id: 'valid', name: '  Kept  ' },
    {
      id: 'long',
      name: 'x'.repeat(150),
      tags: ['a', 3, 'b'],
      source: 'bogus',
    },
  ])
  const { module } = await importWithSeed({ [PRESETS_KEY]: raw })
  const { presets } = module.usePresets.getState()
  assert.equal(presets.length, 2)
  assert.equal(presets[0].name, 'Kept')
  assert.equal(presets[0].system, '')
  assert.equal(presets[0].greeting, '')
  assert.equal(presets[0].source, 'manual')
  assert.equal(typeof presets[0].updatedAt, 'number')
  assert.equal(presets[1].name.length, 100)
  assert.deepEqual(presets[1].tags, ['a', 'b'])
  assert.equal(presets[1].source, 'manual')
})

await test('persisted default only counts when the preset still exists', async () => {
  const presets = JSON.stringify([basePreset('a', 'A'), basePreset('b', 'B')])
  const missing = await importWithSeed({
    [PRESETS_KEY]: presets,
    [DEFAULT_KEY]: 'ghost',
  })
  assert.equal(missing.module.usePresets.getState().defaultId, null)
  assert.equal(missing.module.getDefaultPreset(), undefined)

  const valid = await importWithSeed({
    [PRESETS_KEY]: presets,
    [DEFAULT_KEY]: 'b',
  })
  assert.equal(valid.module.usePresets.getState().defaultId, 'b')
  assert.equal(valid.module.getDefaultPreset().id, 'b')
})

await test('first preset becomes default; later presets do not steal it', async () => {
  const { module, storage } = await importWithSeed()
  const first = module.createPreset({ name: '  First  ', system: 's1', greeting: 'g1' })
  assert.equal(first.name, 'First')
  assert.equal(module.usePresets.getState().defaultId, first.id)

  const second = module.createPreset({ name: 'Second', system: '', greeting: '' })
  assert.equal(module.usePresets.getState().defaultId, first.id)
  assert.equal(module.getDefaultPreset().id, first.id)
  assert.equal(storage.getItem(DEFAULT_KEY), first.id)
  assert.equal(JSON.parse(storage.getItem(PRESETS_KEY)).length, 2)
})

await test('new preset does not become default when presets exist without one', async () => {
  const seed = JSON.stringify([basePreset('existing', 'Existing')])
  const { module } = await importWithSeed({ [PRESETS_KEY]: seed })
  assert.equal(module.usePresets.getState().defaultId, null)
  const created = module.createPreset({ name: 'New', system: '', greeting: '' })
  assert.equal(module.usePresets.getState().defaultId, null)
  assert.equal(module.getDefaultPreset(), undefined)
  assert.equal(module.usePresets.getState().presets.length, 2)
  assert.notEqual(created.id, 'existing')
})

await test('empty or whitespace names are rejected without changing state', async () => {
  const { module } = await importWithSeed()
  const before = module.usePresets.getState()
  assert.throws(
    () => module.createPreset({ name: '   ', system: '', greeting: '' }),
    /Preset name is required/
  )
  assert.deepEqual(module.usePresets.getState(), before)

  const preset = module.createPreset({ name: 'Valid', system: '', greeting: '' })
  assert.throws(
    () => module.updatePreset(preset.id, { name: '  ' }),
    /Preset name is required/
  )
  assert.equal(module.usePresets.getState().presets[0].name, 'Valid')
})

await test('update keeps defaultId, normalizes name and ignores undefined fields', async () => {
  const { module } = await importWithSeed()
  const preset = module.createPreset({ name: 'Original', system: 'old', greeting: 'hi' })
  module.usePresets.setState((state) => ({
    presets: state.presets.map((item) =>
      item.id === preset.id ? { ...item, updatedAt: 1 } : item
    ),
  }))

  module.updatePreset(preset.id, {
    name: `  ${'y'.repeat(150)}  `,
    system: 'new',
    source: undefined,
  })

  const updated = module.usePresets.getState().presets[0]
  assert.equal(updated.name.length, 100)
  assert.equal(updated.system, 'new')
  assert.equal(updated.source, 'manual')
  assert.equal(updated.greeting, 'hi')
  assert.ok(updated.updatedAt > 1)
  assert.equal(module.usePresets.getState().defaultId, preset.id)
  assert.equal(module.getDefaultPreset().system, 'new')
})

await test('update with an unknown id is a no-op', async () => {
  const { module } = await importWithSeed()
  const preset = module.createPreset({ name: 'A', system: '', greeting: '' })
  const before = module.usePresets.getState()
  module.updatePreset('missing', { name: 'B' })
  assert.deepEqual(module.usePresets.getState(), before)
  assert.equal(module.usePresets.getState().presets[0].id, preset.id)
})

await test('setDefaultPreset handles null and unknown ids safely', async () => {
  const { module } = await importWithSeed()
  const first = module.createPreset({ name: 'A', system: '', greeting: '' })
  const second = module.createPreset({ name: 'B', system: '', greeting: '' })

  module.setDefaultPreset(second.id)
  assert.equal(module.usePresets.getState().defaultId, second.id)

  module.setDefaultPreset('ghost')
  assert.equal(module.usePresets.getState().defaultId, second.id)

  module.setDefaultPreset(null)
  assert.equal(module.usePresets.getState().defaultId, null)
  assert.equal(module.getDefaultPreset(), undefined)

  module.setDefaultPreset(first.id)
  assert.equal(module.usePresets.getState().defaultId, first.id)
})

await test('deleting the default clears it; deleting others keeps it', async () => {
  const { module } = await importWithSeed()
  const first = module.createPreset({ name: 'A', system: '', greeting: '' })
  const second = module.createPreset({ name: 'B', system: '', greeting: '' })

  module.setDefaultPreset(second.id)
  module.deletePreset(first.id)
  assert.equal(module.usePresets.getState().defaultId, second.id)
  assert.equal(module.usePresets.getState().presets.length, 1)

  module.deletePreset(second.id)
  assert.equal(module.usePresets.getState().defaultId, null)
  assert.equal(module.usePresets.getState().presets.length, 0)
  assert.equal(module.getDefaultPreset(), undefined)
})

await test('snapshot copies four fields and is unaffected by later edits', async () => {
  const { module } = await importWithSeed()
  const preset = module.createPreset({
    name: 'Card',
    system: 'system-v1',
    greeting: 'hello',
    description: 'desc',
    tags: ['tag'],
  })
  const snapshot = module.snapshotPreset(preset)
  assert.deepEqual(snapshot, {
    id: preset.id,
    name: 'Card',
    system: 'system-v1',
    greeting: 'hello',
  })

  module.updatePreset(preset.id, { name: 'Renamed', system: 'system-v2', greeting: 'bye' })
  assert.deepEqual(snapshot, {
    id: preset.id,
    name: 'Card',
    system: 'system-v1',
    greeting: 'hello',
  })
})

await test('storage read/write failures are tolerated (memory-only state)', async () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    },
  }
  const module = await loadModule(blocked)
  assert.deepEqual(module.usePresets.getState(), { presets: [], defaultId: null })

  const preset = module.createPreset({ name: 'Memory', system: 's', greeting: 'g' })
  assert.equal(module.usePresets.getState().presets.length, 1)
  assert.equal(module.getDefaultPreset().id, preset.id)
  module.updatePreset(preset.id, { system: 's2' })
  assert.equal(module.getDefaultPreset().system, 's2')
})

await test('persisted presets round-trip through a fresh import', async () => {
  const { module, storage } = await importWithSeed()
  const created = module.createPreset({
    name: 'Roundtrip',
    system: 'sys',
    greeting: 'hi',
    description: 'desc',
    tags: ['t1'],
    creator: 'author',
    characterVersion: '1.2',
    source: 'chara-v2',
  })
  const seed = Object.fromEntries(storage.entries())
  const { module: reloaded } = await importWithSeed(seed)
  const state = reloaded.usePresets.getState()
  assert.equal(state.defaultId, created.id)
  assert.equal(state.presets.length, 1)
  const [loaded] = state.presets
  assert.equal(loaded.id, created.id)
  assert.equal(loaded.name, 'Roundtrip')
  assert.equal(loaded.system, 'sys')
  assert.equal(loaded.greeting, 'hi')
  assert.equal(loaded.description, 'desc')
  assert.deepEqual(loaded.tags, ['t1'])
  assert.equal(loaded.creator, 'author')
  assert.equal(loaded.characterVersion, '1.2')
  assert.equal(loaded.source, 'chara-v2')
})

console.log(`\n${passes.length} passed, ${failures.length} failed`)
if (failures.length > 0) {
  process.exitCode = 1
}
