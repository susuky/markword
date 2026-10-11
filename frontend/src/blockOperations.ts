import { htmlToMarkdown } from './htmlToMarkdown'
import { lineOffsets, type BlockChange, type BlockType } from './markdownBlocks'

export interface DocumentBlock {
  element: HTMLElement
  anchor: HTMLElement
  parent: DocumentBlock | null
  from: number
  to: number
  line: number
  end: number
  kind: string
}

export type BlockAction = 'duplicate' | 'delete' | 'up' | 'down' | 'indent' | 'outdent'
export type BlockPlacement = 'before' | 'after' | 'inside'

// The Markdown source remains the document. DOM anchors supply its current tree,
// including individual list items; generated footnotes never become editable blocks.
export function documentBlocks(root: HTMLElement, source: string) {
  const starts = lineOffsets(source)
  const blocks: DocumentBlock[] = []
  const visit = (children: Element[], parent: DocumentBlock | null) => {
    for (const child of children) {
      if (!(child instanceof HTMLElement) || child.matches('button, summary, .footnotes')) continue
      if (child.matches('ul, ol')) { visit(Array.from(child.children), parent); continue }
      const anchor = child.matches('[data-source-start]') ? child : child.querySelector<HTMLElement>('[data-source-start]')
      if (!anchor) continue
      const line = Number(anchor.dataset.sourceStart)
      const end = Number(anchor.dataset.sourceEnd)
      if (!Number.isInteger(line) || !Number.isInteger(end)) continue
      const block: DocumentBlock = {
        element: child, anchor, parent, line, end, kind: anchor.tagName.toLowerCase(),
        from: starts[line - 1] ?? source.length,
        to: anchor.hasAttribute('data-markdown-virtual') ? starts[line - 1] ?? source.length : starts[end] ?? source.length,
      }
      blocks.push(block)
      if (anchor.matches('details')) {
        const content = anchor.querySelector(':scope > .markdown-toggle-content')
        if (content) visit(Array.from(content.children), block)
      } else if (anchor.matches('li')) {
        for (const nested of Array.from(anchor.children)) {
          if (nested.matches('ul, ol')) visit(Array.from(nested.children), block)
          else if (Number((nested as HTMLElement).dataset.sourceStart) > line) visit([nested], block)
        }
      }
    }
  }
  visit(Array.from(root.children), null)
  return blocks
}

export function normalizedBlocks(blocks: DocumentBlock[]) {
  const ordered = [...new Set(blocks)].sort((a, b) => a.from - b.from || b.to - a.to)
  return ordered.filter((block) => !ordered.some((parent) => parent !== block && parent.from <= block.from && parent.to >= block.to && (parent.from < block.from || parent.to > block.to)))
}

interface Edit { from: number; to: number; content: string }
function edit(source: string, changes: Edit[], focus: number): BlockChange | null {
  const ordered = changes.sort((a, b) => b.from - a.from || b.to - a.to)
  if (ordered.some((change, index) => index > 0 && change.to > ordered[index - 1].from)) return null
  let next = source
  for (const change of ordered) next = next.slice(0, change.from) + change.content + next.slice(change.to)
  if (next === source) return null
  return { source: next, line: Math.max(1, next.slice(0, Math.max(0, Math.min(focus, next.length))).split('\n').length), focusExisting: true }
}

