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

/** 主进程报告的密钥存储方式；plaintext 表示未加密，界面必须如实展示降级状态 */
interface DesktopKeyStorage {
  encryptionAvailable: boolean
  mode: 'encrypted' | 'plaintext'
}

/** Electron preload 注入的桌面桥接；纯网页环境不存在 */
interface DesktopBridge {
  isDesktop: true
  /** 启动时已解密的 API Key */
  apiKey: string | null
  /** 启动时的密钥存储状态快照 */
  keyStorage: DesktopKeyStorage
  /** 桌面偏好：关闭窗口时是否保留在托盘 */
  desktopPrefs: { closeToTray: boolean }
  /** 保存 API Key，成功返回 true；false 表示系统加密不可用 */
  setApiKey(key: string | null): Promise<boolean>
  /** 重新向主进程查询当前存储状态 */
  getKeyStorage(): Promise<DesktopKeyStorage>
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
