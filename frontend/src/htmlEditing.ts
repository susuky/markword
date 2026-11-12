import DOMPurify from 'dompurify'
import { collectHtmlBlocks, getHtmlBlockId } from './htmlBlocks'

export { getHtmlBlockId, getHtmlBlockLabel } from './htmlBlocks'

const TEXT_ATTRIBUTE = 'data-markword-edit-text'
const LINK_ATTRIBUTE = 'data-markword-edit-link'
const BLOCK_ATTRIBUTE = 'data-markword-edit-block'
const SOURCE_ATTRIBUTE = 'data-markword-source-id'
const CONTROL_ATTRIBUTE = 'data-markword-edit-control'
const NON_TEXT = 'script, style, noscript, textarea, select, svg, math, iframe, object, template'

export function serializeHtml(document: Document) {
  return Array.from(document.childNodes, (node) => node.nodeType === Node.ELEMENT_NODE
    ? (node as Element).outerHTML
    : new XMLSerializer().serializeToString(node)).join('\n')
}

export function createHtmlEditingDocument(source: string, snapshot?: { html: string; dynamicIds: string[] }) {
  const original = new DOMParser().parseFromString(source, 'text/html')
  const preview = snapshot ? new DOMParser().parseFromString(snapshot.html, 'text/html') : original.cloneNode(true) as Document
  const texts = new Map<string, Text>()
  const links = new Map<string, HTMLAnchorElement>()
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>()
  const originals = new Map(Array.from([original.body, ...original.body.querySelectorAll<HTMLElement>('*')], (element) => [getHtmlBlockId(element), element]))
  const dynamicIds = new Set(snapshot?.dynamicIds ?? [])
  if (!snapshot) [preview.body, ...preview.body.querySelectorAll('*')].forEach((element) => element.setAttribute(SOURCE_ATTRIBUTE, getHtmlBlockId(element)))
  const sourceId = (element: Element) => element.getAttribute(SOURCE_ATTRIBUTE)
  const { blocks: renderedBlocks, elements: renderedElements } = collectHtmlBlocks(preview)
  const elements = new Map<string, HTMLElement>()
  const blocks = renderedBlocks.flatMap((block) => {
    const rendered = renderedElements.get(block.id)!
    const id = sourceId(rendered)
    const element = id === null ? undefined : originals.get(id)
    if (!element) return []
    let parent = rendered.parentElement
    while (parent && parent !== preview.body && !elements.has(sourceId(parent) ?? '')) parent = parent.parentElement
    const parentId = parent && parent !== preview.body ? sourceId(parent) : null
    elements.set(id!, element)
    return [{ ...block, id: id!, parentId, depth: parentId ? (parentId.split('.').length - 1) : 0 }]
  })

  preview.querySelectorAll('*').forEach((element) => {
    for (const attribute of [TEXT_ATTRIBUTE, LINK_ATTRIBUTE, BLOCK_ATTRIBUTE, CONTROL_ATTRIBUTE, 'contenteditable']) element.removeAttribute(attribute)
  })
  ;[preview.body, ...preview.body.querySelectorAll<HTMLElement>('*')].forEach((element) => {
    const id = sourceId(element)
    const sourceElement = id === null ? undefined : originals.get(id)
    if (!sourceElement) return
    if (elements.has(id!)) element.setAttribute(BLOCK_ATTRIBUTE, id!)
    if (sourceElement.matches('a[href]')) {
      links.set(id!, sourceElement as HTMLAnchorElement)
      element.setAttribute(LINK_ATTRIBUTE, id!)
    }
    if (sourceElement.matches('textarea, select, input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])') && !dynamicIds.has(id!)) {
      controls.set(id!, sourceElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
      element.setAttribute(CONTROL_ATTRIBUTE, id!)
      element.removeAttribute('readonly')
      element.removeAttribute('disabled')
    }
    if (element.closest(NON_TEXT) || dynamicIds.has(id!)) return
    Array.from(element.childNodes).forEach((copy, index) => {
      const node = sourceElement.childNodes[index]
      if (copy.nodeType !== Node.TEXT_NODE || node?.nodeType !== Node.TEXT_NODE || !copy.textContent?.trim() || node.textContent !== copy.textContent) return
      const textId = String(texts.size)
      texts.set(textId, node as Text)
      const editable = preview.createElement('markword-edit-text')
      editable.setAttribute(TEXT_ATTRIBUTE, textId)
      editable.setAttribute('contenteditable', 'plaintext-only')
      editable.textContent = copy.textContent
      copy.replaceWith(editable)
    })
  })
  preview.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`).forEach((element) => element.removeAttribute(SOURCE_ATTRIBUTE))
  preview.querySelectorAll('link').forEach((link) => { if (link.rel !== 'stylesheet') link.remove() })
  preview.querySelectorAll('input, textarea, select').forEach((element) => {
    if (!element.hasAttribute(CONTROL_ATTRIBUTE)) element.setAttribute('disabled', '')
  })

  const safe = DOMPurify.sanitize(preview.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
    // IDs drive the page's CSS and anchors. This script-free iframe is accessed
    // through DOM methods and our own markers, never through named properties.
    SANITIZE_DOM: false,
    ADD_TAGS: ['link', 'markword-edit-text'],
    ADD_ATTR: ['contenteditable'],
    FORBID_TAGS: ['script', 'noscript', 'iframe', 'object', 'embed', 'base', 'meta'],
    FORBID_ATTR: ['autofocus'],
  })
  const rendered = new DOMParser().parseFromString(safe, 'text/html')
  const policy = rendered.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
  rendered.head.prepend(policy)
  const viewport = rendered.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  rendered.head.append(viewport)
  const editingStyle = rendered.createElement('style')
  editingStyle.textContent = `[${TEXT_ATTRIBUTE}]{cursor:text;min-width:.5em}[${TEXT_ATTRIBUTE}]:hover{outline:1px dashed #167469;outline-offset:3px}[${TEXT_ATTRIBUTE}]:focus{outline:2px solid #167469;outline-offset:3px}[${LINK_ATTRIBUTE}]{cursor:text}`
  rendered.head.append(editingStyle)
  return { original, texts, links, controls, dynamicIds, elements, blocks, preview: '<!doctype html>\n' + rendered.documentElement.outerHTML }
}

export function createStaticHtml(source: string) {
  const safe = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true, SANITIZE_DOM: false, ADD_TAGS: ['link'],
    FORBID_TAGS: ['script', 'noscript', 'iframe', 'object', 'embed', 'base', 'meta'],
    FORBID_ATTR: ['autofocus', 'contenteditable'],
  })
  const document = new DOMParser().parseFromString(safe, 'text/html')
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-markword-source') || attribute.name.startsWith('data-markword-edit') || attribute.name.startsWith('data-markword-runtime')) element.removeAttribute(attribute.name)
    }
  })
  document.querySelectorAll('button, input[type=button], input[type=submit], input[type=reset]').forEach((element) => element.remove())
  const viewport = document.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  document.head.prepend(viewport)
  return '<!doctype html>\n' + document.documentElement.outerHTML
}

export function isEditableLink(value: string) {
  // eslint-disable-next-line no-control-regex -- Reject control characters in user-supplied URLs.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value, 'https://example.com/').protocol) }
  catch { return false }
}
