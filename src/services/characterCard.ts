import type { PresetSource } from './presets.js'

export type ImportedCharacterCard = {
  name: string
  system: string
  greeting: string
  description?: string
  tags?: string[]
  creator?: string
  characterVersion?: string
  source: PresetSource
}

export type CharacterCardErrorCode =
  | 'invalidFile'
  | 'unsupportedCard'
  | 'noCardData'
  | 'invalidJson'
  | 'missingName'

export class CharacterCardError extends Error {
  readonly code: CharacterCardErrorCode

  constructor(code: CharacterCardErrorCode) {
    super(code)
    this.name = 'CharacterCardError'
    this.code = code
  }
}

type CardData = {
  name?: unknown
  description?: unknown
  personality?: unknown
  scenario?: unknown
  first_mes?: unknown
  mes_example?: unknown
  system_prompt?: unknown
  post_history_instructions?: unknown
  creator?: unknown
  character_version?: unknown
  tags?: unknown
  alternate_greetings?: unknown
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

// 单次替换并用回调取替换值：避免角色名里的 `$&`/`$1` 被当作替换模式，
// 也避免名字里恰好含 `{{user}}` 时被二次展开。
const replaceMacros = (value: string, name: string) =>
  value.replace(/\{\{(char|user)\}\}/gi, (_, macro: string) =>
    macro.toLowerCase() === 'char' ? name : 'User',
  )

const buildSystem = (data: CardData, name: string) => {
  const explicit = text(data.system_prompt)
  if (explicit) {
    return replaceMacros(explicit, name)
  }
  const sections = [
    text(data.description) && `Description:\n${text(data.description)}`,
    text(data.personality) && `Personality:\n${text(data.personality)}`,
    text(data.scenario) && `Scenario:\n${text(data.scenario)}`,
  ].filter(Boolean)
  return sections.length > 0
    ? replaceMacros(`You are ${name}.\n\n${sections.join('\n\n')}`, name)
    : ''
}

const fromCardData = (data: CardData, source: PresetSource): ImportedCharacterCard => {
  const name = text(data.name)
  if (!name) {
    throw new CharacterCardError('missingName')
  }
  const greetings = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.map(text).filter(Boolean)
    : []
  return {
    name,
    system: buildSystem(data, name),
    greeting: replaceMacros(text(data.first_mes) || greetings[0] || '', name),
    description: text(data.description) || undefined,
    tags: Array.isArray(data.tags)
      ? data.tags.map(text).filter(Boolean).slice(0, 20)
      : undefined,
    creator: text(data.creator) || undefined,
    characterVersion: text(data.character_version) || undefined,
    source,
  }
}

/** 接受 V2/V3 规范对象，也接受直接带 data 的对象；V1 平铺卡不支持。 */
export const parseCharacterCardJson = (raw: unknown): ImportedCharacterCard => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CharacterCardError('invalidJson')
  }
  const record = raw as Record<string, unknown>
  const spec = text(record.spec)
  // 未知 spec 优先拒绝，避免无 data 时误报成 noCardData。
  if (spec && spec !== 'chara_card_v2' && spec !== 'chara_card_v3') {
    throw new CharacterCardError('unsupportedCard')
  }
  const data = record.data
  const hasData = Boolean(data) && typeof data === 'object' && !Array.isArray(data)
  if (spec && !hasData) {
    throw new CharacterCardError('noCardData')
  }
  return fromCardData(
    (hasData ? data : record) as CardData,
    spec === 'chara_card_v3' ? 'chara-v3' : 'chara-v2',
  )
}

const decodeBase64Utf8 = (value: string) => {
  try {
    const binary = atob(value.replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    throw new CharacterCardError('invalidJson')
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** tEXt 的 keyword/value 按 PNG 规范是 ISO-8859-1，而非 UTF-8。 */
const decodeLatin1 = (bytes: Uint8Array) => {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 0x2000) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 0x2000))
  }
  return result
}

const readPngTextChunks = (bytes: Uint8Array) => {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new CharacterCardError('invalidFile')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks = new Map<string, string>()
  let offset = 8
  let sawIend = false
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = decodeLatin1(bytes.subarray(offset + 4, offset + 8))
    const start = offset + 8
    const end = start + length
    // 声明长度越过文件末尾：文件被截断或长度字段损坏。
    if (end + 4 > bytes.length) {
      throw new CharacterCardError('invalidFile')
    }
    const data = bytes.subarray(start, end)
    if (type === 'tEXt') {
      const zero = data.indexOf(0)
      if (zero > 0) {
        const keyword = decodeLatin1(data.subarray(0, zero))
        if (keyword === 'chara' || keyword === 'ccv3') {
          chunks.set(keyword, decodeLatin1(data.subarray(zero + 1)))
        }
      }
    } else if (type === 'iTXt') {
      const zero = data.indexOf(0)
      // keyword\0 flag method language\0 translated\0 text
      if (zero > 0 && zero + 2 < data.length) {
        const keyword = decodeLatin1(data.subarray(0, zero))
        if (keyword === 'chara' || keyword === 'ccv3') {
          const compressionFlag = data[zero + 1]
          if (compressionFlag === 0) {
            let cursor = zero + 3
            let fields = 0
            while (fields < 2) {
              const next = data.indexOf(0, cursor)
              if (next < 0) {
                break
              }
              cursor = next + 1
              fields += 1
            }
            if (fields === 2) {
              chunks.set(keyword, new TextDecoder().decode(data.subarray(cursor)))
            }
          }
        }
      }
    }
    if (type === 'IEND') {
      sawIend = true
      break
    }
    offset = end + 4
  }
  if (!sawIend) {
    throw new CharacterCardError('invalidFile')
  }
  if (chunks.size === 0) {
    throw new CharacterCardError('noCardData')
  }
  // 空字符串的 ccv3 不应遮住可用的 chara。
  return chunks.get('ccv3') || chunks.get('chara') || ''
}

/** 从 PNG 的 tEXt/iTXt chunk 读取 base64 JSON；不依赖图像库。 */
export const parseCharacterCardPng = (buffer: ArrayBuffer): ImportedCharacterCard => {
  const encoded = readPngTextChunks(new Uint8Array(buffer))
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64Utf8(encoded))
  } catch (error) {
    if (error instanceof CharacterCardError) {
      throw error
    }
    throw new CharacterCardError('invalidJson')
  }
  return parseCharacterCardJson(payload)
}
