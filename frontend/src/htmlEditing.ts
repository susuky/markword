import DOMPurify from 'dompurify'

const TEXT_ATTRIBUTE = 'data-markword-edit-text'
const LINK_ATTRIBUTE = 'data-markword-edit-link'
const NON_TEXT = 'script, style, noscript, textarea, select, svg, math, iframe, object, template'

export function serializeHtml(document: Document) {
  return Array.from(document.childNodes, (node) => node.nodeType === Node.ELEMENT_NODE
    ? (node as Element).outerHTML
    : new XMLSerializer().serializeToString(node)).join('\n')
}

export function createHtmlEditingDocument(source: string) {
  const original = new DOMParser().parseFromString(source, 'text/html')
  const preview = original.cloneNode(true) as Document
  const texts = new Map<string, Text>()
  const links = new Map<string, HTMLAnchorElement>()

  // Only our own markers may identify editable nodes; the original remains untouched.
  preview.querySelectorAll('*').forEach((element) => {
    element.removeAttribute(TEXT_ATTRIBUTE)
    element.removeAttribute(LINK_ATTRIBUTE)
    element.removeAttribute('contenteditable')
  })
  const originals = original.createTreeWalker(original.body, NodeFilter.SHOW_TEXT)
  const copies = preview.createTreeWalker(preview.body, NodeFilter.SHOW_TEXT)
  const pairs: [Text, Text][] = []
  while (originals.nextNode() && copies.nextNode()) pairs.push([originals.currentNode as Text, copies.currentNode as Text])
  for (const [node, copy] of pairs) {
    if (!node.textContent?.trim() || node.parentElement?.closest(NON_TEXT)) continue
    const id = String(texts.size)
    texts.set(id, node)
    // A custom tag avoids inheriting rules intended for the page's own spans.
    const editable = preview.createElement('markword-edit-text')
    editable.setAttribute(TEXT_ATTRIBUTE, id)
    editable.setAttribute('contenteditable', 'plaintext-only')
    editable.textContent = copy.textContent
    copy.replaceWith(editable)
  }
  const previewLinks = preview.querySelectorAll('a[href]')
  original.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link, index) => {
    const id = String(index)
    links.set(id, link)
    previewLinks[index].setAttribute(LINK_ATTRIBUTE, id)
  })
  preview.querySelectorAll('link').forEach((link) => { if (link.rel !== 'stylesheet') link.remove() })
  preview.querySelectorAll('input, textarea, select').forEach((element) => element.setAttribute('disabled', ''))

  const safe = DOMPurify.sanitize(preview.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
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
  return { original, texts, links, preview: '<!doctype html>\n' + rendered.documentElement.outerHTML }
}

export function isEditableLink(value: string) {
  // eslint-disable-next-line no-control-regex -- Reject control characters in user-supplied URLs.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value, 'https://example.com/').protocol) }
  catch { return false }
}
