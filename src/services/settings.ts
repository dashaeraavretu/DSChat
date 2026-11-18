import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态。
 * API Key 在桌面端由系统加密存储（见 window.desktop），网页端仍存 localStorage。
 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

/** Electron preload 注入的桌面桥接；纯网页环境返回 undefined */
const desktopBridge = (): DesktopBridge | undefined => {
  if (typeof window === 'undefined' || typeof window.desktop === 'undefined') {
    return undefined
  }
  const bridge = window.desktop
  return bridge && bridge.isDesktop && typeof bridge.setApiKey === 'function' ? bridge : undefined
}

/** 是否运行在桌面端（Electron 壳）内；网页端为 false */
export const isDesktopApp = (): boolean => desktopBridge() !== undefined

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
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 桌面端使用 preload 解密后的 Key；网页端沿用 localStorage */
const initialApiKey = (): string | null => {
  const bridge = desktopBridge()
  if (bridge) {
    return typeof bridge.apiKey === 'string' ? bridge.apiKey : null
  }
  return read(KEYS.apiKey)
}

export const useSettings = create<Settings>(() => ({
  apiKey: initialApiKey(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

/**
 * 桌面端异步保存：由系统加密存储；返回 false 表示加密不可用，
 * 此时回退到 localStorage 保证本次可用，并保留警告便于排查。
 */
const saveDesktopApiKey = async (bridge: DesktopBridge, apiKey: string | null) => {
  try {
    const saved = await bridge.setApiKey(apiKey)
    if (!saved) {
      // eslint-disable-next-line no-console
      console.warn('[settings] 桌面端系统加密存储不可用，API Key 已回退保存到 localStorage')
      write(KEYS.apiKey, apiKey)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 桌面端保存 API Key 失败', error)
  }
}

export const setApiKey = (apiKey: string | null) => {
  const bridge = desktopBridge()
  if (!bridge) {
    write(KEYS.apiKey, apiKey)
  }
  useSettings.setState({ apiKey })
  if (bridge) {
    // 桌面端不在这里写明文，等加密存储的结果
    void saveDesktopApiKey(bridge, apiKey)
  }
}

/**
 * 桌面端：把网页版遗留在 localStorage 的 API Key 迁移到系统加密存储。
 * 成功后才删除旧键；迁移失败保留旧键并警告，不阻塞应用启动。
 */
export const migrateLegacyApiKey = async (): Promise<void> => {
  const bridge = desktopBridge()
  if (!bridge) {
    return
  }
  let legacy: string | null
  try {
    legacy = localStorage.getItem(KEYS.apiKey)
  } catch {
    return
  }
  if (!legacy) {
    return
  }
  try {
    const saved = await bridge.setApiKey(legacy)
    if (!saved) {
      // eslint-disable-next-line no-console
      console.warn('[settings] 系统加密存储不可用，网页版遗留的 API Key 暂时保留在 localStorage')
      return
    }
    write(KEYS.apiKey, null)
    // preload 启动时未拿到 Key（例如首次从网页版升级）时，补上内存状态
    if (!useSettings.getState().apiKey) {
      useSettings.setState({ apiKey: legacy })
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 迁移网页版 API Key 失败，保留 localStorage 旧键', error)
  }
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
