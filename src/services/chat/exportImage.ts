import Prism from 'prismjs'
import type { PhrasingContent, RootContent } from 'mdast'
import { translate } from '../../i18n/index.js'
import { ensureKatex, type Katex } from '../markdown/katex.js'
import { getHighlightLang, isHighlightLoaded, loadHighlight } from '../markdown/highlight.js'
import { renderMermaid } from '../markdown/mermaid.js'
import { toMdAst } from '../markdown/parse.js'
import { getVisibleMessages, normalizeSession } from './branches.js'
import { loadSession } from './db.js'
import { describeReply } from './describe.js'
import { useChatStore } from './store.js'
import type { AssistantMessage, Message, Session } from './types.js'
import { buildReplyView } from './view.js'

/** 导出图宽度（CSS 像素）；与阅读区最大宽度接近，保证公式与表格有足够空间。 */
const IMAGE_WIDTH = 900
/** 最多按 2 倍像素密度输出，避免高分屏下图片过大。 */
const MAX_PIXEL_RATIO = 2
/** 画布单边上限；超过时缩小倍率，1 倍仍放不下则返回可读错误。 */
const MAX_CANVAS_SIDE = 16384
/** 画布总面积上限（Chromium 约 2.68 亿像素）。 */
const MAX_CANVAS_AREA = 16384 * 16384

/** 导出失败的稳定错误码；调用方用它映射提示文案，不必解析 message。 */
export type ExportImageErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'EMPTY_SESSION'
  | 'RENDER_FAILED'
  | 'CANVAS_UNAVAILABLE'
  | 'RASTERIZE_FAILED'
  | 'IMAGE_TOO_LARGE'

/** 可识别的导出错误：code 稳定，message 面向日志或兜底展示。 */
export class ExportImageError extends Error {
  readonly code: ExportImageErrorCode

  constructor(code: ExportImageErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ExportImageError'
    this.code = code
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export const isExportImageError = (error: unknown): error is ExportImageError =>
  error instanceof ExportImageError

type RenderContext = {
  katex: Katex
  dark: boolean
}

const themeIsDark = () =>
  document.body.classList.contains('dark') ||
  document.body.hasAttribute('data-ds-dark-theme') ||
  document.documentElement.style.colorScheme === 'dark'

/** 文件名去除 Windows/macOS 非法字符、控制字符和结尾的点/空格，并避开保留设备名。 */
const safeImageName = (title: string, id: string) => {
  const cleaned = Array.from(
    title
      .normalize('NFC')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
  )
    .slice(0, 80)
    .join('')
  const fallback = `chat-${id.replace(/[\\/:*?"<>|]/g, '_')}`
  const base = cleaned || fallback
  // CON、NUL、COM1 等名称在 Windows 上即使带扩展名也不能作为文件名。
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base)
  return `${reserved ? `${base}-chat` : base}.png`
}

const resolveSession = async (sessionId: string): Promise<Session | undefined> => {
  // 正在编辑/流式生成的会话以内存版本为准；临时会话也只存在内存中。
  const cached = useChatStore.getState().sessionCache[sessionId]
  return cached ?? (await loadSession(sessionId))
}

const safeLinkUrl = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined
  }
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const appendText = (parent: Node, value: string) => {
  if (!value) {
    return
  }
  // 与页面 Markdown 渲染一致：源文换行（含软换行）都变成视觉换行。
  value.split(/\r?\n/).forEach((line, index) => {
    if (index > 0) {
      parent.appendChild(document.createElement('br'))
    }
    if (line) {
      parent.appendChild(document.createTextNode(line))
    }
  })
}

const mathElement = (value: string, display: boolean, ctx: RenderContext): HTMLElement => {
  const fallback = () => {
    const element = document.createElement(display ? 'p' : 'span')
    if (display) {
      element.className = 'ds-markdown-paragraph'
    }
    element.textContent = value
    return element
  }
  try {
    // throwOnError=false 会让 KaTeX 自己输出红色的错误文本；这里保留原文更易读。
    const html = ctx.katex.renderToString(value, {
      throwOnError: true,
      strict: false,
      displayMode: display,
      trust: false,
    })
    const holder = document.createElement('span')
    holder.innerHTML = html
    const rendered = holder.firstElementChild
    return rendered instanceof HTMLElement ? rendered : fallback()
  } catch {
    return fallback()
  }
}

