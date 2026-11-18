import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLogger, redactSensitive } from '../electron/logger.mjs'

const secrets = [
  'Authorization: Bearer sk-super-secret-key-123456',
  'x-api-key: another-secret-value',
  '{"apiKey":"plain-text-key"}',
  '{"content":"private chat message"}',
  'prefix sk-abcdefgh12345678 suffix',
]

for (const sample of secrets) {
  const redacted = redactSensitive(sample)
  assert.ok(!redacted.includes('super-secret'), redacted)
  assert.ok(!redacted.includes('another-secret'), redacted)
  assert.ok(!redacted.includes('plain-text-key'), redacted)
  assert.ok(!redacted.includes('private chat message'), redacted)
  assert.ok(!redacted.includes('abcdefgh12345678'), redacted)
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'dschat-log-test-'))
try {
  const logger = createLogger(dir)
  for (const sample of secrets) logger.info(sample)
  const content = logger.readAll()
  assert.ok(!content.includes('super-secret'), content)
  assert.ok(!content.includes('another-secret'), content)
  assert.ok(!content.includes('plain-text-key'), content)
  assert.ok(!content.includes('private chat message'), content)
  assert.ok(!content.includes('abcdefgh12345678'), content)
  assert.ok(content.includes('[REDACTED]'), content)
  console.log('logger redaction test passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
