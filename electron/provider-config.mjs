/**
 * Provider 配置：构建期环境变量、主进程白名单与代理目标的唯一来源。
 *
 * 渲染层在构建时拿到 __API_ORIGIN__ 等常量；主进程此前只读运行时环境变量，
 * 导致自建 DSCHAT_API_ORIGIN 的安装包在用户机器上被白名单拒绝。构建脚本会把
 * 解析结果写入 electron/provider-config.json，主进程读取它作为默认值和白名单。
 * 运行时环境变量仅用于开发覆盖，优先级高于构建配置。
 */

export const OFFICIAL_API_ORIGIN = 'https://api.deepseek.com'
export const QIANJI_API_ORIGIN = 'https://dygpt.duoyioa.com/qianji'

const PROVIDER_ENV_KEYS = [
  'DSCHAT_PROFILE',
  'DSCHAT_API_ORIGIN',
  'DSCHAT_MESSAGES_PATH',
  'DSCHAT_MODELS_PATH',
  'DSCHAT_MODEL',
  'DSCHAT_VERIFY_MODE',
  'DSCHAT_FEATURE_FILES',
  'DSCHAT_FEATURE_SPEECH',
  'DSCHAT_FEATURE_WEB_TOOLS',
]

const stripTrailingSlash = (value) => String(value ?? '').replace(/\/+$/, '')
const envText = (env, name) => (typeof env?.[name] === 'string' ? env[name].trim() : '')
const envFlag = (env, name, fallback) => {
  const value = envText(env, name).toLowerCase()
  return value ? !['0', 'false', 'off', 'no'].includes(value) : fallback
}
const joinUrl = (origin, pathname) =>
  /^https?:\/\//i.test(pathname)
    ? pathname
    : `${origin.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`

export const isSafeProviderPath = (value) =>
  typeof value === 'string' &&
  value.startsWith('/') &&
  value.length <= 512 &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.split('/').includes('..') &&
  /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(value)

export const isLoopbackHost = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'

/** 与 rspack.config.ts 的 resolveProvider() 保持同一套默认值和环境变量语义 */
export function resolveProviderFromEnv(env = process.env) {
  const qianji = envText(env, 'DSCHAT_PROFILE').toLowerCase() === 'qianji'
  const origin = stripTrailingSlash(
    envText(env, 'DSCHAT_API_ORIGIN') || (qianji ? QIANJI_API_ORIGIN : OFFICIAL_API_ORIGIN)
  )
  const messagesPath = envText(env, 'DSCHAT_MESSAGES_PATH') || (qianji ? '/v1' : '/anthropic/v1')
  const modelsPath = envText(env, 'DSCHAT_MODELS_PATH') || (qianji ? '/v1/models' : '/models')
  const model =
    envText(env, 'DSCHAT_MODEL') || (qianji ? 'DS/DeepSeek-V4.1-Flash' : 'deepseek-flash')
  const rawVerifyMode = envText(env, 'DSCHAT_VERIFY_MODE') || (qianji ? 'message' : 'models')
  const verifyMode = ['models', 'message', 'skip'].includes(rawVerifyMode)
    ? rawVerifyMode
    : 'models'

  return {
    origin,
    messagesBase: joinUrl(origin, messagesPath),
    modelsUrl: joinUrl(origin, modelsPath),
    model,
    verifyMode,
    features: qianji
      ? { files: false, speech: false, webTools: false }
      : {
          files: envFlag(env, 'DSCHAT_FEATURE_FILES', true),
          speech: envFlag(env, 'DSCHAT_FEATURE_SPEECH', true),
          webTools: envFlag(env, 'DSCHAT_FEATURE_WEB_TOOLS', true),
        },
  }
}

/** 校验构建脚本生成的 provider 配置；缺失或损坏时返回 null，绝不抛异常 */
export function readBuildProvider(filePath, readFile) {
  try {
    const parsed = JSON.parse(readFile(filePath, 'utf8'))
    return normalizeProvider(parsed)
  } catch {
    return null
  }
}

