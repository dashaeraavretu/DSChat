#!/usr/bin/env node
/**
 * 统一测试入口：依次运行 tests/ 下的无头回归脚本。
 * 不启动 Electron 窗口；需要真实代理链路的用 `pnpm test:proxy`。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tests = [
  'provider-config.test.mjs',
  'update-check.test.mjs',
  'security-csp.test.mjs',
  'security-key.test.mjs',
  'presets.test.mjs',
  'character-card.test.mjs',
  'markdown-cjk.test.mjs',
  'katex-copy.test.mjs',
  'prompt-variables.test.mjs',
  'session-features.test.mjs',
  'logger-redaction.mjs',
]

if (existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  tests.push('smoke.mjs')
} else {
  console.log('skip tests/smoke.mjs (run `pnpm build` first)')
}

const failures = []
for (const test of tests) {
  const file = path.join(ROOT, 'tests', test)
  console.log(`\n=== ${test} ===`)
  const result = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    failures.push(test)
  }
}

console.log('')
if (failures.length > 0) {
  console.error(`FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`All ${tests.length} test files passed.`)
