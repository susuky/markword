import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import { normalizeAssetPath } from './assets'
import { translate } from './i18n'
import type { DocumentMode } from './types'
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

// ponytail: bounded FIFO; unchanged code blocks reuse highlighting while prose changes.
const highlightCache = new Map<string, string>()
const MAX_HIGHLIGHT_CACHE_CHARS = 1_000_000
const MAX_HIGHLIGHT_CACHE_ENTRIES = 100
let highlightCacheChars = 0

function highlightCode(code: string, language: string) {
  const key = JSON.stringify([language, code])
  const cached = highlightCache.get(key)
  if (cached !== undefined) return cached
  const result = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value
  const chars = key.length + result.length
  if (chars <= MAX_HIGHLIGHT_CACHE_CHARS) {
    while (highlightCache.size >= MAX_HIGHLIGHT_CACHE_ENTRIES || highlightCacheChars + chars > MAX_HIGHLIGHT_CACHE_CHARS) {
      const [oldKey, oldValue] = highlightCache.entries().next().value!
      highlightCacheChars -= oldKey.length + oldValue.length
      highlightCache.delete(oldKey)
    }
    highlightCache.set(key, result)
    highlightCacheChars += chars
  }
  return result
}

const md = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: true,
  highlight: highlightCode,
})

md.enable('table')

// Allow only a plain line break inside table cells; arbitrary HTML stays disabled.
md.inline.ruler.before('html_inline', 'markword_table_break', (state, silent) => {
  if (state.src[state.pos] !== '<') return false
  const match = state.src.slice(state.pos).match(/^<br\s*\/?>/i)
  if (!match) return false
  if (!silent) state.push('markword_table_break', '', 0).content = match[0]
  state.pos += match[0].length
  return true
})
md.core.ruler.after('inline', 'markword_table_breaks', (state) => {
  let inTable = false
  for (const token of state.tokens) {
    if (token.type === 'table_open') inTable = true
    if (token.type === 'table_close') inTable = false
    if (token.type !== 'inline' || !token.children) continue
    for (const child of token.children) {
      if (child.type !== 'markword_table_break') continue
      child.type = inTable ? 'hardbreak' : 'text'
      child.tag = inTable ? 'br' : ''
      if (inTable) child.content = ''
    }
  }
})

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
  return `<input class="task-list-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? translate('Completed') : translate('Not completed')}">`
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

function localMediaBlockRule(state: StateBlock, startLine: number, _endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const maximum = state.eMarks[startLine]
  const line = state.src.slice(start, maximum).trim()
  const match = line.match(/^@\[(video|audio)]\((?:<([^>]+)>|([^\s)]+))\)$/i)
  if (!match) return false
  const path = normalizeAssetPath(match[2] || match[3])
  if (!path) return false
  if (silent) return true

  const token = state.push('local_media', match[1].toLocaleLowerCase(), 0)
  token.block = true
  token.map = [startLine, startLine + 1]
  token.meta = { kind: match[1].toLocaleLowerCase(), path }
  state.line = startLine + 1
  return true
}

md.block.ruler.before('fence', 'markword_local_media', localMediaBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
md.renderer.rules.local_media = (tokens, index) => {
  const token = tokens[index]
  const { kind, path } = token.meta as { kind: 'video' | 'audio'; path: string }
  const safePath = md.utils.escapeHtml(path)
  const filename = md.utils.escapeHtml(path.split('/').at(-1) ?? path)
  const startLine = token.map ? token.map[0] + 1 : 1
  const endLine = token.map ? Math.max(startLine, token.map[1]) : startLine
  return `<figure class="local-media local-media--${kind} is-loading" data-source-start="${startLine}" data-source-end="${endLine}"><${kind} controls preload="metadata" data-asset-path="${safePath}"></${kind}><figcaption>${filename}</figcaption></figure>`
}

function footnoteDefinitionRule(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const match = state.src.slice(start, state.eMarks[startLine]).match(/^\[\^([^\]]+)\]:\s*(.*)$/)
  if (!match) return false
  if (silent) return true
  let nextLine = startLine + 1
  const content = [match[2]]
  while (nextLine < endLine && state.sCount[nextLine] >= state.blkIndent + 2) {
    content.push(state.getLines(nextLine, nextLine + 1, state.blkIndent + 2, false))
    nextLine += 1
  }
  const env = state.env as MarkdownEnvironment
  env.footnotes.set(match[1], {
    id: match[1],
    content: content.join('\n'),
    startLine: startLine + 1,
    endLine: nextLine,
  })
  state.line = nextLine
  return true
}

