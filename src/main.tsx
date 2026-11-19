import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'
import './app/presets.css'

ensureKatex()
setupTheme()

/** Web 版 PWA：仅在安全上下文（HTTPS / localhost）且非 Electron 环境注册 */
const registerServiceWorker = () => {
  const secureContext =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  if (window.desktop || !secureContext || !('serviceWorker' in navigator)) {
    return
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {
      // 离线缓存是可选项；注册失败时继续使用在线版本
    })
  })
}

registerServiceWorker()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
