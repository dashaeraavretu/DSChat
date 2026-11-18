#!/usr/bin/env node
/**
 * CJK Markdown emphasis regression.
 *
 * Run: node tests/markdown-cjk.test.mjs
 *
 * `toMdAst` 在 src/services/markdown/parse.ts 中是 TypeScript，Node 不能直接导入，
 * 因此这里用相同的 fromMarkdown 配置（GFM + LLM math）直接解析，断言正文里的
 * **“引号”** / **《书名》** / **词**与**词** 会产出 strong 节点。
 *
 * CommonMark 的 delimiter run 规则在中文正文中会把“紧贴 CJK 字符、后接全角标点”
 * 的 ** 判为不能开启强调，因此除了行首单独成段的形式，还必须覆盖嵌入中文句子的形式。
 */

import { registerHooks } from 'node:module'

// 把项目内的 .js 相对导入映射到 .ts，Node 22 原生剥离类型
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context)
      } catch {
        // 保持原解析
      }
    }
    return nextResolve(specifier, context)
  },
})
const { toMdAst } = await import(
  new URL('../src/services/markdown/parse.ts', import.meta.url).href
)

const parse = (input) => toMdAst(input, { sources: undefined, disableLink: false })

/** 取第一个段落里的行内节点；块级节点直接展开 */
const phrasingNodes = (ast) =>
  ast.children.flatMap((block) => (block.type === 'paragraph' ? block.children : []))

/** strong 节点内纯文本，用于断言强调内容而不是只看节点类型 */
const strongTexts = (input) =>
  phrasingNodes(parse(input))
    .filter((node) => node.type === 'strong')
    .map((node) => node.children.map((child) => child.value ?? '').join(''))

const passes = []
const failures = []

function check(name, input, expected) {
  let actual
  try {
    actual = strongTexts(input)
  } catch (error) {
    failures.push(`${name}: parser threw ${error?.message ?? error}`)
    console.log(`  FAIL ${name}`)
    return
  }
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passes.push(name)
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}: ${JSON.stringify(input)} -> ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
    console.log(`  FAIL ${name}`)
    console.log(`       ${JSON.stringify(input)} -> ${JSON.stringify(actual)}`)
    console.log(`       expected ${JSON.stringify(expected)}`)
  }
}

console.log('CJK Markdown emphasis regression\n')

console.log('[1/3] 独立成段的示例')
check('引号在行首', '**“引号”**', ['“引号”'])
check('书名号在行首', '**《书名》**', ['《书名》'])
check('连续强调在行首', '**词**与**词**', ['词', '词'])

console.log('\n[2/3] 嵌入中文正文（真实消息形态）')
check('引号前有 CJK 字符', '这是**“引号”**测试', ['“引号”'])
check('书名号前有 CJK 字符', '这是**《书名》**测试', ['《书名》'])
check('引号后接中文句号', '他说**“引号”**。', ['“引号”'])
check('书名号后接 CJK 字符', '前缀**《书名》**后缀', ['《书名》'])
check('连续强调嵌入正文', '第一**词**与**词**第三', ['词', '词'])

console.log('\n[3/3] 不应误伤的控制用例')
check('普通拉丁强调', 'a **bold** b', ['bold'])
check('未闭合定界符保持文本', '这是**“未闭合”', [])

console.log(`\n${passes.length} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.error('\nCJK emphasis regression failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  console.error(
    '\n注意：修复点在 src/services/markdown/parse.ts（parser 域），不在本次 ux-dev 的文件边界内。'
  )
  process.exitCode = 1
} else {
  console.log('CJK emphasis regression passed.')
}
