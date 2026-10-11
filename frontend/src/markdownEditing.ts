import { htmlToMarkdown } from './htmlToMarkdown'
import { renderMarkdown } from './markdown'

const TEXT_SELECTOR = '[data-markdown-edit-text]'
// Keep generated content and its source intact. Tables have their own editor.
const PROTECTED = 'table, img, video, audio, .dynamic-source-block, .footnote-ref, .local-asset-link'

export function protectedMarkdownBlocks(root: HTMLElement) {
  return Array.from(root.querySelectorAll(':scope > *, .markdown-toggle-content > *')).filter((element): element is HTMLElement => element instanceof HTMLElement
    && element.hasAttribute('data-source-start') && !element.matches('table')
    && !element.matches('details')
    && (element.matches(PROTECTED) || Boolean(element.querySelector(PROTECTED))))
}

export function editableCodeText(code: HTMLElement) {
  return code.parentElement?.querySelector<HTMLTextAreaElement>('[data-markdown-code-input]')?.value ?? code.textContent ?? ''
}

function fencedCode(previous: string, value: string) {
  const opening = previous.match(/^([ ]{0,3})(`{3,}|~{3,})([^\r\n]*)\r?\n/)
  if (!opening) return null
  const [, indent, marker, info] = opening
  let length = marker.length
  // A pasted fence must remain code, never close the block early.
  for (const match of value.matchAll(new RegExp(`${marker[0]}{3,}`, 'g'))) length = Math.max(length, match[0].length + 1)
  const fence = marker[0].repeat(length)
  const content = value && !value.endsWith('\n') ? value + '\n' : value
  const result = `${indent}${fence}${info}\n${content.replace(/^(?=.)/gm, indent)}${indent}${fence}`
  return previous.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result
}

function anchorGroups(anchors: HTMLElement[]) {
  const keys = new Map<HTMLElement, string>()
  const groups = new Map<string, HTMLElement[]>()
  for (const anchor of anchors) {
    const parent = anchor.parentElement?.closest<HTMLElement>('[data-source-start]')
    const key = `${parent ? keys.get(parent) ?? '' : ''}/${anchor.tagName}`
    const group = groups.get(key) ?? []
    keys.set(anchor, `${key}:${group.length}`)
    group.push(anchor)
    groups.set(key, group)
  }
  return groups
}

export function prepareMarkdownEditing(root: HTMLElement, initialSource: string, codeLabel: string) {
  let source = initialSource
  const starts = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') starts.push(index + 1)
  // Reference definitions are invisible in the DOM and can serve links in other blocks.
  const elements = Array.from(root.querySelectorAll(':scope > *, .markdown-toggle-content > *, details > summary')).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && element.matches('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, summary')
    && element.hasAttribute('data-source-start') && !element.querySelector(PROTECTED),
  )
  const blocks = elements.filter((element) => !elements.some((parent) => parent !== element && parent.contains(element))).map((element) => ({
    element,
    from: starts[Number(element.dataset.sourceStart) - 1] ?? source.length,
    to: element.hasAttribute('data-markdown-virtual') ? starts[Number(element.dataset.sourceStart) - 1] ?? source.length : starts[Number(element.dataset.sourceEnd)] ?? source.length,
  })).filter((block) => !/^[ \t]*(?:>[ \t]*)*(?:[-+*]\s+|\d+[.)]\s+)?\[[^\]\n]+\]:/m.test(source.slice(block.from, block.to))).sort((a, b) => a.from - b.from)

  for (const { element } of blocks) {
    element.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
      code.dataset.markdownEditCode = ''
      code.tabIndex = 0
      code.setAttribute('role', 'button')
      code.setAttribute('aria-label', codeLabel)
    })
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      if (text.textContent?.trim() && !text.parentElement?.closest('pre, button')) texts.push(text)
    }
    const leaves = [element, ...element.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, summary')]
    for (const leaf of leaves) {
      if (!leaf.matches('p, li, h1, h2, h3, h4, h5, h6, summary') || leaf.querySelector(':scope > p')) continue
      // A new list item can have children but still needs its own blank writing line.
      if (Array.from(leaf.childNodes).some((node) => !(node instanceof HTMLElement && node.matches('ul, ol')) && node.textContent?.trim())) continue
      const text = document.createTextNode(''); leaf.insertBefore(text, leaf.querySelector(':scope > ul, :scope > ol')); texts.push(text)
    }
    for (const text of texts) {
      const editable = document.createElement('markword-md-text')
      editable.dataset.markdownEditText = ''
      editable.contentEditable = 'plaintext-only'
      editable.textContent = text.textContent
      text.replaceWith(editable)
    }
    element.querySelectorAll<HTMLInputElement>('.task-list-checkbox').forEach((checkbox) => { checkbox.disabled = false })
  }

  return {
    contains(element: Element) { return blocks.some((block) => block.element.contains(element)) },
    update(target: Element, onChange: (next: string, previous: string) => boolean) {
      const index = blocks.findIndex((block) => block.element.contains(target))
      if (index < 0) return false
      const block = blocks[index]
      const clone = block.element.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.copy-code').forEach((button) => button.remove())
      const codes = block.element.querySelectorAll<HTMLElement>('[data-markdown-edit-code]')
      clone.querySelectorAll<HTMLElement>('[data-markdown-edit-code]').forEach((code, codeIndex) => {
        code.textContent = editableCodeText(codes[codeIndex])
        code.hidden = false
      })
      clone.querySelectorAll('[data-markdown-code-input]').forEach((input) => input.remove())
      const container = document.createElement('div')
      container.append(clone)
      const previous = source.slice(block.from, block.to)
      let converted = (block.element.matches('pre') && codes[0] ? fencedCode(previous, editableCodeText(codes[0])) : null) ?? htmlToMarkdown(container, true)
      if (block.element.matches('summary')) converted = '<summary>' + converted.replace(/\r?\n/g, ' ').replaceAll('</summary>', '&lt;/summary&gt;') + '</summary>'
      const replacement = converted + (previous.match(/(?:\r?\n[ \t]*)+$/)?.[0] ?? '')
      const next = source.slice(0, block.from) + replacement + source.slice(block.to)
      if (!onChange(next, source)) return false
      block.element.removeAttribute('data-markdown-virtual')
      const delta = replacement.length - previous.length
      const lineDelta = replacement.split('\n').length - previous.split('\n').length
      const endLine = Number(block.element.dataset.sourceEnd)
      // The live DOM stays mounted for the caret. Keep later tables and scroll anchors current.
      root.querySelectorAll<HTMLElement>('[data-source-start]').forEach((anchor) => {
        const start = Number(anchor.dataset.sourceStart)
        const end = Number(anchor.dataset.sourceEnd)
        if (start > endLine) anchor.dataset.sourceStart = String(start + lineDelta)
        if (end >= endLine) anchor.dataset.sourceEnd = String(end + lineDelta)
      })
      if (!block.element.matches('summary')) {
        const parsed = document.createElement('div')
        parsed.innerHTML = renderMarkdown(replacement)
        const originalAnchors = [block.element, ...block.element.querySelectorAll<HTMLElement>('[data-source-start]')]
        const updatedAnchors = Array.from(parsed.querySelectorAll<HTMLElement>('[data-source-start]'))
        // Typing into an empty loose item can add a paragraph wrapper. Match
        // ranges within each parent so that other items still move their own source.
        const originalGroups = anchorGroups(originalAnchors)
        const updatedGroups = anchorGroups(updatedAnchors)
        const originalSet = new Set(originalAnchors)
        const matched = new Set<HTMLElement>()
        const startLine = source.slice(0, block.from).split('\n').length
        for (const [key, anchors] of originalGroups) {
          const parent = anchors[0].parentElement?.closest<HTMLElement>('[data-source-start]')
          if (parent && originalSet.has(parent) && !matched.has(parent)) continue
          const updated = updatedGroups.get(key)
          if (anchors.length !== updated?.length) continue
          anchors.forEach((anchor, anchorIndex) => {
            anchor.dataset.sourceStart = String(startLine + Number(updated[anchorIndex].dataset.sourceStart) - 1)
            anchor.dataset.sourceEnd = String(startLine + Number(updated[anchorIndex].dataset.sourceEnd) - 1)
            matched.add(anchor)
          })
        }
      }
      root.querySelectorAll<HTMLElement>('.preview-table').forEach((wrapper) => {
        const button = wrapper.querySelector<HTMLElement>('[data-table-line]')
        if (button) button.dataset.tableLine = wrapper.querySelector<HTMLElement>('table')?.dataset.sourceStart
      })
      block.to += delta
      blocks.slice(index + 1).forEach((later) => { later.from += delta; later.to += delta })
      source = next
      return true
    },
    dispose() {
      root.querySelectorAll(TEXT_SELECTOR).forEach((element) => element.replaceWith(...element.childNodes))
      root.querySelectorAll('[data-markdown-edit-code]').forEach((code) => {
        for (const attribute of ['data-markdown-edit-code', 'tabindex', 'role', 'aria-label', 'hidden']) code.removeAttribute(attribute)
      })
      root.querySelectorAll('[data-markdown-code-input]').forEach((input) => input.remove())
      root.querySelectorAll<HTMLInputElement>('.task-list-checkbox').forEach((checkbox) => { checkbox.disabled = true })
    },
  }
}