const renderInline = (node: PhrasingContent, ctx: RenderContext): Node => {
  switch (node.type) {
    case 'text':
      return (() => {
        const fragment = document.createDocumentFragment()
        appendText(fragment, node.value)
        return fragment
      })()
    case 'break':
      return document.createElement('br')
    case 'emphasis': {
      const element = document.createElement('em')
      for (const child of node.children) {
        element.appendChild(renderInline(child, ctx))
      }
      return element
    }
    case 'strong': {
      const element = document.createElement('strong')
      for (const child of node.children) {
        element.appendChild(renderInline(child, ctx))
      }
      return element
    }
    case 'inlineCode': {
      const element = document.createElement('code')
      element.textContent = node.value
      return element
    }
    case 'link': {
      const href = safeLinkUrl(node.url)
      if (!href) {
        const fragment = document.createDocumentFragment()
        for (const child of node.children) {
          fragment.appendChild(renderInline(child, ctx))
        }
        return fragment
      }
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      if (node.title) {
        anchor.title = node.title
      }
      for (const child of node.children) {
        anchor.appendChild(renderInline(child, ctx))
      }
      return anchor
    }
    case 'image': {
      const href = safeLinkUrl(node.url)
      if (!href) {
        return document.createTextNode(node.url)
      }
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.textContent = node.url
      return anchor
    }
    case 'html': {
      if (/^<br\s*\/?>$/i.test(node.value.trim())) {
        return document.createElement('br')
      }
      const element = document.createElement('span')
      element.className = 'ds-markdown-html'
      element.textContent = node.value
      return element
    }
    case 'inlineMath':
      return mathElement(node.value, false, ctx)
    case 'citation': {
      const element = document.createElement('span')
      element.className = 'ds-markdown-cite'
      element.textContent = String(node.source.index)
      element.title = node.source.title || node.source.url
      return element
    }
    default: {
      const value = (node as { value?: unknown }).value
      return document.createTextNode(typeof value === 'string' ? value : '')
    }
  }
}

const renderInlineNodes = (parent: Node, nodes: PhrasingContent[], ctx: RenderContext) => {
  for (const node of nodes) {
    parent.appendChild(renderInline(node, ctx))
  }
}

const codeBlockElement = async (
  code: string,
  infostring: string,
  ctx: RenderContext
): Promise<HTMLElement> => {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  banner.className = 'md-code-block-banner'
  const language = document.createElement('span')
  language.className = 'export-image-code-lang'
  language.textContent = infostring || 'text'
  banner.appendChild(language)
  block.appendChild(banner)

  if (infostring.toLowerCase() === 'mermaid') {
    let svg: string | null = null
    try {
      svg = await renderMermaid(code, ctx.dark, () => false)
    } catch {
      svg = null
    }
    if (svg) {
      const diagram = document.createElement('div')
      diagram.className = 'md-mermaid-diagram'
      diagram.innerHTML = svg
      block.appendChild(diagram)
      return block
    }
    const status = document.createElement('div')
    status.className = 'md-mermaid-status'
    status.textContent = translate('mermaidRenderFail')
    block.appendChild(status)
  }

  const lang = getHighlightLang(infostring)
  if (lang && !isHighlightLoaded(lang)) {
    try {
      await loadHighlight(lang)
    } catch {
      // 语言包下载失败时退回纯文本，不让整张图失败。
    }
  }
  const name = lang && isHighlightLoaded(lang) ? lang : 'plaintext'
  const pre = document.createElement('pre')
  try {
    pre.innerHTML = Prism.highlight(code, Prism.languages[name], name)
  } catch {
    pre.textContent = code
  }
  block.appendChild(pre)
  return block
}