export function normalizeProvider(value) {
  if (!value || typeof value !== 'object') return null
  if (
    typeof value.origin !== 'string' ||
    typeof value.messagesBase !== 'string' ||
    typeof value.modelsUrl !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.features !== 'object' ||
    value.features === null
  ) {
    return null
  }

  let originUrl
  try {
    originUrl = new URL(stripTrailingSlash(value.origin))
  } catch {
    return null
  }
  if (originUrl.protocol !== 'https:' && originUrl.protocol !== 'http:') return null
  if (originUrl.username || originUrl.password || originUrl.search || originUrl.hash) return null

  const verifyMode = ['models', 'message', 'skip'].includes(value.verifyMode)
    ? value.verifyMode
    : 'models'
  return {
    origin: stripTrailingSlash(value.origin),
    messagesBase: stripTrailingSlash(value.messagesBase),
    modelsUrl: stripTrailingSlash(value.modelsUrl),
    model: value.model.slice(0, 200),
    verifyMode,
    features: {
      files: value.features.files === true,
      speech: value.features.speech === true,
      webTools: value.features.webTools === true,
    },
  }
}

/** 有显式运行时环境变量时用它覆盖构建配置；否则使用构建时写入的配置 */
export function resolveDefaultProvider({ build = null, env = process.env } = {}) {
  const envProvider = resolveProviderFromEnv(env)
  if (!build) return envProvider
  const hasEnvOverride = PROVIDER_ENV_KEYS.some((key) => envText(env, key) !== '')
  return hasEnvOverride ? envProvider : build
}

/** 允许代理指向的根地址；构建期自建 origin 与运行时开发覆盖都算 */
export function providerRoots(build = null, env = process.env) {
  const roots = new Set([OFFICIAL_API_ORIGIN, QIANJI_API_ORIGIN])
  const configured = stripTrailingSlash(envText(env, 'DSCHAT_API_ORIGIN'))
  if (configured) roots.add(configured)
  if (build?.origin) roots.add(stripTrailingSlash(build.origin))
  return [...roots]
}

/**
 * 校验渲染层同步过来的 provider。只允许官方、千机、构建期写入的自建地址，
 * 或开发时显式放开的本机 mock 服务；即使渲染层被攻破，也不能把带 Key 的
 * 请求改发到任意主机。
 */
export function validateProvider(
  config,
  { defaults, allowedRoots = [], allowLoopback = false } = {}
) {
  if (!config || typeof config !== 'object') return null
  const origin = stripTrailingSlash(typeof config.origin === 'string' ? config.origin.trim() : '')
  if (!origin) return null
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return null
  }
  if (originUrl.username || originUrl.password || originUrl.search || originUrl.hash) return null

  const allowedRoot = allowedRoots.some((root) => root === origin)
  const loopback = allowLoopback && isLoopbackHost(originUrl.hostname)
  if (!allowedRoot && !loopback) return null
  if (!loopback && originUrl.protocol !== 'https:') return null
  if (loopback && originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return null

  const normalizeBase = (value) => {
    if (typeof value !== 'string') return null
    const trimmed = stripTrailingSlash(value.trim())
    if (!trimmed) return null
    try {
      const url = new URL(trimmed)
      if (url.protocol !== originUrl.protocol || url.origin !== originUrl.origin) return null
      if (url.username || url.password || url.search || url.hash) return null
      if (!isSafeProviderPath(url.pathname)) return null
      if (!trimmed.startsWith(`${origin}/`) && trimmed !== origin) return null
      return trimmed
    } catch {
      return null
    }
  }

  const messagesBase = normalizeBase(config.messagesBase)
  const modelsUrl = normalizeBase(config.modelsUrl)
  if (!messagesBase || !modelsUrl) return null

  const model =
    typeof config.model === 'string' && config.model.trim().length > 0
      ? config.model.trim().slice(0, 200)
      : defaults?.model
  const features =
    config.features && typeof config.features === 'object'
      ? {
          files: config.features.files === true,
          speech: config.features.speech === true,
          webTools: config.features.webTools === true,
        }
      : defaults?.features
  const verifyMode = ['models', 'message', 'skip'].includes(config.verifyMode)
    ? config.verifyMode
    : 'models'
  return { origin, messagesBase, modelsUrl, model, features, verifyMode }
}
