#!/usr/bin/env node
/**
 * KaTeX display formula copy regression.
 *
 * Run: node tests/katex-copy.test.mjs
 *
 * MathFormula.tsx 是 TSX，Node 不能直接导入，因此这里做两类断言：
 * 1. 源码静态断言：块级公式组件包含 hover 复制按钮、复制原始 LaTeX、错误兜底、
 *    aria/title/i18n key，以及不向消息层传播点击；
 * 2. 可执行断言：用真实 katex 渲染 display 公式，确认组件依赖的
 *    .katex-display / .katex 类名存在，且 throwOnError 对损坏公式抛错
 *    （组件用 try/catch 走 fallback，而不是崩溃）。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import katex from 'katex'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFile(path.join(ROOT, relativePath), 'utf8')

const passes = []
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name)
    console.log(`  ok   ${name}`)
  } else {
    failures.push(detail ? `${name}: ${detail}` : name)
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`)
  }
}

const component = await read('src/components/markdown/MathFormula.tsx')
const css = await read('src/components/markdown/markdown.css')
const zh = await read('src/i18n/zh.ts')
const en = await read('src/i18n/en.ts')

console.log('KaTeX copy regression\n')

console.log('[1/4] 组件：块级公式与复制按钮')
check('MathBlock 使用 ds-markdown-math-wrap 包裹', component.includes('ds-markdown-math-wrap'))
check('display 公式保留 katex-display 类', component.includes('katex-display ds-markdown-math'))
check('复制按钮使用 ds-math-copy 类', component.includes('ds-math-copy'))
check(
  '复制按钮有 aria-label={t(\'copyFormula\')}',
  /aria-label=\{t\('copyFormula'\)\}/.test(component)
)
check('复制按钮有 title={t(\'copyFormula\')}', /title=\{t\('copyFormula'\)\}/.test(component))
check('按钮 type=button，避免表单默认提交', /type="button"/.test(component))

console.log('\n[2/4] 复制逻辑：原始公式、错误不崩溃')
check('复制的是 mdast 原始 value', /copyText\(value\)/.test(component))
check('复用带降级的 copyText 工具', component.includes("from '../../utils/clipboard.js'"))
check('复制成功提示 formulaCopied', component.includes("key: copied ? 'formulaCopied' : 'copyFailed'"))
check('复制失败提示 copyFailed（不静默崩溃）', component.includes('copyFailed'))
check('点击复制不向消息层冒泡', /stopPropagation\(\)/.test(component))

console.log('\n[3/4] CSS：hover 显示、隐藏时不抢点击、触摸可用')
check('存在 .ds-math-copy 样式', /\.ds-math-copy\s*\{/.test(css))
check(
  'hover 公式区域显示按钮',
  /\.ds-markdown-math-wrap:hover\s+\.ds-math-copy/.test(css)
)
check('默认 opacity: 0 隐藏', /\.ds-math-copy\s*\{[\s\S]*?opacity:\s*0;/.test(css))
check(
  '默认 pointer-events: none，隐藏时不拦截公式点击',
  /\.ds-math-copy\s*\{[\s\S]*?pointer-events:\s*none;/.test(css)
)
check(
  'hover/focus 时恢复 pointer-events: auto',
  /\.ds-markdown-math-wrap:hover\s+\.ds-math-copy,[\s\S]*?pointer-events:\s*auto;/.test(css)
)
check('键盘 focus-visible 可见', /\.ds-math-copy:focus-visible/.test(css))
check('触摸设备常显按钮', /@media\s*\(hover:\s*none\)\s*\{[\s\S]*?\.ds-math-copy/.test(css))
check(
  '块公式间距挂在外层 wrap（避免复制按钮破坏 :last-child）',
  /\.ds-markdown\s+\.ds-markdown-math-wrap\s*\{[\s\S]*?margin:\s*16px 0;/.test(css)
)
check(
  '内层 katex-display 不再承担外边距',
  /\.ds-markdown-math\.katex-display\s*\{[\s\S]*?margin:\s*0;/.test(css)
)

console.log('\n[4/4] 可执行：KaTeX display 渲染与错误路径')
const html = katex.renderToString('E = mc^2', {
  throwOnError: true,
  strict: false,
  displayMode: true,
})
check('display 渲染输出含 class="katex-display"', html.includes('class="katex-display"'))
check('display 渲染输出含 class="katex"', html.includes('class="katex"'))
let invalidThrew = false
try {
  katex.renderToString('\\frac{1}{', { throwOnError: true, strict: false, displayMode: true })
} catch {
  invalidThrew = true
}
check('损坏公式在 throwOnError 下抛错（组件可 catch 并 fallback）', invalidThrew)

console.log('\n[补充] i18n key 存在')
check('zh.ts 含 copyFormula', /copyFormula:/.test(zh))
check('zh.ts 含 formulaCopied', /formulaCopied:/.test(zh))
check('en.ts 含 copyFormula', /copyFormula:/.test(en))
check('en.ts 含 formulaCopied', /formulaCopied:/.test(en))

console.log(`\n${passes.length} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.error('\nKaTeX copy regression failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exitCode = 1
} else {
  console.log('KaTeX copy regression passed.')
}
