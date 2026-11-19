declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 构建期应用版本 */
declare const __APP_VERSION__: string
/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string
/** Anthropic 兼容接口的基地址（messages/files） */
declare const __MESSAGES_BASE__: string
/** Key 校验使用的 models 地址 */
declare const __MODELS_URL__: string
/** 构建期默认模型 */
declare const __API_MODEL__: string
/** 当前服务支持的功能；测试构建可关闭 */
declare const __FEATURES__: { files: boolean; speech: boolean; webTools: boolean }
/** Key 校验方式：models（默认）/ message（1 token 探测）/ skip */
declare const __VERIFY_MODE__: 'models' | 'message' | 'skip'

/**
 * 主进程报告的密钥存储方式：
 * - encrypted：safeStorage 系统加密后落盘
 * - memory：safeStorage 不可用，只在主进程内存中保存（未加密、不落盘）
 */
interface DesktopKeyStorage {
  encryptionAvailable: boolean
  mode: 'encrypted' | 'memory'
  /** getKeyStorage 会带上主进程当前的 Key 状态；启动快照中可缺省 */
  hasApiKey?: boolean
}

/** 主进程代理返回的脱敏错误；不含 Key */
interface DesktopApiError {
  kind?: 'http' | 'stream' | 'network' | 'interrupted' | 'protocol'
  message: string
  status?: number
  localMessageKey?: string
}

type DesktopApiResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopApiError }

interface DesktopStreamEvent {
  id: string
  kind: 'message' | 'tts'
  type: 'chunk' | 'end' | 'error'
  data?: ArrayBuffer
  error?: DesktopApiError
}

interface DesktopProviderConfig {
  origin: string
  messagesBase: string
  modelsUrl: string
  model: string
  features: { files: boolean; speech: boolean; webTools: boolean }
  verifyMode: 'models' | 'message' | 'skip'
}

/** Electron preload 注入的桌面桥接；纯网页环境不存在 */
interface DesktopBridge {
  isDesktop: true
  /** 主进程是否持有 Key；渲染层永远拿不到 Key 本身 */
  hasApiKey: boolean
  /** 启动时的密钥存储状态快照 */
  keyStorage: DesktopKeyStorage
  /** 桌面偏好：关闭窗口时是否保留在托盘 */
  desktopPrefs: { closeToTray: boolean }
  /** 保存 API Key（输入后由主进程校验/加密）；成功返回 true */
  setApiKey(key: string | null): Promise<boolean>
  /** 校验并保存新输入的 Key，成功后才落盘；错误已脱敏 */
  verifyAndSaveApiKey(key: string): Promise<DesktopApiResult>
  /** 重新向主进程查询当前存储状态 */
  getKeyStorage(): Promise<DesktopKeyStorage>
  /** 同步构建期 provider 配置；主进程只接受官方/千机/显式构建期地址 */
  configureApi(config: DesktopProviderConfig): Promise<boolean>
  /** 一次性 API 请求（verify/upload-file/delete-file/transcribe） */
  apiRequest<T = unknown>(
    id: string,
    method: 'verify' | 'upload-file' | 'delete-file' | 'transcribe',
    payload: unknown
  ): Promise<DesktopApiResult<T>>
  /** 中止一次性 API 请求 */
  abortApiRequest(id: string): Promise<boolean>
  /** 开始 Messages/TTS 流；主进程转发原始字节并负责 abort */
  startApiStream(
    id: string,
    kind: 'message' | 'tts',
    payload: unknown
  ): Promise<DesktopApiResult>
  /** 停止流，必须中止主进程的上游请求 */
  abortApiStream(id: string): Promise<boolean>
  /** 订阅流事件，返回取消订阅函数 */
  onApiStream(callback: (event: DesktopStreamEvent) => void): () => void
  /** 更新关闭到托盘偏好 */
  setCloseToTray(enabled: boolean): Promise<boolean>
  /** 应用主窗口缩放（0.9–1.25） */
  setZoomFactor(factor: number): Promise<boolean>
  /** 弹出保存对话框写入文本文件（用于 Markdown 导出） */
  saveTextFile(payload: { content: string; defaultName: string }): Promise<boolean>
  /** 应用系统/HTTP/SOCKS5 代理 */
  applyProxy(payload: { mode: 'system' | 'http' | 'socks5'; host: string; port: string }): Promise<boolean>
  /** 生成完成通知；主进程会再次检查窗口焦点 */
  notifyGenerationDone(payload: { title: string; body: string; silent?: boolean }): Promise<boolean>
  /** 订阅原生菜单/托盘命令，返回取消订阅函数 */
  onCommand(callback: (command: 'new-chat' | 'search' | 'settings' | 'escape') => void): () => void
  /** 导出脱敏诊断日志；info 为构建期端点/模型等信息 */
  exportDiagnostics(info: {
    version: string
    apiOrigin: string
    model: string
    features: { files: boolean; speech: boolean; webTools: boolean }
  }): Promise<boolean>
  version: string
}

interface Window {
  desktop?: DesktopBridge
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}

/** 装饰 SVG 作为资源 URL 导入 */
declare module '*.svg' {
  const src: string
  export default src
}
