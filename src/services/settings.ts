import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * API Key 的实际保存方式：
 * - encrypted：主进程确认使用系统加密
 * - memory：safeStorage 不可用，只在主进程内存中保存（未加密、不落盘，降级）
 * - web：纯网页版
 * 桌面端不再回退到 localStorage。
 */
export type ApiKeyStorage = 'encrypted' | 'memory' | 'web'

/** 可用缩放档位；与设置下拉一致 */
export type ZoomFactor = 0.9 | 1 | 1.1 | 1.25
const ZOOM_FACTORS: ZoomFactor[] = [0.9, 1, 1.1, 1.25]
export type ReadingWidth = 'comfortable' | 'wide'
export type TtsSpeed = 0.8 | 1 | 1.2
export type SendKey = 'enter' | 'ctrlEnter'
export type Appearance = 'original' | 'tui' | 'fish' | 'paper' | 'ink' | 'geek'
export type ProxyMode = 'system' | 'http' | 'socks5'

/**
 * 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态。
 * API Key 在桌面端由主进程持有（见 window.desktop），渲染层只有 hasApiKey；
 * 网页端仍存 localStorage。
 */
type Settings = {
  /**
   * 桌面端仅用作「已有 Key」的兼容标记，绝不是真实 Key；
   * 真实 Key 只在主进程内存/系统加密存档中。网页端仍保存真实 Key。
   */
  apiKey: string | null
  /** 主进程是否持有 API Key（桌面端唯一的 Key 状态来源） */
  hasApiKey: boolean
  /** 网页版是否把 API Key 写入浏览器存储；关闭后仅本次页面内存有效 */
  rememberWebApiKey: boolean
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
  appearance: Appearance
  /** 水墨/极客外观是否播放 WebGL 动态背景 */
  appearanceMotion: boolean
  showMascot: boolean
  showInputCount: boolean
  notifySound: boolean
  proxyMode: ProxyMode
  proxyHost: string
  proxyPort: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  rememberWebApiKey: 'chat-demo:remember-web-api-key',
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
  appearance: 'chat-demo:appearance',
  appearanceMotion: 'chat-demo:appearance-motion',
  showMascot: 'chat-demo:show-mascot',
  showInputCount: 'chat-demo:show-input-count',
  notifySound: 'chat-demo:notify-sound',
  proxyMode: 'chat-demo:proxy-mode',
  proxyHost: 'chat-demo:proxy-host',
  proxyPort: 'chat-demo:proxy-port',
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

/**
 * preload 异常时 window.desktop 不存在，但仍是 Electron。此时绝不能把
 * Key 当网页版写进 localStorage；宁可提示不可用，也不降级成明文。
 */
const isElectronRuntime = (): boolean =>
  typeof navigator !== 'undefined' && /\bElectron\//i.test(navigator.userAgent)

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

/**
 * 桌面端兼容标记：只表示「主进程已有 Key」，不携带任何密钥字符。
 * 其他模块仍按 `apiKey` 真假判断，因此保留该字段而不把真实 Key 放进渲染层。
 */
const DESKTOP_KEY_PRESENT = '__desktop_key_present__'

/** 桌面端只检查主进程 hasApiKey；网页端沿用 localStorage */
const initialApiKey = (): string | null => {
  const bridge = desktopBridge()
  if (bridge) {
    return bridge.hasApiKey === true ? DESKTOP_KEY_PRESENT : null
  }
  if (isElectronRuntime()) {
    return null
  }
  if (read(KEYS.rememberWebApiKey) === 'false') {
    return null
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
  return bridge.keyStorage?.mode === 'encrypted' ? 'encrypted' : 'memory'
}

export const useSettings = create<Settings>(() => ({
  apiKey: initialApiKey(),
  hasApiKey:
    desktopBridge()?.hasApiKey === true ||
    (!desktopBridge() &&
      !isElectronRuntime() &&
      read(KEYS.rememberWebApiKey) !== 'false' &&
      !!read(KEYS.apiKey)),
  rememberWebApiKey: read(KEYS.rememberWebApiKey) !== 'false',
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
  appearance: (() => {
    const value = read(KEYS.appearance)
    return value === 'tui' ||
      value === 'fish' ||
      value === 'paper' ||
      value === 'ink' ||
      value === 'geek'
      ? value
      : 'original'
  })(),
  appearanceMotion: read(KEYS.appearanceMotion) !== 'false',
  showMascot: read(KEYS.showMascot) !== 'false',
  showInputCount: read(KEYS.showInputCount) !== 'false',
  notifySound: read(KEYS.notifySound) !== 'false',
  proxyMode: (() => {
    const value = read(KEYS.proxyMode)
    return value === 'http' || value === 'socks5' ? value : 'system'
  })(),
  proxyHost: read(KEYS.proxyHost) ?? '',
  proxyPort: read(KEYS.proxyPort) ?? '',
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

const setApiKeyStorage = (apiKeyStorage: ApiKeyStorage) => useSettings.setState({ apiKeyStorage })

/** 重新向主进程查询实际存储方式；桌面端只接受 encrypted / memory */
export const refreshApiKeyStorage = async (): Promise<void> => {
  const bridge = desktopBridge()
  if (!bridge || typeof bridge.getKeyStorage !== 'function') {
    return
  }
  try {
    const status = await bridge.getKeyStorage()
    setApiKeyStorage(status.mode === 'encrypted' ? 'encrypted' : 'memory')
    if (typeof status.hasApiKey === 'boolean') {
      useSettings.setState({
        hasApiKey: status.hasApiKey,
        apiKey: status.hasApiKey ? DESKTOP_KEY_PRESENT : null,
      })
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 查询密钥存储状态失败，按未加密内存模式展示', error)
    setApiKeyStorage('memory')
  }
}

/**
 * 桌面端异步保存：主进程负责 safeStorage 或内存降级，渲染层绝不写 localStorage。
 * 失败时回滚 hasApiKey，避免界面显示与实际状态不一致。
 */
const saveDesktopApiKey = async (
  bridge: DesktopBridge,
  apiKey: string | null,
  previousHasKey: boolean
) => {
  try {
    const saved = await bridge.setApiKey(apiKey)
    if (!saved) {
      useSettings.setState({
        apiKey: previousHasKey ? DESKTOP_KEY_PRESENT : null,
        hasApiKey: previousHasKey,
      })
      return
    }
    await refreshApiKeyStorage()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[settings] 主进程保存 API Key 失败', error)
    useSettings.setState({
      apiKey: previousHasKey ? DESKTOP_KEY_PRESENT : null,
      hasApiKey: previousHasKey,
    })
  }
}

/**
 * 更新 API Key 状态。桌面端只把 Key 交给主进程一次，渲染层保存的是
 * DESKTOP_KEY_PRESENT 标记；网页端保持原有 localStorage 行为。
 * `persisted` 用于「主进程已校验并保存」的场景，避免重复写盘。
 */
export const setApiKey = (apiKey: string | null, options?: { persisted?: boolean }) => {
  const bridge = desktopBridge()
  if (!bridge) {
    if (isElectronRuntime()) {
      // 预加载桥接失效时不做 localStorage 明文降级
      // eslint-disable-next-line no-console
      console.warn('[settings] 桌面桥接不可用，已拒绝把 API Key 写入 localStorage')
      useSettings.setState({ apiKey: null, hasApiKey: false })
      return
    }
    write(KEYS.apiKey, useSettings.getState().rememberWebApiKey ? apiKey : null)
    useSettings.setState({
      apiKey,
      hasApiKey: !!apiKey,
    })
    return
  }

  const previousHasKey = useSettings.getState().hasApiKey
  const hasKey = !!apiKey
  useSettings.setState({
    apiKey: hasKey ? DESKTOP_KEY_PRESENT : null,
    hasApiKey: hasKey,
  })
  if (options?.persisted) {
    void refreshApiKeyStorage()
    return
  }
  void saveDesktopApiKey(bridge, apiKey, previousHasKey)
}

/**
 * 网页版：控制是否把 API Key 写入浏览器存储。
 * 关闭时立即删除已落盘的明文 Key；内存中的 Key 保留到本次会话结束。
 */
export const setRememberWebApiKey = (rememberWebApiKey: boolean) => {
  write(KEYS.rememberWebApiKey, String(rememberWebApiKey))
  if (!desktopBridge()) {
    if (rememberWebApiKey) {
      const current = useSettings.getState().apiKey
      if (current) {
        write(KEYS.apiKey, current)
      }
    } else {
      write(KEYS.apiKey, null)
    }
  }
  useSettings.setState({ rememberWebApiKey })
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
  useSettings.setState({ apiKey: null, hasApiKey: false })
  if (bridge) {
    await refreshApiKeyStorage()
  } else {
    setApiKeyStorage('web')
  }
  return true
}

/**
 * 桌面端：把网页版遗留在 localStorage 的 API Key 交给主进程后删除旧键。
 * 主进程按 safeStorage 能力加密落盘或仅内存保存；无论哪种方式都不再保留
 * localStorage 明文副本。
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

  // 主进程已有 Key 时只清掉遗留明文，不覆盖现有 Key
  if (useSettings.getState().hasApiKey) {
    write(KEYS.apiKey, null)
    return
  }

  try {
    const saved = await bridge.setApiKey(legacy)
    if (!saved) {
      // eslint-disable-next-line no-console
      console.warn('[settings] 主进程拒绝迁移旧版 API Key，保留 localStorage 旧键')
      return
    }
    // 迁移成功后立即删除明文副本；主进程可能只是内存模式，界面会如实显示降级
    write(KEYS.apiKey, null)
    useSettings.setState({
      apiKey: DESKTOP_KEY_PRESENT,
      hasApiKey: true,
    })
    await refreshApiKeyStorage()
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

export const setAppearance = (appearance: Appearance) => {
  write(KEYS.appearance, appearance)
  useSettings.setState({ appearance })
}

export const setAppearanceMotion = (appearanceMotion: boolean) => {
  write(KEYS.appearanceMotion, String(appearanceMotion))
  useSettings.setState({ appearanceMotion })
}

export const setShowMascot = (showMascot: boolean) => {
  write(KEYS.showMascot, String(showMascot))
  useSettings.setState({ showMascot })
}

export const setShowInputCount = (showInputCount: boolean) => {
  write(KEYS.showInputCount, String(showInputCount))
  useSettings.setState({ showInputCount })
}

export const setNotifySound = (notifySound: boolean) => {
  write(KEYS.notifySound, String(notifySound))
  useSettings.setState({ notifySound })
}

export const applyProxyPreference = (): void => {
  const bridge = desktopBridge()
  if (!bridge?.applyProxy) {
    return
  }
  const { proxyMode, proxyHost, proxyPort } = useSettings.getState()
  void bridge.applyProxy({
    mode: proxyMode,
    host: proxyHost,
    port: proxyPort,
  })
}

export const setProxyPreference = (patch: { mode?: ProxyMode; host?: string; port?: string }) => {
  const next = {
    proxyMode: patch.mode ?? useSettings.getState().proxyMode,
    proxyHost: patch.host ?? useSettings.getState().proxyHost,
    proxyPort: patch.port ?? useSettings.getState().proxyPort,
  }
  write(KEYS.proxyMode, next.proxyMode)
  write(KEYS.proxyHost, next.proxyHost)
  write(KEYS.proxyPort, next.proxyPort)
  useSettings.setState(next)
  applyProxyPreference()
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
