import {
  isTranslationKey,
  translate,
  type TranslationMessage,
} from '../../i18n/index.js'
import {
  API_MODEL,
  API_ORIGIN,
  FEATURES,
  MESSAGES_BASE,
  MODELS_URL,
  VERIFY_MODE,
} from '../buildInfo.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期服务配置；默认官方地址与 0.1.3 完全一致 */
export { API_ORIGIN } from '../buildInfo.js'
/** Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = MESSAGES_BASE
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

const API_ERROR_KINDS: readonly ApiErrorKind[] = [
  'http',
  'stream',
  'network',
  'interrupted',
  'protocol',
]

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

/** 把主进程返回的脱敏错误映射回渲染层原有的 ApiError 分类 */
export const apiErrorFromBridge = (error?: DesktopApiError): ApiError => {
  const kind =
    error?.kind && API_ERROR_KINDS.includes(error.kind) ? (error.kind as ApiErrorKind) : 'network'
  const localMessage =
    error?.localMessageKey && isTranslationKey(error.localMessageKey)
      ? { key: error.localMessageKey }
      : undefined
  return new ApiError(kind, localMessage ?? (error?.message || 'Request failed'), error?.status)
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

const desktopBridge = (): DesktopBridge | undefined => {
  if (typeof window === 'undefined' || typeof window.desktop === 'undefined') {
    return undefined
  }
  const bridge = window.desktop
  return bridge && bridge.isDesktop && typeof bridge.apiRequest === 'function' ? bridge : undefined
}

/** 桌面端启动时把构建期 provider 交给主进程；不包含任何 Key */
let desktopConfigured: Promise<DesktopBridge> | null = null

const requireDesktopBridge = async (): Promise<DesktopBridge> => {
  const bridge = desktopBridge()
  if (!bridge) {
    throw new ApiError('network', 'Desktop API bridge is unavailable')
  }
  if (!desktopConfigured) {
    desktopConfigured = (async () => {
      const ok = await bridge.configureApi({
        origin: API_ORIGIN,
        messagesBase: MESSAGES_BASE,
        modelsUrl: MODELS_URL,
        model: API_MODEL,
        features: FEATURES,
        verifyMode: VERIFY_MODE,
      })
      if (!ok) {
        throw new ApiError('network', '主进程拒绝了 API 代理配置')
      }
      return bridge
    })()
  }
  return desktopConfigured
}

const createRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('Aborted', 'AbortError')

export const isDesktopApiBridge = () => desktopBridge() !== undefined

/** 一次性 API 请求；Key 不出主进程，signal 中止会转发到主进程 */
const callDesktopApi = async <T>(
  method: 'verify' | 'upload-file' | 'delete-file' | 'transcribe',
  payload: unknown,
  signal?: AbortSignal
): Promise<T> => {
  const bridge = await requireDesktopBridge()
  if (signal?.aborted) {
    throw abortReason(signal)
  }
  const id = createRequestId()
  const onAbort = () => {
    void bridge.abortApiRequest(id)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await bridge.apiRequest<T>(id, method, payload)
    if (signal?.aborted) {
      throw abortReason(signal)
    }
    if (!result.ok) {
      throw apiErrorFromBridge(result.error)
    }
    return result.value
  } catch (error) {
    if (signal?.aborted) {
      throw abortReason(signal)
    }
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 把主进程转发的字节流包装成 ReadableStream：订阅先于启动，避免漏掉首帧；
 * 中止或取消时通知主进程 abort 上游请求。
 */
const openDesktopByteStream = (
  bridge: DesktopBridge,
  id: string,
  kind: 'message' | 'tts',
  payload: unknown,
  signal?: AbortSignal
): ReadableStream<Uint8Array> => {
  let cleanup = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false
      let unsubscribe = () => {}
      const finish = () => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      }
      const fail = (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        try {
          controller.error(error)
        } catch {
          // 已关闭
        }
      }
      const onAbort = () => {
        void bridge.abortApiStream(id)
        fail(abortReason(signal as AbortSignal))
      }
      cleanup = () => {
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
        cleanup = () => {}
      }

      if (signal?.aborted) {
        fail(abortReason(signal))
        return
      }

      unsubscribe = bridge.onApiStream((event) => {
        if (event.id !== id) {
          return
        }
        if (event.type === 'chunk') {
          if (settled || !event.data) {
            return
          }
          try {
            controller.enqueue(new Uint8Array(event.data))
          } catch {
            // 流已关闭时停止入队
          }
          return
        }
        if (event.type === 'end') {
          finish()
          return
        }
        if (event.type === 'error') {
          fail(apiErrorFromBridge(event.error))
        }
      })
      signal?.addEventListener('abort', onAbort, { once: true })

      void bridge
        .startApiStream(id, kind, payload)
        .then((result) => {
          if (!result.ok) {
            fail(apiErrorFromBridge(result.error))
          }
        })
        .catch((error: unknown) => {
          fail(error instanceof ApiError ? error : new ApiError('network', String(error)))
        })
    },
    cancel() {
      void bridge.abortApiStream(id)
      cleanup()
    },
  })
}

