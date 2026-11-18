import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_NAME = 'DSChat'
const APP_ID = 'com.dschat.desktop'
const PROTOCOL = 'dsc'
const APP_ORIGIN = `${PROTOCOL}://app`
const DEV_ORIGIN = 'http://localhost:8090'
const DEV = process.env.DSCHAT_DEV === '1'
const SMOKE = process.argv.includes('--smoke')
const SMOKE_BLOB = process.argv.includes('--smoke-blob')

// 开发时读取源码旁的 dist/，打包后读取 asar 内的 dist/
const DIST_DIR = app.isPackaged
  ? path.join(app.getAppPath(), 'dist')
  : path.join(__dirname, '..', 'dist')

app.setName(APP_NAME)
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID)
}

// 必须在 app ready 之前注册：standard/secure 让 IndexedDB、localStorage、
// crypto.subtle、navigator.mediaDevices 等按安全上下文工作；supportFetchAPI
// 与 corsEnabled 让渲染层的 fetch 和异步 chunk 加载在自定义协议下可用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

/** @type {BrowserWindow | null} */
let mainWindow = null

let settingsFile = ''
/** 内存中的当前 API Key，preload 通过 sendSync 同步读取 */
let currentApiKey = null
/** 当前存档是否为系统加密格式；null 表示尚无存档 */
let currentKeyEncrypted = null

/**
 * 从 userData/secrets.json 读取 API Key。
 * 加密格式：{ version: 1, encrypted: true, apiKey: '<base64 ciphertext>' }
 * 降级格式：{ version: 1, encrypted: false, apiKey: '<plaintext>' }
 */
function loadApiKey() {
  currentKeyEncrypted = null
  try {
    if (!existsSync(settingsFile)) return null
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) return null

    if (parsed.encrypted === true) {
      currentKeyEncrypted = true
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn(
          '[settings] 存档已加密，但当前系统无法使用 safeStorage 解密；请重新设置 API Key。'
        )
        currentKeyEncrypted = null
        return null
      }
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(parsed.apiKey, 'base64'))
        return decrypted.length > 0 ? decrypted : null
      } catch (error) {
        console.warn('[settings] 解密 API Key 失败，已忽略该存档：', error)
        currentKeyEncrypted = null
        return null
      }
    }

    // 兼容旧版降级存档：文件是明文，界面必须如实显示“未加密”。
    currentKeyEncrypted = false
    return parsed.apiKey
  } catch (error) {
    console.warn('[settings] 读取 API Key 失败，已按未设置处理：', error)
    currentKeyEncrypted = null
    return null
  }
}

/**
 * 密钥存储状态，供渲染层在设置页如实展示。
 * 只要当前存档是明文（或系统加密不可用），mode 就是 plaintext，绝不谎称已加密。
 */
function keyStorageStatus() {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  return {
    encryptionAvailable,
    mode: encryptionAvailable && currentKeyEncrypted !== false ? 'encrypted' : 'plaintext',
  }
}

/**
 * 持久化 API Key。写临时文件后再 rename，避免进程中断留下半个 JSON。
 * 传 null 或空字符串表示清除，直接删除密钥文件。
 */