function newline(source: string) { return source.includes('\r\n') ? '\r\n' : '\n' }
function indentation(block: DocumentBlock, source: string) {
  return source.slice(block.from, block.to).match(/^[ \t]*/)?.[0].length ?? 0
}
function reindent(value: string, from: number, to: number) {
  return value.replace(/^[ \t]*(?=\S)/gm, (spaces) => ' '.repeat(Math.max(0, spaces.length - from + to)))
}
function insert(source: string, at: number, value: string, list = false) {
  const nl = newline(source)
  const before = source.slice(0, at)
  const after = source.slice(at)
  const gap = list ? nl : nl + nl
  const prefix = before && !before.endsWith(gap) ? (before.endsWith(nl) ? (list ? '' : nl) : gap) : ''
  const followingItem = /^[ \t]*(?:[-+*]|\d+[.)])\s/.test(after) || after.startsWith(nl)
  const endingGap = list && followingItem ? nl : nl + nl
  const suffix = after && !value.endsWith(endingGap) ? (value.endsWith(nl) ? (endingGap === nl ? '' : nl) : endingGap) : ''
  return prefix + value + suffix
}
function selectionContent(source: string, selected: DocumentBlock[], indent = 0) {
  const nl = newline(source)
  return selected.map((block) => reindent(source.slice(block.from, block.to).replace(/\s+$/, ''), indentation(block, source), indent)).join(nl + nl) + nl
}
function previousSibling(blocks: DocumentBlock[], selected: DocumentBlock[]) {
  const first = selected[0]
  return blocks.filter((block) => block.parent === first.parent && block.to <= first.from).at(-1)
}

function titleSource(block: DocumentBlock, source: string) {
  const raw = reindent(source.slice(block.from, block.to).trimEnd(), indentation(block, source), 0)
  if (!['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(block.kind) || raw.includes('\n')) return null
  return raw.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '')
}

export function toggleSource(title: string, body: string, source = '', open = true) {
  const nl = newline(source)
  return `<details${open ? ' open' : ''}>${nl}<summary>${title.replaceAll('</summary>', '&lt;/summary&gt;')}</summary>${nl}${nl}${body.trimEnd()}${nl}${nl}</details>${nl}`
}

export function moveBlocks(source: string, selectedInput: DocumentBlock[], target: DocumentBlock, placement: BlockPlacement, defaultTitle: string): BlockChange | null {
  const selected = normalizedBlocks(selectedInput)
  if (!selected.length || selected.some((block) => block.from <= target.from && block.to >= target.to)) return null
  if (placement === 'inside') {
    if (target.kind === 'li') {
      const marker = source.slice(target.from, target.to).match(/^[ \t]*(?:[-+*]|\d+[.)])\s+/)?.[0]
      if (!marker) return null
      const value = selectionContent(source, selected, marker.length)
      const at = target.to
      const removedBefore = selected.filter((block) => block.to <= at).reduce((sum, block) => sum + block.to - block.from, 0)
      // Empty items and numbering after 1 cannot interrupt a paragraph without a blank line.
      const firstNumber = value.match(/^[ \t]*(\d+)[.)]\s/)?.[1]
      const emptyItem = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]*(?:\r?\n|$)/.test(value)
      const continuesList = target.anchor.lastElementChild?.matches(firstNumber ? 'ol' : 'ul')
      const compact = selected.every((block) => block.kind === 'li') && (continuesList || (!emptyItem && (!firstNumber || Number(firstNumber) === 1)))
      const insertion = insert(source, at, value, compact)
      const focus = at - removedBefore + (insertion.match(/^(?:\r?\n)*/)?.[0].length ?? 0)
      return edit(source, [...selected.map((block) => ({ from: block.from, to: block.to, content: '' })), { from: at, to: at, content: insertion }], focus)
    }
    const body = selectionContent(source, selected)
    if (target.kind === 'details') {
      const at = lineOffsets(source)[target.end - 1] ?? target.to
      if (selected.some((block) => block.from >= target.from && block.to <= target.to)) return null
      const removedBefore = selected.filter((block) => block.to <= at).reduce((sum, block) => sum + block.to - block.from, 0)
      const changes = selected.map((block) => ({ from: block.from, to: block.to, content: '' }))
      changes.push({ from: at, to: at, content: insert(source, at, selectionContent(source, selected, indentation(target, source))) })
      if (!target.anchor.hasAttribute('open')) {
        const lineEnd = source.indexOf('\n', target.from)
        const to = lineEnd < 0 ? target.to : lineEnd
        changes.push({ from: target.from, to, content: source.slice(target.from, to).replace('<details>', '<details open>') })
      }
      return edit(source, changes, at - removedBefore)
    }
    const title = titleSource(target, source)
    const original = title === null ? reindent(source.slice(target.from, target.to), indentation(target, source), 0) + newline(source) : ''
    const replacement = reindent(toggleSource(title ?? defaultTitle, original + body, source), 0, indentation(target, source))
    return edit(source, [...selected.map((block) => ({ from: block.from, to: block.to, content: '' })), { from: target.from, to: target.to, content: replacement }], target.from)
  }
  // Dropping a parent beside its own child would overlap source edits.
  if (selected.some((block) => target.from < block.to && target.to > block.from)) return null
  const at = placement === 'before' ? target.from : target.to
  const value = selectionContent(source, selected, indentation(target, source))
  const removedBefore = selected.filter((block) => block.to <= at).reduce((sum, block) => sum + block.to - block.from, 0)
  const insertion = insert(source, at, value, target.kind === 'li' && selected.every((block) => block.kind === 'li'))
  return edit(source, [...selected.map((block) => ({ from: block.from, to: block.to, content: '' })), { from: at, to: at, content: insertion }], at - removedBefore)
}

