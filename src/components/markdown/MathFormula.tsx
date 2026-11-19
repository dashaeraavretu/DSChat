import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'
import { IconCopyOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult = {
  html: string
  renderMode: 'katex' | 'fallback'
}

const noop = () => {}

/** KaTeX 渲染公式；出错时保留上次成功的结果（流式中公式未写完），没有则展示原文 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult => {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    if (!katex) {
      return { html: input, renderMode: 'fallback' }
    }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
      const html = katex
        .renderToString(input, { throwOnError: true, strict: false, displayMode: !isInline })
        .slice(prefix.length, -suffix.length)
      const result = { html, renderMode: 'katex' } as const
      previousResultRef.current = result
      return result
    } catch {
      return previousResultRef.current ?? { html: input, renderMode: 'fallback' }
    }
  }, [input, isInline, katex])
}

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const t = useTranslate()
  const { html, renderMode } = useMathHtml(value, false)
  if (renderMode === 'fallback') {
    return <p className="ds-markdown-paragraph">{html}</p>
  }
  const copy = async () => {
    // copyText 内部处理 clipboard 不可用与权限失败，并回退到 execCommand。
    const copied = await copyText(value)
    showToast({ key: copied ? 'formulaCopied' : 'copyFailed' })
  }
  return (
    <span className="ds-markdown-math-wrap">
      <span className="katex-display ds-markdown-math">
        <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
      </span>
      <button
        type="button"
        className="ds-math-copy"
        aria-label={t('copyFormula')}
        title={t('copyFormula')}
        onClick={(event) => {
          // 复制按钮不参与消息/公式所在区域的其他点击行为。
          event.stopPropagation()
          void copy()
        }}
      >
        <IconCopyOutline16 />
      </button>
    </span>
  )
})

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const { html, renderMode } = useMathHtml(value, true)
  if (renderMode === 'fallback') {
    return html
  }
  return <span className="katex" dangerouslySetInnerHTML={{ __html: html }}></span>
})
