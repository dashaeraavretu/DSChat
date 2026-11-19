import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RefObject } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setDraftQuote } from '../../services/chat/drafts.js'
import { createQuote, quoteText, type Quote, type QuoteRole } from '../../services/quote.js'
import styles from './QuoteSelectionBar.module.css'

/** 浮条自身宽度的一半，用于把按钮夹在视口内。 */
const HALF_WIDTH = 44
/** 选区顶部空间不足时改为显示在选区下方。 */
const ABOVE_MIN_TOP = 48

type BarState = Quote & {
  top: number
  left: number
  below: boolean
}

const elementOf = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

const messageElementOf = (node: Node) =>
  elementOf(node)?.closest<HTMLElement>('[data-quote-message-id]') ?? null

/**
 * 选中同一条消息的正文后，在选区上方显示「引用」浮条。
 * 浮条通过 portal 渲染为 fixed 元素，不参与消息列表布局；引用只写入当前草稿。
 */
export const QuoteSelectionBar = ({
  sessionId,
  containerRef,
}: {
  sessionId: string
  containerRef: RefObject<HTMLElement>
}) => {
  const t = useTranslate()
  const [bar, setBar] = useState<BarState | null>(null)
  const frameRef = useRef(0)

  const hide = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    setBar(null)
  }, [])

  const update = useCallback(() => {
    frameRef.current = 0
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setBar(null)
      return
    }
    const range = selection.getRangeAt(0)
    const start = messageElementOf(range.startContainer)
    const end = messageElementOf(range.endContainer)
    // 只允许同一条消息内部的连续选区，避免跨消息引用。
    if (!start || start !== end || !container.contains(start)) {
      setBar(null)
      return
    }
    const messageId = start.dataset.quoteMessageId
    const role = start.dataset.quoteRole
    if (!messageId || (role !== 'user' && role !== 'assistant')) {
      setBar(null)
      return
    }
    const quote = createQuote(messageId, role as QuoteRole, selection.toString())
    if (!quote) {
      setBar(null)
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setBar(null)
      return
    }
    const below = rect.top < ABOVE_MIN_TOP
    setBar({
      ...quote,
      below,
      top: below ? rect.bottom + 8 : rect.top - 8,
      left: Math.min(
        Math.max(rect.left + rect.width / 2, HALF_WIDTH + 8),
        window.innerWidth - HALF_WIDTH - 8
      ),
    })
  }, [containerRef])

  useEffect(() => {
    const schedule = () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(update)
    }
    const onPointerUp = () => schedule()
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keyup', onPointerUp)
    // 滚动或改变窗口大小后选区坐标失效，直接收起。
    window.addEventListener('resize', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      cancelAnimationFrame(frameRef.current)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keyup', onPointerUp)
      window.removeEventListener('resize', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [hide, update])

  if (!bar) {
    return null
  }

  const apply = () => {
    setDraftQuote(sessionId, { text: bar.text, messageId: bar.messageId, role: bar.role })
    window.getSelection()?.removeAllRanges()
    hide()
  }

  return createPortal(
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={quoteText(t, 'quoteAction')}
      style={{
        top: bar.top,
        left: bar.left,
        transform: bar.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      }}
      // 在指针按下时直接生效：既保持文本选区，也避免触屏在 click 前先清掉选区。
      onPointerDown={(event) => {
        event.preventDefault()
        if (event.button === 0) {
          apply()
        }
      }}
      onClick={(event) => {
        // 键盘触发的 click 没有指针按下过程，detail 为 0；指针已在 pointerdown 处理。
        if (event.detail === 0) {
          apply()
        }
      }}
    >
      <button type="button" className={styles.action}>
        {quoteText(t, 'quoteAction')}
      </button>
    </div>,
    document.body
  )
}
