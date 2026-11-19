/**
 * 0.3.3 主进程代理行为冒烟测试。
 *
 * 不启动窗口，不读写真实 profile：在进程内起一个本机 mock 上游，直接调用
 * main.mjs 的真实代理函数，覆盖 Key 校验、SSE 消息流、流中止、附件上传/删除、
 * ASR 与 TTS 字节流。由 `electron . --smoke-proxy` 触发。
 */

import assert from 'node:assert/strict'
import http from 'node:http'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate, timeout = 3000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return true
    await delay(20)
  }
  return false
}

function createSender() {
  const events = []
  let onDestroyed = null
  return {
    events,
    isDestroyed: () => false,
    once: (name, callback) => {
      if (name === 'destroyed') onDestroyed = callback
    },
    removeListener: () => {},
    send: (_channel, payload) => {
      events.push(payload)
    },
    destroy: () => onDestroyed?.(),
  }
}

const readBody = (request) =>
  new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
  })

function startMockUpstream() {
  const seen = { headers: [] }
  const server = http.createServer(async (request, response) => {
    seen.headers.push(request.headers)
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname

    if (request.method === 'GET' && pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }

    if (request.method === 'POST' && pathname === '/v1/messages') {
      await readBody(request)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.flushHeaders()
      if (url.searchParams.has('slow')) {
        // 保持连接，等待主进程 abort 后由 close 事件清理
        response.on('close', () => response.end())
        return
      }
      response.write('event: message_start\ndata: {"type":"message_start"}\n\n')
      await delay(10)
      response.write('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n')
      await delay(10)
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      return
    }

    if (request.method === 'POST' && pathname === '/v1/files') {
      await readBody(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'file_mock', type: 'file' }))
      return
    }

    if (request.method === 'DELETE' && pathname === '/v1/files/file_mock') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'POST' && pathname === '/v1/tools/asr') {
      await readBody(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ text: 'mock transcript' }))
      return
    }

    if (request.method === 'POST' && pathname === '/v1/tools/tts') {
      await readBody(request)
      response.writeHead(200, { 'content-type': 'audio/pcm' })
      response.end(Buffer.from([1, 2, 3, 4]))
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, seen, port: server.address().port })
    })
  })
}

/**
 * @param {{
 *   getApiKey: () => string | null,
 *   setApiKey: (key: string | null) => void,
 *   getProvider: () => unknown,
 *   setProvider: (provider: unknown) => void,
 *   validateProvider: (config: unknown) => unknown,
 *   verifyKeyRequest: Function,
 *   beginProviderStream: Function,
 *   uploadToProvider: Function,
 *   deleteProviderFile: Function,
 *   transcribeWithProvider: Function,
 *   abortStream: (id: string) => boolean,
 * }} api
 */
