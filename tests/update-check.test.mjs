#!/usr/bin/env node
/**
 * 更新检查纯函数回归：
 * - 版本比较与 GitHub Release 解析
 * - 只允许配置仓库的 Releases 页面
 * - 未配置/损坏的构建配置安全降级
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildLatestReleaseUrl,
  compareVersions,
  evaluateUpdate,
  isAllowedReleaseUrl,
  parseLatestRelease,
  parseRepoSlug,
  parseVersion,
  readReleaseConfig,
  repoFromPackageJson,
} from '../electron/update-check.mjs'

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

const repo = 'dashaeraavretu/DSChat'
const releasePayload = {
  tag_name: 'v0.4.0',
  html_url: `https://github.com/${repo}/releases/tag/v0.4.0`,
  name: 'DSChat 0.4.0',
  body: 'Release notes',
  published_at: '2026-11-19T00:00:00Z',
  draft: false,
  prerelease: false,
}

console.log('update check test\n')

check('parseRepoSlug accepts owner/repo only', () => {
  assert.equal(parseRepoSlug('dashaeraavretu/DSChat'), repo)
  assert.equal(parseRepoSlug(' owner/repo '), 'owner/repo')
  for (const value of ['', 'owner', 'owner/repo/extra', 'owner/../repo', 'https://github.com/a/b']) {
    assert.equal(parseRepoSlug(value), '')
  }
})

check('repoFromPackageJson handles string and object forms', () => {
  assert.equal(
    repoFromPackageJson({ repository: 'https://github.com/dashaeraavretu/DSChat.git' }),
    repo
  )
  assert.equal(
    repoFromPackageJson({ repository: { url: 'git+https://github.com/dashaeraavretu/DSChat' } }),
    repo
  )
  assert.equal(repoFromPackageJson({ repository: 'https://gitlab.com/a/b' }), '')
  assert.equal(repoFromPackageJson({}), '')
})

check('readReleaseConfig tolerates missing/corrupt files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dschat-release-'))
  try {
    assert.deepEqual(readReleaseConfig(path.join(dir, 'missing.json'), readFileSync), {
      githubRepo: '',
    })
    const corrupt = path.join(dir, 'corrupt.json')
    writeFileSync(corrupt, '{')
    assert.deepEqual(readReleaseConfig(corrupt, readFileSync), { githubRepo: '' })
    const valid = path.join(dir, 'valid.json')
    writeFileSync(valid, JSON.stringify({ githubRepo: repo }))
    assert.deepEqual(readReleaseConfig(valid, readFileSync), { githubRepo: repo })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

check('parseVersion handles v-prefix, padding and prerelease', () => {
  assert.deepEqual(parseVersion('v0.4'), { nums: [0, 4, 0], prerelease: '' })
  assert.deepEqual(parseVersion('1.2.3-beta.2'), {
    nums: [1, 2, 3],
    prerelease: 'beta.2',
  })
  for (const value of ['', 'v', '1.x.3', '1.2.3.4', null]) {
    assert.equal(parseVersion(value), null)
  }
})

check('compareVersions follows semver ordering', () => {
  assert.equal(compareVersions('0.3.3', '0.4.0'), -1)
  assert.equal(compareVersions('v0.4.0', '0.3.3'), 1)
  assert.equal(compareVersions('0.3.3', '0.3.3'), 0)
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta.1'), -1)
  assert.equal(compareVersions('invalid', '1.0.0'), null)
})

check('buildLatestReleaseUrl requires a valid repo', () => {
  assert.equal(
    buildLatestReleaseUrl(repo),
    `https://api.github.com/repos/${repo}/releases/latest`
  )
  assert.equal(buildLatestReleaseUrl(''), '')
  assert.equal(buildLatestReleaseUrl('evil/../repo'), '')
})

check('isAllowedReleaseUrl only accepts configured repo release pages', () => {
  assert.equal(
    isAllowedReleaseUrl(repo, `https://github.com/${repo}/releases/tag/v0.4.0`),
    true
  )
  assert.equal(isAllowedReleaseUrl(repo, `https://github.com/${repo}/releases`), true)
  for (const url of [
    `https://github.com/other/repo/releases/tag/v0.4.0`,
    `https://evil.example/${repo}/releases/tag/v0.4.0`,
    `http://github.com/${repo}/releases/tag/v0.4.0`,
    `https://github.com/${repo}/issues/1`,
    `https://github.com/${repo}/releases/tag/v0.4.0?x=1`,
  ]) {
    assert.equal(isAllowedReleaseUrl(repo, url), false, url)
  }
})

check('parseLatestRelease validates tag, URL and prerelease state', () => {
  const release = parseLatestRelease(releasePayload, repo)
  assert.ok(release)
  assert.equal(release.version, '0.4.0')
  assert.equal(release.url, releasePayload.html_url)
  assert.equal(release.name, 'DSChat 0.4.0')
  assert.equal(parseLatestRelease({ ...releasePayload, html_url: 'https://evil.example/x' }, repo), null)
  assert.equal(parseLatestRelease({ ...releasePayload, tag_name: 'not-a-version' }, repo), null)
  assert.equal(parseLatestRelease({ ...releasePayload, prerelease: true }, repo), null)
  assert.equal(parseLatestRelease({ ...releasePayload, draft: true }, repo), null)
})

check('evaluateUpdate reports newer/equal/invalid versions safely', () => {
  const release = parseLatestRelease(releasePayload, repo)
  assert.equal(release?.version, '0.4.0')
  const newer = evaluateUpdate('0.3.3', release)
  assert.equal(newer.hasUpdate, true)
  assert.equal(newer.latestVersion, '0.4.0')
  assert.equal(newer.url, releasePayload.html_url)

  const same = evaluateUpdate('0.4.0', release)
  assert.equal(same.hasUpdate, false)

  const invalid = evaluateUpdate('not-a-version', release)
  assert.equal(invalid.hasUpdate, false)
  assert.equal(invalid.currentVersion, 'not-a-version')
})

console.log(`\n${checks} checks passed`)
