import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'
import type Token from 'markdown-it/lib/token.mjs'

interface FootnoteDefinition {
  id: string
  content: string
  startLine: number
  endLine: number
}

interface MarkdownEnvironment {
  footnotes: Map<string, FootnoteDefinition>
  footnoteOrder: string[]
  footnoteReferenceCounts: Map<string, number>
}

const md = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    return language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value
  },
})

md.enable('table')

function slugifyHeading(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'
}

md.core.ruler.push('markword_heading_anchors', (state) => {
  const slugs = new Map<string, number>()
  for (let index = 0; index < state.tokens.length - 1; index += 1) {
    const opening = state.tokens[index]
    const inline = state.tokens[index + 1]
    if (opening.type !== 'heading_open' || inline.type !== 'inline') continue
    const base = slugifyHeading(inline.content)
    const occurrence = slugs.get(base) ?? 0
    slugs.set(base, occurrence + 1)
    opening.attrSet('id', occurrence ? `${base}-${occurrence + 1}` : base)
    opening.attrJoin('class', 'heading-anchor')
  }
})

md.core.ruler.push('markword_task_lists', (state) => {
  for (let index = 2; index < state.tokens.length; index += 1) {
    const inline = state.tokens[index]
    if (inline.type !== 'inline' || state.tokens[index - 1].type !== 'paragraph_open') continue
    const itemOpen = state.tokens[index - 2]
    if (itemOpen.type !== 'list_item_open') continue
    const text = inline.children?.find((child) => child.type === 'text')
    const match = text?.content.match(/^\[([ xX])\]\s+/)
    if (!text || !match) continue
    text.content = text.content.slice(match[0].length)
    const checkbox = new state.Token('task_checkbox', '', 0)
    checkbox.meta = { checked: match[1].toLowerCase() === 'x' }
    inline.children!.unshift(checkbox)
    itemOpen.attrJoin('class', 'task-list-item')
    for (let parentIndex = index - 3; parentIndex >= 0; parentIndex -= 1) {
      if (state.tokens[parentIndex].type === 'bullet_list_open') {
        state.tokens[parentIndex].attrJoin('class', 'task-list')
        break
      }
      if (state.tokens[parentIndex].type === 'bullet_list_close') break
    }
  }
})

md.renderer.rules.task_checkbox = (tokens, index) => {
  const checked = Boolean(tokens[index].meta?.checked)
  return `<input class="task-list-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? '已完成' : '未完成'}">`
}

function footnoteReferenceRule(state: StateInline, silent: boolean) {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5e) return false
  const end = state.src.indexOf(']', state.pos + 2)
  if (end < 0) return false
  const id = state.src.slice(state.pos + 2, end)
  const env = state.env as MarkdownEnvironment
  if (!id || !env.footnotes.has(id)) return false
  if (!silent) {
    const count = (env.footnoteReferenceCounts.get(id) ?? 0) + 1
    env.footnoteReferenceCounts.set(id, count)
    if (!env.footnoteOrder.includes(id)) env.footnoteOrder.push(id)
    const token = state.push('footnote_ref', '', 0)
    token.meta = { id, count, number: env.footnoteOrder.indexOf(id) + 1 }
  }
  state.pos = end + 1
  return true
}

md.inline.ruler.before('emphasis', 'markword_footnote_ref', footnoteReferenceRule)
md.renderer.rules.footnote_ref = (tokens, index) => {
  const { id, count, number } = tokens[index].meta as { id: string; count: number; number: number }
  const safeId = md.utils.escapeHtml(id)
  return `<sup class="footnote-ref"><a href="#fn-${safeId}" id="fnref-${safeId}-${count}">${number}</a></sup>`
}

function mathInlineRule(state: StateInline, silent: boolean) {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false
  const end = state.src.indexOf('$', state.pos + 1)
  if (end <= state.pos + 1 || state.src[end - 1] === '\\') return false
  if (!silent) {
    const token = state.push('math_inline', '', 0)
    token.content = state.src.slice(state.pos + 1, end)
  }
  state.pos = end + 1
  return true
}

