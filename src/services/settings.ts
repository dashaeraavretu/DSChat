import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * API Key 的实际保存方式：
 * - encrypted：主进程确认使用系统加密
 * - plaintext：主进程确认系统加密不可用或存档为明文（降级）
 * - localStorage：主进程保存失败，渲染层回退到浏览器本地存储（未加密，降级）
 * - web：纯网页版
 */
export type ApiKeyStorage = 'encrypted' | 'plaintext' | 'localStorage' | 'web'

/** 可用缩放档位；与设置下拉一致 */
export type ZoomFactor = 0.9 | 1 | 1.1 | 1.25
const ZOOM_FACTORS: ZoomFactor[] = [0.9, 1, 1.1, 1.25]
export type ReadingWidth = 'comfortable' | 'wide'
export type TtsSpeed = 0.8 | 1 | 1.2
export type SendKey = 'enter' | 'ctrlEnter'

/**
 * 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态。
 * API Key 在桌面端由系统加密存储（见 window.desktop），网页端仍存 localStorage。
 */
type Settings = {
  apiKey: string | null
  apiKeyStorage: ApiKeyStorage
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 桌面端关闭窗口时保留在托盘 */
  closeToTray: boolean
  /** 生成超过 15 秒且窗口未聚焦时发送系统通知 */
  notifyOnComplete: boolean
  /** 主窗口界面缩放 */
  zoomFactor: ZoomFactor
  readingWidth: ReadingWidth
  ttsSpeed: TtsSpeed
  sendKey: SendKey
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
  notifyOnComplete: 'chat-demo:notify-on-complete',
  zoomFactor: 'chat-demo:zoom-factor',
  readingWidth: 'chat-demo:reading-width',
  ttsSpeed: 'chat-demo:tts-speed',
  sendKey: 'chat-demo:send-key',
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
    // 主进程不可用时的 localStorage 降级键仍可用于本次会话，避免每次重启都丢失
    return typeof bridge.apiKey === 'string' ? bridge.apiKey : read(KEYS.apiKey)
  }
  return read(KEYS.apiKey)
}

/** 桌面端以主进程报告的状态为准；缺少状态时按未加密处理，避免谎称已加密 */
const initialZoomFactor = (): ZoomFactor => {
  const saved = Number(read(KEYS.zoomFactor))
  return ZOOM_FACTORS.includes(saved as ZoomFactor) ? (saved as ZoomFactor) : 1
}

const initialApiKeyStorage = (): ApiKeyStorage => {
  const bridge = desktopBridge()
  if (!bridge) {
    return 'web'
  }
  // localStorage 里还留着降级键时，必须先如实显示“未加密”，不能等迁移后才纠正
  if (!bridge.apiKey && read(KEYS.apiKey)) {
    return 'localStorage'
  }
  return bridge.keyStorage?.mode === 'encrypted' ? 'encrypted' : 'plaintext'
}

