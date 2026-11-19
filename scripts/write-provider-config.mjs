#!/usr/bin/env node
/**
 * 把构建期 provider 配置写入 electron/provider-config.json。
 * 主进程读取该文件，既作为默认 provider，也作为自建 DSCHAT_API_ORIGIN 的白名单；
 * 这样安装包不必依赖用户运行时环境变量。
 *
 * 由 build:web / build:test / dev:desktop 在打包前调用。
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProviderFromEnv } from '../electron/provider-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'electron', 'provider-config.json')
const provider = resolveProviderFromEnv(process.env)

writeFileSync(target, `${JSON.stringify(provider, null, 2)}\n`)
console.log(
  `[provider] ${path.relative(root, target)}: ${provider.origin} (${provider.model})`
)
