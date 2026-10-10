import { htmlToMarkdown } from './htmlToMarkdown'

const LEAF = 'p, h1, h2, h3, h4, h5, h6, li'
const CURSOR = 'MARKWORDCURSOR'
export interface BlockChange { source: string; line: number; offset?: number; code?: boolean; table?: boolean }

export const BLOCK_TYPES = [
  { id: 'text', label: 'Paragraph', source: CURSOR },
  { id: 'h1', label: 'Heading 1', source: '# ' + CURSOR },
  { id: 'h2', label: 'Heading 2', source: '## ' + CURSOR },
  { id: 'h3', label: 'Heading 3', source: '### ' + CURSOR },
  { id: 'bullet', label: 'Bulleted list', source: '- ' + CURSOR },
  { id: 'ordered', label: 'Numbered list', source: '1. ' + CURSOR },
  { id: 'task', label: 'To-do list', source: '- [ ] ' + CURSOR },
  { id: 'quote', label: 'Quote', source: '> ' + CURSOR },
  { id: 'code', label: 'Code block', source: '```text\n' + CURSOR + '\n```' },
  { id: 'table', label: 'Table', source: '|  |  |\n| --- | --- |\n|  |  |' },
  { id: 'divider', label: 'Divider', source: '---\n\n' + CURSOR },
] as const
export type BlockType = typeof BLOCK_TYPES[number]['id']

export function lineOffsets(source: string) {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  return starts
}

export function rootBlock(root: HTMLElement, target: Element | null) {
  let element = target as HTMLElement | null
  while (element && element.parentElement !== root) element = element.parentElement
  return element?.parentElement === root ? element : null
}

function bounds(root: HTMLElement, source: string, target: Element | null) {
  const element = rootBlock(root, target)
  const anchor = element?.matches('[data-source-start]') ? element : element?.querySelector<HTMLElement>('[data-source-start]')
  if (!element || !anchor) return null
  const starts = lineOffsets(source)
  const from = starts[Number(anchor.dataset.sourceStart) - 1] ?? source.length
  const to = element.hasAttribute('data-markdown-virtual') ? from : starts[Number(anchor.dataset.sourceEnd)] ?? source.length
  return { element, from, to }
}

function splice(source: string, from: number, to: number, content: string, cursor: number): BlockChange {
  const prefix = source.slice(0, from)
  const separator = prefix && !prefix.endsWith('\n\n') ? (prefix.endsWith('\n') ? '\n' : '\n\n') : ''
  const replacement = separator + content + (source.slice(to) && !content.endsWith('\n\n') ? '\n\n' : '')
  return { source: prefix + replacement + source.slice(to), line: (prefix + separator + content.slice(0, cursor)).split('\n').length }
}

export function insertBlock(root: HTMLElement, source: string, target: Element | null, type: BlockType, replace = false): BlockChange {
  const spec = BLOCK_TYPES.find((item) => item.id === type)!
  const block = bounds(root, source, target)
  const from = replace && block ? block.from : block?.to ?? source.length
  const to = replace && block ? block.to : from
  const cursor = spec.source.indexOf(CURSOR)
  let prefix = ''
  const leaf = target?.closest(LEAF)
  if (replace && block && leaf && leaf !== block.element && !leaf.textContent?.trim()) {
    const container = document.createElement('div')
    const clone = block.element.cloneNode(true) as HTMLElement
    const index = Array.from(block.element.querySelectorAll(LEAF)).indexOf(leaf)
    const empty = clone.querySelectorAll(LEAF)[index]
    if (empty) empty.remove()
    clean(clone); container.append(clone)
    const remaining = htmlToMarkdown(container, true)
    prefix = remaining ? remaining + '\n\n' : ''
  }
  const result = splice(source, from, to, prefix + spec.source.replace(CURSOR, ''), prefix.length + Math.max(0, cursor))
  return { ...result, code: type === 'code', table: type === 'table' }
}

export function deleteBlock(root: HTMLElement, source: string, target: Element): BlockChange | null {
  const block = bounds(root, source, target)
  if (!block) return null
  return { source: source.slice(0, block.from) + source.slice(block.to), line: source.slice(0, block.from).split('\n').length }
}

function clean(container: HTMLElement) {
  container.querySelectorAll('.copy-code, .preview-table__edit, [data-markdown-code-input]').forEach((node) => node.remove())
}