md.inline.ruler.after('escape', 'markword_math_inline', mathInlineRule)
md.renderer.rules.math_inline = (tokens, index) => {
  const source = tokens[index].content
  return `<span class="math-inline dynamic-source-block" data-math-source="${encodeURIComponent(source)}" data-math-display="false">${md.utils.escapeHtml(source)}</span>`
}

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const maximum = state.eMarks[startLine]
  const firstLine = state.src.slice(start, maximum).trim()
  if (!firstLine.startsWith('$$')) return false
  if (silent) return true

  let nextLine = startLine
  const content: string[] = []
  const openingRemainder = firstLine.slice(2)
  if (openingRemainder.endsWith('$$')) {
    content.push(openingRemainder.slice(0, -2))
  } else {
    if (openingRemainder) content.push(openingRemainder)
    for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
      const lineEnd = state.eMarks[nextLine]
      const line = state.src.slice(lineStart, lineEnd)
      const closing = line.lastIndexOf('$$')
      if (closing >= 0) {
        content.push(line.slice(0, closing))
        break
      }
      content.push(line)
    }
  }

  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = content.join('\n').trim()
  token.map = [startLine, Math.min(endLine, nextLine + 1)]
  state.line = Math.min(endLine, nextLine + 1)
  return true
}

md.block.ruler.before('fence', 'markword_math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
md.renderer.rules.math_block = (tokens, index) => {
  const token = tokens[index]
  const startLine = token.map ? token.map[0] + 1 : 1
  const endLine = token.map ? Math.max(startLine, token.map[1]) : startLine
  return `<div class="math-block dynamic-source-block" data-math-source="${encodeURIComponent(token.content)}" data-math-display="true" data-source-start="${startLine}" data-source-end="${endLine}">${md.utils.escapeHtml(token.content)}</div>`
}

function extractFootnotes(source: string): { source: string; definitions: Map<string, FootnoteDefinition> } {
  const lines = source.split('\n')
  const definitions = new Map<string, FootnoteDefinition>()
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[\^([^\]]+)\]:\s*(.*)$/)
    if (!match) continue
    const start = index
    const content = [match[2]]
    let end = index
    while (end + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[end + 1])) {
      end += 1
      content.push(lines[end].replace(/^(?: {2,}|\t)/, ''))
    }
    definitions.set(match[1], {
      id: match[1],
      content: content.join('\n'),
      startLine: start + 1,
      endLine: end + 1,
    })
    for (let clear = start; clear <= end; clear += 1) lines[clear] = ''
    index = end
  }
  return { source: lines.join('\n'), definitions }
}

function annotateSourceRanges(tokens: Token[]) {
  for (const token of tokens) {
    if (token.map && (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block')) {
      token.attrSet('data-source-start', String(token.map[0] + 1))
      token.attrSet('data-source-end', String(Math.max(token.map[0] + 1, token.map[1])))
    }
    if (token.children) annotateSourceRanges(token.children)
  }
}

const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules)
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0]
  const startLine = token.map ? token.map[0] + 1 : 1
  const endLine = token.map ? Math.max(startLine, token.map[1]) : startLine

  if (language.toLowerCase() === 'mermaid') {
    const source = md.utils.escapeHtml(token.content)
    return `<div class="mermaid-block dynamic-source-block" data-mermaid-source="${encodeURIComponent(token.content)}" data-source-start="${startLine}" data-source-end="${endLine}"><div class="mermaid-loading">正在繪製圖表…</div><pre class="mermaid-fallback"><code>${source}</code></pre></div>`
  }

  const rendered = defaultFence(tokens, index, options, env, self)
  return rendered.replace('<pre>', `<pre data-source-start="${startLine}" data-source-end="${endLine}"><button class="copy-code" type="button" aria-label="複製程式碼">複製</button>`)
}

function renderFootnotes(env: MarkdownEnvironment) {
  if (!env.footnoteOrder.length) return ''
  const items = env.footnoteOrder.map((id) => {
    const definition = env.footnotes.get(id)!
    const safeId = md.utils.escapeHtml(id)
    const references = env.footnoteReferenceCounts.get(id) ?? 1
    const backlinks = Array.from({ length: references }, (_, index) =>
      `<a class="footnote-backref" href="#fnref-${safeId}-${index + 1}" aria-label="回到註腳引用">↩</a>`,
    ).join(' ')
    return `<li id="fn-${safeId}" data-source-start="${definition.startLine}" data-source-end="${definition.endLine}">${md.renderInline(definition.content, env)} ${backlinks}</li>`
  }).join('')
  return `<section class="footnotes"><hr><ol>${items}</ol></section>`
}

export function renderMarkdown(source: string) {
  const extracted = extractFootnotes(source)
  const env: MarkdownEnvironment = {
    footnotes: extracted.definitions,
    footnoteOrder: [],
    footnoteReferenceCounts: new Map(),
  }
  const tokens = md.parse(extracted.source, env)
  annotateSourceRanges(tokens)
  const html = md.renderer.render(tokens, md.options, env) + renderFootnotes(env)
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-source-start', 'data-source-end', 'data-mermaid-source', 'data-math-source', 'data-math-display', 'checked', 'disabled'],
    ADD_TAGS: ['button', 'input'],
  })
}

