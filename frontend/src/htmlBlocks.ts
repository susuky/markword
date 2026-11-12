export type HtmlLayout = 'single' | 'two-columns' | 'three-columns' | 'image-left' | 'image-right'
export type HtmlBlockAction = 'up' | 'down' | 'duplicate' | 'delete'
export type HtmlBlockWidth = 'auto' | 'full' | 'wide' | 'normal' | 'narrow'
export type HtmlBlockAlign = 'left' | 'center' | 'right'

export interface HtmlBlock {
  id: string
  label: string
  kind: string
  depth: number
  parentId: string | null
}

const HIDDEN = 'script, style, noscript, template, meta, link, source, track, [hidden], [aria-hidden="true"]'
const BLOCKS = 'main, article, section, aside, nav, header, footer, address, div, p, h1, h2, h3, h4, h5, h6, blockquote, pre, ul, ol, li, dl, dt, dd, table, figure, picture, img, video, audio, hr, details'
const CONTAINERS = 'main, article, section, aside, nav, header, footer, address, div, blockquote, figure'
const LAYOUT_ATTRIBUTE = 'data-markword-layout'
const LAYOUT_STYLE = 'style[data-markword-layout-styles]'

function isVisibleContent(element: Element) {
  if (element.closest(HIDDEN)) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = (current as HTMLElement).style
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
  }
  return true
}

function contentChildren(element: Element) {
  return Array.from(element.children).filter((child): child is HTMLElement => child.namespaceURI === 'http://www.w3.org/1999/xhtml' && isVisibleContent(child))
}

export function getHtmlBlockId(element: Element): string {
  const parts: number[] = []
  for (let current: Element | null = element; current && current !== element.ownerDocument.body; current = current.parentElement) {
    if (!current.parentElement) return ''
    parts.unshift(Array.from(current.parentElement.children).indexOf(current))
  }
  return parts.join('.')
}

export function getHtmlBlockLabel(element: Element): string {
  const image = element.matches('img') ? element : element.querySelector('img')
  let text = element.getAttribute('aria-label') || (element.matches('img, picture') ? image?.getAttribute('alt') : '') || ''
  if (!text) {
    const content = element.querySelector('h1, h2, h3, h4, h5, h6') ?? element
    const walker = element.ownerDocument.createTreeWalker(content, 4)
    while (text.length < 64 && walker.nextNode()) {
      if (walker.currentNode.parentElement && isVisibleContent(walker.currentNode.parentElement)) text += walker.currentNode.textContent || ''
    }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 64) || element.getAttribute('id') || element.tagName.toLowerCase()
}

export function collectHtmlBlocks(document: Document) {
  const elements = new Map<string, HTMLElement>()
  const blocks: HtmlBlock[] = []
  for (const element of document.body.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (!isVisibleContent(element) || element.closest('svg, math, select, textarea, iframe, object')) continue
    // A single unstyled wrapper adds no useful choice above its only child.
    if (element.tagName === 'DIV' && !element.id && !element.className && !element.getAttribute('style') && contentChildren(element).length <= 1 && !Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent?.trim())) continue
    if (!element.textContent?.trim() && !element.matches('img, picture, video, audio, hr') && !element.querySelector('img, video, audio, svg, canvas, iframe, object, hr')) continue
    const id = getHtmlBlockId(element)
    let parent = element.parentElement
    while (parent && parent !== document.body && !elements.has(getHtmlBlockId(parent))) parent = parent.parentElement
    const parentId = parent && parent !== document.body ? getHtmlBlockId(parent) : null
    const depth = parentId === null ? 0 : (blocks.find((block) => block.id === parentId)?.depth ?? -1) + 1
    elements.set(id, element)
    blocks.push({ id, label: getHtmlBlockLabel(element), kind: element.tagName.toLowerCase(), depth, parentId })
  }
  return { elements, blocks }
}

export function getHtmlBlockImage(element: Element): HTMLImageElement | null {
  if (element.tagName === 'IMG') return element as HTMLImageElement
  const images = element.querySelectorAll<HTMLImageElement>('img')
  return images.length === 1 ? images[0] : null
}

