#!/usr/bin/env node
/**
 * DSChat desktop smoke test.
 *
 * Zero dependencies: run with `node tests/smoke.mjs` after `pnpm build`.
 * Checks that the web bundle exists with the expected title, that the bundle
 * and a JavaScript asset can be served over HTTP, that the Electron entry
 * points exist, and that electron-builder is configured in package.json.
 *
 * This intentionally does not launch Electron or use Playwright. It is a
 * fast pre-flight check, not an end-to-end test.
 */

import { createServer, get } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const EXPECTED_TITLE = 'DSChat'

const failures = []
const passes = []

function ok(message) {
  passes.push(message)
  console.log(`  ok   ${message}`)
}

function fail(message) {
  failures.push(message)
  console.log(`  FAIL ${message}`)
}

async function readText(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8')
}

async function checkFile(relativePath, label = relativePath) {
  try {
    const info = await stat(path.join(ROOT, relativePath))
    if (!info.isFile() || info.size === 0) {
      fail(`${label} exists but is empty or not a file`)
      return null
    }
    ok(`${label} exists (${info.size} bytes)`)
    return info
  } catch {
    fail(`${label} is missing: ${relativePath}`)
    return null
  }
}

function extractScriptSources(html) {
  const sources = []
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = re.exec(html)) !== null) sources.push(match[1])
  return sources
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.woff2':
      return 'font/woff2'
    case '.woff':
      return 'font/woff'
    case '.ttf':
      return 'font/ttf'
    default:
      return 'application/octet-stream'
  }
}

/** Serve DIST with a minimal static handler that refuses path traversal. */
function startStaticServer() {
  const server = createServer(async (req, res) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('Bad request')
      return
    }
    if (pathname === '/') pathname = '/index.html'
    const filePath = path.resolve(DIST, `.${pathname}`)
    if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
      res.writeHead(403).end('Forbidden')
      return
    }
    try {
      const body = await readFile(filePath)
      res.writeHead(200, {
        'content-type': contentType(filePath),
        'content-length': body.byteLength,
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('Not found')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: address.port })
    })
  })
}

/** GET a path from the local server; resolve with status and body length. */
function httpGet(port, requestPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = get(
      { host: '127.0.0.1', port, path: requestPath, timeout: timeoutMs },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
        })
        response.on('end', () => {
          resolve({ status: response.statusCode, bytes, headers: response.headers })
        })
      }
    )
    request.on('timeout', () => request.destroy(new Error('request timed out')))
    request.on('error', reject)
  })
}

async function main() {
  console.log(`DSChat smoke test\nRepository: ${ROOT}\n`)

  console.log('[1/4] Built web bundle')
  const htmlInfo = await checkFile('dist/index.html')
  let html = ''
  if (htmlInfo) {
    try {
      html = await readText('dist/index.html')
    } catch (error) {
      fail(`dist/index.html could not be read: ${error.message}`)
    }
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    if (!titleMatch) {
      fail('dist/index.html has no <title> element')
    } else {
      const title = titleMatch[1].trim()
      if (title === EXPECTED_TITLE) ok(`dist/index.html title is "${EXPECTED_TITLE}"`)
      else fail(`dist/index.html title is "${title}", expected "${EXPECTED_TITLE}"`)
    }
  } else {
    fail('Build the app first: pnpm build')
  }

  const scripts = extractScriptSources(html).filter((src) => !/^https?:/i.test(src))
  if (scripts.length === 0) {
    fail('dist/index.html references no local JavaScript bundle')
  }

  console.log('\n[2/4] Static bundle over HTTP')
  let serverHandle
  try {
    serverHandle = await startStaticServer()
    const rootResponse = await httpGet(serverHandle.port, '/index.html')
    if (rootResponse.status === 200 && rootResponse.bytes > 0) {
      ok(`GET /index.html -> 200 (${rootResponse.bytes} bytes)`)
    } else {
      fail(`GET /index.html -> ${rootResponse.status} (${rootResponse.bytes} bytes)`)
    }
    if (scripts.length > 0) {
      const scriptPath = scripts[0].startsWith('/') ? scripts[0] : `/${scripts[0]}`
      const scriptResponse = await httpGet(serverHandle.port, scriptPath)
      if (scriptResponse.status === 200 && scriptResponse.bytes > 0) {
        ok(`GET ${scriptPath} -> 200 (${scriptResponse.bytes} bytes)`)
      } else {
        fail(`GET ${scriptPath} -> ${scriptResponse.status} (${scriptResponse.bytes} bytes)`)
      }
    }
  } catch (error) {
    fail(`Static server check failed: ${error.message}`)
  } finally {
    await new Promise((resolve) => serverHandle?.server.close(resolve))
  }

  console.log('\n[3/4] Electron entry points')
  await checkFile('electron/main.mjs')
  await checkFile('electron/preload.cjs')

  console.log('\n[4/4] Electron packaging metadata')
  let pkg
  try {
    pkg = JSON.parse(await readText('package.json'))
  } catch (error) {
    fail(`package.json could not be read: ${error.message}`)
  }
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.electron) ok(`electron dependency declared (${deps.electron})`)
    else fail('package.json does not declare an electron dependency')

    if (deps['electron-builder']) ok(`electron-builder declared (${deps['electron-builder']})`)
    else fail('package.json does not declare an electron-builder dependency')

    const build = pkg.build ?? pkg['electron-builder']
    if (build && typeof build === 'object' && !Array.isArray(build)) {
      ok('electron-builder configuration present in package.json')
    } else {
      fail('package.json has no electron-builder "build" configuration')
    }
  }

  console.log(`\n${passes.length} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    console.error('\nSmoke test failed. Build the app and ensure the Electron shell and packaging metadata are complete.')
    process.exitCode = 1
  } else {
    console.log('Smoke test passed.')
  }
}

main().catch((error) => {
  console.error(`Smoke test crashed: ${error.stack ?? error}`)
  process.exitCode = 1
})
