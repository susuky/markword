import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

const md = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value
    return highlighted
  },
})

function annotateSourceLines(tokens: Token[]) {
  for (const token of tokens) {
    if (token.map && (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block')) {
      token.attrSet('data-source-line', String(token.map[0] + 1))
      token.attrSet('data-source-end-line', String(token.map[1]))
    }
    if (token.children) annotateSourceLines(token.children)
  }
}

const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules)
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0]
  const line = token.map ? token.map[0] + 1 : 1
  const endLine = token.map ? token.map[1] : line

  if (language.toLowerCase() === 'mermaid') {
    const source = md.utils.escapeHtml(token.content)
    return `<div class="mermaid-block" data-mermaid-source="${encodeURIComponent(token.content)}" data-source-line="${line}" data-source-end-line="${endLine}"><div class="mermaid-loading">正在繪製圖表…</div><pre class="mermaid-fallback"><code>${source}</code></pre></div>`
  }

  const rendered = defaultFence(tokens, index, options, env, self)
  return rendered.replace('<pre>', `<pre data-source-line="${line}" data-source-end-line="${endLine}"><button class="copy-code" type="button" aria-label="複製程式碼">複製</button>`)
}

export function renderMarkdown(source: string) {
  const tokens = md.parse(source, {})
  annotateSourceLines(tokens)
  const html = md.renderer.render(tokens, md.options, {})
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-source-line', 'data-source-end-line', 'data-mermaid-source'],
    ADD_TAGS: ['button'],
  })
}

export interface SourceAnchor {
  element: HTMLElement
  line: number
  top: number
}

export function collectSourceAnchors(root: HTMLElement): SourceAnchor[] {
  const seen = new Set<number>()
  const anchors: SourceAnchor[] = []
  const scrollContainer = root.closest<HTMLElement>('.preview-scroll') ?? root.parentElement
  const scrollRect = scrollContainer?.getBoundingClientRect()
  const scrollTop = scrollContainer?.scrollTop ?? 0
  root.querySelectorAll<HTMLElement>('[data-source-line]').forEach((element) => {
    const line = Number(element.dataset.sourceLine)
    if (!Number.isFinite(line) || seen.has(line)) return
    seen.add(line)
    const elementRect = element.getBoundingClientRect()
    const top = scrollRect
      ? elementRect.top - scrollRect.top + scrollTop
      : elementRect.top - root.getBoundingClientRect().top
    anchors.push({ element, line, top })
  })
  return anchors.sort((a, b) => a.line - b.line || a.top - b.top)
}

export function lineToPreviewOffset(line: number, anchors: SourceAnchor[], maxScroll: number) {
  if (!anchors.length) return 0
  if (line <= anchors[0].line) return 0
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1]
    const next = anchors[index]
    if (line <= next.line) {
      const span = Math.max(1, next.line - previous.line)
      const progress = (line - previous.line) / span
      return Math.min(maxScroll, previous.top + progress * (next.top - previous.top))
    }
  }
  return maxScroll
}

export function previewOffsetToLine(offset: number, anchors: SourceAnchor[], lastLine: number, maxScroll: number) {
  if (!anchors.length || offset <= anchors[0].top) return 1
  if (maxScroll > 0 && offset >= maxScroll - 2) return lastLine
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1]
    const next = anchors[index]
    if (offset <= next.top) {
      const span = Math.max(1, next.top - previous.top)
      const progress = (offset - previous.top) / span
      return previous.line + progress * (next.line - previous.line)
    }
  }
  return lastLine
}