function imageLayoutParts(element: HTMLElement) {
  const children = contentChildren(element)
  if (children.length !== 2) return null
  const imageGroups = children.filter((child) => {
    if (!getHtmlBlockImage(child)) return false
    const copy = child.cloneNode(true) as HTMLElement
    copy.querySelectorAll('figcaption, script, style').forEach((node) => node.remove())
    return !copy.textContent?.trim()
  })
  return imageGroups.length === 1 ? { image: imageGroups[0], text: children.find((child) => child !== imageGroups[0])! } : null
}

function canLayout(element: HTMLElement) {
  return element.matches(CONTAINERS) && contentChildren(element).length >= 2 && !Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent?.trim())
}

function isMovable(element: HTMLElement) {
  return element !== element.ownerDocument.body && !!element.parentElement && element.parentElement.tagName !== 'PICTURE' && element.matches(BLOCKS) && isVisibleContent(element)
}

function siblings(element: HTMLElement) {
  return element.parentElement ? contentChildren(element.parentElement).filter(isMovable) : []
}

export function getHtmlBlockCapabilities(element: HTMLElement) {
  const peers = siblings(element)
  const index = peers.indexOf(element)
  const movable = isMovable(element)
  return {
    up: movable && index > 0,
    down: movable && index >= 0 && index < peers.length - 1,
    duplicate: movable,
    delete: movable,
    layout: canLayout(element),
    imageLayout: canLayout(element) && imageLayoutParts(element) !== null,
    image: getHtmlBlockImage(element) !== null,
  }
}

function updateImageLayout(element: HTMLElement) {
  if (!['image-left', 'image-right'].includes(element.getAttribute(LAYOUT_ATTRIBUTE) || '')) return
  const parts = imageLayoutParts(element)
  if (parts) element.setAttribute(LAYOUT_ATTRIBUTE, contentChildren(element)[0] === parts.image ? 'image-left' : 'image-right')
  else element.setAttribute(LAYOUT_ATTRIBUTE, 'two-columns')
}

export function moveHtmlBlock(element: HTMLElement, target: HTMLElement, placement: 'before' | 'after') {
  if (!isMovable(element) || !isMovable(target) || element === target || element.parentElement !== target.parentElement) throw new Error('Move blocks within the same section.')
  const parent = element.parentElement!
  parent.insertBefore(element, placement === 'before' ? target : target.nextSibling)
  updateImageLayout(parent)
  return element
}

