#!/usr/bin/env node
/**
 * 0.3.3 security: API Key never reaches the renderer; no plaintext fallback.
 *
 * Run with: node tests/security-key.test.mjs
 *
 * Static contract checks plus a small source audit:
 * - preload exposes hasApiKey/version/keyStorage/setApiKey, never an apiKey value
 * - renderer services call the main-process proxy; no key is sent per request
 * - settings has no localStorage fallback for the desktop key
 * - safeStorage failure degrades to main-process memory, not plaintext secrets.json
 * - ApiKeyField uses a fixed mask
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

const main = read('electron/main.mjs')
const preload = read('electron/preload.cjs')
const settings = read('src/services/settings.ts')
const client = read('src/services/api/client.ts')
const speech = read('src/services/api/speech.ts')
const apiKeyField = read('src/components/settings/ApiKeyField.tsx')
const apiKeyForm = read('src/components/settings/useApiKeyForm.ts')
const env = read('src/env.d.ts')

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

console.log('security key test\n')

check('preload never exposes the key value or the sync key channel', () => {
  assert.doesNotMatch(preload, /settings:get-api-key/)
  // 小写 apiKey 只可能出现在真实 Key 字段/通道中；hasApiKey/setApiKey 不受影响
  assert.doesNotMatch(preload, /\bapiKey\b/)
  assert.doesNotMatch(preload, /event\.returnValue\s*=\s*currentApiKey/)
})

check('preload exposes hasApiKey and the bridge API surface', () => {
  assert.match(preload, /hasApiKey/)
  assert.match(preload, /verifyAndSaveApiKey/)
  assert.match(preload, /configureApi/)
  assert.match(preload, /apiRequest\(/)
  assert.match(preload, /startApiStream\(/)
  assert.match(preload, /abortApiStream\(/)
  assert.match(preload, /version,/)
})

check('main has no plaintext key channel and uses safeStorage only', () => {
  assert.doesNotMatch(main, /settings:get-api-key/)
  assert.doesNotMatch(main, /encrypted\s*:\s*false/)
  assert.match(main, /safeStorage\.encryptString/)
  assert.match(main, /safeStorage\.decryptString/)
  assert.match(main, /mode:\s*'memory'/)
  assert.match(main, /settings:verify-and-save-api-key/)
})

check('main proxy owns messages/files/ASR/TTS/models requests', () => {
  assert.match(main, /api:stream-start/)
  assert.match(main, /api:stream-abort/)
  assert.match(main, /api:request/)
  assert.match(main, /api:abort/)
  assert.match(main, /messagesBase\}\/messages/)
  assert.match(main, /messagesBase\}\/files/)
  assert.match(main, /\/v1\/tools\/asr/)
  assert.match(main, /\/v1\/tools\/tts/)
  assert.match(main, /modelsUrl/)
})

check('desktop requests carry provider config but no key', () => {
  assert.match(client, /configureApi\(\{/)
  assert.match(client, /origin:\s*API_ORIGIN/)
  assert.match(client, /messagesBase:\s*MESSAGES_BASE/)
  assert.match(client, /modelsUrl:\s*MODELS_URL/)
  // configureApi payload 不能包含 Key
  const configureBlock = client.slice(
    client.indexOf('bridge.configureApi({'),
    client.indexOf('})', client.indexOf('bridge.configureApi({')) + 2
  )
  assert.doesNotMatch(configureBlock, /apiKey/)
  assert.match(client, /startApiStream\(id, kind, payload\)/)
  assert.match(client, /abortApiStream\(id\)/)
  assert.match(client, /apiRequest<T>\(id, method, payload\)/)
})

check('speech goes through the bridge on desktop', () => {
  assert.match(speech, /isDesktopApiBridge\(\)/)
  assert.match(speech, /desktopApiRequest<string>/)
  assert.match(speech, /openDesktopApiStream\('tts'/)
})

check('settings has no localStorage key fallback and reports memory mode', () => {
  assert.doesNotMatch(settings, /fallbackToLocalStorage/)
  assert.doesNotMatch(settings, /apiKeyDesktopFallbackHint/)
  assert.doesNotMatch(settings, /bridge\.apiKey/)
  assert.match(settings, /DESKTOP_KEY_PRESENT/)
  assert.match(settings, /mode === 'encrypted' \? 'encrypted' : 'memory'/)
  assert.match(settings, /safeStorage|memory/i)
  // preload 失效时仍识别 Electron，拒绝 localStorage 明文降级
  assert.match(settings, /isElectronRuntime/)
  assert.match(settings, /拒绝把 API Key 写入 localStorage/)

  const saveBlock = settings.slice(
    settings.indexOf('const saveDesktopApiKey'),
    settings.indexOf('export const setApiKey = (')
  )
  assert.ok(saveBlock.length > 0)
  assert.doesNotMatch(saveBlock, /localStorage\.(?:setItem|getItem|removeItem)/)
  assert.doesNotMatch(saveBlock, /write\(KEYS\.apiKey/)
})

check('legacy localStorage key is migrated then deleted', () => {
  const migrate = settings.slice(
    settings.indexOf('export const migrateLegacyApiKey'),
    settings.indexOf('export const setThinking')
  )
  assert.match(migrate, /localStorage\.getItem\(KEYS\.apiKey\)/)
  assert.match(migrate, /bridge\.setApiKey\(legacy\)/)
  assert.match(migrate, /write\(KEYS\.apiKey, null\)/)
})

check('ApiKeyField uses hasApiKey and a fixed mask only', () => {
  assert.match(apiKeyField, /state\.hasApiKey/)
  assert.match(apiKeyField, /\*{8}/)
  assert.doesNotMatch(apiKeyField, /apiKey\.length/)
  assert.doesNotMatch(apiKeyField, /state\.apiKey\b/)
  assert.doesNotMatch(apiKeyField, /repeat\(/)
})

check('key input is verified and saved by the main process', () => {
  assert.match(apiKeyForm, /prepareDesktopApi\(\)/)
  assert.match(apiKeyForm, /verifyAndSaveApiKey\(apiKey\)/)
  assert.match(apiKeyForm, /setApiKey\(apiKey, \{ persisted: true \}\)/)
})

check('bridge type has hasApiKey but no apiKey field', () => {
  assert.match(env, /hasApiKey:\s*boolean/)
  assert.doesNotMatch(env, /\n\s*apiKey:\s*string \| null/)
})

console.log(`\n${checks} checks passed`)
