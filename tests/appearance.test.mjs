#!/usr/bin/env node
/**
 * 外观回归：六套主题、侧栏布局稳定类名、WebGL 背景与无障碍降级。
 * 不启动浏览器；渲染截图由人工/隔离脚本完成。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

let checks = 0
const check = (message, fn) => {
  fn()
  checks += 1
  console.log(`  ok   ${message}`)
}

const settings = read('src/services/settings.ts')
const dialog = read('src/components/settings/SettingsDialog.tsx')
const sider = read('src/components/sider/Sider.tsx')
const siderCss = read('src/components/sider/Sider.module.css')
const presets = read('src/app/presets.css')
const background = read('src/app/BackgroundFx.tsx')
const docs = read('docs/APPEARANCE.md')
const readme = read('README.md')

console.log('appearance test\n')

check('appearance type includes ink and geek', () => {
  assert.match(
    settings,
    /export type Appearance = 'original' \| 'tui' \| 'fish' \| 'paper' \| 'ink' \| 'geek'/
  )
  assert.match(settings, /value === 'ink'/)
  assert.match(settings, /value === 'geek'/)
})

check('appearance motion is persisted and settable', () => {
  assert.match(settings, /appearanceMotion: boolean/)
  assert.match(settings, /appearanceMotion: 'chat-demo:appearance-motion'/)
  assert.match(settings, /export const setAppearanceMotion/)
})

check('settings offers all six appearances and the motion toggle', () => {
  for (const value of ['original', 'tui', 'fish', 'paper', 'ink', 'geek']) {
    assert.match(dialog, new RegExp(`value: '${value}'`))
  }
  assert.match(dialog, /AppearanceMotionSetting/)
  assert.match(dialog, /setAppearanceMotion/)
})

check('ink and geek tokens exist for light and dark', () => {
  assert.match(presets, /body\[data-ds-preset='ink'\] \{/)
  assert.match(presets, /body\[data-ds-preset='ink'\]\[data-ds-dark-theme\]/)
  assert.match(presets, /body\[data-ds-preset='geek'\] \{/)
  assert.match(presets, /body\[data-ds-preset='geek'\]\[data-ds-dark-theme\]/)
  assert.match(presets, /\.ds-bg-fx/)
  assert.match(presets, /\.ds-app-frame/)
})

check('sidebar search has icon, shortcut hint and stable theming hooks', () => {
  assert.match(sider, /IconSearchOutline16/)
  assert.match(sider, /ds-new-chat/)
  assert.match(sider, /ds-search-field/)
  assert.match(sider, /Ctrl K/)
  assert.match(siderCss, /\.searchField/)
  assert.match(siderCss, /\.searchKbd/)
  assert.match(presets, /body\[data-ds-preset='ink'\] \.ds-search-field/)
  assert.match(presets, /body\[data-ds-preset='geek'\] \.ds-search-field/)
})

check('WebGL background has both shaders and performance safeguards', () => {
  assert.match(background, /INK_FRAGMENT/)
  assert.match(background, /GEEK_FRAGMENT/)
  assert.match(background, /prefers-reduced-motion/)
  assert.match(background, /ResizeObserver/)
  assert.match(background, /visibilitychange/)
  assert.match(background, /devicePixelRatio/)
  assert.match(background, /scale = appearance === 'ink' \? 0\.55 : 0\.8/)
  assert.match(background, /requestAnimationFrame/)
})

check('README and appearance docs link the self-hosting and design docs', () => {
  assert.match(readme, /docs\/WEB-DEPLOY\.md/)
  assert.match(readme, /docs\/SELF-HOST\.md/)
  assert.match(readme, /docs\/APPEARANCE\.md/)
  assert.match(readme, /docs\/screenshots\/ink-light\.png/)
  assert.match(readme, /docs\/screenshots\/geek-dark\.png/)
  assert.match(docs, /harryfan\.github\.io/)
  assert.match(docs, /gradient-gl/)
})

console.log(`\n${checks} checks passed`)
