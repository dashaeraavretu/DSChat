#!/usr/bin/env node
/**
 * Provider 配置回归测试。
 *
 * 重点覆盖 0.3.3 的自建 origin 回归：构建期写入的 DSCHAT_API_ORIGIN 必须
 * 进入主进程白名单，安装包不能依赖用户运行时环境变量。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  normalizeProvider,
  providerRoots,
  readBuildProvider,
  resolveDefaultProvider,
  resolveProviderFromEnv,
  validateProvider,
} from '../electron/provider-config.mjs'

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

const customBuild = {
  origin: 'https://gateway.example.com/custom',
  messagesBase: 'https://gateway.example.com/custom/v1',
  modelsUrl: 'https://gateway.example.com/custom/v1/models',
  model: 'custom-model',
  verifyMode: 'message',
  features: { files: true, speech: true, webTools: true },
}

console.log('provider config test\n')

check('empty env resolves to official DeepSeek', () => {
  const provider = resolveProviderFromEnv({})
  assert.equal(provider.origin, 'https://api.deepseek.com')
  assert.equal(provider.messagesBase, 'https://api.deepseek.com/anthropic/v1')
  assert.equal(provider.modelsUrl, 'https://api.deepseek.com/models')
  assert.equal(provider.model, 'deepseek-flash')
  assert.equal(provider.verifyMode, 'models')
})

check('qianji profile resolves to Qianji defaults', () => {
  const provider = resolveProviderFromEnv({ DSCHAT_PROFILE: 'qianji' })
  assert.equal(provider.origin, 'https://dygpt.duoyioa.com/qianji')
  assert.equal(provider.messagesBase, 'https://dygpt.duoyioa.com/qianji/v1')
  assert.equal(provider.modelsUrl, 'https://dygpt.duoyioa.com/qianji/v1/models')
  assert.equal(provider.model, 'DS/DeepSeek-V4.1-Flash')
  assert.equal(provider.verifyMode, 'message')
  assert.deepEqual(provider.features, { files: false, speech: false, webTools: false })
})

check('custom DSCHAT_API_ORIGIN is resolved from env', () => {
  const provider = resolveProviderFromEnv({
    DSCHAT_API_ORIGIN: 'https://gateway.example.com/custom/',
    DSCHAT_MODEL: 'custom-model',
    DSCHAT_VERIFY_MODE: 'skip',
  })
  assert.equal(provider.origin, 'https://gateway.example.com/custom')
  assert.equal(provider.messagesBase, 'https://gateway.example.com/custom/anthropic/v1')
  assert.equal(provider.modelsUrl, 'https://gateway.example.com/custom/models')
  assert.equal(provider.model, 'custom-model')
  assert.equal(provider.verifyMode, 'skip')
})

check('build provider is used when no runtime env override exists', () => {
  const provider = resolveDefaultProvider({ build: customBuild, env: {} })
  assert.deepEqual(provider, customBuild)
})

check('runtime env overrides the build provider', () => {
  const provider = resolveDefaultProvider({
    build: customBuild,
    env: { DSCHAT_API_ORIGIN: 'https://runtime.example.com' },
  })
  assert.equal(provider.origin, 'https://runtime.example.com')
})

check('custom build origin is in the proxy allowlist', () => {
  const roots = providerRoots(customBuild, {})
  assert.ok(roots.includes('https://gateway.example.com/custom'))
  assert.ok(roots.includes('https://api.deepseek.com'))
  assert.ok(roots.includes('https://dygpt.duoyioa.com/qianji'))
})

check('custom build provider is accepted by validateProvider', () => {
  const provider = validateProvider(customBuild, {
    allowedRoots: providerRoots(customBuild, {}),
    defaults: customBuild,
  })
  assert.ok(provider)
  assert.equal(provider.origin, customBuild.origin)
  assert.equal(provider.messagesBase, customBuild.messagesBase)
  assert.equal(provider.model, 'custom-model')
})

check('arbitrary origin is rejected even with a valid shape', () => {
  const provider = validateProvider(
    { ...customBuild, origin: 'https://evil.example', messagesBase: 'https://evil.example/v1', modelsUrl: 'https://evil.example/v1/models' },
    { allowedRoots: providerRoots(customBuild, {}) }
  )
  assert.equal(provider, null)
})

check('plain http is rejected outside loopback', () => {
  const provider = validateProvider(
    {
      ...customBuild,
      origin: 'http://gateway.example.com',
      messagesBase: 'http://gateway.example.com/v1',
      modelsUrl: 'http://gateway.example.com/v1/models',
    },
    { allowedRoots: ['http://gateway.example.com'] }
  )
  assert.equal(provider, null)
})

check('loopback http is accepted only when explicitly allowed', () => {
  const config = {
    origin: 'http://127.0.0.1:9444',
    messagesBase: 'http://127.0.0.1:9444/v1',
    modelsUrl: 'http://127.0.0.1:9444/v1/models',
    model: 'mock',
    features: { files: true, speech: true, webTools: true },
    verifyMode: 'models',
  }
  assert.equal(validateProvider(config, { allowLoopback: false }), null)
  const provider = validateProvider(config, { allowLoopback: true })
  assert.ok(provider)
  assert.equal(provider.origin, 'http://127.0.0.1:9444')
})

check('cross-origin messages base is rejected', () => {
  const provider = validateProvider(
    { ...customBuild, messagesBase: 'https://evil.example/v1' },
    { allowedRoots: providerRoots(customBuild, {}) }
  )
  assert.equal(provider, null)
})

check('credentials, query and hash in base URLs are rejected', () => {
  const roots = providerRoots(customBuild, {})
  for (const messagesBase of [
    'https://user:pass@gateway.example.com/custom/v1',
    'https://gateway.example.com/custom/v1?x=1',
    'https://gateway.example.com/custom/v1#fragment',
  ]) {
    assert.equal(validateProvider({ ...customBuild, messagesBase }, { allowedRoots: roots }), null)
  }
})

check('origin with credentials/query/hash is rejected', () => {
  for (const origin of [
    'https://user:pass@gateway.example.com/custom',
    'https://gateway.example.com/custom?x=1',
    'https://gateway.example.com/custom#fragment',
  ]) {
    assert.equal(validateProvider({ ...customBuild, origin }, { allowedRoots: [origin] }), null)
  }
})

check('readBuildProvider parses a valid generated file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dschat-provider-'))
  try {
    const file = path.join(dir, 'provider-config.json')
    writeFileSync(file, JSON.stringify(customBuild))
    const provider = readBuildProvider(file, readFileSync)
    assert.deepEqual(provider, customBuild)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

check('readBuildProvider tolerates missing/corrupt/invalid files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dschat-provider-'))
  try {
    assert.equal(readBuildProvider(path.join(dir, 'missing.json'), readFileSync), null)
    const corrupt = path.join(dir, 'corrupt.json')
    writeFileSync(corrupt, '{not json')
    assert.equal(readBuildProvider(corrupt, readFileSync), null)
    const invalid = path.join(dir, 'invalid.json')
    writeFileSync(invalid, JSON.stringify({ origin: 'https://example.com' }))
    assert.equal(readBuildProvider(invalid, readFileSync), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

check('normalizeProvider clamps model, verify mode and feature flags', () => {
  const provider = normalizeProvider({
    ...customBuild,
    model: 'x'.repeat(300),
    verifyMode: 'unsupported',
    features: { files: 1, speech: 'yes', webTools: true },
  })
  assert.ok(provider)
  assert.equal(provider.model.length, 200)
  assert.equal(provider.verifyMode, 'models')
  assert.deepEqual(provider.features, { files: false, speech: false, webTools: true })
})

console.log(`\n${checks} checks passed`)
