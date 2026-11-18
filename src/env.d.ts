declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** Electron preload 注入的桌面桥接；纯网页环境不存在 */
interface DesktopBridge {
  isDesktop: true
  /** 启动时已解密的 API Key */
  apiKey: string | null
  /** 保存 API Key，成功返回 true；false 表示系统加密不可用 */
  setApiKey(key: string | null): Promise<boolean>
  version: string
}

interface Window {
  desktop?: DesktopBridge
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
