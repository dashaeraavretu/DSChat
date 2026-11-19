#!/usr/bin/env node
/**
 * 0.3.3 security: dsc://app CSP regression test.
 *
 * Run with: node tests/security-csp.test.mjs
 *
 * Static checks only: the dsc protocol handler must attach a strict CSP to HTML
 * responses, production must not allow inline/external scripts, and the CSP
 * must keep the directives KaTeX/Mermaid/Prism/attachments rely on.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = readFileSync(path.join(ROOT, 'electron/main.mjs'), 'utf8')

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

console.log('security CSP test\n')

check('HTML responses get Content-Security-Policy', () => {
  assert.match(main, /function\s+withDocumentSecurityHeaders/)
  assert.match(main, /headers\.set\(\s*['"]Content-Security-Policy['"]\s*,\s*contentSecurityPolicy\(\)\s*\)/)
  assert.match(main, /withDocumentSecurityHeaders\(response,\s*filePath\)/)
  assert.match(main, /isHtmlFile\(filePath\)/)
})

check('production script-src is self only and blocks inline/eval', () => {
  assert.match(main, /"script-src 'self'"/)
  assert.doesNotMatch(main, /unsafe-eval/)
  assert.doesNotMatch(main, /script-src[^\n]*https?:\/\//)
  assert.doesNotMatch(main, /script-src[^\n]*'unsafe-inline'/)
})

check('style-src allows inline styles for KaTeX/Mermaid/Prism', () => {
  assert.match(main, /"style-src 'self' 'unsafe-inline'"/)
})

check('remote/data directives cover the renderer assets', () => {
  assert.match(main, /"img-src 'self' data: blob:"/)
  assert.match(main, /"font-src 'self' data:"/)
  assert.match(main, /"media-src 'self' data: blob:"/)
  assert.match(main, /"frame-src 'self' blob: data:"/)
})

check('renderer cannot connect to the API directly', () => {
  assert.match(main, /"connect-src 'self'"/)
  // 仅 DEV 分支追加本地 dev server，生产保持 self
  assert.match(main, /DEV\s*\?\s*`connect-src 'self' \$\{DEV_ORIGIN\}/)
})

check('dangerous loading directives are disabled', () => {
  assert.match(main, /"object-src 'none'"/)
  assert.match(main, /"base-uri 'none'"/)
  assert.match(main, /"form-action 'none'"/)
  assert.match(main, /"default-src 'self'"/)
})

const distHtml = path.join(ROOT, 'dist/index.html')
if (existsSync(distHtml)) {
  check('built HTML has no inline <script> body', () => {
    const html = readFileSync(distHtml, 'utf8')
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    for (const [, attrs, body] of scripts) {
      if (/\bsrc\s*=/i.test(attrs)) continue
      assert.equal(body.trim(), '', `inline script found: ${body.slice(0, 80)}`)
    }
  })
} else {
  console.log('  skip dist/index.html (build not present)')
}

console.log(`\n${checks} checks passed`)