function duplicateIdStyles(element: HTMLElement, copy: HTMLElement, replacements: Map<string, string>, replaceUrls: (value: string) => string) {
  if (!replacements.size) return
  const replaceSelector = (selector: string) => selector.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|#((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w\u0080-\uFFFF-])+)/g, (match, quoted: string | undefined, id: string) => {
    if (quoted) return match
    const decoded = id.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_match, hex: string | undefined, character: string) => {
      if (!hex) return character
      const code = parseInt(hex, 16)
      return String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd)
    })
    return replacements.has(decoded) ? `#${CSS.escape(replacements.get(decoded)!)}` : match
  })
  const rewrite = (rules: CSSRuleList, extend: boolean): { text: string; changed: boolean } => {
    let changed = false
    const text = Array.from(rules, (rule) => {
      const nested = 'cssRules' in rule ? rewrite((rule as CSSGroupingRule).cssRules, extend) : null
      if (rule instanceof CSSStyleRule) {
        const selector = replaceSelector(rule.selectorText)
        if (selector !== rule.selectorText) {
          changed = true
          const body = replaceUrls(rule.style.cssText) + ('cssRules' in rule ? rewrite(rule.cssRules, false).text : '')
          return `${extend ? rule.cssText + '\n' : ''}${selector} { ${body} }`
        }
        if (nested?.changed) {
          changed = true
          return `${selector} { ${rule.style.cssText} ${nested.text} }`
        }
      } else if (nested?.changed) {
        changed = true
        return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{ ${nested.text} }`
      }
      return rule.cssText
    }).join('\n')
    return { text, changed }
  }
  for (const style of element.ownerDocument.querySelectorAll<HTMLStyleElement>('style')) {
    // Styles inside the copied section travel with it; other sheets keep both selectors.
    if (element.contains(style) || !style.sheet) continue
    const result = rewrite(style.sheet.cssRules, !copy.contains(style))
    if (result.changed) style.textContent = result.text
  }
}

function duplicateBlock(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement
  const usedIds = new Set(Array.from(element.ownerDocument.querySelectorAll('[id]'), (node) => node.id))
  const replacements = new Map<string, string>()
  const nodes = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  for (const node of nodes) {
    if (!node.id) continue
    const originalId = node.id
    let id = `${originalId}-copy`
    let count = 2
    while (usedIds.has(id)) id = `${originalId}-copy-${count++}`
    usedIds.add(id)
    replacements.set(originalId, id)
    node.id = id
  }
  const references = ['for', 'list', 'form', 'headers', 'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns']
  const replaceUrls = (value: string) => value.replace(/url\(\s*(['"]?)#([^\s)'"<>]+)\1\s*\)/g, (match, quote: string, id: string) => replacements.has(id) ? `url(${quote}#${replacements.get(id)}${quote})` : match)
  for (const node of nodes) {
    for (const attribute of references) {
      const value = node.getAttribute(attribute)
      if (value) node.setAttribute(attribute, value.split(/\s+/).map((id) => replacements.get(id) ?? id).join(' '))
    }
    for (const attribute of ['href', 'xlink:href']) {
      const value = node.getAttribute(attribute)
      if (value?.startsWith('#') && replacements.has(value.slice(1))) node.setAttribute(attribute, `#${replacements.get(value.slice(1))}`)
    }
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.value.includes('url(')) node.setAttribute(attribute.name, replaceUrls(attribute.value))
    }
    if (node.tagName.toLowerCase() === 'style' && node.textContent) node.textContent = replaceUrls(node.textContent)
  }
  element.after(copy)
  duplicateIdStyles(element, copy, replacements, replaceUrls)
  updateImageLayout(element.parentElement!)
  return copy
}

export function applyHtmlBlockAction(element: HTMLElement, action: HtmlBlockAction): HTMLElement | null {
  const capabilities = getHtmlBlockCapabilities(element)
  if (!capabilities[action]) throw new Error('This block cannot be moved or changed here.')
  const peers = siblings(element)
  const index = peers.indexOf(element)
  if (action === 'up') return moveHtmlBlock(element, peers[index - 1], 'before')
  if (action === 'down') return moveHtmlBlock(element, peers[index + 1], 'after')
  if (action === 'duplicate') return duplicateBlock(element)
  const parent = element.parentElement!
  const next = peers[index + 1] ?? peers[index - 1] ?? (parent === element.ownerDocument.body ? null : parent)
  element.remove()
  updateImageLayout(parent)
  return next
}

function ensureLayoutStyles(document: Document) {
  if (document.querySelector(LAYOUT_STYLE)) return
  const style = document.createElement('style')
  style.setAttribute('data-markword-layout-styles', '')
  style.textContent = `[data-markword-layout]{display:grid!important;grid-auto-flow:row!important;grid-template-rows:none!important;gap:24px}
[data-markword-layout="single"]{grid-template-columns:minmax(0,1fr)!important}
[data-markword-layout="two-columns"],[data-markword-layout="image-left"],[data-markword-layout="image-right"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
[data-markword-layout="three-columns"]{grid-template-columns:repeat(3,minmax(0,1fr))!important}
[data-markword-layout]>:not(script):not(style):not([hidden]){position:static!important;float:none!important;grid-area:auto!important;order:0!important;min-width:0;max-width:100%;box-sizing:border-box}
[data-markword-layout] img{max-width:100%;height:auto}
@media(max-width:640px){[data-markword-layout]{grid-template-columns:minmax(0,1fr)!important}}`
  document.head.append(style)
}

export function setHtmlBlockLayout(element: HTMLElement, layout: HtmlLayout) {
  if (!canLayout(element)) throw new Error('Choose a section with at least two content blocks.')
  if (layout === 'image-left' || layout === 'image-right') {
    const parts = imageLayoutParts(element)
    if (!parts) throw new Error('Choose a section with one image group and one text group.')
    if (layout === 'image-left') element.insertBefore(parts.image, parts.text)
    else element.insertBefore(parts.text, parts.image)
  }
  for (const property of ['display', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow']) element.style.removeProperty(property)
  for (const child of contentChildren(element)) {
    for (const property of ['position', 'float', 'grid-area', 'grid-column', 'grid-row', 'order']) child.style.removeProperty(property)
  }
  element.setAttribute(LAYOUT_ATTRIBUTE, layout)
  ensureLayoutStyles(element.ownerDocument)
}

const WIDTHS = { full: 'none', wide: '1120px', normal: '880px', narrow: '640px' } as const

export function setHtmlBlockStyle(element: HTMLElement, options: { gap?: number; width?: HtmlBlockWidth; align?: HtmlBlockAlign }) {
  if (options.gap !== undefined) {
    if (!Number.isFinite(options.gap) || options.gap < 0 || options.gap > 160) throw new Error('Enter spacing between 0 and 160 pixels.')
    if (!canLayout(element)) throw new Error('Choose a section with at least two content blocks.')
    element.style.setProperty('gap', `${options.gap}px`, 'important')
  }
  if (options.width !== undefined) {
    element.setAttribute('data-markword-width', options.width)
    for (const property of ['width', 'max-width', 'margin-left', 'margin-right', 'margin-inline']) element.style.removeProperty(property)
    if (options.width !== 'auto') {
      element.style.setProperty('width', '100%', 'important')
      element.style.setProperty('max-width', WIDTHS[options.width], 'important')
      element.style.setProperty('margin-inline', 'auto', 'important')
    }
  }
  if (options.align !== undefined) {
    element.style.setProperty('text-align', options.align, 'important')
    if (element.matches('img, picture, video')) {
      element.style.setProperty('display', 'block')
      element.style.setProperty('margin-left', options.align === 'left' ? '0' : 'auto', 'important')
      element.style.setProperty('margin-right', options.align === 'right' ? '0' : 'auto', 'important')
    }
  }
}

export function getHtmlBlockSettings(element: HTMLElement): { layout: HtmlLayout | null; gap: number | null; width: HtmlBlockWidth; align: HtmlBlockAlign | null; imageSrc: string | null; imageAlt: string | null } {
  const layout = element.getAttribute(LAYOUT_ATTRIBUTE)
  const width = element.getAttribute('data-markword-width')
  const image = getHtmlBlockImage(element)
  const gap = element.style.gap.match(/^(\d+(?:\.\d+)?)px$/)?.[1]
  return {
    layout: ['single', 'two-columns', 'three-columns', 'image-left', 'image-right'].includes(layout ?? '') ? layout as HtmlLayout : null,
    gap: gap === undefined ? (layout ? 24 : null) : Number(gap),
    width: ['auto', 'full', 'wide', 'normal', 'narrow'].includes(width ?? '') ? width as HtmlBlockWidth : 'auto',
    align: ['left', 'center', 'right'].includes(element.style.textAlign) ? element.style.textAlign as HtmlBlockAlign : null,
    imageSrc: image?.getAttribute('src') ?? null,
    imageAlt: image?.getAttribute('alt') ?? null,
  }
}

export function replaceHtmlBlockImage(element: HTMLElement, src: string, alt?: string) {
  const image = getHtmlBlockImage(element)
  if (!image) throw new Error('Select a single image to replace.')
  const value = src.trim()
  // eslint-disable-next-line no-control-regex -- URL control characters can hide unsafe schemes.
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter an image address or choose an image file.')
  let protocol: string
  try { protocol = new URL(value, 'https://example.com/').protocol }
  catch { throw new Error('Enter an image address or choose an image file.') }
  if (!['http:', 'https:'].includes(protocol) && !(protocol === 'data:' && /^data:image\//i.test(value))) throw new Error('Enter an image address or choose an image file.')
  image.setAttribute('src', value)
  image.removeAttribute('srcset')
  image.removeAttribute('sizes')
  image.closest('picture')?.querySelectorAll(':scope > source').forEach((source) => source.remove())
  if (alt !== undefined) image.setAttribute('alt', alt)
}
