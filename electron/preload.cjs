// 沙箱渲染进程只能加载 CJS preload；package.json 的 "type": "module"
// 不作用于 .cjs 文件。
//
// 安全边界：这里绝不把 API Key 交给渲染层。渲染层只能看到 hasApiKey，
// 所有需要鉴权的请求都由主进程发出；IPC 只传请求参数和响应流。
const { contextBridge, ipcRenderer } = require('electron')

let hasApiKey = false
let version = ''
let keyStorage = { encryptionAvailable: false, mode: 'memory' }
let desktopPrefs = { closeToTray: false }

const normalizeKeyStorage = (value) => {
  if (!value || typeof value !== 'object') return null
  if (value.mode !== 'encrypted' && value.mode !== 'memory' && value.mode !== 'plaintext') return null
  return {
    encryptionAvailable: value.encryptionAvailable === true,
    // plaintext 是旧版状态，统一按未加密内存模式展示
    mode: value.mode === 'encrypted' ? 'encrypted' : 'memory',
  }
}

const readKeyStatus = () => {
  try {
    const status = ipcRenderer.sendSync('settings:get-key-status')
    hasApiKey = status?.hasApiKey === true
    return (
      normalizeKeyStorage(status) ?? {
        encryptionAvailable: false,
        mode: 'memory',
      }
    )
  } catch (error) {
    console.error('[preload] 读取密钥状态失败：', error)
    return { encryptionAvailable: false, mode: 'memory' }
  }
}

const refreshKeyStorage = async () => {
  try {
    const status = await ipcRenderer.invoke('settings:get-key-storage')
    keyStorage = normalizeKeyStorage(status) ?? { encryptionAvailable: false, mode: 'memory' }
    if (status && typeof status.hasApiKey === 'boolean') {
      hasApiKey = status.hasApiKey
    }
    return { ...keyStorage, hasApiKey }
  } catch (error) {
    console.error('[preload] 刷新密钥存储状态失败：', error)
    keyStorage = { encryptionAvailable: false, mode: 'memory' }
    return keyStorage
  }
}

try {
  const value = ipcRenderer.sendSync('app:get-version')
  version = typeof value === 'string' ? value : ''
} catch (error) {
  console.error('[preload] 读取版本号失败：', error)
}

keyStorage = readKeyStatus()

try {
  const prefs = ipcRenderer.sendSync('desktop:get-prefs')
  if (prefs && typeof prefs === 'object') {
    desktopPrefs = { closeToTray: prefs.closeToTray === true }
  }
} catch (error) {
  console.error('[preload] 读取桌面偏好失败：', error)
}

const validId = (id) => typeof id === 'string' && /^[\w-]{1,128}$/.test(id)
const API_METHODS = new Set(['verify', 'upload-file', 'delete-file', 'transcribe'])

const invalidRequest = (message) => ({
  ok: false,
  error: { kind: 'protocol', message },
})

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // 只有布尔状态；Key 本身永远留在主进程
  hasApiKey,
  keyStorage,
  desktopPrefs,
  async setApiKey(key) {
    if (key !== null && typeof key !== 'string') return false
    try {
      const ok = (await ipcRenderer.invoke('settings:set-api-key', key)) === true
      if (ok) {
        hasApiKey = key !== null && key !== ''
        await refreshKeyStorage()
      }
      return ok
    } catch (error) {
      console.error('[preload] 保存 API Key 失败：', error)
      return false
    }
  },
  /** 输入新 Key 时由主进程校验并保存；返回 { ok } 或脱敏错误信息 */
  async verifyAndSaveApiKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
      return invalidRequest('API Key 无效')
    }
    try {
      const result = await ipcRenderer.invoke('settings:verify-and-save-api-key', key)
      if (!result || typeof result !== 'object') return invalidRequest('主进程响应无效')
      if (result.ok === true) {
        hasApiKey = true
        await refreshKeyStorage()
      }
      return result
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
  async getKeyStorage() {
    return refreshKeyStorage()
  },
  /** 把构建期 provider 配置同步给主进程；不包含 Key，也不能指向任意主机 */
  async configureApi(config) {
    if (!config || typeof config !== 'object') return false
    try {
      return (
        (await ipcRenderer.invoke('api:configure', {
          origin: config.origin,
          messagesBase: config.messagesBase,
          modelsUrl: config.modelsUrl,
          model: config.model,
          features: config.features,
          verifyMode: config.verifyMode,
        })) === true
      )
    } catch (error) {
      console.error('[preload] 配置 API 代理失败：', error)
      return false
    }
  },
  /** 一次性 API 请求（校验/上传/删除/ASR）；payload 中不含 Key */
  async apiRequest(id, method, payload) {
    if (!validId(id) || !API_METHODS.has(method)) return invalidRequest('请求无效')
    try {
      const result = await ipcRenderer.invoke('api:request', { id, method, payload })
      if (!result || typeof result !== 'object') return invalidRequest('主进程响应无效')
      return result
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
  async abortApiRequest(id) {
    if (!validId(id)) return false
    try {
      return (await ipcRenderer.invoke('api:abort', id)) === true
    } catch {
      return false
    }
  },
  /** 开始 Messages/TTS 流；主进程转发原始字节，停止时 abort 上游请求 */
  async startApiStream(id, kind, payload) {
    if (!validId(id) || (kind !== 'message' && kind !== 'tts')) {
      return invalidRequest('流请求无效')
    }
    try {
      const result = await ipcRenderer.invoke('api:stream-start', { id, kind, payload })
      if (!result || typeof result !== 'object') return invalidRequest('主进程响应无效')
      return result
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
  async abortApiStream(id) {
    if (!validId(id)) return false
    try {
      return (await ipcRenderer.invoke('api:stream-abort', id)) === true
    } catch {
      return false
    }
  },
  onApiStream(callback) {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => {
      if (!payload || !validId(payload.id)) return
      if (payload.type === 'chunk') {
        if (!(payload.data instanceof ArrayBuffer)) return
        callback(payload)
        return
      }
      if (payload.type === 'end' || payload.type === 'error') {
        callback(payload)
      }
    }
    ipcRenderer.on('api:stream-event', listener)
    return () => ipcRenderer.removeListener('api:stream-event', listener)
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
  async applyProxy(payload) {
    if (!payload || typeof payload !== 'object') return false
    try {
      return (
        (await ipcRenderer.invoke('proxy:apply', {
          mode: payload.mode,
          host: typeof payload.host === 'string' ? payload.host : '',
          port: typeof payload.port === 'string' ? payload.port : '',
        })) === true
      )
    } catch (error) {
      console.error('[preload] 应用代理失败：', error)
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
          silent: payload.silent === true,
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