/** 在输入/校验 Key 前先把构建期 provider 同步给主进程 */
export const prepareDesktopApi = async (): Promise<boolean> => {
  if (!desktopBridge()) {
    return false
  }
  await requireDesktopBridge()
  return true
}

/** 桌面端一次性请求；speech.ts 复用同一套 IPC 中止语义 */
export const desktopApiRequest = callDesktopApi

/** 桌面端流式请求；返回主进程字节流的 ReadableStream */
export const openDesktopApiStream = async (
  kind: 'message' | 'tts',
  payload: unknown,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> => {
  const bridge = await requireDesktopBridge()
  return openDesktopByteStream(bridge, createRequestId(), kind, payload, signal)
}

/**
 * 校验 API Key。默认仍用 GET /models（不产生费用）；
 * 测试 provider 可改为 1-token POST 或跳过，并区分不可达 / 401 / 模型不存在。
 * 桌面端校验主进程当前持有的 Key；输入新 Key 时走 verifyAndSaveApiKey。
 */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  if (VERIFY_MODE === 'skip') {
    return
  }
  if (desktopBridge()) {
    await callDesktopApi('verify', null, signal)
    return
  }
  if (VERIFY_MODE === 'message') {
    try {
      await request(`${ANTHROPIC_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          ...anthropicHeaders(apiKey, false),
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: API_MODEL,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal,
      })
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 ||
          (/model/i.test(error.message) &&
            /(not found|not exist|unsupported|invalid|unknown)/i.test(error.message)))
      ) {
        throw new ApiError('http', { key: 'apiKeyModelUnavailable' }, error.status)
      }
      throw error
    }
    return
  }
  await request(MODELS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/** 桌面端上传输入：ArrayBuffer + 文件名 + MIME，便于结构化克隆跨 IPC */
export type UploadFileData = {
  data: ArrayBuffer
  name: string
  mimeType?: string
}

export type UploadFileSource = File | ArrayBuffer | UploadFileData

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 * 桌面端接受 File、{ data, name, mimeType } 或裸 ArrayBuffer（配合 filename）。
 */
export const uploadFile = async (
  apiKey: string,
  file: UploadFileSource,
  purpose: FilePurpose | null,
  signal?: AbortSignal,
  filename?: string
): Promise<FileObject> => {
  if (!FEATURES.files) {
    throw new ApiError('http', { key: 'featureUnavailableFiles' })
  }
  const source: UploadFileData =
    file instanceof File
      ? {
          data: await file.arrayBuffer(),
          name: file.name,
          mimeType: file.type || undefined,
        }
      : file instanceof ArrayBuffer
        ? { data: file, name: filename?.trim() || 'file.bin' }
        : file
  if (desktopBridge()) {
    return callDesktopApi<FileObject>(
      'upload-file',
      { ...source, purpose },
      signal
    )
  }

  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  const body = new File([source.data], source.name, {
    type: source.mimeType || 'application/octet-stream',
  })
  form.append('file', body)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  if (!FEATURES.files) {
    throw new ApiError('http', { key: 'featureUnavailableFiles' })
  }
  if (desktopBridge()) {
    await callDesktopApi('delete-file', { fileId })
    return
  }
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/** 解析 SSE 字节流；桌面端与网页端共用，保证流式语义一致 */
async function* readMessageEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  for await (const { event: eventName, data } of readServerSentEvents(stream, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 * 桌面端由主进程转发 SSE 原始字节，渲染层不接触 Key，也不直连上游。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const bridge = desktopBridge()
  if (bridge) {
    const configured = await requireDesktopBridge()
    const id = createRequestId()
    const stream = openDesktopByteStream(configured, id, 'message', body, signal)
    yield* readMessageEvents(stream, signal)
    return
  }

  const response = await request(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  yield* readMessageEvents(response.body, signal)
}
