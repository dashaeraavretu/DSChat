import { translate } from '../../i18n/index.js'
import { getVisibleMessages, normalizeSession } from './branches.js'
import { loadSession } from './db.js'
import { describeReply } from './describe.js'
import type { AssistantMessage, Message, Session } from './types.js'

const safeFileName = (title: string, id: string) => {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${cleaned || `chat-${id}`}.md`
}

const assistantText = (message: AssistantMessage) =>
  message.blocks
    .filter((block) => block.type === 'text' && !block.isTemplate)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n\n')
    .trim()

const assistantThinking = (message: AssistantMessage) =>
  message.blocks
    .filter((block) => block.type === 'thinking' && block.thinking.trim())
    .map((block) => (block.type === 'thinking' ? block.thinking : ''))
    .join('\n\n')
    .trim()

const citationLines = (message: AssistantMessage) => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const block of message.blocks) {
    if (block.type !== 'text') {
      continue
    }
    for (const citation of block.citations ?? []) {
      if (seen.has(citation.url)) {
        continue
      }
      seen.add(citation.url)
      lines.push(`- [${citation.title || citation.url}](${citation.url})`)
    }
  }
  return lines
}

/** 只导出当前选中的分支；用户/助手正文、附件名与引用来源转为 Markdown。 */
export const sessionToMarkdown = (session: Session): string => {
  const normalized = normalizeSession(session)
  const path = getVisibleMessages(normalized)
  const title = session.title.trim() || translate('untitledChat')
  const lines: string[] = [
    `# ${title}`,
    '',
    `> ${translate('exportMarkdownExportedAt', { time: new Date().toLocaleString() })}`,
    '',
  ]

  for (const message of path as Message[]) {
    if (message.role === 'user') {
      lines.push(`## ${translate('exportMarkdownUser')}`, '', message.content.trim())
      if (message.files.length > 0) {
        lines.push('', `**${translate('exportMarkdownAttachments')}**`)
        for (const file of message.files) {
          lines.push(`- ${file.name}`)
        }
      }
      lines.push('')
      continue
    }

    lines.push(`## ${translate('exportMarkdownAssistant')}`, '')
    const thinking = assistantThinking(message)
    if (thinking) {
      lines.push(
        '<details>',
        `<summary>${translate('exportMarkdownThinking')}</summary>`,
        '',
        thinking,
        '',
        '</details>',
        ''
      )
    }
    const text = assistantText(message)
    if (text) {
      lines.push(text, '')
    } else {
      const notice = describeReply(message)
      if (notice) {
        lines.push(`> ${notice.text}`, '')
      }
    }
    const citations = citationLines(message)
    if (citations.length > 0) {
      lines.push(`**${translate('exportMarkdownSources')}**`, '', ...citations, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** 用浏览器下载能力保存当前会话的 Markdown；Electron 走默认下载目录。 */
export const exportSessionMarkdown = async (sessionId: string): Promise<boolean> => {
  const session = await loadSession(sessionId)
  if (!session) {
    return false
  }
  const markdown = sessionToMarkdown(session)
  const fileName = safeFileName(session.title, session.id)
  const bridge = window.desktop
  if (bridge?.saveTextFile) {
    return bridge.saveTextFile({ content: markdown, defaultName: fileName })
  }
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
