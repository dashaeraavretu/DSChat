import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import os from 'node:os'
import { createLogger, redactSensitive } from './logger.mjs'
import {
  providerRoots,
  readBuildProvider,
  resolveDefaultProvider,
  validateProvider as validateProviderConfig,
} from './provider-config.mjs'
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
const SMOKE_PROXY = process.argv.includes('--smoke-proxy')

// 代理冒烟测试固定使用临时 userData，绝不读写真实 profile
if (SMOKE_PROXY) {
  app.setPath('userData', path.join(os.tmpdir(), `dschat-proxy-smoke-${process.pid}`))
}

const FILES_BETA = 'files-api-2025-04-14'
/** 仅开发/显式测试时允许把代理指向本机 mock 服务 */
const ALLOW_LOOPBACK_PROVIDER =
  DEV || process.env.DSCHAT_PROXY_ALLOW_LOOPBACK === '1'

/**
 * 构建期写入的 provider 配置（electron/provider-config.json）是主进程的默认值
 * 和白名单来源；运行时 DSCHAT_* 环境变量只用于开发覆盖。
 */
const BUILD_PROVIDER = readBuildProvider(
  path.join(__dirname, 'provider-config.json'),
  readFileSync
)
const ALLOWED_PROVIDER_ROOTS = providerRoots(BUILD_PROVIDER)

/** 当前代理目标；只由主进程保存，渲染层无法在单次请求里指定 URL */
let apiProvider = resolveDefaultProvider({ build: BUILD_PROVIDER })
/** 正在转发的流和一次性 API 请求，用于停止/中止 */
const activeStreams = new Map()
const activeRequests = new Map()

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
/**
 * 当前 API Key。只存在于主进程内存中；preload/渲染层只能看到 hasApiKey。
 * safeStorage 可用时以系统加密格式落盘，否则只在本次进程内保留。
 */
let currentApiKey = null
/** 'encrypted' | 'memory'；只描述主进程实际能力，绝不谎称已加密 */
let currentKeyStorageMode = null

let logger = null
/** @type {Tray | null} */
let tray = null
let isQuitting = false
let windowStateFile = ''
let windowStateTimer = null
/** 窗口位置/大小与桌面偏好 */
let windowState = {
  width: 1200,
  height: 800,
  maximized: false,
  closeToTray: false,
  trayHintShown: false,
}

const tMain = (zh, en) => (app.getLocale().toLowerCase().startsWith('zh') ? zh : en)

function loadWindowState() {
  const fallback = {
    width: 1200,
    height: 800,
    maximized: false,
    closeToTray: false,
    trayHintShown: false,
  }
  try {
    const parsed = JSON.parse(readFileSync(windowStateFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return fallback
    const clamp = (value, min, max, def) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.round(value)))
        : def
    const coordinate = (value) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined
    return {
      width: clamp(parsed.width, 900, 10000, 1200),
      height: clamp(parsed.height, 620, 10000, 800),
      x: coordinate(parsed.x),
      y: coordinate(parsed.y),
      maximized: parsed.maximized === true,
      closeToTray: parsed.closeToTray === true,
      trayHintShown: parsed.trayHintShown === true,
    }
  } catch {
    return fallback
  }
}

