/**
 * 更新检查：只做「检查 GitHub Releases 最新版本 → 打开下载页」，不做自动下载或安装。
 *
 * 纯函数模块，便于单测；主进程负责网络请求和 IPC，渲染层只拿结果。
 * 更新源固定为公开的 GitHub Releases API，不需要任何 Token；私有仓库不支持。
 */

export const GITHUB_API_ORIGIN = 'https://api.github.com'
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** 只接受 owner/repo；拒绝空值、多段路径和 .. */
export const parseRepoSlug = (value) => {
  const slug = String(value ?? '').trim()
  if (!slug || slug.includes('..') || !REPO_PATTERN.test(slug)) return ''
  return slug
}

/** 从 package.json 的 repository 字段提取 owner/repo */
export const repoFromPackageJson = (pkg) => {
  const raw =
    typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url
  if (typeof raw !== 'string' || raw.length === 0) return ''
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[#?].*)?$/i.exec(raw)
  if (!match) return ''
  return parseRepoSlug(`${match[1]}/${match[2]}`)
}

/** 读取构建脚本生成的更新源配置；缺失或损坏时视为未配置 */
export function readReleaseConfig(filePath, readFile) {
  try {
    const parsed = JSON.parse(readFile(filePath, 'utf8'))
    return { githubRepo: parseRepoSlug(parsed?.githubRepo) }
  } catch {
    return { githubRepo: '' }
  }
}

export function parseVersion(value) {
  const text = String(value ?? '').trim().replace(/^v/i, '')
  if (!text) return null
  const dash = text.indexOf('-')
  const core = dash === -1 ? text : text.slice(0, dash)
  const prerelease = dash === -1 ? '' : text.slice(dash + 1)
  const parts = core.split('.')
  if (parts.length === 0 || parts.length > 3) return null
  const nums = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    nums.push(Number.parseInt(part, 10))
  }
  while (nums.length < 3) nums.push(0)
  return { nums, prerelease }
}

const comparePrerelease = (a, b) => {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = left[index]
    const r = right[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)
    if (lNumeric && rNumeric) {
      const diff = Number.parseInt(l, 10) - Number.parseInt(r, 10)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (lNumeric !== rNumeric) {
      return lNumeric ? -1 : 1
    } else if (l !== r) {
      return l > r ? 1 : -1
    }
  }
  return 0
}

/** 返回 -1 / 0 / 1；无法解析的版本返回 null */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  for (let index = 0; index < 3; index += 1) {
    const diff = left.nums[index] - right.nums[index]
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export const buildLatestReleaseUrl = (repo, apiOrigin = GITHUB_API_ORIGIN) => {
  const slug = parseRepoSlug(repo)
  if (!slug) return ''
  const base = String(apiOrigin ?? '').replace(/\/+$/, '')
  return base ? `${base}/repos/${slug}/releases/latest` : ''
}

/** 只允许打开配置仓库的 GitHub Releases 页面，避免更新结果被篡改后跳转任意站点 */
export function isAllowedReleaseUrl(repo, value) {
  const slug = parseRepoSlug(repo)
  if (!slug) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return false
    if (url.username || url.password || url.search || url.hash) return false
    return url.pathname === `/${slug}/releases` || url.pathname.startsWith(`/${slug}/releases/`)
  } catch {
    return false
  }
}

export function parseLatestRelease(payload, repo) {
  if (!payload || typeof payload !== 'object') return null
  if (payload.draft === true || payload.prerelease === true) return null
  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : ''
  const version = tagName.replace(/^v/i, '')
  if (!parseVersion(version)) return null
  const url = typeof payload.html_url === 'string' ? payload.html_url : ''
  if (!isAllowedReleaseUrl(repo, url)) return null
  return {
    version,
    tagName,
    url,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : '',
    notes: typeof payload.body === 'string' ? payload.body.slice(0, 8000) : '',
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : '',
  }
}

/** 比较当前版本与最新 release；不改变任何安装状态 */
export function evaluateUpdate(currentVersion, release) {
  const current = String(currentVersion ?? '')
  if (!release || !parseVersion(release.version) || !parseVersion(current)) {
    return { currentVersion: current, hasUpdate: false }
  }
  const comparison = compareVersions(release.version, current)
  if (comparison === null) return { currentVersion: current, hasUpdate: false }
  return {
    currentVersion: current,
    hasUpdate: comparison > 0,
    latestVersion: release.version,
    url: release.url,
    name: release.name,
    notes: release.notes,
    publishedAt: release.publishedAt,
  }
}
