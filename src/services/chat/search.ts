import { loadAllSessions } from './db.js'
import { toSessionSummary, type Message, type SessionSummary } from './types.js'

export type SessionSearchResult = {
  session: SessionSummary
  /** 标题或正文命中位置附近的片段 */
  snippet: string
  field: 'title' | 'body'
}

const MAX_RESULTS = 50
const SNIPPET_RADIUS = 40

const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
}

const snippetAround = (text: string, index: number, length: number) => {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

/**
 * 会话搜索：标题与所有消息正文（用户文本 + 助手正文块）。
 * 只返回有命中的会话；正文取最后一条命中的消息作为片段。
 */
export const searchSessions = async (query: string): Promise<SessionSearchResult[]> => {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return []
  }
  const sessions = (await loadAllSessions()).sort((a, b) => b.updatedAt - a.updatedAt)
  const results: SessionSearchResult[] = []

  for (const session of sessions) {
    if (session.title.toLocaleLowerCase().includes(needle)) {
      results.push({
        session: toSessionSummary(session),
        snippet: session.title,
        field: 'title',
      })
    } else {
      let match: { text: string; index: number } | null = null
      for (let index = session.messages.length - 1; index >= 0; index -= 1) {
        const text = messageText(session.messages[index])
        const hit = text.toLocaleLowerCase().indexOf(needle)
        if (hit !== -1) {
          match = { text, index: hit }
          break
        }
      }
      if (match) {
        results.push({
          session: toSessionSummary(session),
          snippet: snippetAround(match.text, match.index, needle.length),
          field: 'body',
        })
      }
    }
    if (results.length >= MAX_RESULTS) {
      break
    }
  }

  return results
}
