export type InlineFormat = 'bold' | 'italic' | 'code' | 'link'

const LEAF = 'p, li, h1, h2, h3, h4, h5, h6, summary'
const TAGS = { bold: 'strong,b', italic: 'em,i', code: 'code', link: 'a' }

export interface InlineSelection {
  leaf: HTMLElement
  range: Range
  from: number
  to: number
  active: Record<InlineFormat, boolean>
}

function offset(leaf: HTMLElement, node: Node, position: number) {
  const range = document.createRange()
  range.selectNodeContents(leaf)
  range.setEnd(node, position)
  return range.toString().length
}

export function readInlineSelection(root: HTMLElement, allowCollapsed = false): InlineSelection | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount || (selection.isCollapsed && !allowCollapsed)) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const leaf = start?.closest<HTMLElement>(LEAF)
  if (!leaf || end?.closest(LEAF) !== leaf || !root.contains(leaf) || (!allowCollapsed && !range.toString().trim())
    || leaf.closest('pre, table, .preview-source-block') || leaf.querySelector('img, .dynamic-source-block, .footnote-ref, .local-asset-link')) return null
  const from = offset(leaf, range.startContainer, range.startOffset)
  const to = offset(leaf, range.endContainer, range.endOffset)
  const active = { bold: true, italic: true, code: true, link: true }
  const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT)
  let position = 0
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    const next = position + text.length
    if (next > from && position < to && text.data.slice(Math.max(0, from - position), to - position).trim()) {
      for (const format of Object.keys(TAGS) as InlineFormat[]) {
        active[format] &&= Boolean(text.parentElement?.closest(TAGS[format]))
      }
    }
    position = next
  }
  return { leaf, range: range.cloneRange(), from, to, active }
}

// cloneContents omits a shared inline ancestor. Include it so a partial bold
// selection keeps the formatting on both unselected sides.
function cloneWithinLeaf(range: Range, leaf: HTMLElement) {
  let fragment = range.cloneContents()
  let ancestor = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
  while (ancestor && ancestor !== leaf) {
    const wrapper = ancestor.cloneNode(false)
    wrapper.appendChild(fragment)
    fragment = document.createDocumentFragment()
    fragment.appendChild(wrapper)
    ancestor = ancestor.parentElement
  }
  fragment.querySelectorAll('markword-md-text').forEach((element) => element.replaceWith(...element.childNodes))
  fragment.querySelectorAll('a, strong, b, em, i, code').forEach((element) => {
    if (!element.textContent && !element.querySelector('img, br')) element.remove()
  })
  return fragment
}

export function formatInlineSelection(selection: InlineSelection, format: InlineFormat, url?: string) {
  const { leaf, range } = selection
  const before = document.createRange()
  before.selectNodeContents(leaf)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(leaf)
  after.setStart(range.endContainer, range.endOffset)
  const prefix = cloneWithinLeaf(before, leaf)
  const middle = cloneWithinLeaf(range, leaf)
  const suffix = cloneWithinLeaf(after, leaf)
  middle.querySelectorAll(TAGS[format]).forEach((element) => element.replaceWith(...element.childNodes))
  if (!selection.active[format] || (format === 'link' && url !== undefined)) {
    const wrapper = document.createElement({ bold: 'strong', italic: 'em', code: 'code', link: 'a' }[format])
    if (format === 'link') wrapper.setAttribute('href', url ?? '')
    if (format === 'code') wrapper.textContent = middle.textContent
    else wrapper.append(middle)
    middle.replaceChildren(wrapper)
  }
  leaf.replaceChildren(prefix, middle, suffix)
}

export function restoreInlineSelection(leaf: HTMLElement, from: number, to: number) {
  const length = leaf.textContent?.length ?? 0
  from = Math.min(from, length)
  to = Math.min(to, length)
  const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let position = 0
  let start = false
  let end = false
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    const next = position + text.length
    if (!start && from <= next) { range.setStart(text, Math.max(0, from - position)); start = true }
    if (start && to <= next) { range.setEnd(text, Math.max(0, to - position)); end = true; break }
    position = next
  }
  if (!start || !end) {
    if (length) return
    range.selectNodeContents(leaf)
    range.collapse(true)
  }
  const editable = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('[data-markdown-edit-text]')
  if (editable) editable.focus({ preventScroll: true })
  else { leaf.tabIndex = -1; leaf.focus({ preventScroll: true }) }
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
