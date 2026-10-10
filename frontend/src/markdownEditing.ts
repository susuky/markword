import { htmlToMarkdown } from './htmlToMarkdown'

const TEXT_SELECTOR = '[data-markdown-edit-text]'
// Keep generated content and its source intact. Tables have their own editor.
const PROTECTED = 'table, img, video, audio, .dynamic-source-block, .footnote-ref, .local-asset-link'

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

export function prepareMarkdownEditing(root: HTMLElement, initialSource: string, codeLabel: string) {
  let source = initialSource
  const starts = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === '\n') starts.push(index + 1)
  // Reference definitions are invisible in the DOM and can serve links in other blocks.
  const blocks = Array.from(root.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && element.matches('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre')
    && element.hasAttribute('data-source-start') && !element.querySelector(PROTECTED),
  ).map((element) => ({
    element,
    from: starts[Number(element.dataset.sourceStart) - 1] ?? source.length,
    to: element.hasAttribute('data-markdown-virtual') ? starts[Number(element.dataset.sourceStart) - 1] ?? source.length : starts[Number(element.dataset.sourceEnd)] ?? source.length,
  })).filter((block) => !/^[ \t]*(?:>[ \t]*)*(?:[-+*]\s+|\d+[.)]\s+)?\[[^\]\n]+\]:/m.test(source.slice(block.from, block.to)))

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
      if (text.textContent?.trim() && !text.parentElement?.closest('code, button')) texts.push(text)
    }
    const leaves = [element, ...element.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6')]
    for (const leaf of leaves) {
      if (!leaf.matches('p, li, h1, h2, h3, h4, h5, h6') || leaf.textContent?.trim() || leaf.querySelector('ul, ol, p')) continue
      const text = document.createTextNode(''); leaf.append(text); texts.push(text)
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
      const converted = (block.element.matches('pre') && codes[0] ? fencedCode(previous, editableCodeText(codes[0])) : null) ?? htmlToMarkdown(container, true)
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
