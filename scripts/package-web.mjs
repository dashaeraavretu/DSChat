#!/usr/bin/env node
/**
 * 把 dist/ 打成可直接上传到 Cloudflare Pages / 任意静态托管的 zip。
 * 输出：release/DSChat-<version>-web.zip
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const indexPath = path.join(dist, 'index.html')
if (!existsSync(indexPath)) {
  console.error('[web] dist/index.html 不存在，请先运行 pnpm build')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outDir = path.join(root, 'release')
const outFile = path.join(outDir, `DSChat-${pkg.version}-web.zip`)

const files = {}
const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      walk(full, relative)
    } else if (entry.isFile() && statSync(full).isFile()) {
      files[relative] = new Uint8Array(readFileSync(full))
    }
  }
}
walk(dist)

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, zipSync(files, { level: 9 }))
console.log(
  `[web] ${path.relative(root, outFile)} (${Object.keys(files).length} files, ${Math.round(statSync(outFile).size / 1024)} KB)`
)
