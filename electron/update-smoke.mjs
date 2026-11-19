/**
 * 0.4.0 更新检查行为冒烟测试。
 *
 * 不访问真实 GitHub：进程内起一个 mock Releases API，调用 main.mjs 的
 * checkLatestRelease()，覆盖新版本、已最新、限流、无效响应、恶意跳转 URL
 * 与未配置仓库。由 `electron . --smoke-update` 触发。
 */

import assert from 'node:assert/strict'
import http from 'node:http'

const repo = 'owner/repo'
const release = (overrides = {}) => ({
  tag_name: 'v0.4.0',
  html_url: `https://github.com/${repo}/releases/tag/v0.4.0`,
  name: 'DSChat 0.4.0',
  body: 'Release notes',
  published_at: '2026-11-19T00:00:00Z',
  draft: false,
  prerelease: false,
  ...overrides,
})

export async function runUpdateSmoke(api) {
  const results = []
  const check = async (name, fn) => {
    try {
      await fn()
      results.push({ name, ok: true })
      console.log(`  ok   ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error })
      console.log(`  FAIL ${name}`)
      console.log(`       ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let scenario = 'newer'
  const server = http.createServer((request, response) => {
    if (request.url !== `/repos/${repo}/releases/latest`) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: 'not found' }))
      return
    }
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (scenario === 'rate-limit') {
      json(403, { message: 'API rate limit exceeded' })
      return
    }
    if (scenario === 'malformed') {
      json(200, release({ tag_name: 'not-a-version' }))
      return
    }
    if (scenario === 'untrusted-url') {
      json(200, release({ html_url: 'https://evil.example/owner/repo/releases/tag/v0.4.0' }))
      return
    }
    json(200, release())
  })

  const address = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
  const apiOrigin = `http://127.0.0.1:${address.port}`

  console.log('update smoke test\n')
  try {
    await check('newer release is reported', async () => {
      scenario = 'newer'
      const result = await api.checkLatestRelease({
        repo,
        currentVersion: '0.3.3',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, true)
      assert.equal(result.hasUpdate, true)
      assert.equal(result.latestVersion, '0.4.0')
      assert.equal(result.url, `https://github.com/${repo}/releases/tag/v0.4.0`)
    })

    await check('same version is up to date', async () => {
      scenario = 'newer'
      const result = await api.checkLatestRelease({
        repo,
        currentVersion: '0.4.0',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, true)
      assert.equal(result.hasUpdate, false)
    })

    await check('rate limit is reported as a recoverable error', async () => {
      scenario = 'rate-limit'
      const result = await api.checkLatestRelease({
        repo,
        currentVersion: '0.3.3',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'rate-limit')
    })

    await check('malformed release is rejected', async () => {
      scenario = 'malformed'
      const result = await api.checkLatestRelease({
        repo,
        currentVersion: '0.3.3',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'invalid-response')
    })

    await check('release URL outside the configured repo is rejected', async () => {
      scenario = 'untrusted-url'
      const result = await api.checkLatestRelease({
        repo,
        currentVersion: '0.3.3',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'invalid-response')
    })

    await check('missing repository is not-configured', async () => {
      const result = await api.checkLatestRelease({
        repo: '',
        currentVersion: '0.3.3',
        apiOrigin,
        cache: false,
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'not-configured')
    })
  } finally {
    server.close()
    server.closeAllConnections?.()
  }

  const passed = results.filter((result) => result.ok).length
  console.log(`\n${passed}/${results.length} update smoke checks passed`)
  return passed === results.length ? 0 : 1
}