export async function runProxySmoke(api) {
  const results = []
  const check = (name, fn) => {
    try {
      fn()
      results.push({ name, ok: true })
      console.log(`  ok   ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error })
      console.log(`  FAIL ${name}`)
      console.log(`       ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const checkAsync = async (name, fn) => {
    try {
      await fn()
      results.push({ name, ok: true })
      console.log(`  ok   ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error })
      console.log(`  FAIL ${name}`)
      console.log(`       ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const { server, seen, port } = await startMockUpstream()
  const origin = `http://127.0.0.1:${port}`
  const config = {
    origin,
    messagesBase: `${origin}/v1`,
    modelsUrl: `${origin}/v1/models`,
    model: 'mock-model',
    features: { files: true, speech: true, webTools: true },
    verifyMode: 'models',
  }

  console.log('proxy smoke test\n')
  try {
    const provider = api.validateProvider(config)
    check('loopback provider is accepted in smoke mode', () => assert.ok(provider))
    check('arbitrary origin is rejected', () =>
      assert.equal(
        api.validateProvider({
          ...config,
          origin: 'https://evil.example',
          messagesBase: 'https://evil.example/v1',
          modelsUrl: 'https://evil.example/v1/models',
        }),
        null
      )
    )
    check('http non-loopback origin is rejected', () =>
      assert.equal(
        api.validateProvider({
          ...config,
          origin: 'http://api.deepseek.com',
          messagesBase: 'http://api.deepseek.com/anthropic/v1',
          modelsUrl: 'http://api.deepseek.com/models',
        }),
        null
      )
    )
    check('cross-origin messages base is rejected', () =>
      assert.equal(
        api.validateProvider({ ...config, messagesBase: 'https://evil.example/v1' }),
        null
      )
    )
    check('credentials in base URL are rejected', () =>
      assert.equal(
        api.validateProvider({
          ...config,
          messagesBase: `http://user:pass@127.0.0.1:${port}/v1`,
        }),
        null
      )
    )
    if (!provider) throw new Error('mock provider rejected')

    api.setProvider(provider)
    api.setApiKey('smoke-test-key')

    await checkAsync('Key verification uses GET /models', async () => {
      const result = await api.verifyKeyRequest(api.getApiKey(), provider)
      assert.equal(result.ok, true)
      assert.ok(seen.headers.some((headers) => headers.authorization === 'Bearer smoke-test-key'))
    })

    await checkAsync('message stream forwards SSE bytes and ends', async () => {
      const sender = createSender()
      const result = await api.beginProviderStream(
        { sender },
        {
          id: 'smoke-message',
          kind: 'message',
          url: `${origin}/v1/messages`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: '{}',
          },
          requireSse: true,
        }
      )
      assert.equal(result.ok, true)
      assert.equal(await waitFor(() => sender.events.some((event) => event.type === 'end')), true)
      const text = Buffer.concat(
        sender.events
          .filter((event) => event.type === 'chunk')
          .map((event) => Buffer.from(event.data))
      ).toString('utf8')
      assert.match(text, /message_stop/)
      assert.equal(sender.events.some((event) => event.type === 'error'), false)
    })

    await checkAsync('stream abort stops without end/error events', async () => {
      const sender = createSender()
      const result = await api.beginProviderStream(
        { sender },
        {
          id: 'smoke-abort',
          kind: 'message',
          url: `${origin}/v1/messages?slow=1`,
          init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
          requireSse: true,
        }
      )
      assert.equal(result.ok, true)
      await delay(80)
      assert.equal(api.abortStream('smoke-abort'), true)
      await delay(120)
      assert.equal(sender.events.some((event) => event.type === 'end'), false)
      assert.equal(sender.events.some((event) => event.type === 'error'), false)
    })

    await checkAsync('attachment upload goes through /files', async () => {
      const result = await api.uploadToProvider({
        data: new Uint8Array([1, 2, 3, 4]).buffer,
        name: 'smoke.txt',
        mimeType: 'text/plain',
        purpose: 'user_data',
      })
      assert.equal(result.ok, true)
      assert.equal(result.value?.id, 'file_mock')
    })

    await checkAsync('attachment delete goes through /files/:id', async () => {
      const result = await api.deleteProviderFile('file_mock')
      assert.equal(result.ok, true)
    })

    await checkAsync('ASR returns transcribed text', async () => {
      const result = await api.transcribeWithProvider({
        data: new Uint8Array([1, 2, 3, 4]).buffer,
        name: 'smoke.wav',
        mimeType: 'audio/wav',
      })
      assert.equal(result.ok, true)
      assert.equal(result.value, 'mock transcript')
    })

    await checkAsync('TTS stream forwards raw bytes', async () => {
      const sender = createSender()
      const result = await api.beginProviderStream(
        { sender },
        {
          id: 'smoke-tts',
          kind: 'tts',
          url: `${origin}/v1/tools/tts`,
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          },
          requireSse: false,
        }
      )
      assert.equal(result.ok, true)
      assert.equal(await waitFor(() => sender.events.some((event) => event.type === 'end')), true)
      const bytes = Buffer.concat(
        sender.events
          .filter((event) => event.type === 'chunk')
          .map((event) => Buffer.from(event.data))
      )
      assert.deepEqual([...bytes], [1, 2, 3, 4])
    })
  } finally {
    server.close()
    server.closeAllConnections?.()
  }

  const passed = results.filter((result) => result.ok).length
  console.log(`\n${passed}/${results.length} proxy smoke checks passed`)
  return passed === results.length ? 0 : 1
}
