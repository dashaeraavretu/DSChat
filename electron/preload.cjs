// 沙箱渲染进程只能加载 CJS preload；package.json 的 "type": "module"
// 不作用于 .cjs 文件。
const { contextBridge, ipcRenderer } = require('electron')

let apiKey = null
let version = ''

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

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  apiKey,
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
  version,
})