const tableElement = (node: TableNode, ctx: RenderContext): HTMLElement => {
  const wrapper = document.createElement('div')
  wrapper.className = 'markdown-table-wrapper'
  const table = document.createElement('table')
  const rows = node.children
  const head = rows[0]
  if (head) {
    const thead = document.createElement('thead')
    const tr = document.createElement('tr')
    for (const cell of head.children) {
      const th = document.createElement('th')
      renderInlineNodes(th, cell.children, ctx)
      tr.appendChild(th)
    }
    thead.appendChild(tr)
    table.appendChild(thead)
  }
  if (rows.length > 1) {
    const tbody = document.createElement('tbody')
    for (const row of rows.slice(1)) {
      const tr = document.createElement('tr')
      for (const cell of row.children) {
        const td = document.createElement('td')
        renderInlineNodes(td, cell.children, ctx)
        tr.appendChild(td)
      }
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
  }
  wrapper.appendChild(table)
  return wrapper
}

type TableNode = Extract<RootContent, { type: 'table' }>

const renderBlocks = async (
  nodes: RootContent[],
  parent: Node,
  ctx: RenderContext
): Promise<void> => {
  for (const node of nodes) {
    const element = await renderBlock(node, ctx)
    if (element) {
      parent.appendChild(element)
    }
  }
}

const renderBlock = async (
  node: RootContent,
  ctx: RenderContext
): Promise<HTMLElement | null> => {
  switch (node.type) {
    case 'paragraph': {
      const paragraph = document.createElement('p')
      paragraph.className = 'ds-markdown-paragraph'
      renderInlineNodes(paragraph, node.children, ctx)
      return paragraph
    }
    case 'heading': {
      if (node.children.length === 0) {
        return null
      }
      const heading = document.createElement(`h${node.depth}`)
      renderInlineNodes(heading, node.children, ctx)
      return heading
    }
    case 'thematicBreak':
      return document.createElement('hr')
    case 'blockquote': {
      const quote = document.createElement('blockquote')
      await renderBlocks(node.children, quote, ctx)
      return quote
    }
    case 'list': {
      const list = document.createElement(node.ordered ? 'ol' : 'ul')
      if (node.ordered && node.start !== null && node.start !== undefined && list instanceof HTMLOListElement) {
        list.start = node.start
      }
      for (const item of node.children) {
        const li = document.createElement('li')
        const isTask = typeof item.checked === 'boolean'
        if (isTask) {
          li.className = 'ds-markdown-task-list-item'
          const checkbox = document.createElement('span')
          checkbox.className = 'ds-markdown-task-checkbox'
          checkbox.textContent = item.checked ? '☑  ' : '□  '
          li.appendChild(checkbox)
        }
        await renderBlocks(item.children as RootContent[], li, ctx)
        list.appendChild(li)
      }
      return list
    }
    case 'code':
      return codeBlockElement(node.value, node.lang || 'text', ctx)
    case 'html': {
      const element = document.createElement('span')
      element.className = 'ds-markdown-html'
      element.textContent = node.value
      return element
    }
    case 'table':
      return tableElement(node, ctx)
    case 'math': {
      const wrap = document.createElement('div')
      wrap.className = 'ds-markdown-math-wrap'
      wrap.appendChild(mathElement(node.value, true, ctx))
      return wrap
    }
    default:
      // 脚注、定义等已在 toMdAst 中转换成段落或文本。
      return null
  }
}

const renderMarkdown = async (
  container: HTMLElement,
  markdown: string,
  options: { sources?: ReturnType<typeof buildReplyView>['sources']; disableLink: boolean },
  ctx: RenderContext
) => {
  if (!markdown.trim()) {
    return
  }
  const ast = toMdAst(markdown, {
    sources: options.sources,
    disableLink: options.disableLink,
  })
  await renderBlocks(ast.children, container, ctx)
}

const assistantMarkdown = (view: ReturnType<typeof buildReplyView>) =>
  [
    ...view.steps.flatMap((step) => (step.type === 'text' ? [step.markdown] : [])),
    view.answer?.markdown ?? '',
  ]
    .filter((part) => part.trim())
    .join('\n\n')
    .trim()

/** 只列出正文实际引用的来源，与 Markdown 导出的来源列表保持一致。 */
const citedSources = (
  markdown: string,
  sources: ReturnType<typeof buildReplyView>['sources']
) => {
  const indexes = new Set(
    Array.from(markdown.matchAll(/\[citation:(\d+)\]/g), (match) => Number(match[1]))
  )
  return indexes.size > 0 ? sources.filter((source) => indexes.has(source.index)) : []
}

const assistantThinking = (message: AssistantMessage) =>
  message.blocks
    .filter((block) => block.type === 'thinking' && block.thinking.trim())
    .map((block) => (block.type === 'thinking' ? block.thinking : ''))
    .join('\n\n')
    .trim()

const roleLabel = (parent: HTMLElement, text: string) => {
  const label = document.createElement('div')
  label.className = 'export-image-role'
  label.textContent = text
  parent.appendChild(label)
}

const filesElement = (message: Extract<Message, { role: 'user' }>) => {
  if (message.files.length === 0) {
    return null
  }
  const files = document.createElement('div')
  files.className = 'export-image-files'
  const title = document.createElement('div')
  title.className = 'export-image-files-title'
  title.textContent = translate('exportMarkdownAttachments')
  files.appendChild(title)
  for (const file of message.files) {
    const chip = document.createElement('span')
    chip.className = 'export-image-file'
    chip.textContent = file.name
    files.appendChild(chip)
  }
  return files
}

const sourcesElement = (
  sources: ReturnType<typeof buildReplyView>['sources']
): HTMLElement | null => {
  if (sources.length === 0) {
    return null
  }
  const box = document.createElement('div')
  box.className = 'export-image-sources'
  const title = document.createElement('div')
  title.className = 'export-image-sources-title'
  title.textContent = translate('exportMarkdownSources')
  box.appendChild(title)
  const list = document.createElement('ol')
  for (const source of sources) {
    const item = document.createElement('li')
    const href = safeLinkUrl(source.url)
    const label = source.title || source.url
    if (href) {
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.title = source.url
      anchor.textContent = label
      item.appendChild(anchor)
    } else {
      item.textContent = label
    }
    list.appendChild(item)
  }
  box.appendChild(list)
  return box
}

const buildRoot = async (
  session: Session,
  messages: Message[],
  ctx: RenderContext
): Promise<HTMLElement> => {
  const root = document.createElement('div')
  root.className = `export-image-root ${ctx.dark ? 'dark' : 'light'}`
  root.setAttribute('data-export-version', '1')

  const header = document.createElement('header')
  header.className = 'export-image-header'
  const title = document.createElement('div')
  title.className = 'export-image-title'
  title.textContent = session.title.trim() || translate('untitledChat')
  const meta = document.createElement('div')
  meta.className = 'export-image-meta'
  meta.textContent = translate('exportMarkdownExportedAt', {
    time: new Date().toLocaleString(),
  })
  header.append(title, meta)
  root.appendChild(header)

  const main = document.createElement('main')
  main.className = 'export-image-main'

  for (const message of messages) {
    const section = document.createElement('section')
    section.className = `export-image-message ${message.role === 'user' ? 'export-image-user' : 'export-image-assistant'}`
    roleLabel(
      section,
      translate(message.role === 'user' ? 'exportMarkdownUser' : 'exportMarkdownAssistant')
    )

    if (message.role === 'user') {
      if (message.content) {
        const bubble = document.createElement('div')
        bubble.className = 'export-image-bubble'
        bubble.textContent = message.content
        section.appendChild(bubble)
      }
      const files = filesElement(message)
      if (files) {
        section.appendChild(files)
      }
      main.appendChild(section)
      continue
    }

    const thinking = assistantThinking(message)
    if (thinking && message.stopReason !== 'refusal') {
      const box = document.createElement('div')
      box.className = 'export-image-thinking'
      const label = document.createElement('div')
      label.className = 'export-image-thinking-title'
      label.textContent = translate('exportMarkdownThinking')
      const body = document.createElement('div')
      body.className = 'ds-markdown export-image-thinking-body'
      await renderMarkdown(body, thinking, { disableLink: true }, ctx)
      box.append(label, body)
      section.appendChild(box)
    }

    const view = buildReplyView(message, false)
    const answer = message.stopReason === 'refusal' ? '' : assistantMarkdown(view)
    if (answer) {
      const body = document.createElement('div')
      body.className = 'ds-markdown export-image-markdown'
      await renderMarkdown(body, answer, { sources: view.sources, disableLink: false }, ctx)
      section.appendChild(body)
    }

    const notice = describeReply(message)
    if (notice) {
      if (notice.presentation === 'response') {
        const body = document.createElement('div')
        body.className = 'ds-markdown export-image-markdown'
        await renderMarkdown(body, notice.text, { disableLink: false }, ctx)
        section.appendChild(body)
      } else {
        const body = document.createElement('div')
        body.className = 'export-image-notice'
        body.textContent = notice.text
        section.appendChild(body)
      }
    }

    const sources = sourcesElement(citedSources(answer, view.sources))
    if (sources) {
      section.appendChild(sources)
    }
    main.appendChild(section)
  }

  root.appendChild(main)

  const footer = document.createElement('footer')
  footer.className = 'export-image-footer'
  footer.textContent = translate('appName')
  root.appendChild(footer)

  // 把 body 上解析后的主题变量复制到导出根节点，foreignObject 内没有 body。
  const bodyStyle = getComputedStyle(document.body)
  for (let index = 0; index < bodyStyle.length; index += 1) {
    const name = bodyStyle.item(index)
    if (name.startsWith('--')) {
      root.style.setProperty(name, bodyStyle.getPropertyValue(name))
    }
  }
  return root
}

type StyleEntry = { text: string; base: string }

const collectStyleEntries = (ignored: Element | null): StyleEntry[] => {
  const entries: StyleEntry[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    if (ignored && sheet.ownerNode === ignored) {
      continue
    }
    try {
      const rules = sheet.cssRules
      const base = sheet.href || document.baseURI
      for (const rule of Array.from(rules)) {
        entries.push({ text: rule.cssText, base })
      }
    } catch {
      // file:// 或跨域样式表可能禁止读取 cssRules，此时退回计算样式内联。
    }
  }
  return entries
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read font failed'))
    reader.readAsDataURL(blob)
  })