export const useSettings = create<Settings>(() => ({
  apiKey: initialApiKey(),
  apiKeyStorage: initialApiKeyStorage(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  closeToTray: desktopBridge()?.desktopPrefs?.closeToTray === true,
  notifyOnComplete: read(KEYS.notifyOnComplete) !== 'false',
  zoomFactor: initialZoomFactor(),
  readingWidth: read(KEYS.readingWidth) === 'wide' ? 'wide' : 'comfortable',
  ttsSpeed: read(KEYS.ttsSpeed) === '0.8' ? 0.8 : read(KEYS.ttsSpeed) === '1.2' ? 1.2 : 1,
  sendKey: read(KEYS.sendKey) === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
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

const setApiKeyStorage = (apiKeyStorage: ApiKeyStorage) =>
  useSettings.setState({ apiKeyStorage })

/** 主进程保存失败时的降级路径：写入 localStorage，并在设置页如实标记未加密 */
const fallbackToLocalStorage = (apiKey: string | null, reason: unknown) => {
  // eslint-disable-next-line no-console
  console.warn('[settings] 系统加密存储不可用，API Key 已回退保存到 localStorage（未加密）', reason)
  write(KEYS.apiKey, apiKey)
  setApiKeyStorage('localStorage')
}

/** 重新向主进程查询实际存储方式；只在保存成功后调用，避免覆盖 localStorage 降级状态 */
export const refreshApiKeyStorage = async (): Promise<void> => {
  const bridge = desktopBridge()
  if (!bridge || typeof bridge.getKeyStorage !== 'function') {
    return
  }
  try {
    const status = await bridge.getKeyStorage()
    setApiKeyStorage(status.mode === 'encrypted' ? 'encrypted' : 'plaintext')
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 查询密钥存储状态失败，按未加密展示', error)
    setApiKeyStorage('plaintext')
  }
}

/**
 * 桌面端异步保存：主进程返回 false（无法持久化）或 IPC 异常时，
 * 回退 localStorage 并标记为未加密降级；成功则刷新主进程给出的状态。
 */
const saveDesktopApiKey = async (bridge: DesktopBridge, apiKey: string | null) => {
  try {
    const saved = await bridge.setApiKey(apiKey)
    if (!saved) {
      fallbackToLocalStorage(apiKey, '主进程保存失败')
      return
    }
    await refreshApiKeyStorage()
  } catch (error) {
    fallbackToLocalStorage(apiKey, error)
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
 * 清除 API Key：桌面端删除 secrets.json 并清空主进程内存，同时清理网页版遗留的
 * localStorage 键；保存失败时不做任何“已清除”的假象，返回 false 交给界面提示。
 */
export const clearApiKey = async (): Promise<boolean> => {
  const bridge = desktopBridge()
  if (bridge) {
    try {
      if (!(await bridge.setApiKey(null))) {
        return false
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[settings] 清除 API Key 失败', error)
      return false
    }
  }
  write(KEYS.apiKey, null)
  useSettings.setState({ apiKey: null })
  if (bridge) {
    await refreshApiKeyStorage()
  } else {
    setApiKeyStorage('web')
  }
  return true
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
      setApiKeyStorage('localStorage')
      return
    }
    write(KEYS.apiKey, null)
    // preload 启动时未拿到 Key（例如首次从网页版升级）时，补上内存状态
    if (!useSettings.getState().apiKey) {
      useSettings.setState({ apiKey: legacy })
    }
    await refreshApiKeyStorage()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 迁移网页版 API Key 失败，保留 localStorage 旧键', error)
    setApiKeyStorage('localStorage')
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

export const setReadingWidth = (readingWidth: ReadingWidth) => {
  write(KEYS.readingWidth, readingWidth)
  useSettings.setState({ readingWidth })
}

export const setTtsSpeed = (ttsSpeed: TtsSpeed) => {
  write(KEYS.ttsSpeed, String(ttsSpeed))
  useSettings.setState({ ttsSpeed })
}

export const setSendKey = (sendKey: SendKey) => {
  write(KEYS.sendKey, sendKey)
  useSettings.setState({ sendKey })
}

export const setNotifyOnComplete = (notifyOnComplete: boolean) => {
  write(KEYS.notifyOnComplete, String(notifyOnComplete))
  useSettings.setState({ notifyOnComplete })
}

const applyZoom = (zoomFactor: ZoomFactor) => {
  const bridge = desktopBridge()
  if (bridge && typeof bridge.setZoomFactor === 'function') {
    void bridge.setZoomFactor(zoomFactor).then((ok) => {
      if (!ok) {
        useSettings.setState({ zoomFactor: 1 })
      }
    })
  }
}

/** 启动时把已保存的缩放应用到主窗口 */
export const applyZoomPreference = () => {
  applyZoom(useSettings.getState().zoomFactor)
}

export const setZoomPreference = (zoomFactor: ZoomFactor) => {
  if (!ZOOM_FACTORS.includes(zoomFactor)) {
    return
  }
  write(KEYS.zoomFactor, String(zoomFactor))
  useSettings.setState({ zoomFactor })
  applyZoom(zoomFactor)
}

/** 关闭到托盘保存在主进程的 window-state.json，与窗口位置一起管理 */
export const setCloseToTray = (closeToTray: boolean) => {
  useSettings.setState({ closeToTray })
  const bridge = desktopBridge()
  if (bridge && typeof bridge.setCloseToTray === 'function') {
    void bridge.setCloseToTray(closeToTray).then((ok) => {
      if (!ok) {
        useSettings.setState({ closeToTray: !closeToTray })
      }
    })
  }
}