function writeWindowState(patch) {
  Object.assign(windowState, patch)
  if (!windowStateFile) return
  try {
    mkdirSync(path.dirname(windowStateFile), { recursive: true })
    const temp = `${windowStateFile}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(windowState, null, 2)}\n`, 'utf8')
    renameSync(temp, windowStateFile)
  } catch (error) {
    logger?.warn(`窗口状态保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const intersects = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/** 只在保存的位置仍落在某个显示器工作区时恢复坐标，否则居中 */
function restoredBounds() {
  const { width, height, x, y } = windowState
  if (typeof x === 'number' && typeof y === 'number') {
    const visible = screen
      .getAllDisplays()
      .some((display) => intersects({ x, y, width, height }, display.workArea))
    if (visible) {
      return { x, y, width, height, center: false }
    }
  }
  return { width, height, center: true }
}

function updateTrayMenu() {
  if (!tray) return
  const visible = mainWindow?.isVisible() === true
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: visible ? tMain('隐藏窗口', 'Hide window') : tMain('显示窗口', 'Show window'),
        click: toggleWindow,
      },
      {
        label: tMain('新建对话', 'New chat'),
        click: () => sendRendererCommand('new-chat'),
      },
      { type: 'separator' },
      {
        label: tMain('退出', 'Quit'),
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  )
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide()
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  updateTrayMenu()
}

function createTray() {
  if (tray) return
  const trayPath = path.join(app.getAppPath(), 'build', 'tray.png')
  const image = nativeImage.createFromPath(
    existsSync(trayPath) ? trayPath : path.join(app.getAppPath(), 'build', 'icon.png')
  )
  if (image.isEmpty()) {
    logger?.warn('托盘图标缺失，跳过托盘创建')
    return
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip(APP_NAME)
  logger?.info('托盘已创建')
  tray.on('click', toggleWindow)
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  updateTrayMenu()
}

function sendRendererCommand(command) {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('app:command', command)
  updateTrayMenu()
}

function showTrayHintOnce() {
  if (windowState.trayHintShown) return
  writeWindowState({ trayHintShown: true })
  void dialog.showMessageBox({
    type: 'info',
    title: tMain('DSChat 仍在运行', 'DSChat is still running'),
    message: tMain('DSChat 已最小化到托盘', 'DSChat was minimized to the tray'),
    detail: tMain(
      '双击托盘图标可以重新打开窗口；可在设置中关闭“关闭到托盘”。',
      'Double-click the tray icon to reopen the window. You can turn this off in Settings.'
    ),
    buttons: [tMain('知道了', 'OK')],
  })
}

const removeSecretsFile = () => {
  try {
    unlinkSync(settingsFile)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

const writeEncryptedKey = (key) => {
  const payload = {
    version: 1,
    encrypted: true,
    apiKey: safeStorage.encryptString(key).toString('base64'),
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
}

/**
 * 从 userData/secrets.json 读取 API Key。
 * 只认系统加密格式：{ version: 1, encrypted: true, apiKey: '<base64 ciphertext>' }。
 * 旧版明文存档只在内存中接续使用，随后删除该文件（不会继续明文落盘）。
 * 文件损坏或无法解密时按未设置处理，保持原有行为。
 */
function loadApiKey() {
  currentApiKey = null
  currentKeyStorageMode = safeStorage.isEncryptionAvailable() ? 'encrypted' : 'memory'
  try {
    if (!existsSync(settingsFile)) return null
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) return null

    if (parsed.encrypted === true) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn(
          '[settings] 存档已加密，但当前系统无法使用 safeStorage 解密；请重新设置 API Key。'
        )
        return null
      }
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(parsed.apiKey, 'base64'))
        if (decrypted.length > 0) {
          currentApiKey = decrypted
          currentKeyStorageMode = 'encrypted'
        }
        return currentApiKey
      } catch (error) {
        console.warn('[settings] 解密 API Key 失败，已忽略该存档：', error)
        return null
      }
    }

    // 旧版降级存档：只把它接到主进程内存，能加密就立即迁移，绝不继续明文落盘。
    const legacyKey = parsed.apiKey
    if (safeStorage.isEncryptionAvailable()) {
      try {
        writeEncryptedKey(legacyKey)
        currentApiKey = legacyKey
        currentKeyStorageMode = 'encrypted'
        return currentApiKey
      } catch (error) {
        console.warn('[settings] 旧版明文 Key 迁移到系统加密失败：', error)
      }
    }
    currentApiKey = legacyKey
    currentKeyStorageMode = 'memory'
    try {
      removeSecretsFile()
    } catch (error) {
      console.warn('[settings] 删除旧版明文 Key 文件失败：', error)
    }
    return currentApiKey
  } catch (error) {
    console.warn('[settings] 读取 API Key 失败，已按未设置处理：', error)
    return null
  }
}

/**
 * 密钥存储状态，供渲染层在设置页如实展示。
 * encrypted：系统加密落盘；memory：仅本次进程内存（safeStorage 不可用），
 * 不会回退到 localStorage，也不会写明文 secrets.json。
 */
function keyStorageStatus() {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  return {
    encryptionAvailable,
    mode: currentKeyStorageMode ?? (encryptionAvailable ? 'encrypted' : 'memory'),
    hasApiKey: typeof currentApiKey === 'string' && currentApiKey.length > 0,
  }
}

/**
 * 保存 API Key。传 null 或空字符串表示清除，直接删除密钥文件。
 * safeStorage 可用时写系统加密格式；不可用时只保存在主进程内存并返回 true，
 * 同时通过 keyStorage.mode='memory' 告诉界面降级状态。
 */
function saveApiKey(key) {
  if (key === null || key === '') {
    removeSecretsFile()
    currentApiKey = null
    currentKeyStorageMode = safeStorage.isEncryptionAvailable() ? 'encrypted' : 'memory'
    return true
  }
  if (typeof key !== 'string' || key.length === 0 || key.length > 8192) return false

  if (safeStorage.isEncryptionAvailable()) {
    writeEncryptedKey(key)
    currentApiKey = key
    currentKeyStorageMode = 'encrypted'
    return true
  }

  // 安全降级：不写明文 secrets.json。Key 只活在主进程内存，重启后需要重新输入。
  // 同时删除可能存在的旧存档，避免下次 safeStorage 恢复后把旧 Key 又读回来。
  try {
    removeSecretsFile()
  } catch (error) {
    console.warn('[settings] 清理旧 Key 存档失败：', error)
  }
  console.warn('[settings] safeStorage 不可用：API Key 仅保存在主进程内存中（未加密、不落盘）。')
  currentApiKey = key
  currentKeyStorageMode = 'memory'
  return true
}

// ---------------------------------------------------------------------------
// 主进程 API 代理：所有上游请求都在这里发出，Key 只在本进程内使用。
// ---------------------------------------------------------------------------

const apiOk = (value = null) => ({ ok: true, value })
const apiFailure = (kind, message, status, localMessageKey) => ({
  ok: false,
  error: {
    kind,
    message: sanitizeErrorText(message),
    ...(typeof status === 'number' ? { status } : {}),
    ...(localMessageKey ? { localMessageKey } : {}),
  },
})

/** 错误文案与日志都不允许出现当前 Key；再交给日志脱敏规则兜底 */
function sanitizeErrorText(value) {
  let text = redactSensitive(String(value ?? ''))
  if (currentApiKey) {
    text = text.split(currentApiKey).join('[REDACTED]')
  }
  return text.slice(0, 2000)
}

const isTrustedSender = (event) => isTrustedPageUrl(event.senderFrame?.url ?? event.sender.getURL())

function apiKeyMissing() {
  return apiFailure('http', 'API Key 未设置', 401)
}

/** 校验渲染层同步过来的构建期 provider；白名单来自构建配置 + 开发覆盖 */
const validateProvider = (config) =>
  validateProviderConfig(config, {
    defaults: apiProvider,
    allowedRoots: ALLOWED_PROVIDER_ROOTS,
    allowLoopback: ALLOW_LOOPBACK_PROVIDER,
  })

async function apiErrorFromResponse(response) {
  const text = await response.text().catch(() => '')
  let message = text || response.statusText || `HTTP ${response.status}`
  try {
    const body = JSON.parse(text)
    if (body && typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // 非 JSON 错误体直接使用原文（已截断/脱敏）
  }
  return apiFailure('http', message, response.status)
}

const hasFileBlock = (body) =>
  Array.isArray(body?.messages) &&
  body.messages.some(
    (message) =>
      typeof message?.content !== 'string' &&
      Array.isArray(message?.content) &&
      message.content.some((block) => block?.type === 'image' || block?.type === 'document')
  )

/** 校验 Key（不写入）；默认 GET /models，千机可用 1-token POST */
async function verifyKeyRequest(key, provider, signal) {
  if (provider.verifyMode === 'skip') return apiOk()
  try {
    let response
    if (provider.verifyMode === 'message') {
      response = await net.fetch(`${provider.messagesBase}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal,
      })
    } else {
      response = await net.fetch(provider.modelsUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal,
      })
    }
    if (!response.ok) {
      const result = await apiErrorFromResponse(response)
      const message = result.error?.message ?? ''
      if (
        response.status === 404 ||
        (/model/i.test(message) && /(not found|not exist|unsupported|invalid|unknown)/i.test(message))
      ) {
        result.error.localMessageKey = 'apiKeyModelUnavailable'
      }
      return result
    }
    return apiOk()
  } catch (error) {
    if (signal?.aborted) return apiFailure('network', '请求已取消')
    return apiFailure('network', error instanceof Error ? error.message : String(error))
  }
}