export interface SourceAnchor {
  element: HTMLElement
  startLine: number
  endLine: number
  top: number
  bottom: number
}

export function collectSourceAnchors(root: HTMLElement): SourceAnchor[] {
  const anchors: SourceAnchor[] = []
  const scrollContainer = root.closest<HTMLElement>('.preview-scroll') ?? root.parentElement
  const scrollRect = scrollContainer?.getBoundingClientRect()
  const scrollTop = scrollContainer?.scrollTop ?? 0
  root.querySelectorAll<HTMLElement>('[data-source-start]').forEach((element) => {
    const startLine = Number(element.dataset.sourceStart)
    const endLine = Math.max(startLine, Number(element.dataset.sourceEnd) || startLine)
    if (!Number.isFinite(startLine)) return
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return
    const top = scrollRect ? rect.top - scrollRect.top + scrollTop : rect.top - root.getBoundingClientRect().top
    anchors.push({ element, startLine, endLine, top, bottom: top + rect.height })
  })
  return anchors
    .sort((a, b) => a.top - b.top || a.startLine - b.startLine || b.bottom - a.bottom)
    .filter((anchor, index, values) => index === 0 || anchor.top !== values[index - 1].top || anchor.startLine !== values[index - 1].startLine)
}

function interpolate(value: number, from: number, to: number, targetFrom: number, targetTo: number) {
  if (to <= from) return targetFrom
  const progress = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return targetFrom + progress * (targetTo - targetFrom)
}

export function lineToPreviewOffset(line: number, anchors: SourceAnchor[], maxScroll: number) {
  if (!anchors.length || line <= anchors[0].startLine) return 0
  let containing: SourceAnchor | null = null
  let previous: SourceAnchor | null = null
  let next: SourceAnchor | null = null
  for (const anchor of anchors) {
    const span = anchor.endLine - anchor.startLine
    if (line >= anchor.startLine && line <= anchor.endLine) {
      const currentSpan = containing ? containing.endLine - containing.startLine : Number.POSITIVE_INFINITY
      if (span < currentSpan || (span === currentSpan && anchor.startLine > (containing?.startLine ?? 0))) containing = anchor
    } else if (anchor.endLine < line) {
      const previousSpan = previous ? previous.endLine - previous.startLine : Number.POSITIVE_INFINITY
      if (!previous || anchor.endLine > previous.endLine || (anchor.endLine === previous.endLine && span < previousSpan)) previous = anchor
    } else if (anchor.startLine > line) {
      const nextSpan = next ? next.endLine - next.startLine : Number.POSITIVE_INFINITY
      if (!next || anchor.startLine < next.startLine || (anchor.startLine === next.startLine && span < nextSpan)) next = anchor
    }
  }
  if (containing) return Math.min(maxScroll, interpolate(line, containing.startLine, containing.endLine, containing.top, containing.bottom))
  if (previous && next) return Math.min(maxScroll, interpolate(line, previous.endLine, next.startLine, previous.bottom, next.top))
  return maxScroll
}

export function previewOffsetToLine(offset: number, anchors: SourceAnchor[], lastLine: number, maxScroll: number) {
  if (!anchors.length || offset <= anchors[0].top) return 1
  if (maxScroll > 0 && offset >= maxScroll - 2) return lastLine

  let low = 0
  let high = anchors.length - 1
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (anchors[middle].top <= offset) low = middle
    else high = middle - 1
  }
  const current = anchors[low]
  if (offset <= current.bottom) {
    return interpolate(offset, current.top, current.bottom, current.startLine, current.endLine)
  }
  const next = anchors[low + 1]
  if (next) return interpolate(offset, current.bottom, next.top, current.endLine, next.startLine)
  return lastLine
}

export function elementOffsetToSourceLine(element: HTMLElement, clientY: number) {
  const anchor = element.closest<HTMLElement>('[data-source-start]')
  if (!anchor) return null
  const startLine = Number(anchor.dataset.sourceStart)
  const endLine = Math.max(startLine, Number(anchor.dataset.sourceEnd) || startLine)
  const rect = anchor.getBoundingClientRect()
  if (!Number.isFinite(startLine) || rect.height <= 0) return null
  return interpolate(clientY, rect.top, rect.bottom, startLine, endLine)
}