const fontDataCache = new Map<string, Promise<string | null>>()

const fetchBlobWithXhr = (absoluteUrl: string): Promise<Blob | null> =>
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', absoluteUrl)
      xhr.responseType = 'blob'
      xhr.timeout = 3000
      xhr.onload = () => {
        const statusOk = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0
        resolve(statusOk && xhr.response instanceof Blob ? xhr.response : null)
      }
      xhr.onerror = () => resolve(null)
      xhr.ontimeout = () => resolve(null)
      xhr.onabort = () => resolve(null)
      xhr.send()
    } catch {
      resolve(null)
    }
  })

const fetchFontBlob = async (absoluteUrl: string): Promise<Blob | null> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(absoluteUrl, { signal: controller.signal })
    if (response.ok) {
      return await response.blob()
    }
  } catch {
    // file:// 下 fetch 通常不可用，下面用 XHR 再试一次。
  } finally {
    clearTimeout(timer)
  }
  return absoluteUrl.startsWith('file:') ? fetchBlobWithXhr(absoluteUrl) : null
}

const fetchFontData = async (absoluteUrl: string) => {
  const cached = fontDataCache.get(absoluteUrl)
  if (cached) {
    return cached
  }
  const task = (async () => {
    if (absoluteUrl.startsWith('data:')) {
      return absoluteUrl
    }
    const blob = await fetchFontBlob(absoluteUrl)
    return blob ? await blobToDataUrl(blob) : null
  })()
  fontDataCache.set(absoluteUrl, task)
  return task
}

/** 把 @font-face 的第一份字体数据内嵌为 data: URL；SVG 作为图片渲染时不会请求外链字体。 */
const inlineFontFaces = async (entry: StyleEntry): Promise<string> => {
  if (!entry.text.includes('@font-face')) {
    return entry.text
  }
  const faces = entry.text.match(/@font-face\s*\{[^}]*\}/g) ?? []
  let text = entry.text
  for (const face of faces) {
    const urls = Array.from(face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g))
      .map((match) => match[2])
      .filter((url): url is string => Boolean(url))
    const woff2 = urls.find((url) => url.split('?')[0].endsWith('.woff2'))
    const source = woff2 ?? urls[0]
    if (!source || source.startsWith('data:')) {
      continue
    }
    let absolute: string
    try {
      absolute = new URL(source, entry.base).href
    } catch {
      continue
    }
    const data = await fetchFontData(absolute)
    if (!data) {
      continue
    }
    const format = woff2 ? 'woff2' : ''
    const replaced = face.replace(
      /src:[^}]*/,
      `src:url("${data}")${format ? ` format("${format}")` : ''}`
    )
    text = text.replace(face, replaced)
  }
  return text
}

