import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CharacterCardError,
  parseCharacterCardJson,
  parseCharacterCardPng,
} from '../src/services/characterCard.ts'

const expectCode = (run, code) => {
  assert.throws(
    run,
    (error) => error instanceof CharacterCardError && error.code === code,
    `expected CharacterCardError(${code})`,
  )
}

const base64 = (value) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64')

const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Aria',
    description: '{{char}} is calm.',
    personality: 'Kind',
    scenario: 'Forest',
    first_mes: 'Hello {{user}}, I am {{char}}.',
    alternate_greetings: ['Alt {{char}}'],
    system_prompt: 'Act as {{char}}.',
    post_history_instructions: 'ignored by import',
    creator: 'card-maker',
    character_version: '1.2',
    tags: ['fantasy', 'calm'],
  },
}

test('V2 JSON: maps fields, source and system_prompt priority', () => {
  const parsed = parseCharacterCardJson(V2_CARD)
  assert.equal(parsed.name, 'Aria')
  assert.equal(parsed.source, 'chara-v2')
  assert.equal(parsed.system, 'Act as Aria.')
  assert.equal(parsed.greeting, 'Hello User, I am Aria.')
  assert.equal(parsed.description, '{{char}} is calm.')
  assert.deepEqual(parsed.tags, ['fantasy', 'calm'])
  assert.equal(parsed.creator, 'card-maker')
  assert.equal(parsed.characterVersion, '1.2')
})

test('V2 JSON: builds system from description/personality/scenario when system_prompt is absent', () => {
  const parsed = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: {
      name: 'Aria',
      description: '{{char}} is calm.',
      personality: 'Kind {{char}}',
      scenario: 'A forest with {{user}}.',
      first_mes: 'Hi',
    },
  })
  assert.equal(
    parsed.system,
    'You are Aria.\n\nDescription:\nAria is calm.\n\nPersonality:\nKind Aria\n\nScenario:\nA forest with User.',
  )
})

test('V2 JSON: whitespace-only system_prompt falls back to composed system', () => {
  const parsed = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: { name: 'Aria', system_prompt: '   ', description: 'Desc', first_mes: 'Hi' },
  })
  assert.equal(parsed.system, 'You are Aria.\n\nDescription:\nDesc')
})

test('V3 JSON: source, alternate_greetings fallback and UTF-8 text', () => {
  const parsed = parseCharacterCardJson({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '三',
      first_mes: '   ',
      alternate_greetings: ['你好 {{user}}', '第二条'],
      tags: ['中文'],
    },
  })
  assert.equal(parsed.source, 'chara-v3')
  assert.equal(parsed.name, '三')
  assert.equal(parsed.greeting, '你好 User')
  assert.deepEqual(parsed.tags, ['中文'])
})

test('empty greeting stays empty and first_mes wins over alternate greetings', () => {
  const empty = parseCharacterCardJson({ spec: 'chara_card_v2', data: { name: 'NoGreeting' } })
  assert.equal(empty.greeting, '')
  const preferred = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: { name: 'X', first_mes: 'Main', alternate_greetings: ['Alt'] },
  })
  assert.equal(preferred.greeting, 'Main')
})

test('macros: replacement values are literal and expanded once', () => {
  const dollar = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: { name: 'A$&B', system_prompt: 'I am {{char}}; you are {{user}}.' },
  })
  assert.equal(dollar.system, 'I am A$&B; you are User.')

  const nested = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: { name: '{{user}}', first_mes: 'I am {{char}}.' },
  })
  assert.equal(nested.greeting, 'I am {{user}}.')
})

test('tags: non-strings are dropped and list is capped at 20', () => {
  const parsed = parseCharacterCardJson({
    spec: 'chara_card_v2',
    data: {
      name: 'Tags',
      tags: [...Array.from({ length: 25 }, (_, index) => `tag-${index}`), 42, null, '  '],
    },
  })
  assert.equal(parsed.tags.length, 20)
  assert.equal(parsed.tags[0], 'tag-0')
  assert.equal(parsed.tags[19], 'tag-19')
})

test('objects with data but no spec are treated as V2', () => {
  const parsed = parseCharacterCardJson({ data: { name: 'DataOnly', first_mes: 'Hi' } })
  assert.equal(parsed.name, 'DataOnly')
  assert.equal(parsed.source, 'chara-v2')
})

test('flat V2-shaped objects are accepted as V2', () => {
  const parsed = parseCharacterCardJson({ name: 'Flat', description: 'Desc', first_mes: 'Hi' })
  assert.equal(parsed.name, 'Flat')
  assert.equal(parsed.source, 'chara-v2')
})

test('errors: missing name', () => {
  expectCode(() => parseCharacterCardJson({ spec: 'chara_card_v2', data: {} }), 'missingName')
  expectCode(
    () => parseCharacterCardJson({ spec: 'chara_card_v2', data: { name: '   ' } }),
    'missingName',
  )
})

test('errors: spec without data is noCardData', () => {
  expectCode(() => parseCharacterCardJson({ spec: 'chara_card_v2' }), 'noCardData')
  expectCode(() => parseCharacterCardJson({ spec: 'chara_card_v3', data: null }), 'noCardData')
  expectCode(() => parseCharacterCardJson({ spec: 'chara_card_v2', data: [] }), 'noCardData')
})

test('errors: unknown spec is rejected before data checks', () => {
  expectCode(
    () => parseCharacterCardJson({ spec: 'chara_card_v1', data: { name: 'Old' } }),
    'unsupportedCard',
  )
  expectCode(() => parseCharacterCardJson({ spec: 'chara_card_v9' }), 'unsupportedCard')
  expectCode(() => parseCharacterCardJson({ spec: 'something_else' }), 'unsupportedCard')
})