// Structural edits serialize only the containing block. Invisible definitions and other blocks stay byte-for-byte intact.
export function splitBlock(root: HTMLElement, source: string, target: HTMLElement): BlockChange | null {
  const block = bounds(root, source, target)
  const leaf = target.closest<HTMLElement>(LEAF)
  const selection = window.getSelection()
  if (!block || !leaf || !selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!leaf.contains(range.startContainer) || !leaf.contains(range.endContainer)) return null
  const before = range.cloneRange(); before.selectNodeContents(leaf); before.setEnd(range.startContainer, range.startOffset)
  const after = range.cloneRange(); after.selectNodeContents(leaf); after.setStart(range.endContainer, range.endOffset)
  const container = document.createElement('div')
  const clone = block.element.cloneNode(true) as HTMLElement
  container.append(clone)
  const path = [block.element, ...block.element.querySelectorAll(LEAF)]
  const copy = [clone, ...clone.querySelectorAll(LEAF)][path.indexOf(leaf)] as HTMLElement
  if (!copy) return null
  const marker = 'MWCURSOR' + crypto.randomUUID().replaceAll('-', '')
  const next = document.createElement(leaf.matches('li') ? 'li' : 'p')
  const isEmpty = !leaf.textContent?.trim() && !leaf.querySelector('ul, ol')
  next.append(document.createTextNode(marker), after.cloneContents())
  copy.replaceChildren(before.cloneContents())
  if (leaf.matches('li') && !isEmpty) {
    const checkbox = leaf.querySelector(':scope > input[type=checkbox]')
    if (checkbox) { const unchecked = checkbox.cloneNode() as HTMLInputElement; unchecked.checked = false; unchecked.removeAttribute('checked'); next.prepend(unchecked, ' ') }
  }
  if (isEmpty && leaf.matches('li')) {
    // Enter on an empty item exits its list, keeping following items as a separate list.
    const list = copy.parentElement!
    const tail = list.cloneNode(false) as HTMLElement
    while (copy.nextSibling) tail.append(copy.nextSibling)
    const paragraph = document.createElement('p'); paragraph.textContent = marker
    list.after(paragraph, tail); copy.remove()
    if (!list.children.length) list.remove()
    if (!tail.children.length) tail.remove()
  } else if (isEmpty && copy.parentElement?.matches('blockquote')) {
    copy.parentElement.after(next); copy.remove()
  } else copy.after(next)
  clean(container)
  const converted = htmlToMarkdown(container, true)
  const cursor = converted.indexOf(marker)
  if (cursor < 0) return null
  const suffix = source.slice(block.from, block.to).match(/(?:\r?\n[ \t]*)+$/)?.[0] ?? ''
  const content = converted.replace(marker, '') + suffix
  return splice(source, block.from, block.to, content, cursor)
}

export function mergeBlock(root: HTMLElement, source: string, target: HTMLElement): BlockChange | null {
  const leaf = target.closest<HTMLElement>(LEAF)
  const selection = window.getSelection()
  if (!leaf || !selection?.isCollapsed || !selection.rangeCount) return null
  const before = selection.getRangeAt(0).cloneRange(); before.selectNodeContents(leaf); before.setEnd(selection.anchorNode!, selection.anchorOffset)
  if (before.toString().length) return null
  const block = bounds(root, source, leaf)
  if (!block) return null
  if (!leaf.textContent?.trim()) return leaf === block.element ? deleteBlock(root, source, leaf) : splitBlock(root, source, target)
  const previous = leaf.previousElementSibling as HTMLElement | null
  if (!previous?.matches(LEAF) || !previous.querySelector('[data-markdown-edit-text]') || previous.querySelector('ul, ol')) return null
  const previousBlock = bounds(root, source, previous)
  if (!previousBlock) return null
  const container = document.createElement('div')
  const offset = previous.textContent?.length ?? 0
  if (previousBlock.element === block.element) {
    const clone = block.element.cloneNode(true) as HTMLElement
    const leaves = Array.from(block.element.querySelectorAll(LEAF))
    const cloneLeaves = clone.querySelectorAll(LEAF)
    const first = cloneLeaves[leaves.indexOf(previous)], second = cloneLeaves[leaves.indexOf(leaf)]
    second.querySelector('input[type=checkbox]')?.remove()
    first.append(...second.childNodes); second.remove(); container.append(clone)
  } else {
    const first = previous.cloneNode(true) as HTMLElement, second = leaf.cloneNode(true) as HTMLElement
    first.append(...second.childNodes); container.append(first)
  }
  clean(container)
  const converted = htmlToMarkdown(container, true)
  const result = splice(source, previousBlock.from, block.to, converted, 0)
  return { ...result, line: Number(previous.dataset.sourceStart) || result.line, offset }
}

export function ensureWritingLine(root: HTMLElement, source: string, line: number) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-source-start]'))
  const match = elements.reverse().find((el) => Number(el.dataset.sourceStart) <= line && Number(el.dataset.sourceEnd) >= line && el.matches(LEAF + ', pre'))
  if (match) return match
  const quote = /^\s*>[ >]*$/.test(source.split('\n')[line - 1] ?? '')
    ? Array.from(root.querySelectorAll<HTMLElement>('blockquote[data-source-start]')).reverse().find((el) => Number(el.dataset.sourceStart) <= line)
    : null
  if (quote) {
    const paragraph = document.createElement('p')
    paragraph.dataset.sourceStart = String(line)
    paragraph.dataset.sourceEnd = String(line)
    quote.append(paragraph)
    for (let parent: HTMLElement | null = quote; parent && parent !== root; parent = parent.parentElement) {
      if (parent.hasAttribute('data-source-end')) parent.dataset.sourceEnd = String(Math.max(line, Number(parent.dataset.sourceEnd)))
    }
    return paragraph
  }
  const paragraph = document.createElement('p')
  paragraph.dataset.sourceStart = String(line)
  paragraph.dataset.sourceEnd = String(line)
  paragraph.dataset.markdownVirtual = ''
  const next = Array.from(root.children).find((el) => Number((el as HTMLElement).dataset.sourceStart || el.querySelector<HTMLElement>('[data-source-start]')?.dataset.sourceStart) > line)
  root.insertBefore(paragraph, next ?? null)
  return paragraph
}

export function focusWritingLine(root: HTMLElement, line: number, offset = 0) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-source-start]')).reverse()
  const block = blocks.find((el) => Number(el.dataset.sourceStart) <= line && Number(el.dataset.sourceEnd) >= line && el.querySelector('[data-markdown-edit-text]'))
  if (!block) return
  const fields = Array.from(block.querySelectorAll<HTMLElement>('[data-markdown-edit-text]'))
  for (const field of fields) {
    const length = field.textContent?.length ?? 0
    if (offset > length && field !== fields.at(-1)) { offset -= length; continue }
    field.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(field)
    if (field.firstChild?.nodeType === Node.TEXT_NODE) range.setStart(field.firstChild, Math.min(offset, length))
    range.collapse(true)
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    field.scrollIntoView({ block: 'nearest' })
    break
  }
}