const EXPORT_CSS = `
.export-image-root {
  box-sizing: border-box;
  width: ${IMAGE_WIDTH}px;
  padding: 48px 48px 40px;
  background: var(--export-bg);
  color: var(--export-text);
  font-family: var(--export-font);
  font-size: 16px;
  line-height: 28px;
  overflow: visible;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.export-image-root.light {
  --export-bg: var(--dsw-alias-bg-base, #ffffff);
  --export-text: var(--dsw-alias-label-primary, #0f1115);
  --export-secondary: var(--dsw-alias-label-secondary, #61666b);
  --export-tertiary: var(--dsw-alias-label-tertiary, #81858c);
  --export-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  --export-bubble: var(--dsw-specific-bubble, #edf3fe);
  --export-code-bg: var(--dsw-alias-markdown-code-block, #f9fafb);
  --export-code-banner: var(--dsw-alias-markdown-code-block-banner, #f5f6f7);
  --export-inline-code: var(--dsw-alias-markdown-inline-code, #ebeef2);
  --export-link: var(--dsw-alias-brand-text, #3964fe);
  --export-error: var(--dsw-alias-state-error-primary, #ec1313);
  --export-citation: var(--dsw-alias-markdown-citation, #ebeef2);
  --export-font: var(
    --dsw-font-family,
    system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
  );
  --export-code-font: var(
    --ds-font-family-code,
    Menlo, Monaco, Consolas, 'Cascadia Mono', 'Liberation Mono', 'Courier New', monospace
  );
}
.export-image-root.dark {
  --export-bg: var(--dsw-alias-bg-base, #151517);
  --export-text: var(--dsw-alias-label-primary, #f9fafb);
  --export-secondary: var(--dsw-alias-label-secondary, #cfd3d6);
  --export-tertiary: var(--dsw-alias-label-tertiary, #adb2b8);
  --export-border: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  --export-bubble: var(--dsw-specific-bubble, #2c2c2e);
  --export-code-bg: var(--dsw-alias-markdown-code-block, #1b1b1c);
  --export-code-banner: var(--dsw-alias-markdown-code-block-banner, #2c2c2e);
  --export-inline-code: var(--dsw-alias-markdown-inline-code, #2c2c2e);
  --export-link: var(--dsw-alias-brand-text, #679efe);
  --export-error: var(--dsw-alias-state-error-primary, #f25a5a);
  --export-citation: var(--dsw-alias-markdown-citation, #2c2c2e);
  --export-font: var(
    --dsw-font-family,
    system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
  );
  --export-code-font: var(
    --ds-font-family-code,
    Menlo, Monaco, Consolas, 'Cascadia Mono', 'Liberation Mono', 'Courier New', monospace
  );
}
.export-image-root,
.export-image-root * {
  box-sizing: border-box;
}
.export-image-root *,
.export-image-root *::before,
.export-image-root *::after {
  animation: none !important;
  transition: none !important;
}
.export-image-header {
  padding-bottom: 24px;
  margin-bottom: 36px;
  border-bottom: 1px solid var(--export-border);
}
.export-image-title {
  font-size: 30px;
  line-height: 40px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.export-image-meta {
  margin-top: 8px;
  color: var(--export-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.export-image-message {
  margin-bottom: 34px;
}
.export-image-message:last-child {
  margin-bottom: 0;
}
.export-image-role {
  margin-bottom: 8px;
  color: var(--export-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.export-image-user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.export-image-user .export-image-role {
  text-align: right;
}
.export-image-bubble {
  max-width: 80%;
  padding: 10px 16px;
  border-radius: 18px;
  background: var(--export-bubble);
  color: var(--export-text);
  font-size: 16px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.export-image-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  max-width: 80%;
  margin-top: 8px;
}
.export-image-files-title {
  color: var(--export-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.export-image-file {
  padding: 2px 9px;
  border: 1px solid var(--export-border);
  border-radius: 999px;
  color: var(--export-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.export-image-thinking {
  margin-bottom: 16px;
  padding: 10px 14px;
  border-left: 2px solid var(--export-border);
  border-radius: 0 8px 8px 0;
  background: var(--export-code-banner);
  color: var(--export-secondary);
}
.export-image-thinking-title {
  margin-bottom: 4px;
  color: var(--export-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.export-image-thinking-body {
  font-size: 14px;
  line-height: 24px;
  color: var(--export-secondary);
}
.export-image-notice {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--export-code-banner);
  color: var(--export-error);
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.export-image-sources {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--export-border);
}
.export-image-sources-title {
  margin-bottom: 6px;
  color: var(--export-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.export-image-sources ol {
  margin: 0;
  padding-left: 22px;
}
.export-image-sources li {
  color: var(--export-secondary);
  font-size: 13px;
  line-height: 21px;
  overflow-wrap: anywhere;
}
.export-image-sources a {
  color: var(--export-link);
  text-decoration: none;
}
.export-image-footer {
  margin-top: 40px;
  padding-top: 16px;
  border-top: 1px solid var(--export-border);
  color: var(--export-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
}
.export-image-root .ds-markdown {
  color: var(--export-text);
  font-family: var(--export-font);
  font-size: 16px;
  line-height: 28px;
}
.export-image-root .ds-markdown > *:first-child {
  margin-top: 0 !important;
}
.export-image-root .ds-markdown > *:last-child {
  margin-bottom: 0 !important;
}
.export-image-root .ds-markdown h1,
.export-image-root .ds-markdown h2,
.export-image-root .ds-markdown h3 {
  margin: 32px 0 16px;
  line-height: 1.4;
}
.export-image-root .ds-markdown h1 {
  font-size: 24px;
}
.export-image-root .ds-markdown h2 {
  font-size: 22px;
}
.export-image-root .ds-markdown h3 {
  font-size: 20px;
}
.export-image-root .ds-markdown h4,
.export-image-root .ds-markdown h5,
.export-image-root .ds-markdown h6 {
  margin: 16px 0;
  font-size: 16px;
  line-height: 28px;
}
.export-image-root .ds-markdown h4 {
  font-weight: 600;
}
.export-image-root .ds-markdown h5,
.export-image-root .ds-markdown h6 {
  font-weight: 600;
}
.export-image-root .ds-markdown p {
  margin: 16px 0;
}
.export-image-root .ds-markdown ul,
.export-image-root .ds-markdown ol {
  margin: 16px 0;
  padding-left: 22px;
}
.export-image-root .ds-markdown li {
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.export-image-root .ds-markdown ul > .ds-markdown-task-list-item {
  list-style: none;
}
.export-image-root .ds-markdown .ds-markdown-task-checkbox {
  margin-left: -18px;
  color: var(--export-secondary);
}
.export-image-root .ds-markdown blockquote {
  margin: 16px 0;
  padding-left: 14px;
  border-left: 2px solid var(--export-tertiary);
  color: var(--export-secondary);
}
.export-image-root .ds-markdown hr {
  height: 1px;
  margin: 32px 0;
  border: none;
  background: var(--export-border);
}
.export-image-root .ds-markdown a {
  color: var(--export-link);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.export-image-root .ds-markdown .ds-markdown-html {
  font-family: var(--export-code-font);
}
.export-image-root .ds-markdown code {
  padding: 0 5px;
  border-radius: 6px;
  background: var(--export-inline-code);
  font-family: var(--export-code-font);
  font-size: 0.875em;
}
.export-image-root .ds-markdown .markdown-table-wrapper {
  margin: 16px 0;
  overflow: visible;
}
.export-image-root .ds-markdown table {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}
.export-image-root .ds-markdown th,
.export-image-root .ds-markdown td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--export-border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.export-image-root .ds-markdown th {
  border-top: 1px solid var(--export-border);
  font-weight: 600;
}
.export-image-root .ds-markdown .md-code-block {
  margin: 16px 0;
  border-radius: 12px;
  background: var(--export-code-bg);
  color: var(--export-text);
  overflow: hidden;
}
.export-image-root .ds-markdown .md-code-block-banner {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 4px 14px;
  background: var(--export-code-banner);
}
.export-image-code-lang {
  color: var(--export-secondary);
  font-family: var(--export-code-font);
  font-size: 12px;
  line-height: 18px;
}
.export-image-root .ds-markdown .md-code-block > pre {
  margin: 0;
  padding: 16px;
  font-family: var(--export-code-font);
  font-size: 13px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}
.export-image-root .md-mermaid-diagram {
  padding: 16px;
  text-align: center;
  overflow: visible;
}
.export-image-root .md-mermaid-diagram svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.export-image-root .md-mermaid-status {
  padding: 18px;
  color: var(--export-secondary);
  font-size: 14px;
  text-align: center;
}
.export-image-root .ds-markdown-math-wrap {
  display: block;
  margin: 16px 0;
}
.export-image-root .ds-markdown-math-wrap .katex-display {
  margin: 0;
  padding: 4px 0;
  overflow: visible;
  text-align: center;
}
.export-image-root .ds-markdown-cite {
  position: relative;
  top: -5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  margin: 0 2px;
  padding: 0 4px;
  border-radius: 6px 6px 6px 0;
  background: var(--export-citation);
  color: var(--export-tertiary);
  font-family: var(--export-code-font);
  font-size: 9px;
  font-weight: 500;
  line-height: 14px;
}
.export-image-root.light .md-code-block .token.comment,
.export-image-root.light .md-code-block .token.prolog,
.export-image-root.light .md-code-block .token.cdata {
  color: #9b9ea3;
}
.export-image-root.light .md-code-block .token.doctype,
.export-image-root.light .md-code-block .token.punctuation,
.export-image-root.light .md-code-block .token.entity {
  color: #383d46;
}
.export-image-root.light .md-code-block .token.attr-name,
.export-image-root.light .md-code-block .token.class-name,
.export-image-root.light .md-code-block .token.boolean,
.export-image-root.light .md-code-block .token.constant,
.export-image-root.light .md-code-block .token.number,
.export-image-root.light .md-code-block .token.atrule {
  color: #b26b00;
}
.export-image-root.light .md-code-block .token.keyword {
  color: #a626a4;
}
.export-image-root.light .md-code-block .token.property,
.export-image-root.light .md-code-block .token.tag,
.export-image-root.light .md-code-block .token.symbol,
.export-image-root.light .md-code-block .token.deleted,
.export-image-root.light .md-code-block .token.important {
  color: #e45649;
}
.export-image-root.light .md-code-block .token.selector,
.export-image-root.light .md-code-block .token.string,
.export-image-root.light .md-code-block .token.char,
.export-image-root.light .md-code-block .token.builtin,
.export-image-root.light .md-code-block .token.inserted,
.export-image-root.light .md-code-block .token.regex,
.export-image-root.light .md-code-block .token.attr-value {
  color: #4f8f4f;
}
.export-image-root.light .md-code-block .token.variable,
.export-image-root.light .md-code-block .token.operator,
.export-image-root.light .md-code-block .token.function {
  color: #3b78e7;
}
.export-image-root.light .md-code-block .token.url {
  color: #0087b8;
}
.export-image-root.dark .md-code-block .token.comment,
.export-image-root.dark .md-code-block .token.prolog,
.export-image-root.dark .md-code-block .token.doctype,
.export-image-root.dark .md-code-block .token.cdata {
  color: #8da1b9;
}
.export-image-root.dark .md-code-block .token.punctuation {
  color: #e3eaf2;
}
.export-image-root.dark .md-code-block .token.tag,
.export-image-root.dark .md-code-block .token.tag .token.punctuation {
  color: #66cccc;
}
.export-image-root.dark .md-code-block .token.attr-name,
.export-image-root.dark .md-code-block .token.boolean,
.export-image-root.dark .md-code-block .token.number,
.export-image-root.dark .md-code-block .token.constant {
  color: #e6d37a;
}
.export-image-root.dark .md-code-block .token.class-name,
.export-image-root.dark .md-code-block .token.property,
.export-image-root.dark .md-code-block .token.variable {
  color: #6cb8e6;
}
.export-image-root.dark .md-code-block .token.attr-value,
.export-image-root.dark .md-code-block .token.inserted,
.export-image-root.dark .md-code-block .token.string {
  color: #91d076;
}
.export-image-root.dark .md-code-block .token.builtin,
.export-image-root.dark .md-code-block .token.regex {
  color: #f4adf4;
}
.export-image-root.dark .md-code-block .token.function {
  color: #c699e3;
}
.export-image-root.dark .md-code-block .token.keyword,
.export-image-root.dark .md-code-block .token.operator,
.export-image-root.dark .md-code-block .token.selector {
  color: #e9ae7e;
}
.export-image-root.dark .md-code-block .token.deleted,
.export-image-root.dark .md-code-block .token.important {
  color: #cd6660;
}
.export-image-root .md-code-block .token.bold {
  font-weight: 700;
}
.export-image-root .md-code-block .token.italic {
  font-style: italic;
}
`