function saveApiKey(key) {
  if (key === null || key === '') {
    try {
      unlinkSync(settingsFile)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    currentApiKey = null
    currentKeyEncrypted = null
    return true
  }

  let payload
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (encryptionAvailable) {
    payload = {
      version: 1,
      encrypted: true,
      apiKey: safeStorage.encryptString(key).toString('base64'),
    }
  } else {
    // 安全提示：safeStorage 在少数环境（例如未配置密钥环的 Linux 桌面）
    // 不可用。此时只能明文落盘，任何能读取该用户文件的本地程序都能拿到
    // API Key。此处按契约降级并显式标注 encrypted:false，同时输出警告。
    // 在 Windows/macOS 的正常安装环境下 safeStorage 走 DPAPI/Keychain。
    console.warn(
      `[settings] safeStorage 不可用：API Key 将以明文保存到 ${settingsFile}，` +
        '存在被本地其他程序读取的风险。'
    )
    payload = { version: 1, encrypted: false, apiKey: key }
  }

  mkdirSync(path.dirname(settingsFile), { recursive: true })
  const tempFile = `${settingsFile}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(tempFile, settingsFile)
  } catch (error) {
    try {
      unlinkSync(tempFile)
    } catch {
      // 临时文件可能尚未创建，忽略清理失败
    }
    throw error
  }

  currentApiKey = key
  currentKeyEncrypted = encryptionAvailable
  return true
}

function registerIpc() {
  ipcMain.on('settings:get-api-key', (event) => {
    event.returnValue = currentApiKey
  })

  ipcMain.on('app:get-version', (event) => {
    event.returnValue = app.getVersion()
  })

  ipcMain.on('settings:get-key-storage', (event) => {
    event.returnValue = keyStorageStatus()
  })

  ipcMain.handle('settings:get-key-storage', () => keyStorageStatus())

  ipcMain.handle('settings:set-api-key', (_event, key) => {
    if (key !== null && typeof key !== 'string') return false
    try {
      return saveApiKey(key)
    } catch (error) {
      console.error('[settings] 保存 API Key 失败：', error)
      return false
    }
  })
}

function isTrustedPageUrl(urlLike) {
  try {
    const url = new URL(urlLike)
    if (url.protocol === `${PROTOCOL}:` && url.hostname === 'app') return true
    if (DEV && url.origin === new URL(DEV_ORIGIN).origin) return true
  } catch {
    // 无效 URL 一律视为不可信
  }
  return false
}

function registerPermissions() {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl =
      details?.requestingUrl || details?.requestingOrigin || webContents?.getURL() || ''
    if (permission !== 'media' || !isTrustedPageUrl(requestingUrl)) {
      callback(false)
      return
    }

    // 只放行语音输入所需的麦克风；同时申请摄像头则整体拒绝。
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : []
    const wantsAudio = mediaTypes.includes('audio')
    const wantsVideo = mediaTypes.includes('video')
    callback(!wantsVideo && (wantsAudio || mediaTypes.length === 0))
  })

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === 'media' && isTrustedPageUrl(requestingOrigin)
  })
}

function notFoundResponse() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function registerProtocolHandler() {
  protocol.handle(PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return notFoundResponse()

      let pathname
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response('Bad Request', {
          status: 400,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }

      if (pathname === '' || pathname === '/') pathname = '/index.html'
      if (pathname.includes('\0')) {
        return new Response('Bad Request', {
          status: 400,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }

      // 只允许 dist/ 内的普通文件：resolve 后再次确认仍在根目录下。
      const filePath = path.resolve(DIST_DIR, pathname.replace(/^[/\\]+/, ''))
      const relative = path.relative(DIST_DIR, filePath)
      if (
        relative === '' ||
        relative.startsWith(`..${path.sep}`) ||
        relative === '..' ||
        path.isAbsolute(relative)
      ) {
        return notFoundResponse()
      }

      try {
        if (!statSync(filePath).isFile()) return notFoundResponse()
      } catch {
        return notFoundResponse()
      }

      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      console.error('[protocol] 处理 dsc:// 请求失败：', error)
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  })
}

function openExternalUrl(targetUrl) {
  try {
    const url = new URL(targetUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    void shell.openExternal(targetUrl).catch((error) => {
      console.warn('[window] 打开外部链接失败：', error)
    })
  } catch {
    // 非法 URL 直接忽略
  }
}

function isAllowedInAppNavigation(targetUrl) {
  try {
    const url = new URL(targetUrl)
    if (url.protocol === `${PROTOCOL}:` && url.hostname === 'app') return true
    if (DEV && url.origin === new URL(DEV_ORIGIN).origin) return true
  } catch {
    // fall through
  }
  return false
}

function wireWindowSecurity(win) {
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedInAppNavigation(targetUrl)) return
    event.preventDefault()
    openExternalUrl(targetUrl)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 附件原件与图片预览使用 blob: URL（见 MessageFile.tsx），由本应用同源
    // 的渲染进程创建。这里放行成受控的只读子窗口；http/https 仍交给系统浏览器。
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {
      // about:blank 等非 URL 情形按外部链接处理
    }
    if (protocol === 'blob:') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 800,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: false,
          },
        },
      }
    }

    openExternalUrl(url)
    return { action: 'deny' }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] 渲染进程退出：', details.reason)
  })
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: APP_NAME,
    backgroundColor: '#0b1b33',
    show: false,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
    },
  })

  mainWindow = win
  win.once('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  wireWindowSecurity(win)

  if (SMOKE) {
    const timer = setTimeout(() => {
      console.error('[smoke] timed out waiting for did-finish-load')
      app.exit(1)
    }, 30_000)

    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      console.log(`[smoke] did-finish-load ${win.webContents.getURL()}`)
      // 留出时间把日志刷到 stdout，再退出，避免冒烟测试卡住
      setTimeout(() => app.exit(0), 100)
    })
    win.webContents.once('did-fail-load', (_event, code, description, url) => {
      clearTimeout(timer)
      console.error(`[smoke] did-fail-load ${code} ${description} ${url}`)
      setTimeout(() => app.exit(1), 100)
    })
  }

  if (SMOKE_BLOB) {
    const timer = setTimeout(() => {
      console.error('[smoke-blob] timed out waiting for preview window')
      app.exit(1)
    }, 30_000)

    win.webContents.on('did-create-window', (child) => {
      child.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        console.log(`[smoke-blob] preview loaded ${child.webContents.getURL()}`)
        setTimeout(() => app.exit(0), 100)
      })
      child.webContents.once('did-fail-load', (_event, code, description, url) => {
        clearTimeout(timer)
        console.error(`[smoke-blob] preview failed ${code} ${description} ${url}`)
        setTimeout(() => app.exit(1), 100)
      })
    })

    win.webContents.once('did-finish-load', () => {
      void win.webContents
        .executeJavaScript(
          `(() => {
            const url = URL.createObjectURL(new Blob(['DSChat blob smoke'], { type: 'text/plain' }))
            window.open(url, '_blank', 'noreferrer')
            return url
          })()`
        )
        .catch((error) => {
          clearTimeout(timer)
          console.error('[smoke-blob] executeJavaScript failed:', error)
          app.exit(1)
        })
    })
  }

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) {
      console.error(`[window] 页面加载失败 ${code} ${description} ${url}`)
    }
  })

  const target = DEV ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`
  console.log(`[main] loading ${target}`)
  win.loadURL(target).catch((error) => {
    console.error('[window] loadURL 失败：', error)
    if (SMOKE) app.exit(1)
  })

  return win
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(DEV
          ? [{ role: 'toggleDevTools' }, { type: 'separator' }]
          : [{ type: 'separator' }]),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    settingsFile = path.join(app.getPath('userData'), 'secrets.json')
    currentApiKey = loadApiKey()

    registerIpc()
    registerProtocolHandler()
    registerPermissions()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('web-contents-created', (_event, contents) => {
    // 本项目不使用 <webview>，直接禁止挂载
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
