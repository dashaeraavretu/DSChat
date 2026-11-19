#!/usr/bin/env node
/**
 * Web 部署 / PWA 回归：
 * - 构建脚本生成 _headers 与 sw.js
 * - CSP 跟随构建期 API origin
 * - Service Worker 只在 HTTPS 的非 Electron 环境注册
 * - PWA manifest 可安装
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')
const dist = (file) => path.join(ROOT, 'dist', file)

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

console.log('web deploy test\n')

check('service worker registration is web-only and secure-context-only', () => {
  const main = read('src/main.tsx')
  assert.match(main, /window\.desktop/)
  assert.match(main, /location\.protocol === 'https:'/)
  assert.match(main, /location\.hostname === 'localhost'/)
  assert.match(main, /location\.hostname === '127\.0\.0\.1'/)
  assert.match(main, /navigator\.serviceWorker\.register\('sw\.js'\)/)
})

check('web deploy script generates headers and the service worker', () => {
  const script = read('scripts/write-web-deploy.mjs')
  assert.match(script, /dist\/_headers|path\.join\(dist, '_headers'\)/)
  assert.match(script, /path\.join\(dist, 'sw\.js'\)/)
  assert.match(script, /connect-src 'self' \$\{apiOrigin\}/)
  assert.match(script, /frame-ancestors 'none'/)
  assert.match(script, /CACHE = 'dschat-\$\{version\}'/)
  assert.match(script, /request\.mode === 'navigate'/)
})

check('wrangler config points at dist', () => {
  const config = read('wrangler.toml')
  assert.match(config, /pages_build_output_dir\s*=\s*"\.\/dist"/)
})

check('PWA manifest is installable and scoped', () => {
  const manifest = read('build/site.webmanifest')
  assert.match(manifest, /"display":\s*"standalone"/)
  assert.match(manifest, /"scope":\s*"\.\/"/)
  assert.match(manifest, /"sizes":\s*"192x192"/)
  assert.match(manifest, /"sizes":\s*"512x512"/)
  assert.match(manifest, /"purpose":\s*"maskable"/)
})

if (existsSync(dist('index.html'))) {
  check('built _headers has a strict CSP and the API origin', () => {
    const headers = read('dist/_headers')
    assert.match(headers, /connect-src 'self' https:\/\/api\.deepseek\.com/)
    assert.match(headers, /script-src 'self'/)
    assert.match(headers, /object-src 'none'/)
    assert.match(headers, /frame-ancestors 'none'/)
    assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-cache/)
  })

  check('built service worker has a versioned cache and offline fallback', () => {
    const sw = read('dist/sw.js')
    assert.match(sw, /const CACHE = 'dschat-\d+\.\d+\.\d+'/)
    assert.match(sw, /\.\/index\.html/)
    assert.match(sw, /self\.skipWaiting\(\)/)
    assert.match(sw, /new Response\('Offline'/)
  })

  check('built manifest is present', () => {
    const manifest = JSON.parse(read('dist/site.webmanifest'))
    assert.equal(manifest.display, 'standalone')
    assert.equal(manifest.scope, './')
  })
} else {
  console.log('  skip built assets (run `pnpm build` first)')
}

console.log(`\n${checks} checks passed`)
