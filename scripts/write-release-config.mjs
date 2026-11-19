#!/usr/bin/env node
/**
 * 写入 electron/release-config.json：
 * - 优先使用构建环境变量 DSCHAT_GITHUB_REPO（CI 用 ${{ github.repository }}）
 * - 否则回退到 package.json 的 repository 字段
 *
 * 主进程用该配置请求 GitHub Releases API。未配置时更新检查会返回
 * not-configured，不影响应用启动和聊天。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRepoSlug, repoFromPackageJson } from '../electron/update-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const githubRepo = parseRepoSlug(
  process.env.DSCHAT_GITHUB_REPO?.trim() || repoFromPackageJson(pkg)
)
const target = path.join(root, 'electron', 'release-config.json')

writeFileSync(target, `${JSON.stringify({ githubRepo }, null, 2)}\n`)
console.log(
  `[release] ${path.relative(root, target)}: ${githubRepo || '(not configured)'}`
)