/** cssRules 不可读时的兜底：把布局相关的计算样式直接写到克隆节点上。 */
const COMPUTED_STYLE_PROPERTIES = [
  'display',
  'position',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'background-color',
  'background-image',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-underline-offset',
  'white-space',
  'word-break',
  'overflow-wrap',
  'vertical-align',
  'list-style-type',
  'list-style-position',
  'table-layout',
  'border-collapse',
  'border-spacing',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'order',
  'opacity',
  'visibility',
  'overflow-x',
  'overflow-y',
  'transform',
  'transform-origin',
  'box-shadow',
  'text-shadow',
  'fill',
  'stroke',
  'stroke-width',
]

const inlineComputedStyles = (source: Element, target: Element) => {
  const computed = getComputedStyle(source)
  const targetStyle = (target as Element & { style?: CSSStyleDeclaration }).style
  if (targetStyle) {
    for (const property of COMPUTED_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value) {
        targetStyle.setProperty(property, value)
      }
    }
  }
  const sourceChildren = Array.from(source.children)
  const targetChildren = Array.from(target.children)
  for (let index = 0; index < sourceChildren.length; index += 1) {
    const sourceChild = sourceChildren[index]
    const targetChild = targetChildren[index]
    if (sourceChild && targetChild) {
      inlineComputedStyles(sourceChild, targetChild)
    }
  }
}