test('errors: non-object JSON roots are invalidJson', () => {
  for (const value of [null, undefined, 'text', 42, true, [], [{}]]) {
    expectCode(() => parseCharacterCardJson(value), 'invalidJson')
  }
})

// --- PNG helpers ---------------------------------------------------------

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const ascii = (value) => Uint8Array.from([...value].map((character) => character.charCodeAt(0)))
const utf8 = (value) => new TextEncoder().encode(value)

const concat = (parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// CRC is intentionally left zero: the parser validates structure, not CRCs.
const pngChunk = (type, data) => {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(ascii(type), 4)
  out.set(data, 8)
  return out
}

const IHDR = pngChunk('IHDR', new Uint8Array(13))
const IEND = pngChunk('IEND', new Uint8Array(0))

const textChunk = (keyword, value) =>
  pngChunk('tEXt', concat([ascii(keyword), Uint8Array.of(0), ascii(value)]))

const itxtChunk = (keyword, value, options = {}) => {
  const { compressed = false, language = '', translated = '' } = options
  return pngChunk(
    'iTXt',
    concat([
      ascii(keyword),
      Uint8Array.of(0),
      Uint8Array.of(compressed ? 1 : 0),
      Uint8Array.of(0),
      ascii(language),
      Uint8Array.of(0),
      utf8(translated),
      Uint8Array.of(0),
      utf8(value),
    ]),
  )
}

const buildPng = (...chunks) => concat([PNG_SIGNATURE, IHDR, ...chunks, IEND])

// --- PNG tests -----------------------------------------------------------

test('PNG tEXt: reads chara base64 JSON', () => {
  const parsed = parseCharacterCardPng(buildPng(textChunk('chara', base64(V2_CARD))).buffer)
  assert.equal(parsed.name, 'Aria')
  assert.equal(parsed.source, 'chara-v2')
  assert.equal(parsed.greeting, 'Hello User, I am Aria.')
})

test('PNG iTXt: skips language/translated fields and decodes UTF-8 text', () => {
  const card = {
    spec: 'chara_card_v3',
    data: { name: '三', first_mes: '你好 {{user}}' },
  }
  const png = buildPng(itxtChunk('chara', base64(card), { language: 'zh', translated: '角色' }))
  const parsed = parseCharacterCardPng(png.buffer)
  assert.equal(parsed.name, '三')
  assert.equal(parsed.greeting, '你好 User')
  assert.equal(parsed.source, 'chara-v3')
})

test('PNG: ccv3 takes precedence over chara', () => {
  const v2 = { spec: 'chara_card_v2', data: { name: 'Old', first_mes: 'old' } }
  const v3 = { spec: 'chara_card_v3', data: { name: 'New', first_mes: 'new' } }
  const png = buildPng(textChunk('chara', base64(v2)), itxtChunk('ccv3', base64(v3)))
  const parsed = parseCharacterCardPng(png.buffer)
  assert.equal(parsed.name, 'New')
  assert.equal(parsed.source, 'chara-v3')
})

test('PNG iTXt: whitespace in base64 is tolerated', () => {
  const encoded = base64(V2_CARD).replace(/(.{20})/g, '$1\n')
  const parsed = parseCharacterCardPng(buildPng(itxtChunk('chara', encoded)).buffer)
  assert.equal(parsed.name, 'Aria')
})

test('PNG iTXt: compressed payload is not parsed', () => {
  const png = buildPng(itxtChunk('chara', base64(V2_CARD), { compressed: true }))
  expectCode(() => parseCharacterCardPng(png.buffer), 'noCardData')
})

test('PNG errors: bad signature and too-short file are invalidFile', () => {
  expectCode(() => parseCharacterCardPng(new Uint8Array(32).buffer), 'invalidFile')
  expectCode(() => parseCharacterCardPng(new Uint8Array([137, 80, 78, 71]).buffer), 'invalidFile')
})

test('PNG errors: missing IEND is invalidFile', () => {
  const png = concat([PNG_SIGNATURE, IHDR, textChunk('chara', base64(V2_CARD))])
  expectCode(() => parseCharacterCardPng(png.buffer), 'invalidFile')
})

test('PNG errors: chunk length past end of file is invalidFile', () => {
  const png = buildPng(textChunk('chara', base64(V2_CARD)))
  // tEXt header starts after signature (8) + IHDR chunk (25).
  new DataView(png.buffer).setUint32(33, 9999)
  expectCode(() => parseCharacterCardPng(png.buffer), 'invalidFile')
})

test('PNG errors: no chara/ccv3 chunk is noCardData', () => {
  expectCode(() => parseCharacterCardPng(buildPng().buffer), 'noCardData')
  expectCode(
    () => parseCharacterCardPng(buildPng(textChunk('Comment', 'hello')).buffer),
    'noCardData',
  )
  expectCode(
    () => parseCharacterCardPng(buildPng(textChunk('Chara', base64(V2_CARD))).buffer),
    'noCardData',
  )
})

test('PNG errors: invalid base64 is invalidJson', () => {
  expectCode(
    () => parseCharacterCardPng(buildPng(textChunk('chara', 'not-base64!!!')).buffer),
    'invalidJson',
  )
})

test('PNG errors: valid base64 with invalid JSON is invalidJson', () => {
  expectCode(
    () => parseCharacterCardPng(buildPng(textChunk('chara', base64('not json'))).buffer),
    'invalidJson',
  )
})
