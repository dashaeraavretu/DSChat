import type { FileBlockParam, MessageParam, TextBlockParam } from './api/types.js'
import { isTranslationKey, type TranslationKey } from '../i18n/index.js'

/** 引用来源消息的角色，仅用于标识，不改变消息树。 */
export type QuoteRole = 'user' | 'assistant'

/**
 * 下一条消息附带的引用：只在草稿与本次请求里存在，不写入消息树，
 * 因此不会新增消息节点或分支。
 */
export type Quote = {
  /** 选中的正文，已去掉首尾空白并规整换行 */
  text: string
  /** 来源消息 id，防止跨消息引用 */
  messageId: string
  role: QuoteRole
}

/** 引用功能使用、由集成者补充的 i18n key。 */
export type QuoteTextKey = 'quoteAction' | 'quoteRemove' | 'quoteSource'

/** i18n 尚未补 key 时的兜底文案；补入后 quoteText 自动使用翻译。 */
const QUOTE_FALLBACKS: Record<QuoteTextKey, string> = {
  quoteAction: '引用',
  quoteRemove: '取消引用',
  quoteSource: '引用内容',
}

/**
 * 调用方传入当前语言的 t；i18n key 由集成者补充，缺失时回退到中文，
 * 避免运行时读取 undefined。三个 key 都保留显式的 t('...') 调用。
 */
export const quoteText = (
  t: (key: TranslationKey) => string,
  key: QuoteTextKey
): string => {
  // 集成前 key 还不在 TranslationKey 中，运行时由 isTranslationKey 保护。
  switch (key) {
    case 'quoteAction':
      return isTranslationKey('quoteAction')
        ? t('quoteAction' as TranslationKey)
        : QUOTE_FALLBACKS.quoteAction
    case 'quoteRemove':
      return isTranslationKey('quoteRemove')
        ? t('quoteRemove' as TranslationKey)
        : QUOTE_FALLBACKS.quoteRemove
    case 'quoteSource':
      return isTranslationKey('quoteSource')
        ? t('quoteSource' as TranslationKey)
        : QUOTE_FALLBACKS.quoteSource
  }
}

/** 统一换行、去掉首尾空白，最多保留一个空行；选中内容为空时返回空字符串。 */
export const normalizeQuoteText = (value: string) =>
  value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

export const createQuote = (messageId: string, role: QuoteRole, value: string): Quote | null => {
  const text = normalizeQuoteText(value)
  return text ? { text, messageId, role } : null
}

/** 引用在请求里以 Markdown 引用块呈现，模型能识别为上下文，而消息气泡里不显示。 */
export const formatQuoteContext = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

/** 有文本块时把引用并进最后一个文本块，附件顺序保持不变；纯附件提问补一个文本块。 */
const withQuotedBlocks = (
  content: (FileBlockParam | TextBlockParam)[],
  quoted: string
): (FileBlockParam | TextBlockParam)[] => {
  const blocks = [...content]
  const last = blocks.at(-1)
  if (last?.type === 'text') {
    blocks[blocks.length - 1] = {
      type: 'text',
      text: last.text ? `${quoted}\n\n${last.text}` : quoted,
    }
    return blocks
  }
  blocks.push({ type: 'text', text: quoted })
  return blocks
}

/**
 * 只改写本次请求快照里的最后一条 user 消息（本轮提问）；会话中保存的消息、
 * 历史轮次和分支结构都不变。重新生成/重试等未携带 quote 的请求原样返回。
 */
export const withQuote = (messages: MessageParam[], quote: Quote): MessageParam[] => {
  const index = messages.findLastIndex((message) => message.role === 'user')
  const message = messages[index]
  if (message?.role !== 'user') {
    return messages
  }
  const quoted = formatQuoteContext(quote.text)
  const content =
    typeof message.content === 'string'
      ? [quoted, message.content].filter(Boolean).join('\n\n')
      : withQuotedBlocks(message.content, quoted)
  const next = [...messages]
  next[index] = { role: 'user', content }
  return next
}
