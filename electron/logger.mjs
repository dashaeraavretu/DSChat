import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'

export const MAX_LOG_BYTES = 5 * 1024 * 1024
export const MAX_LOG_FILES = 3

const REDACTIONS = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]'],
  [/(authorization\s*[:=]\s*)[^\s"',;]+/gi, '$1[REDACTED]'],
  [/(x-api-key\s*[:=]\s*)[^\s"',;]+/gi, '$1[REDACTED]'],
  [/(api[_-]?key\s*["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_KEY]'],
  [/(bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED]'],
  [/"(content|messages|text|prompt|body)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"'],
]

/** 导出与写盘前统一脱敏：Authorization、Key、常见正文 JSON 字段 */
export const redactSensitive = (input) => {
  let text = String(input ?? '')
  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement)
  }
  return text
}

const dayStamp = () => new Date().toISOString().slice(0, 10)

/**
 * 按天写日志，单文件超过 5 MiB 轮转为 .1/.2（共 3 个文件）。
 * 目录不可写时静默降级，不能影响应用运行。
 */
export const createLogger = (dir, { maxBytes = MAX_LOG_BYTES, maxFiles = MAX_LOG_FILES } = {}) => {
  const currentFile = () => path.join(dir, `dschat-${dayStamp()}.log`)

  const ensureDir = () => mkdirSync(dir, { recursive: true })

  const rotate = (file) => {
    if (!existsSync(file)) return
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      return
    }
    if (size < maxBytes) return
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const from = index === 1 ? file : `${file}.${index - 1}`
      const to = `${file}.${index}`
      if (existsSync(from)) {
        try {
          if (existsSync(to)) unlinkSync(to)
          renameSync(from, to)
        } catch {
          // 轮转失败时继续写当前文件
        }
      }
    }
  }

  const write = (level, message) => {
    try {
      ensureDir()
      const file = currentFile()
      rotate(file)
      appendFileSync(
        file,
        `[${new Date().toISOString()}] [${level}] ${redactSensitive(message)}\n`,
        'utf8'
      )
    } catch {
      // 日志失败不影响主流程
    }
  }

  const describe = (error) =>
    error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ''}` : String(error)

  return {
    dir,
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message, error) => write('ERROR', error ? `${message}\n${describe(error)}` : message),
    readAll: () => {
      try {
        ensureDir()
        const files = readdirSync(dir)
          .filter((name) => /^dschat-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name))
          .sort()
        return files
          .map((name) => `--- ${name} ---\n${readFileSync(path.join(dir, name), 'utf8')}`)
          .join('\n')
      } catch {
        return ''
      }
    },
  }
}