export function canBlockAction(action: BlockAction, blocks: DocumentBlock[], input: DocumentBlock[]) {
  const selected = normalizedBlocks(input)
  if (!selected.length) return false
  if (action === 'delete' || action === 'duplicate') return true
  const parent = selected[0].parent
  if (selected.some((block) => block.parent !== parent)) return false
  if (action === 'outdent') return Boolean(parent)
  const before = previousSibling(blocks, selected)
  if (action === 'up') return Boolean(before)
  if (action === 'down') return blocks.some((block) => block.parent === parent && block.from >= selected.at(-1)!.to)
  return Boolean(before)
}

export function blockAction(source: string, blocks: DocumentBlock[], input: DocumentBlock[], action: BlockAction, defaultTitle: string): BlockChange | null {
  const selected = normalizedBlocks(input)
  if (!canBlockAction(action, blocks, selected)) return null
  if (action === 'delete') return edit(source, selected.map((block) => ({ from: block.from, to: block.to, content: '' })), selected[0].from)
  if (action === 'duplicate') {
    return edit(source, selected.map((block) => ({ from: block.to, to: block.to, content: insert(source, block.to, source.slice(block.from, block.to) || newline(source), block.kind === 'li') })), selected[0].to)
  }
  if (action === 'outdent') {
    const parent = selected[0].parent!
    const at = parent.to
    const value = selectionContent(source, selected, indentation(parent, source))
    const removed = selected.reduce((sum, block) => sum + block.to - block.from, 0)
    const insertion = insert(source, at, value, parent.kind === 'li' && selected.every((block) => block.kind === 'li'))
    const focus = at - removed + (insertion.match(/^(?:\r?\n)*/)?.[0].length ?? 0)
    return edit(source, [...selected.map((block) => ({ from: block.from, to: block.to, content: '' })), { from: at, to: at, content: insertion }], focus)
  }
  const target = action === 'down' ? blocks.find((block) => block.parent === selected[0].parent && block.from >= selected.at(-1)!.to) : previousSibling(blocks, selected)
  return target ? moveBlocks(source, selected, target, action === 'indent' ? 'inside' : action === 'up' ? 'before' : 'after', defaultTitle) : null
}

export const CONVERT_TYPES: BlockType[] = ['text', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'task', 'quote', 'code', 'toggle']
export function canConvertBlock(block: DocumentBlock, type: BlockType, blocks: DocumentBlock[], source: string) {
  if (type === 'toggle' || block.kind === 'details') return true
  if (!['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre'].includes(block.kind)) return false
  if (block.anchor.querySelector('img, .dynamic-source-block, .footnote-ref, .local-asset-link')) return false
  if (/^[ \t]*(?:>[ \t]*)*(?:[-+*]\s+|\d+[.)]\s+)?\[[^\]\n]+\]:/m.test(source.slice(block.from, block.to))) return false
  const children = blocks.some((child) => child.parent === block)
  return !children || ['bullet', 'ordered', 'task'].includes(type)
}