// Block parsing already understands fences, indented code and nested containers.
md.block.ruler.before('reference', 'markword_footnote_definition', footnoteDefinitionRule, { alt: ['paragraph', 'reference'] })

function annotateSourceRanges(tokens: Token[]) {
  for (const token of tokens) {
    if (token.map && (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block' || token.type === 'hr')) {
      token.attrSet('data-source-start', String(token.map[0] + 1))
      token.attrSet('data-source-end', String(Math.max(token.map[0] + 1, token.map[1])))
    }
    if (token.children) annotateSourceRanges(token.children)
  }
}

const defaultFence = md.renderer.rules.fence!.bind(md.renderer.rules)
function renderMermaid(source: string, startLine: number, endLine: number) {
  return `<div class="mermaid-block dynamic-source-block" data-mermaid-source="${encodeURIComponent(source)}" data-source-start="${startLine}" data-source-end="${endLine}"><div class="mermaid-loading">${translate('Drawing diagram…')}</div><pre class="mermaid-fallback"><code>${md.utils.escapeHtml(source)}</code></pre></div>`
}

md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const language = token.info.trim().split(/\s+/)[0]
  const startLine = token.map ? token.map[0] + 1 : 1
  const endLine = token.map ? Math.max(startLine, token.map[1]) : startLine

  if (language.toLowerCase() === 'mermaid') {
    return renderMermaid(token.content, startLine, endLine)
  }

  const rendered = defaultFence(tokens, index, options, env, self)
  return rendered.replace('<pre>', `<pre data-source-start="${startLine}" data-source-end="${endLine}"><button class="copy-code" type="button" aria-label="${translate('Copy code')}">${translate('Copy')}</button>`)
}

function removeTokenAttribute(token: Token, name: string) {
  token.attrs = token.attrs?.filter(([attribute]) => attribute !== name) ?? null
}

const defaultImage = md.renderer.rules.image?.bind(md.renderer.rules)
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const path = normalizeAssetPath(token.attrGet('src'))
  if (path) {
    removeTokenAttribute(token, 'src')
    token.attrSet('data-asset-path', path)
    token.attrJoin('class', 'local-asset is-loading')
  }
  return defaultImage ? defaultImage(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

const defaultLinkOpen = md.renderer.rules.link_open?.bind(md.renderer.rules)
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const path = normalizeAssetPath(token.attrGet('href'))
  if (path) {
    removeTokenAttribute(token, 'href')
    token.attrSet('data-asset-path', path)
    token.attrSet('download', path.split('/').at(-1) ?? 'asset')
    token.attrJoin('class', 'local-asset-link is-loading')
  }
  return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

function renderFootnotes(env: MarkdownEnvironment) {
  if (!env.footnoteOrder.length) return ''
  const items = env.footnoteOrder.map((id) => {
    const definition = env.footnotes.get(id)!
    const safeId = md.utils.escapeHtml(id)
    const references = env.footnoteReferenceCounts.get(id) ?? 1
    const backlinks = Array.from({ length: references }, (_, index) =>
      `<a class="footnote-backref" href="#fnref-${safeId}-${index + 1}" aria-label="${translate('Back to footnote reference')}">↩</a>`,
    ).join(' ')
    return `<li id="fn-${safeId}" data-source-start="${definition.startLine}" data-source-end="${definition.endLine}">${md.renderInline(definition.content, env)} ${backlinks}</li>`
  }).join('')
  return `<section class="footnotes"><hr><ol>${items}</ol></section>`
}

export function renderMarkdown(source: string, mode: DocumentMode = 'markdown') {
  if (mode === 'mermaid') return renderMermaid(source, 1, source.split('\n').length)
  if (mode === 'text') return source.split('\n').map((line, index) =>
    `<div data-source-start="${index + 1}" data-source-end="${index + 1}" style="white-space:pre-wrap;min-height:1.78em">${md.utils.escapeHtml(line)}</div>`,
  ).join('')
  const env: MarkdownEnvironment = {
    footnotes: new Map(),
    footnoteOrder: [],
    footnoteReferenceCounts: new Map(),
  }
  const tokens = md.parse(source, env)
  annotateSourceRanges(tokens)
  const html = md.renderer.render(tokens, md.options, env) + renderFootnotes(env)
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-source-start', 'data-source-end', 'data-mermaid-source', 'data-math-source', 'data-math-display', 'data-asset-path', 'checked', 'controls', 'disabled', 'download', 'preload'],
    ADD_TAGS: ['audio', 'button', 'figcaption', 'figure', 'input', 'video'],
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