const toArrayBuffer = (value) => {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  return null
}

const safeUploadName = (value) => {
  const name = path.basename(typeof value === 'string' ? value.replace(/\0/g, '') : '')
  return name.slice(0, 200) || 'file'
}

async function uploadToProvider(payload, signal) {
  if (!apiProvider.features.files) {
    return apiFailure('http', 'Files API 不可用', undefined, 'featureUnavailableFiles')
  }
  const data = toArrayBuffer(payload?.data)
  if (!data || data.byteLength === 0 || data.byteLength > 64 * 1024 * 1024) {
    return apiFailure('protocol', '附件内容无效')
  }
  const purpose = payload?.purpose
  if (purpose !== null && purpose !== undefined && purpose !== 'rich_layout_recognition' && purpose !== 'user_data') {
    return apiFailure('protocol', '附件 purpose 无效')
  }
  const form = new FormData()
  if (purpose) form.append('purpose', purpose)
  const type = typeof payload?.mimeType === 'string' && payload.mimeType ? payload.mimeType : 'application/octet-stream'
  form.append('file', new Blob([data], { type }), safeUploadName(payload?.name))
  try {
    const response = await net.fetch(`${apiProvider.messagesBase}/files`, {
      method: 'POST',
      headers: { 'x-api-key': currentApiKey, 'anthropic-beta': FILES_BETA },
      body: form,
      signal,
    })
    if (!response.ok) return await apiErrorFromResponse(response)
    const file = await response.json().catch(() => null)
    if (!file || typeof file.id !== 'string' || file.type !== 'file') {
      return apiFailure('protocol', '附件上传响应无效')
    }
    return apiOk(file)
  } catch (error) {
    if (signal?.aborted) return apiFailure('network', '请求已取消')
    return apiFailure('network', error instanceof Error ? error.message : String(error))
  }
}

