import { create } from 'zustand'
import { createId } from '../utils/id.js'

export type PresetSource = 'manual' | 'chara-v2' | 'chara-v3'

export type Preset = {
  id: string
  name: string
  /** 每轮注入的 system 提示词 */
  system: string
  /** 空会话展示的开场白 */
  greeting: string
  description?: string
  tags?: string[]
  creator?: string
  characterVersion?: string
  source: PresetSource
  updatedAt: number
}

/** 会话创建时固化的快照，之后修改预设不影响已有会话 */
export type PresetSnapshot = Pick<Preset, 'id' | 'name' | 'system' | 'greeting'>

const PRESETS_KEY = 'chat-demo:presets-v1'
const DEFAULT_KEY = 'chat-demo:default-preset'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时仅内存生效
  }
}

const normalizePreset = (value: unknown): Preset | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<Preset>
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null
  return {
    id: item.id,
    name: item.name.slice(0, 100),
    system: typeof item.system === 'string' ? item.system : '',
    greeting: typeof item.greeting === 'string' ? item.greeting : '',
    description: typeof item.description === 'string' ? item.description : undefined,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20)
      : undefined,
    creator: typeof item.creator === 'string' ? item.creator : undefined,
    characterVersion:
      typeof item.characterVersion === 'string' ? item.characterVersion : undefined,
    source:
      item.source === 'chara-v2' || item.source === 'chara-v3' ? item.source : 'manual',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  }
}

const loadPresets = (): Preset[] => {
  try {
    const raw = read(PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map(normalizePreset).filter((item): item is Preset => item !== null)
      : []
  } catch {
    return []
  }
}

const loadDefaultId = (presets: Preset[]): string | null => {
  const saved = read(DEFAULT_KEY)
  return saved && presets.some((preset) => preset.id === saved) ? saved : null
}

const initialPresets = loadPresets()

type PresetState = {
  presets: Preset[]
  defaultId: string | null
}

export const usePresets = create<PresetState>(() => ({
  presets: initialPresets,
  defaultId: loadDefaultId(initialPresets),
}))

const persistPresets = (presets: Preset[], defaultId: string | null) => {
  write(PRESETS_KEY, JSON.stringify(presets))
  write(DEFAULT_KEY, defaultId)
}

const setPresets = (presets: Preset[], defaultId: string | null) => {
  persistPresets(presets, defaultId)
  usePresets.setState({ presets, defaultId })
}

export const getDefaultPreset = (): Preset | undefined => {
  const { presets, defaultId } = usePresets.getState()
  return presets.find((preset) => preset.id === defaultId)
}

export const snapshotPreset = (preset: Preset): PresetSnapshot => ({
  id: preset.id,
  name: preset.name,
  system: preset.system,
  greeting: preset.greeting,
})

export const createPreset = (
  input: Omit<Preset, 'id' | 'updatedAt' | 'source'> & { source?: PresetSource }
): Preset => {
  const preset: Preset = {
    ...input,
    id: createId(),
    source: input.source ?? 'manual',
    updatedAt: Date.now(),
  }
  const state = usePresets.getState()
  const presets = [...state.presets, preset]
  const defaultId = state.defaultId ?? preset.id
  setPresets(presets, defaultId)
  return preset
}

export const updatePreset = (id: string, patch: Partial<Omit<Preset, 'id'>>) => {
  const state = usePresets.getState()
  const presets = state.presets.map((preset) =>
    preset.id === id ? { ...preset, ...patch, updatedAt: Date.now() } : preset
  )
  setPresets(presets, state.defaultId)
}

export const setDefaultPreset = (id: string | null) => {
  const state = usePresets.getState()
  const defaultId = id && state.presets.some((preset) => preset.id === id) ? id : null
  setPresets(state.presets, defaultId)
}

export const deletePreset = (id: string) => {
  const state = usePresets.getState()
  const presets = state.presets.filter((preset) => preset.id !== id)
  setPresets(presets, state.defaultId === id ? null : state.defaultId)
}