function convertOne(source: string, block: DocumentBlock, type: BlockType, defaultTitle: string) {
  const nl = newline(source)
  const raw = reindent(source.slice(block.from, block.to).trimEnd(), indentation(block, source), 0)
  if (type === 'toggle') {
    if (block.kind === 'details') return source.slice(block.from, block.to)
    if (block.kind === 'li') {
      const width = raw.match(/^(?:[-+*]|\d+[.)])\s+/)?.[0].length ?? 2
      const lines = raw.split(/\r?\n/)
      const title = lines[0].replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
      return reindent(toggleSource(title, reindent(lines.slice(1).join(nl), width, 0), source), 0, indentation(block, source)) + nl
    }
    const title = titleSource(block, source)
    return reindent(toggleSource(title ?? defaultTitle, title === null ? raw : '', source), 0, indentation(block, source)) + nl
  }
  let body = raw
  let children = ''
  if (block.kind === 'details') {
    const lines = raw.split(/\r?\n/)
    body = lines[1].replace(/^<summary>|<\/summary>$/g, '')
    children = lines.slice(2, -1).join(nl).trim()
  } else if (block.kind === 'li') {
    const marker = raw.match(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/)?.[0] ?? ''
    const width = raw.match(/^(?:[-+*]|\d+[.)])\s+/)?.[0].length ?? 2
    body = raw.slice(marker.length)
    if (['bullet', 'ordered', 'task'].includes(type)) {
      const prefix = type === 'ordered' ? '1. ' : type === 'task' ? (block.anchor.querySelector<HTMLInputElement>(':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]')?.checked ? '- [x] ' : '- [ ] ') : '- '
      const lines = body.split(/\r?\n/)
      const contentWidth = type === 'ordered' ? 3 : 2
      return ' '.repeat(indentation(block, source)) + prefix + lines[0] + (lines.length > 1 ? nl + reindent(lines.slice(1).join(nl), width, indentation(block, source) + contentWidth) : '') + nl
    }
    body = body.replace(new RegExp(`^ {1,${width}}`, 'gm'), '')
  } else if (/^h[1-6]$/.test(block.kind)) body = raw.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '')
  else if (block.kind === 'blockquote') body = raw.replace(/^ {0,3}> ?/gm, '')
  else if (block.kind === 'pre' && type !== 'code') {
    const container = document.createElement('p')
    container.textContent = block.anchor.querySelector('code')?.textContent ?? ''
    body = htmlToMarkdown(container, true)
  }
  let result = body
  if (type === 'code') {
    const content = block.kind === 'pre' ? null : body
    if (content !== null) {
      const longest = Math.max(2, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length))
      const fence = '`'.repeat(longest + 1)
      result = `${fence}text${nl}${content}${nl}${fence}`
    }
  } else if (['h1', 'h2', 'h3'].includes(type)) result = '#'.repeat(Number(type[1])) + ' ' + body.replace(/\r?\n/g, ' ')
  else if (type === 'quote') result = body.split(/\r?\n/).map((line) => '> ' + line).join(nl)
  else if (['bullet', 'ordered', 'task'].includes(type)) {
    const marker = type === 'ordered' ? '1. ' : type === 'task' ? '- [ ] ' : '- '
    result = marker + body.replace(/\r?\n/g, nl + ' '.repeat(type === 'ordered' ? 3 : 2))
  }
  return reindent(result + (children ? nl + nl + children : '') + nl + nl, 0, indentation(block, source))
}

export function convertBlocks(source: string, blocks: DocumentBlock[], input: DocumentBlock[], type: BlockType, defaultTitle: string) {
  const selected = normalizedBlocks(input)
  if (!selected.length || selected.some((block) => !canConvertBlock(block, type, blocks, source))) return null
  return edit(source, selected.map((block) => ({ from: block.from, to: block.to, content: convertOne(source, block, type, defaultTitle) })), selected[0].from)
}

export function foldBlock(source: string, block: DocumentBlock): BlockChange | null {
  if (block.kind !== 'details') return null
  const end = source.indexOf('\n', block.from)
  const to = end < 0 ? source.length : end
  const opening = source.slice(block.from, to)
  const replacement = opening.includes(' open') ? opening.replace(' open', '') : opening.replace('<details>', '<details open>')
  return edit(source, [{ from: block.from, to, content: replacement }], block.from)
}