const createCssBundle = async (
  ignored: Element | null
): Promise<{ css: string; hasDocumentStyles: boolean }> => {
  const entries = collectStyleEntries(ignored)
  const processed = await Promise.all(entries.map(inlineFontFaces))
  let css = processed.join('\n')
  if (css) {
    // 主题/highlight 规则里以 body 为前缀的选择器在 foreignObject 中没有 body。
    css = css
      .replace(/body\.dark\b/g, '.export-image-root.dark')
      .replace(/body\.light\b/g, '.export-image-root.light')
  }
  return {
    css: `${css}\n${EXPORT_CSS}`,
    // 用 KaTeX 自己的类名判断样式表是否可读；EXPORT_CSS 里的简化规则不能代替它。
    hasDocumentStyles: css.includes('.ds-markdown') && css.includes('.katex-mathml'),
  }
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    } else {
      setTimeout(resolve, 0)
    }
  })

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new ExportImageError('RASTERIZE_FAILED', 'Canvas produced an empty PNG.'))
        }
      }, 'image/png')
      return
    }
    try {
      const data = canvas.toDataURL('image/png')
      const binary = atob(data.slice(data.indexOf(',') + 1))
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch (error) {
      reject(
        new ExportImageError('RASTERIZE_FAILED', 'Failed to encode the rendered image.', error)
      )
    }
  })