async function deleteProviderFile(fileId, signal) {
  if (!apiProvider.features.files) {
    return apiFailure('http', 'Files API 不可用', undefined, 'featureUnavailableFiles')
  }
  try {
    const response = await net.fetch(
      `${apiProvider.messagesBase}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: { 'x-api-key': currentApiKey, 'anthropic-beta': FILES_BETA },
        signal,
      }
    )
    if (!response.ok) return await apiErrorFromResponse(response)
    return apiOk()
  } catch (error) {
    if (signal?.aborted) return apiFailure('network', '请求已取消')
    return apiFailure('network', error instanceof Error ? error.message : String(error))
  }
}

async function transcribeWithProvider(payload, signal) {
  if (!apiProvider.features.speech) {
    return apiFailure('http', '语音接口不可用', undefined, 'featureUnavailableSpeech')
  }
  const data = toArrayBuffer(payload?.data)
  if (!data || data.byteLength === 0 || data.byteLength > 8 * 1024 * 1024) {
    return apiFailure('protocol', '录音内容无效')
  }
  const form = new FormData()
  const type = typeof payload?.mimeType === 'string' && payload.mimeType ? payload.mimeType : 'audio/wav'
  form.append('file', new Blob([data], { type }), safeUploadName(payload?.name || 'recording.wav'))
  try {
    const response = await net.fetch(`${apiProvider.origin}/v1/tools/asr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentApiKey}` },
      body: form,
      signal,
    })
    if (!response.ok) return await apiErrorFromResponse(response)
    const raw = await response.text()
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return apiFailure('protocol', raw)
    }
    if (!body || typeof body.text !== 'string') return apiFailure('protocol', raw)
    return apiOk(body.text)
  } catch (error) {
    if (signal?.aborted) return apiFailure('network', '请求已取消')
    return apiFailure('network', error instanceof Error ? error.message : String(error))
  }
}

function sendStreamEvent(sender, payload) {
  if (!sender || sender.isDestroyed()) return
  try {
    sender.send('api:stream-event', payload)
  } catch {
    // 窗口已销毁时静默结束
  }
}

/**
 * 发起上游请求并把原始字节流经 IPC 转发给渲染层。
 * 渲染层沿用原有 SSE 解析器；停止时通过 api:stream-abort 中止这里的 fetch。
 */
async function beginProviderStream(event, { id, kind, url, init, requireSse }) {
  const sender = event.sender
  const controller = new AbortController()
  const previous = activeStreams.get(id)
  previous?.controller.abort()

  const onDestroyed = () => controller.abort()
  const entry = { controller, sender, kind, onDestroyed }
  activeStreams.set(id, entry)
  sender.once('destroyed', onDestroyed)
  const cleanup = () => {
    sender.removeListener('destroyed', onDestroyed)
    if (activeStreams.get(id) === entry) activeStreams.delete(id)
  }

  try {
    const response = await net.fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      const result = await apiErrorFromResponse(response)
      cleanup()
      return result
    }
    if (requireSse) {
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const text = await response.text().catch(() => '')
        cleanup()
        return apiFailure('protocol', text || '响应不是 text/event-stream')
      }
    }
    if (!response.body) {
      cleanup()
      return apiFailure('protocol', '响应没有可读取的流')
    }

    const reader = response.body.getReader()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (controller.signal.aborted || sender.isDestroyed()) break
          // 发 ArrayBuffer：跨 contextBridge/结构化克隆最稳妥
          const data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          sendStreamEvent(sender, { id, kind, type: 'chunk', data })
        }
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sendStreamEvent(sender, { id, kind, type: 'end' })
        }
      } catch (error) {
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          const message = error instanceof Error ? error.message : String(error)
          sendStreamEvent(sender, {
            id,
            kind,
            type: 'error',
            error: { kind: 'network', message: sanitizeErrorText(message) },
          })
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          // 已释放
        }
        cleanup()
      }
    })()
    return apiOk()
  } catch (error) {
    cleanup()
    if (controller.signal.aborted) return apiFailure('network', '请求已取消')
    return apiFailure('network', error instanceof Error ? error.message : String(error))
  }
}

function registerIpc() {
  ipcMain.on('settings:get-key-status', (event) => {
    event.returnValue = keyStorageStatus()
  })

  ipcMain.on('app:get-version', (event) => {
    event.returnValue = app.getVersion()
  })

  ipcMain.on('settings:get-key-storage', (event) => {
    event.returnValue = keyStorageStatus()
  })

  ipcMain.handle('settings:get-key-storage', (event) => {
    if (!isTrustedSender(event)) return { encryptionAvailable: false, mode: 'memory', hasApiKey: false }
    return keyStorageStatus()
  })

  ipcMain.handle('settings:set-api-key', (event, key) => {
    if (!isTrustedSender(event)) return false
    if (key !== null && typeof key !== 'string') return false
    try {
      return saveApiKey(key)
    } catch (error) {
      logger?.error('保存 API Key 失败', sanitizeErrorText(error instanceof Error ? error.message : error))
      return false
    }
  })

  /** 输入新 Key 时先由主进程校验，成功后才落盘；Key 不经任何渲染层 API 请求 */
  ipcMain.handle('settings:verify-and-save-api-key', async (event, key) => {
    if (!isTrustedSender(event)) return apiFailure('network', '不可信来源')
    if (typeof key !== 'string' || key.length === 0 || key.length > 8192) {
      return apiFailure('protocol', 'API Key 无效')
    }
    const result = await verifyKeyRequest(key, apiProvider)
    if (!result.ok) return result
    try {
      if (!saveApiKey(key)) return apiFailure('protocol', 'API Key 保存失败')
      return apiOk()
    } catch (error) {
      logger?.error('保存 API Key 失败', sanitizeErrorText(error instanceof Error ? error.message : error))
      return apiFailure('protocol', 'API Key 保存失败')
    }
  })

  ipcMain.handle('api:configure', (event, config) => {
    if (!isTrustedSender(event)) return false
    const next = validateProvider(config)
    if (!next) return false
    apiProvider = next
    return true
  })

  /** 非流式 API：Key 校验、附件上传/删除、ASR */
  ipcMain.handle('api:request', async (event, payload) => {
    if (!isTrustedSender(event)) return apiFailure('network', '不可信来源')
    const id = typeof payload?.id === 'string' ? payload.id : ''
    if (!/^[\w-]{1,128}$/.test(id)) return apiFailure('protocol', '请求 ID 无效')
    const method = payload?.method
    if (!['verify', 'upload-file', 'delete-file', 'transcribe'].includes(method)) {
      return apiFailure('protocol', '未知的 API 操作')
    }
    if (!currentApiKey) return apiKeyMissing()

    const controller = new AbortController()
    activeRequests.get(id)?.controller.abort()
    activeRequests.set(id, { controller, sender: event.sender })
    try {
      if (method === 'verify') {
        return await verifyKeyRequest(currentApiKey, apiProvider, controller.signal)
      }
      if (method === 'upload-file') {
        return await uploadToProvider(payload?.payload, controller.signal)
      }
      if (method === 'delete-file') {
        const fileId = payload?.payload?.fileId
        if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 200) {
          return apiFailure('protocol', 'file_id 无效')
        }
        return await deleteProviderFile(fileId, controller.signal)
      }
      return await transcribeWithProvider(payload?.payload, controller.signal)
    } finally {
      if (activeRequests.get(id)?.controller === controller) activeRequests.delete(id)
    }
  })

  ipcMain.handle('api:abort', (event, id) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return false
    const entry = activeRequests.get(id)
    if (!entry || entry.sender !== event.sender) return false
    entry.controller.abort()
    return true
  })

  /** Messages/TTS 流：主进程转发原始字节，停止时 abort 上游请求 */
  ipcMain.handle('api:stream-start', async (event, payload) => {
    if (!isTrustedSender(event)) return apiFailure('network', '不可信来源')
    const id = typeof payload?.id === 'string' ? payload.id : ''
    if (!/^[\w-]{1,128}$/.test(id)) return apiFailure('protocol', '流 ID 无效')
    const kind = payload?.kind
    if (kind !== 'message' && kind !== 'tts') return apiFailure('protocol', '未知的流类型')
    if (!currentApiKey) return apiKeyMissing()
    const body = payload?.payload
    if (!body || typeof body !== 'object') return apiFailure('protocol', '请求内容无效')

    if (kind === 'message') {
      let json
      try {
        json = JSON.stringify({ ...body, stream: true })
      } catch {
        return apiFailure('protocol', '请求内容无法序列化')
      }
      if (json.length > 32 * 1024 * 1024) return apiFailure('protocol', '请求内容过大')
      const beta = hasFileBlock(body)
      return beginProviderStream(event, {
        id,
        kind,
        url: `${apiProvider.messagesBase}/messages`,
        init: {
          method: 'POST',
          headers: {
            'x-api-key': currentApiKey,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
          },
          body: json,
        },
        requireSse: true,
      })
    }

    if (!apiProvider.features.speech) {
      return apiFailure('http', '语音接口不可用', undefined, 'featureUnavailableSpeech')
    }
    const text = typeof body.text === 'string' ? body.text : ''
    const voice = body.voice === 'tide' ? 'tide' : body.voice === 'stella' ? 'stella' : ''
    const speed = typeof body.speed === 'number' && Number.isFinite(body.speed) ? body.speed : 1
    if (!text || text.length > 200000 || !voice) return apiFailure('protocol', '朗读参数无效')
    return beginProviderStream(event, {
      id,
      kind,
      url: `${apiProvider.origin}/v1/tools/tts`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice_id: voice,
          format: 'pcm',
          filter_markdown: true,
          speed: Math.min(2, Math.max(0.5, speed)),
        }),
      },
      requireSse: false,
    })
  })

  ipcMain.handle('api:stream-abort', (event, id) => {
    if (!isTrustedSender(event) || typeof id !== 'string') return false
    const entry = activeStreams.get(id)
    if (!entry || entry.sender !== event.sender) return false
    entry.controller.abort()
    return true
  })

  ipcMain.on('desktop:get-prefs', (event) => {
    event.returnValue = { closeToTray: windowState.closeToTray === true }
  })

  ipcMain.handle('window:set-zoom-factor', (event, factor) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
    if (!isTrustedPageUrl(senderUrl) || typeof factor !== 'number' || !Number.isFinite(factor)) {
      return false
    }
    const clamped = Math.min(1.25, Math.max(0.9, factor))
    try {
      mainWindow?.webContents.setZoomFactor(clamped)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('proxy:apply', async (event, payload) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
    if (!isTrustedPageUrl(senderUrl)) return false
    const mode = payload?.mode
    try {
      if (mode === 'system') {
        await session.defaultSession.setProxy({ mode: 'system' })
      } else if (mode === 'http' || mode === 'socks5') {
        const host = typeof payload.host === 'string' ? payload.host.trim() : ''
        const port = Number(payload.port)
        if (!host || !/^[\w.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
          return false
        }
        await session.defaultSession.setProxy({
          mode: 'fixed_servers',
          proxyRules: `${mode}://${host}:${port}`,
          proxyBypassRules: '<local>',
        })
      } else {
        return false
      }
      await session.defaultSession.closeAllConnections()
      return true
    } catch (error) {
      logger?.error('设置代理失败', error)
      return false
    }
  })

  ipcMain.handle('app:notify-done', (event, payload) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
    if (!isTrustedPageUrl(senderUrl)) return false
    // 窗口已聚焦时不再打扰；设置开关由渲染层决定是否调用
    if (mainWindow?.isFocused()) return false
    const title = typeof payload?.title === 'string' ? payload.title : APP_NAME
    const body = typeof payload?.body === 'string' ? payload.body : ''
    try {
      const notification = new Notification({ title, body, silent: payload?.silent === true })
      notification.on('click', () => {
        mainWindow?.show()
        mainWindow?.focus()
      })
      notification.show()
      return true
    } catch (error) {
      logger?.warn(`完成通知发送失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  })

  ipcMain.handle('desktop:set-close-to-tray', (_event, enabled) => {
    writeWindowState({ closeToTray: enabled === true })
    if (enabled === true) createTray()
    updateTrayMenu()
    return true
  })

  ipcMain.handle('file:save-text', async (event, payload) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
    if (!isTrustedPageUrl(senderUrl)) return false
    const content = typeof payload?.content === 'string' ? payload.content : ''
    if (!content || content.length > 5 * 1024 * 1024) return false
    const requested = typeof payload?.defaultName === 'string' ? payload.defaultName : 'export.md'
    const name = path.basename(requested).slice(0, 120) || 'export.md'
    const options = {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    }
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    try {
      writeFileSync(result.filePath, content, 'utf8')
      return true
    } catch (error) {
      logger?.error('保存导出文件失败', error)
      return false
    }
  })

  ipcMain.handle('diagnostics:export', async (event, info) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
    if (!isTrustedPageUrl(senderUrl)) return false

    const input = info && typeof info === 'object' ? info : {}
    const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
    const features =
      input.features && typeof input.features === 'object'
        ? {
            files: input.features.files === true,
            speech: input.features.speech === true,
            webTools: input.features.webTools === true,
          }
        : null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const options = {
      defaultPath: path.join(app.getPath('documents'), `DSChat-diagnostics-${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    }
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false

    const header = [
      `DSChat ${text(input.version, 64) || app.getVersion()}`,
      `API origin: ${text(input.apiOrigin, 512)}`,
      `Model: ${text(input.model, 128)}`,
      `Features: ${features ? JSON.stringify(features) : 'unknown'}`,
      `Electron: ${process.versions.electron}`,
      `Chrome: ${process.versions.chrome}`,
      `Node: ${process.versions.node}`,
      `OS: ${process.platform} ${process.arch} ${os.release()}`,
      `Locale: ${app.getLocale()}`,
    ].join('\n')

    try {
      writeFileSync(result.filePath, redactSensitive(`${header}\n\n${logger?.readAll() ?? ''}`), 'utf8')
      logger?.info('诊断日志已导出')
      return true
    } catch (error) {
      logger?.error('导出诊断日志失败', error)
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

/**
 * dsc://app 的严格 CSP：
 * - 禁内联脚本，脚本只允许同源构建产物；
 * - KaTeX/Mermaid/Prism 会写内联 style，因此 style-src 额外允许 unsafe-inline；
 * - 图片/媒体允许 data: 与 blob:，附件预览使用 blob:；
 * - connect-src 只允许 self，生产渲染层不能直连 API，所有请求走主进程代理。
 * 开发模式只额外放开本地 dev server 的 HTTP/WS，不放开任何外域脚本。
 */
const contentSecurityPolicy = () => {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    DEV ? `connect-src 'self' ${DEV_ORIGIN} ${DEV_ORIGIN.replace(/^http/, 'ws')}` : "connect-src 'self'",
    "media-src 'self' data: blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]
  return directives.join('; ')
}

function isHtmlFile(filePath) {
  return /\.html?$/i.test(filePath)
}

/** 给 HTML 响应追加安全头；其余静态资源保持原响应 */
function withDocumentSecurityHeaders(response, filePath) {
  if (!isHtmlFile(filePath)) return response
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', contentSecurityPolicy())
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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

      const response = await net.fetch(pathToFileURL(filePath).toString())
      return withDocumentSecurityHeaders(response, filePath)
    } catch (error) {
      console.error('[protocol] 处理 dsc:// 请求失败：', error)
      logger?.error('处理 dsc:// 请求失败', error)
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

/** 只接受本应用来源创建的 blob URL，避免放行任意 blob:http(s)://... */
const previewPrefixes = [`blob:${APP_ORIGIN}/`, ...(DEV ? [`blob:${DEV_ORIGIN}/`] : [])]

const isAllowedPreviewUrl = (targetUrl) =>
  previewPrefixes.some((prefix) => targetUrl.startsWith(prefix))

/**
 * 预览子窗口与主窗口同 partition（Chromium 的 blob URL 不能跨 partition 加载），
 * 但无 preload、启用 sandbox/contextIsolation，且只允许停留在最初的 blob 预览：
 * 外链、重定向、新窗口一律拦截。
 */
function wirePreviewWindow(child, initialUrl) {
  const blockNavigation = (event, targetUrl) => {
    if (targetUrl === initialUrl) return
    event.preventDefault()
    console.warn('[preview] 已拦截预览子窗口导航：', targetUrl)
  }

  child.webContents.on('will-navigate', blockNavigation)
  child.webContents.on('will-redirect', blockNavigation)
  child.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[preview] 已拦截预览子窗口新窗口：', url)
    return { action: 'deny' }
  })
  child.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function wireWindowSecurity(win) {
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedInAppNavigation(targetUrl)) return
    event.preventDefault()
    openExternalUrl(targetUrl)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 附件原件与图片预览使用本应用来源的 blob: URL（见 MessageFile.tsx）。
    // 同 partition 放行为受控的只读子窗口；http/https 仍交给系统浏览器。
    if (isAllowedPreviewUrl(url)) {
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

  win.webContents.on('did-create-window', (child, details) => {
    wirePreviewWindow(child, details.url)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] 渲染进程退出：', details.reason)
    logger?.error(`渲染进程退出：${details.reason}`)
  })
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  const bounds = restoredBounds()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 620,
    title: APP_NAME,
    backgroundColor: '#0b1b33',
    show: false,
    autoHideMenuBar: !DEV,
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
  if (!DEV) {
    win.setMenuBarVisibility(false)
  }
  win.once('ready-to-show', () => {
    if (windowState.maximized) {
      win.maximize()
    }
    win.show()
    updateTrayMenu()
  })

  const saveBounds = () => {
    if (win.isDestroyed()) return
    writeWindowState({ ...win.getNormalBounds(), maximized: win.isMaximized() })
  }
  const scheduleSaveBounds = () => {
    clearTimeout(windowStateTimer)
    windowStateTimer = setTimeout(saveBounds, 300)
  }
  win.on('resize', scheduleSaveBounds)
  win.on('move', scheduleSaveBounds)
  win.on('maximize', scheduleSaveBounds)
  win.on('unmaximize', scheduleSaveBounds)
  win.on('show', updateTrayMenu)
  win.on('hide', updateTrayMenu)
  win.on('close', (event) => {
    saveBounds()
    logger?.info(
      `窗口关闭 closeToTray=${windowState.closeToTray} tray=${tray !== null} quitting=${isQuitting}`
    )
    if (!isQuitting && windowState.closeToTray && tray) {
      event.preventDefault()
      win.hide()
      showTrayHintOnce()
      updateTrayMenu()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    updateTrayMenu()
  })

  wireWindowSecurity(win)

  if (!DEV) {
    // 生产环境禁用 DevTools 快捷键；菜单快捷键仍由 application menu 注册
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = String(input.key || '').toLowerCase()
      const blocked =
        key === 'f12' ||
        (input.control && input.shift && (key === 'i' || key === 'j'))
      if (blocked) {
        event.preventDefault()
        console.warn('[window] 已拦截 DevTools 快捷键')
      }
    })
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools()
    })
  }

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
      logger?.warn(`页面加载失败 ${code} ${description}`)
    }
  })

  const target = DEV ? DEV_ORIGIN : `${APP_ORIGIN}/index.html`
  console.log(`[main] loading ${target}`)
  win.loadURL(target).catch((error) => {
    console.error('[window] loadURL 失败：', error)
    logger?.error('loadURL 失败', error)
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
      label: tMain('会话', 'Chat'),
      submenu: [
        {
          label: tMain('新建对话', 'New chat'),
          accelerator: 'CmdOrCtrl+N',
          click: () => sendRendererCommand('new-chat'),
        },
        {
          label: tMain('搜索对话', 'Search chats'),
          accelerator: 'CmdOrCtrl+K',
          click: () => sendRendererCommand('search'),
        },
        {
          label: tMain('设置', 'Settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => sendRendererCommand('settings'),
        },
        {
          label: tMain('关闭弹窗或停止生成', 'Close dialog or stop'),
          accelerator: 'Esc',
          click: () => sendRendererCommand('escape'),
        },
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

  app.whenReady().then(async () => {
    logger = createLogger(path.join(app.getPath('userData'), 'logs'))
    logger.info(`应用启动 v${app.getVersion()} electron ${process.versions.electron}`)

    if (SMOKE_PROXY) {
      try {
        await session.defaultSession.setProxy({ mode: 'direct' })
      } catch (error) {
        console.warn('[smoke-proxy] 设置直连失败：', error)
      }
      // 仅源码测试使用；proxy-smoke.mjs 不进入安装包
      const { runProxySmoke } = await import('./proxy-smoke.mjs')
      const code = await runProxySmoke({
        getApiKey: () => currentApiKey,
        setApiKey: (key) => {
          currentApiKey = key
        },
        getProvider: () => apiProvider,
        setProvider: (provider) => {
          apiProvider = provider
        },
        validateProvider,
        verifyKeyRequest,
        beginProviderStream,
        uploadToProvider,
        deleteProviderFile,
        transcribeWithProvider,
        abortStream: (id) => {
          const entry = activeStreams.get(id)
          if (!entry) return false
          entry.controller.abort()
          return true
        },
      })
      app.exit(code)
      return
    }

    settingsFile = path.join(app.getPath('userData'), 'secrets.json')
    windowStateFile = path.join(app.getPath('userData'), 'window-state.json')
    windowState = loadWindowState()
    currentApiKey = loadApiKey()

    registerIpc()
    registerProtocolHandler()
    registerPermissions()
    buildMenu()
    createTray()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    logger?.info('应用退出')
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
