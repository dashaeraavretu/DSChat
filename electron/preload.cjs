// 沙箱渲染进程只能加载 CJS preload；package.json 的 "type": "module"
// 不作用于 .cjs 文件。
const { contextBridge, ipcRenderer } = require('electron')

let apiKey = null
let version = ''
let keyStorage = { encryptionAvailable: false, mode: 'plaintext' }
let desktopPrefs = { closeToTray: false }

const normalizeKeyStorage = (value) => {
  if (!value || typeof value !== 'object') return null
  if (value.mode !== 'encrypted' && value.mode !== 'plaintext') return null
  return { encryptionAvailable: value.encryptionAvailable === true, mode: value.mode }
}

const readKeyStorage = () => {
  try {
    return (
      normalizeKeyStorage(ipcRenderer.sendSync('settings:get-key-storage')) ?? {
        encryptionAvailable: false,
        mode: 'plaintext',
      }
    )
  } catch (error) {
    console.error('[preload] 读取密钥存储状态失败：', error)
    return { encryptionAvailable: false, mode: 'plaintext' }
  }
}

try {
  const stored = ipcRenderer.sendSync('settings:get-api-key')
  apiKey = typeof stored === 'string' && stored.length > 0 ? stored : null
} catch (error) {
  console.error('[preload] 读取 API Key 失败：', error)
}

try {
  const value = ipcRenderer.sendSync('app:get-version')
  version = typeof value === 'string' ? value : ''
} catch (error) {
  console.error('[preload] 读取版本号失败：', error)
}

keyStorage = readKeyStorage()

try {
  const prefs = ipcRenderer.sendSync('desktop:get-prefs')
  if (prefs && typeof prefs === 'object') {
    desktopPrefs = { closeToTray: prefs.closeToTray === true }
  }
} catch (error) {
  console.error('[preload] 读取桌面偏好失败：', error)
}

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  apiKey,
  keyStorage,
  desktopPrefs,
  async setApiKey(key) {
    if (key !== null && typeof key !== 'string') return false
    try {
      const ok = await ipcRenderer.invoke('settings:set-api-key', key)
      if (ok === true) {
        apiKey = key === '' ? null : key
      }
      return ok === true
    } catch (error) {
      console.error('[preload] 保存 API Key 失败：', error)
      return false
    }
  },
  async getKeyStorage() {
    try {
      return (
        normalizeKeyStorage(await ipcRenderer.invoke('settings:get-key-storage')) ?? {
          encryptionAvailable: false,
          mode: 'plaintext',
        }
      )
    } catch (error) {
      console.error('[preload] 刷新密钥存储状态失败：', error)
      return { encryptionAvailable: false, mode: 'plaintext' }
    }
  },
  async setZoomFactor(factor) {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) return false
    try {
      return (await ipcRenderer.invoke('window:set-zoom-factor', factor)) === true
    } catch (error) {
      console.error('[preload] 设置缩放失败：', error)
      return false
    }
  },
  async saveTextFile(payload) {
    if (!payload || typeof payload.content !== 'string' || typeof payload.defaultName !== 'string') {
      return false
    }
    try {
      return (
        (await ipcRenderer.invoke('file:save-text', {
          content: payload.content,
          defaultName: payload.defaultName,
        })) === true
      )
    } catch (error) {
      console.error('[preload] 保存文件失败：', error)
      return false
    }
  },
  async notifyGenerationDone(payload) {
    if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') {
      return false
    }
    try {
      return (
        (await ipcRenderer.invoke('app:notify-done', {
          title: payload.title.slice(0, 200),
          body: payload.body.slice(0, 500),
        })) === true
      )
    } catch (error) {
      console.error('[preload] 发送完成通知失败：', error)
      return false
    }
  },
  async setCloseToTray(enabled) {
    try {
      return (await ipcRenderer.invoke('desktop:set-close-to-tray', enabled === true)) === true
    } catch (error) {
      console.error('[preload] 保存关闭到托盘偏好失败：', error)
      return false
    }
  },
  onCommand(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, command) => {
      if (
        command === 'new-chat' ||
        command === 'search' ||
        command === 'settings' ||
        command === 'escape'
      ) {
        callback(command)
      }
    }
    ipcRenderer.on('app:command', listener)
    return () => ipcRenderer.removeListener('app:command', listener)
  },
  async exportDiagnostics(info) {
    try {
      return (await ipcRenderer.invoke('diagnostics:export', info)) === true
    } catch (error) {
      console.error('[preload] 导出诊断日志失败：', error)
      return false
    }
  },
  version,
})