const rasterize = async (
  root: HTMLElement,
  css: string,
  hasDocumentStyles: boolean,
  width: number,
  height: number
): Promise<Blob> => {
  const clone = root.cloneNode(true) as HTMLElement
  clone.style.width = `${width}px`
  if (!hasDocumentStyles) {
    inlineComputedStyles(root, clone)
  }
  const style = document.createElement('style')
  style.textContent = css
  clone.prepend(style)

  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject></svg>`
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  // 必须使用 data: URL：同源 blob URL 在 Chromium 中配合 foreignObject 会污染 canvas，
  // 导致 toBlob/toDataURL 抛 SecurityError。data: URL 不会污染画布。
  let dataUrl: string
  try {
    dataUrl = await blobToDataUrl(svgBlob)
  } catch (error) {
    throw new ExportImageError('RASTERIZE_FAILED', 'Failed to encode the SVG image.', error)
  }
  const image = new Image()
  image.decoding = 'sync'
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () =>
      reject(
        new ExportImageError(
          'RASTERIZE_FAILED',
          'The browser could not rasterize the session image.'
        )
      )
  })
  image.src = dataUrl
  await loaded

  const maxBySide = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height)
  const maxByArea = Math.sqrt(MAX_CANVAS_AREA / (width * height))
  const scale = Math.max(
    1,
    Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1, maxBySide, maxByArea)
  )
  if (height * scale > MAX_CANVAS_SIDE || width * scale > MAX_CANVAS_SIDE) {
    throw new ExportImageError(
      'IMAGE_TOO_LARGE',
      `Session image is too tall to export (${Math.ceil(height)}px).`
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new ExportImageError('CANVAS_UNAVAILABLE', 'Canvas 2D context is unavailable.')
  }
  const background = getComputedStyle(root).backgroundColor
  context.fillStyle =
    background && background !== 'rgba(0, 0, 0, 0)' ? background : themeIsDark() ? '#151517' : '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return await canvasToBlob(canvas)
}

/**
 * 把会话当前选中的分支离屏渲染为 PNG。
 *
 * - 只使用本地数据与本地渲染器（KaTeX、Prism、Mermaid），不请求服务端。
 * - 失败时抛出带稳定 code 的 ExportImageError。
 * - 返回的 name 已去除文件系统非法字符，blob 的 MIME 为 image/png。
 */
export const exportSessionImage = async (
  sessionId: string
): Promise<{ name: string; blob: Blob }> => {
  const session = await resolveSession(sessionId)
  if (!session) {
    throw new ExportImageError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`)
  }
  const messages = getVisibleMessages(normalizeSession(session))
  if (messages.length === 0) {
    throw new ExportImageError('EMPTY_SESSION', 'The session has no visible messages to export.')
  }

  let host: HTMLDivElement | null = null
  let hostStyle: HTMLStyleElement | null = null
  try {
    if (!document.body) {
      throw new ExportImageError('RENDER_FAILED', 'Document body is unavailable.')
    }
    const katex = await ensureKatex()
    const root = await buildRoot(
      session,
      messages,
      { katex, dark: themeIsDark() }
    )

    host = document.createElement('div')
    host.className = 'ds-export-image-host'
    host.setAttribute('aria-hidden', 'true')
    Object.assign(host.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: `${IMAGE_WIDTH}px`,
      pointerEvents: 'none',
      zIndex: '-1',
      background: 'transparent',
    })
    hostStyle = document.createElement('style')
    hostStyle.setAttribute('data-export-image-style', '')
    // 隐藏 DOM 必须和最终 SVG 使用同一套导出样式，否则高度与降级内联都会失真。
    hostStyle.textContent = `${EXPORT_CSS}\n.ds-export-image-host,.ds-export-image-host *{animation:none!important;transition:none!important}`
    document.head.appendChild(hostStyle)
    document.body.appendChild(host)
    host.appendChild(root)

    if (document.fonts) {
      await document.fonts.ready
    }
    await nextFrame()

    const rect = root.getBoundingClientRect()
    const width = Math.max(1, Math.ceil(rect.width))
    const height = Math.max(1, Math.ceil(root.scrollHeight || rect.height))
    if (height > MAX_CANVAS_SIDE) {
      throw new ExportImageError(
        'IMAGE_TOO_LARGE',
        `Session image is too tall to export (${height}px).`
      )
    }

    const { css, hasDocumentStyles } = await createCssBundle(hostStyle)
    const blob = await rasterize(root, css, hasDocumentStyles, width, height)
    return { name: safeImageName(session.title, session.id), blob }
  } catch (error) {
    if (error instanceof ExportImageError) {
      throw error
    }
    throw new ExportImageError('RENDER_FAILED', 'Failed to render the session image.', error)
  } finally {
    host?.remove()
    hostStyle?.remove()
  }
}

/** 触发浏览器下载；Electron 会保存到默认下载目录。菜单接入方负责提示结果。 */
export const downloadImageBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 渲染并下载，返回实际文件名，便于调用方展示提示。 */
export const downloadSessionImage = async (sessionId: string): Promise<string> => {
  const { name, blob } = await exportSessionImage(sessionId)
  downloadImageBlob(blob, name)
  return name
}
