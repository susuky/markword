import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  collectSourceAnchors,
  elementOffsetToSourceLine,
  highlightCode,
  lineToPreviewOffset,
  previewOffsetToLine,
  renderMarkdown,
  type SourceAnchor,
} from '../markdown'
import { normalizeAssetPath } from '../assets'
import '../markdownFeatures.css'
import '../toggleStyles.css'
import { useI18n } from '../i18n'
import { getAssetsByPaths } from '../storage'
import type { DocumentMode, ThemeName } from '../types'
import { THEME_META } from '../themeConfig'
import { mermaidFontScale, normalizeMermaidLabelWidths, renderMathBlocks, renderMermaidSvg, showMermaidError } from '../dynamicMarkdown'
import { ImageLightbox, type LightboxMedia } from './ImageLightbox'
import { editableCodeText, prepareMarkdownEditing, protectedMarkdownBlocks } from '../markdownEditing'
import { isEditableLink } from '../htmlEditing'
import { Plus, Trash2, Type, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, Code2, Table2, Minus, X, Bold, Italic, Code, Link, ChevronRight } from 'lucide-react'
import { BLOCK_TYPES, insertBlock, deleteBlock, splitBlock, mergeBlock, ensureWritingLine, focusWritingLine, rootBlock, lineOffsets, type BlockChange, type BlockType } from '../markdownBlocks'
import { SourceBlockEditor } from './SourceBlockEditor'
import { formatInlineSelection, readInlineSelection, restoreInlineSelection, type InlineFormat, type InlineSelection } from '../inlineFormatting'
import { BlockControls } from './BlockControls'
import { blockAction, documentBlocks, foldBlock } from '../blockOperations'

export interface PreviewHandle {
  scrollToLine: (line: number, atEnd?: boolean) => void
  addBlock: (position?: number) => void
}

interface PreviewPaneProps {
  mode: DocumentMode
  markdown: string
  theme: ThemeName
  markdownFontSize?: number
  mermaidFontSize?: number
  assetVersion?: number
  onScrollLine: (line: number, atEnd: boolean) => void
  onLayout: () => void
  onSourceLine?: (line: number) => void
  onEditTable?: (line: number) => void
  editing?: boolean
  onVisualChange?: (next: string, previous: string, target: Element) => boolean
  onUndo?: () => void
  onRedo?: () => void
}

interface PreviewFocus extends BlockChange {
  caret?: { field: number; from: number; to: number }
}

const MERMAID_SVG_CACHE_LIMIT = 40
const MERMAID_RENDER_DEBOUNCE_MS = 300
const MERMAID_BASE_PREVIEW_MAX_HEIGHT = 360
const IMAGE_PREVIEW_TRIGGER = 'data-image-preview-trigger'
function resizeCodeEditor(input: HTMLTextAreaElement) {
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

function beginCodeEdit(code: HTMLElement) {
  const input = document.createElement('textarea')
  input.dataset.markdownCodeInput = ''
  input.setAttribute('aria-label', code.getAttribute('aria-label') ?? '')
  input.spellcheck = false
  input.wrap = 'off'
  input.rows = 1
  input.value = code.textContent ?? ''
  code.hidden = true
  code.after(input)
  resizeCodeEditor(input)
  input.focus()
}

function focusPreviewBlock(root: HTMLElement | null, line: number) {
  if (!root) return
  const anchors = Array.from(root.querySelectorAll<HTMLElement>('[data-source-start]'))
  const anchor = anchors.filter((element) => Number(element.dataset.sourceStart) <= line && Number(element.dataset.sourceEnd) >= line).at(-1)
    ?? anchors.find((element) => Number(element.dataset.sourceStart) >= line) ?? anchors.at(-1)
  const block = anchor?.closest<HTMLElement>('.preview-source-block') ?? anchor
  if (!block) return
  const target = block.querySelector<HTMLElement>('[data-markdown-source-edit], [data-markdown-edit-text]') ?? block
  if (!target.isContentEditable && target.tagName !== 'BUTTON') target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'nearest' })
}
function configureMermaidPreview(block: HTMLElement, svg: SVGSVGElement, fontSize: number) {
  const viewBoxWidth = svg.viewBox.baseVal.width
  const previewScale = Math.max(1, mermaidFontScale(fontSize))
  block.style.setProperty('--mermaid-preview-width', `${Math.round(previewScale * 10_000) / 100}%`)
  block.style.setProperty('--mermaid-preview-max-height', `${Math.round(MERMAID_BASE_PREVIEW_MAX_HEIGHT * previewScale)}px`)
  if (viewBoxWidth > 0) block.style.setProperty('--mermaid-preview-max-width', `${viewBoxWidth}px`)
  else block.style.removeProperty('--mermaid-preview-max-width')
}

function decodeFilename(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function imageFilename(image: HTMLImageElement) {
  const candidates = [image.dataset.assetPath, image.currentSrc, image.src]
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('blob:') || candidate.startsWith('data:')) continue
    try {
      const pathname = new URL(candidate, document.baseURI).pathname
      const filename = decodeFilename(pathname.split('/').filter(Boolean).at(-1) ?? '')
      if (filename && filename.includes('.')) return filename
    } catch {
      const filename = decodeFilename(candidate.split('/').filter(Boolean).at(-1) ?? '')
      if (filename && filename.includes('.')) return filename
    }
  }
  const label = [...image.alt.trim()]
    .map((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
    .join('')
    .slice(0, 80)
  return `${label || 'image'}.png`
}

function decoratePreviewTrigger(element: HTMLElement, label: string, title: string) {
  element.setAttribute(IMAGE_PREVIEW_TRIGGER, '')
  if (!element.hasAttribute('role')) {
    element.setAttribute('role', 'button')
    element.setAttribute('data-image-preview-added-role', '')
  }
  if (!element.hasAttribute('tabindex')) {
    element.tabIndex = 0
    element.setAttribute('data-image-preview-added-tabindex', '')
  }
  if (!element.hasAttribute('aria-label')) {
    element.setAttribute('aria-label', label)
    element.setAttribute('data-image-preview-added-label', '')
  }
  if (!element.hasAttribute('title')) {
    element.title = title
    element.setAttribute('data-image-preview-added-title', '')
  }
}

function mermaidMedia(svg: SVGSVGElement, block: HTMLElement, theme: ThemeName, label: string): LightboxMedia {
  const meta = THEME_META[theme]
  const rect = svg.getBoundingClientRect()
  const viewBox = svg.viewBox.baseVal
  const width = viewBox.width || svg.width.baseVal.value || rect.width || 1
  const height = viewBox.height || svg.height.baseVal.value || rect.height || 1
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('width', '100%')
  background.setAttribute('height', '100%')
  background.setAttribute('fill', meta.code)
  clone.prepend(background)

  const previewStyles = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  previewStyles.textContent = `text{fill:${meta.text} !important}.edgeLabel,.labelBkg{color:${meta.text};background-color:${meta.code} !important;fill:${meta.code} !important}.flowchart-link,.messageLine0,.messageLine1{stroke:${meta.muted}}`
  clone.append(previewStyles)

  const source = new XMLSerializer().serializeToString(clone)
  const line = Number(block.dataset.sourceStart)
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    label,
    filename: Number.isFinite(line) && line > 0 ? `mermaid-diagram-line-${line}.svg` : 'mermaid-diagram.svg',
    width,
    height,
    background: meta.code,
  }
}

const PreviewPaneComponent = forwardRef<PreviewHandle, PreviewPaneProps>(function PreviewPane(
  { markdown, mode, theme, markdownFontSize = 16, mermaidFontSize = 14, assetVersion = 0, onScrollLine, onLayout, onSourceLine, onEditTable, editing = false, onVisualChange, onUndo, onRedo },
  ref,
) {
  const { locale, t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const suppressScrollRef = useRef(false)
  const anchorsRef = useRef<SourceAnchor[]>([])
  const geometryDirtyRef = useRef(true)
  const layoutFrameRef = useRef<number | null>(null)
  const mermaidSvgCacheRef = useRef(new Map<string, string>())
  const [lightboxMedia, setLightboxMedia] = useState<LightboxMedia | null>(null)
  const emittedRef = useRef<string | null>(null)
  const renderingRef = useRef<{ source: string; html: string; locale: string; mode: DocumentMode; editing: boolean; version: number } | null>(null)
  const editingModelRef = useRef<ReturnType<typeof prepareMarkdownEditing> | null>(null)
  const changeRef = useRef(onVisualChange)
  changeRef.current = onVisualChange
  const [link, setLink] = useState<{ element: HTMLAnchorElement; url: string } | null>(null)
  const [linkError, setLinkError] = useState(false)
  const [linkOpenDeferred, setLinkOpenDeferred] = useState(false)
  useEffect(() => {
    if (!link) return
    const deferred = () => setLinkOpenDeferred(true)
    window.addEventListener('markword:open-deferred', deferred)
    return () => window.removeEventListener('markword:open-deferred', deferred)
  }, [link])
  const [structureVersion, setStructureVersion] = useState(0)
  const pendingFocusRef = useRef<PreviewFocus | null>(null)
  const activeBlockRef = useRef<HTMLElement | null>(null)
  const [blockMenu, setBlockMenu] = useState<{ target: HTMLElement | null; replace: boolean; position?: { offset: number; source: string } } | null>(null)
  const blockMenuRef = useRef<HTMLDivElement>(null)
  const blockMenuReturnRef = useRef<HTMLElement | null>(null)
  const [sourceEdit, setSourceEdit] = useState<{ source: string; target: HTMLElement; from: number; to: number; line: number; ending: string; initial: string } | null>(null)
  const sourceFocusRef = useRef<number | null>(null)
  const inlineRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const [inlineSelection, setInlineSelection] = useState<{ selection: InlineSelection; source: string; top: number; left: number } | null>(null)
  const [inlineLink, setInlineLink] = useState<typeof inlineSelection>(null)
  const [inlineUrl, setInlineUrl] = useState('')
  const [inlineLinkError, setInlineLinkError] = useState(false)
  const inlineFocusRef = useRef<{ line: number; leaf: number; from: number; to: number } | null>(null)
  const openBlockMenu = useCallback((target: HTMLElement | null, replace = false, position?: { offset: number; source: string }) => {
    blockMenuReturnRef.current = document.activeElement as HTMLElement | null
    setBlockMenu({ target, replace, position })
  }, [])
  const closeBlockMenu = () => { setBlockMenu(null); blockMenuReturnRef.current?.focus() }
  const rendering = useMemo(() => {
    const current = renderingRef.current
    // Keep the live DOM and caret for our own edits; external changes rebuild the preview.
    if (markdown === emittedRef.current && current?.locale === locale && current.mode === mode && current.editing === editing && current.version === structureVersion) return current
    emittedRef.current = null
    const html = editing && !markdown.trim() ? '<p data-source-start="1" data-source-end="1"></p>' : renderMarkdown(markdown, mode)
    return { source: markdown, html, locale, mode, editing, version: structureVersion }
  // A blank paragraph has no rendered Markdown token; structural edits still need a fresh writing line.
  }, [locale, markdown, mode, editing, structureVersion])

  useLayoutEffect(() => {
    renderingRef.current = rendering
    if (contentRef.current) contentRef.current.innerHTML = rendering.html
  }, [rendering])

  useLayoutEffect(() => {
    setLink(null)
    setLinkError(false)
    setInlineLink(null)
    setInlineSelection(null)
    if (!editing || !contentRef.current) return
    const pending = pendingFocusRef.current
    if (pending) {
      const toggle = contentRef.current.querySelector<HTMLElement>(`details[data-source-start="${pending.line}"]`)
      if (toggle) pending.line = Number(toggle.querySelector<HTMLElement>('summary')?.dataset.sourceStart) || pending.line + 1
    }
    if (pending && !pending.code && !pending.table && !pending.focusExisting) ensureWritingLine(contentRef.current, rendering.source, pending.line)
    const model = prepareMarkdownEditing(contentRef.current, rendering.source, t('Code block'))
    editingModelRef.current = model
    contentRef.current.querySelectorAll<HTMLElement>('[data-markdown-edit-text]').forEach((field) => {
      field.dataset.placeholder = t('Write something, or press / for blocks')
    })
    if (pending) {
      pendingFocusRef.current = null
      if (pending.table) onEditTable?.(pending.line)
      else if (pending.code) {
        const code = Array.from(contentRef.current.querySelectorAll<HTMLElement>('pre[data-source-start]')).find((el) => Number(el.dataset.sourceStart) === pending.line - 1)?.querySelector<HTMLElement>('[data-markdown-edit-code]')
        if (code) beginCodeEdit(code)
      } else if (pending.caret) {
        const item = contentRef.current.querySelector<HTMLElement>(`li[data-source-start="${pending.line}"]`)
        const field = item?.querySelectorAll<HTMLElement>('[data-markdown-edit-text]')[pending.caret.field]
        if (field) {
          restoreInlineSelection(field, pending.caret.from, pending.caret.to)
          field.scrollIntoView({ block: 'nearest' })
        } else focusPreviewBlock(contentRef.current, pending.line)
      } else if (pending.focusExisting) focusPreviewBlock(contentRef.current, pending.line)
      else focusWritingLine(contentRef.current, pending.line, pending.offset)
    }
    const inlineFocus = inlineFocusRef.current
    if (inlineFocus) {
      inlineFocusRef.current = null
      const block = contentRef.current.querySelector<HTMLElement>(`[data-source-start="${inlineFocus.line}"]`)
      const leaves = block ? [block, ...block.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, summary')].filter((element) => element.matches('p, li, h1, h2, h3, h4, h5, h6, summary')) : []
      if (leaves[inlineFocus.leaf]) restoreInlineSelection(leaves[inlineFocus.leaf], inlineFocus.from, inlineFocus.to)
    }
    return () => { model.dispose(); editingModelRef.current = null }
  }, [editing, rendering, t, onEditTable])

  useEffect(() => {
    if (!editing || mode !== 'markdown') return
    const refresh = () => {
      if (inlineLink || inlineRef.current?.contains(document.activeElement)) return
      const root = contentRef.current
      const focusedElsewhere = document.activeElement !== document.body && !root?.contains(document.activeElement)
      const selection = !composingRef.current && !focusedElsewhere && root ? readInlineSelection(root) : null
      if (!selection || !editingModelRef.current?.contains(selection.leaf)) { setInlineSelection(null); return }
      const rect = selection.range.getBoundingClientRect()
      setInlineSelection({ selection, source: markdown, left: Math.max(8, Math.min(window.innerWidth - 208, rect.left + rect.width / 2 - 100)), top: Math.max(8, Math.min(window.innerHeight - 56, rect.top > 110 ? rect.top - 52 : rect.bottom + 8)) })
    }
    document.addEventListener('selectionchange', refresh)
    window.addEventListener('resize', refresh)
    return () => {
      document.removeEventListener('selectionchange', refresh)
      window.removeEventListener('resize', refresh)
    }
  }, [editing, inlineLink, markdown, mode])

  useEffect(() => {
    if (!blockMenu) return
    blockMenuRef.current?.querySelector<HTMLButtonElement>('[data-block-type]')?.focus()
    const close = (event: PointerEvent) => {
      if (!blockMenuRef.current?.contains(event.target as Node)) setBlockMenu(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [blockMenu])

  const applyBlockChange = (change: PreviewFocus | null, target: Element) => {
    if (!change || !changeRef.current?.(change.source, markdown, target)) return false
    emittedRef.current = null
    pendingFocusRef.current = { ...change }
    setStructureVersion((version) => version + 1)
    setBlockMenu(null)
    return true
  }

  const addBlock = (type: BlockType, target: HTMLElement | null, replace = false, position?: { offset: number; source: string }) => {
    if (position && position.source !== markdown) { setBlockMenu(null); return }
    const root = contentRef.current
    if (root) applyBlockChange(insertBlock(root, markdown, target?.isConnected ? target : null, type, replace, position?.offset), target ?? root)
  }

  const publishVisualEdit = (target: Element) => {
    return editingModelRef.current?.update(target, (next, previous) => {
      // Set this before React receives the change so an echo cannot replace the caret.
      emittedRef.current = next
      if (changeRef.current?.(next, previous, target)) return true
      emittedRef.current = null
      return false
    }) ?? false
  }

  const applyInline = (format: InlineFormat, saved = inlineSelection, url?: string) => {
    const root = contentRef.current
    if (!saved || saved.source !== markdown || !root || !saved.selection.leaf.isConnected || !editingModelRef.current?.contains(saved.selection.leaf)) return
    const { selection } = saved
    const block = rootBlock(root, selection.leaf)
    if (!block) return
    const leaves = [block, ...block.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, summary')].filter((element) => element.matches('p, li, h1, h2, h3, h4, h5, h6, summary'))
    const original = selection.leaf.innerHTML
    formatInlineSelection(selection, format, url)
    if (!publishVisualEdit(selection.leaf)) { selection.leaf.innerHTML = original; return }
    inlineFocusRef.current = { line: Number(block.dataset.sourceStart), leaf: leaves.indexOf(selection.leaf), from: selection.from, to: selection.to }
    emittedRef.current = null
    setInlineLink(null)
    setInlineSelection(null)
    setStructureVersion((version) => version + 1)
  }

  const retainSelectionForHistory = () => {
    const root = contentRef.current
    const selection = root ? readInlineSelection(root, true) : null
    const block = selection && root && rootBlock(root, selection.leaf)
    if (!selection || !block) return
    const leaves = [block, ...block.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, summary')].filter((element) => element.matches('p, li, h1, h2, h3, h4, h5, h6, summary'))
    const bookmark = { line: Number(block.dataset.sourceStart), leaf: leaves.indexOf(selection.leaf), from: selection.from, to: selection.to }
    inlineFocusRef.current = bookmark
    requestAnimationFrame(() => { if (inlineFocusRef.current === bookmark) inlineFocusRef.current = null })
  }

  const invalidateGeometry = useCallback(() => {
    geometryDirtyRef.current = true
    if (layoutFrameRef.current !== null) return
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null
      onLayout()
    })
  }, [onLayout])

  const readAnchors = useCallback(() => {
    if (geometryDirtyRef.current && contentRef.current) {
      anchorsRef.current = collectSourceAnchors(contentRef.current)
      geometryDirtyRef.current = false
    }
    return anchorsRef.current
  }, [])

  useEffect(() => {
    geometryDirtyRef.current = true
  }, [rendering, markdownFontSize, mermaidFontSize, theme])

  useImperativeHandle(ref, () => ({
    addBlock(position) { openBlockMenu(position === undefined && activeBlockRef.current?.isConnected ? activeBlockRef.current : null, false, position === undefined ? undefined : { offset: position, source: markdown }) },
    scrollToLine(line, atEnd = false) {
      const scroll = scrollRef.current
      if (!scroll) return
      const maxScroll = scroll.scrollHeight - scroll.clientHeight
      suppressScrollRef.current = true
      scroll.scrollTop = atEnd ? maxScroll : lineToPreviewOffset(line, readAnchors(), maxScroll)
      window.setTimeout(() => { suppressScrollRef.current = false }, 100)
    },
  }), [readAnchors, openBlockMenu, markdown])

  useEffect(() => {
    setLightboxMedia(null)
  }, [assetVersion, rendering, mermaidFontSize, theme])

  useLayoutEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('.mermaid-block') || [])
    if (!blocks.length) {
      invalidateGeometry()
      return
    }

    const cache = mermaidSvgCacheRef.current
    const renderPreview = (block: HTMLElement, source: string) => {
      block.innerHTML = source
      const svg = block.querySelector<SVGSVGElement>('svg')
      if (!svg) return
      normalizeMermaidLabelWidths(svg)
      configureMermaidPreview(block, svg, mermaidFontSize)
      const media = mermaidMedia(svg, block, theme, t('Diagram preview'))
      const image = document.createElement('img')
      image.className = 'mermaid-image'
      image.src = media.src
      image.alt = [...svg.querySelectorAll('title, desc, text, foreignObject')]
        .map((label) => label.textContent?.trim()).filter(Boolean).join('；') || media.label
      image.width = Math.round(media.width)
      image.height = Math.round(media.height)
      image.dataset.mermaidFilename = media.filename
      block.replaceChildren(image)
    }
    const pending: Array<{ block: HTMLElement; cacheKey: string; source: string }> = []
    for (const [index, block] of blocks.entries()) {
      const source = decodeURIComponent(block.dataset.mermaidSource || '')
      const cacheKey = `${theme}\u0000${mermaidFontSize}\u0000${index}\u0000${source}`
      const cachedSvg = cache.get(cacheKey)
      if (cachedSvg) {
        renderPreview(block, cachedSvg)
        block.classList.add('is-rendered')
      } else {
        pending.push({ block, cacheKey, source })
      }
    }
    if (!pending.length) {
      invalidateGeometry()
      return
    }

    const renderTimer = window.setTimeout(() => {
      void (async () => {
        for (const { block, cacheKey, source } of pending) {
          if (cancelled) return
          try {
            const svg = await renderMermaidSvg(source, theme, mermaidFontSize)
            if (cancelled) return
            renderPreview(block, svg)
            cache.set(cacheKey, svg)
            if (cache.size > MERMAID_SVG_CACHE_LIMIT) {
              const oldestKey = cache.keys().next().value
              if (oldestKey) cache.delete(oldestKey)
            }
            block.classList.add('is-rendered')
          } catch (error) {
            if (cancelled) return
            showMermaidError(block, source)
            console.warn('Mermaid render failed', error)
          }
          invalidateGeometry()
        }
      })()
    }, MERMAID_RENDER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(renderTimer)
    }
  }, [rendering, invalidateGeometry, mermaidFontSize, theme, t])

  useEffect(() => {
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-math-source]') || [])
    if (!blocks.length) return
    void Promise.all([renderMathBlocks(blocks), import('katex/dist/katex.min.css')])
      .then(invalidateGeometry)
      .catch((error) => console.warn('Math render failed', error))
  }, [rendering, invalidateGeometry])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let cancelled = false
    const objectUrls: string[] = []
    const mediaListeners: Array<{ element: HTMLElement; event: string }> = []
    const elements = Array.from(content.querySelectorAll<HTMLElement>('[data-asset-path]'))
    const paths = [...new Set(elements
      .map((element) => normalizeAssetPath(element.dataset.assetPath))
      .filter((path): path is string => Boolean(path)))]
    if (!paths.length) return

    void getAssetsByPaths(paths).then((assets) => {
      if (cancelled) return
      const urls = new Map<string, string>()
      assets.forEach((asset, path) => {
        const url = URL.createObjectURL(asset.blob)
        objectUrls.push(url)
        urls.set(path, url)
      })

      elements.forEach((element) => {
        const path = normalizeAssetPath(element.dataset.assetPath)
        const url = path ? urls.get(path) : undefined
        const container = element.closest<HTMLElement>('.local-media')
        if (!url) {
          element.classList.remove('is-loading')
          element.classList.add('is-missing')
          container?.classList.remove('is-loading')
          container?.classList.add('is-missing')
          container?.setAttribute('data-missing-label', t('Local asset is missing'))
          element.setAttribute('title', t('Local asset is missing'))
          if (element instanceof HTMLAnchorElement) element.setAttribute('aria-disabled', 'true')
          return
        }

        const settleEvent = element instanceof HTMLVideoElement || element instanceof HTMLAudioElement ? 'loadedmetadata' : 'load'
        if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
          element.addEventListener(settleEvent, invalidateGeometry, { once: true })
          element.addEventListener('error', invalidateGeometry, { once: true })
          mediaListeners.push({ element, event: settleEvent }, { element, event: 'error' })
          element.src = url
        } else if (element instanceof HTMLAnchorElement) {
          element.href = url
        }
        element.classList.remove('is-loading', 'is-missing')
        element.classList.add('is-resolved')
        container?.classList.remove('is-loading', 'is-missing')
        container?.classList.add('is-resolved')
      })
      invalidateGeometry()
    }).catch((error) => {
      if (!cancelled) console.warn('Local asset loading failed', error)
    })

    return () => {
      cancelled = true
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      mediaListeners.forEach(({ element, event }) => element.removeEventListener(event, invalidateGeometry))
    }
  }, [assetVersion, rendering, invalidateGeometry, t])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const resizeObserver = new ResizeObserver(invalidateGeometry)
    resizeObserver.observe(content)
    content.querySelectorAll<HTMLElement>('.dynamic-source-block').forEach((block) => resizeObserver.observe(block))

    const images = Array.from(content.querySelectorAll<HTMLImageElement>('img'))
    const handleImageSettled = () => invalidateGeometry()
    images.forEach((image) => {
      if (!image.complete) {
        image.addEventListener('load', handleImageSettled, { once: true })
        image.addEventListener('error', handleImageSettled, { once: true })
      }
    })
    invalidateGeometry()
    return () => {
      resizeObserver.disconnect()
      images.forEach((image) => {
        image.removeEventListener('load', handleImageSettled)
        image.removeEventListener('error', handleImageSettled)
      })
    }
  }, [rendering, invalidateGeometry])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    content.querySelectorAll<HTMLImageElement>('img:not(.mermaid-image)').forEach((image) => {
      const label = image.alt.trim()
        ? t('Open image preview: {label}', { label: image.alt.trim() })
        : t('Open image preview')
      decoratePreviewTrigger(image, label, t('Click to enlarge'))
    })
    content.querySelectorAll<HTMLElement>('.mermaid-block').forEach((block) => {
      decoratePreviewTrigger(block, t('Open diagram preview'), t('Click to enlarge'))
    })
  }, [rendering, t])

  useEffect(() => {
    if (!onEditTable || !contentRef.current) return
    const wrappers: HTMLElement[] = []
    contentRef.current.querySelectorAll<HTMLTableElement>('table[data-source-start]').forEach((table, index) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'preview-table'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'preview-table__edit'
      button.textContent = t('Edit table')
      button.setAttribute('aria-label', t('Edit table {number}', { number: index + 1 }))
      button.dataset.tableLine = table.dataset.sourceStart
      const scroll = document.createElement('div')
      scroll.className = 'preview-table__scroll'
      table.before(wrapper)
      scroll.append(table)
      wrapper.append(button, scroll)
      wrappers.push(wrapper)
    })
    invalidateGeometry()
    return () => wrappers.forEach((wrapper) => {
      const table = wrapper.querySelector('table')
      if (table) wrapper.replaceWith(table)
    })
  }, [rendering, invalidateGeometry, onEditTable, t])

  useEffect(() => {
    const content = contentRef.current
    if (!editing || !content) return
    const wrappers = protectedMarkdownBlocks(content).map((block) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'preview-source-block'
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.markdownSourceEdit = ''
      button.textContent = t('Edit source')
      button.setAttribute('aria-label', t('Edit block source'))
      block.before(wrapper)
      wrapper.append(button, block)
      return wrapper
    })
    invalidateGeometry()
    if (sourceFocusRef.current !== null) {
      focusPreviewBlock(content, sourceFocusRef.current)
      sourceFocusRef.current = null
    }
    return () => wrappers.forEach((wrapper) => {
      const block = wrapper.lastElementChild
      if (block) wrapper.replaceWith(block)
    })
  }, [editing, rendering, invalidateGeometry, t])

  useEffect(() => () => {
    if (layoutFrameRef.current !== null) window.cancelAnimationFrame(layoutFrameRef.current)
  }, [])

  const handleScroll = () => {
    setInlineSelection(null)
    const scroll = scrollRef.current
    if (!scroll || suppressScrollRef.current) return
    const maxScroll = scroll.scrollHeight - scroll.clientHeight
    const atEnd = maxScroll > 0 && scroll.scrollTop >= maxScroll - 2
    const lastLine = Math.max(1, markdown.split('\n').length)
    const line = atEnd ? lastLine : previewOffsetToLine(scroll.scrollTop, readAnchors(), lastLine, maxScroll)
    onScrollLine(line, atEnd)
  }

  const openImagePreview = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const content = contentRef.current
    if (!content) return false

    const block = target.closest<HTMLElement>(`.mermaid-block.is-rendered[${IMAGE_PREVIEW_TRIGGER}]`)
    const image = target.closest<HTMLImageElement>(`img[${IMAGE_PREVIEW_TRIGGER}]`)
      ?? block?.querySelector<HTMLImageElement>('.mermaid-image')
    if (image && content.contains(image)) {
      if (image.classList.contains('is-missing') || !image.complete || image.naturalWidth <= 0) return false
      setLightboxMedia({
        src: image.currentSrc || image.src,
        label: image.alt.trim() || t('Image preview'),
        filename: image.dataset.mermaidFilename || imageFilename(image),
        width: image.naturalWidth || image.getBoundingClientRect().width,
        height: image.naturalHeight || image.getBoundingClientRect().height,
        background: block ? THEME_META[theme].code : undefined,
      })
      return true
    }

    return false
  }, [t, theme])

  const handleClick = async (event: React.MouseEvent<HTMLElement>) => {
    const summary = (event.target as Element).closest<HTMLElement>('summary')
    if (summary && editing && contentRef.current) {
      event.preventDefault()
      if (!(event.target as Element).closest('[data-markdown-edit-text], a')) {
        const block = documentBlocks(contentRef.current, markdown).find((item) => item.anchor === summary.parentElement)
        if (block) applyBlockChange(foldBlock(markdown, block), block.element)
        return
      }
    }
    const sourceButton = (event.target as Element).closest('[data-markdown-source-edit]')
    if (sourceButton && editing) {
      const block = sourceButton.nextElementSibling as HTMLElement | null
      const line = Number(block?.dataset.sourceStart)
      const end = Number(block?.dataset.sourceEnd)
      const starts = lineOffsets(markdown)
      const from = starts[line - 1]
      if (!block || from === undefined || !Number.isInteger(end) || end < line) return
      const to = starts[end] ?? markdown.length
      const previous = markdown.slice(from, to)
      const ending = previous.match(/\r?\n$/)?.[0] ?? ''
      setSourceEdit({ source: markdown, target: block, from, to, line, ending, initial: ending ? previous.slice(0, -ending.length) : previous })
      return
    }
    if (editing) {
      const target = event.target as Element
      const code = target.closest<HTMLElement>('[data-markdown-edit-code]')
      if (code) { beginCodeEdit(code); return }
      const anchor = target.closest<HTMLAnchorElement>('a')
      if (anchor) {
        event.preventDefault()
        if (editingModelRef.current?.contains(anchor)) { setLink({ element: anchor, url: anchor.getAttribute('href') ?? '' }); setLinkError(false); setLinkOpenDeferred(false) }
        return
      }
    }
    const tableButton = (event.target as Element).closest<HTMLButtonElement>('.preview-table__edit')
    if (tableButton && onEditTable) {
      onEditTable(Number(tableButton.dataset.tableLine))
      return
    }
    if (openImagePreview(event.target)) {
      event.preventDefault()
      return
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.copy-code')
    if (!button) return
    const code = button.parentElement?.querySelector('code')?.textContent || ''
    await navigator.clipboard.writeText(code)
    button.textContent = t('Copied')
    window.setTimeout(() => { button.textContent = t('Copy') }, 1200)
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (editing && (event.target as Element).closest('[data-markdown-edit-text], [data-markdown-edit-code], [data-markdown-code-input]')) return
    const table = (event.target as Element).closest<HTMLTableElement>('table[data-source-start]')
    if (table && onEditTable) {
      event.preventDefault()
      onEditTable(Number(table.dataset.sourceStart))
      return
    }
    if ((event.target as Element).closest(`[${IMAGE_PREVIEW_TRIGGER}]`)) {
      event.preventDefault()
      return
    }
    if (!onSourceLine) return
    const line = elementOffsetToSourceLine(event.target as HTMLElement, event.clientY)
    if (line !== null) onSourceLine(line)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (editing && !event.nativeEvent.isComposing && event.keyCode !== 229 && (event.ctrlKey || event.metaKey) && ['b', 'i', 'e'].includes(event.key.toLowerCase())) {
      const root = contentRef.current
      const selection = root ? readInlineSelection(root) : null
      if (selection && editingModelRef.current?.contains(selection.leaf)) {
        event.preventDefault()
        applyInline(event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : 'code', { selection, source: markdown, top: 0, left: 0 })
      }
      return
    }
    if (event.key === 'Escape' && inlineSelection) {
      event.preventDefault(); window.getSelection()?.collapseToEnd(); setInlineSelection(null); return
    }
    if (editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      retainSelectionForHistory()
      if (event.shiftKey) onRedo?.()
      else onUndo?.()
      return
    }
    if (editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); retainSelectionForHistory(); onRedo?.(); return
    }
    const target = event.target as HTMLElement
    if (editing && target.matches('summary') && ['Enter', ' '].includes(event.key) && contentRef.current) {
      event.preventDefault()
      const block = documentBlocks(contentRef.current, markdown).find((item) => item.anchor === target.parentElement)
      if (block) applyBlockChange(foldBlock(markdown, block), block.element)
      return
    }
    if (editing && target.matches('[data-markdown-edit-code]') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); beginCodeEdit(target); return
    }
    if (editing && target.matches('[data-markdown-code-input]')) {
      if (!event.nativeEvent.isComposing && (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey)))) {
        event.preventDefault(); target.blur()
      }
      return
    }
    if (editing && target.isContentEditable) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Tab' && target.closest('li') && contentRef.current) {
        const blocks = documentBlocks(contentRef.current, markdown)
        const block = blocks.find((item) => item.anchor === target.closest('li'))
        const change = block && blockAction(markdown, blocks, [block], event.shiftKey ? 'outdent' : 'indent', t('Toggle'))
        if (change) {
          event.preventDefault()
          let caret: PreviewFocus['caret']
          const selection = window.getSelection()
          if (block && selection?.rangeCount) {
            const range = selection.getRangeAt(0)
            if (target.contains(range.startContainer) && target.contains(range.endContainer)) {
              const before = range.cloneRange()
              before.selectNodeContents(target)
              before.setEnd(range.startContainer, range.startOffset)
              const from = before.toString().length
              caret = { field: Array.from(block.anchor.querySelectorAll('[data-markdown-edit-text]')).indexOf(target), from, to: from + range.toString().length }
            }
          }
          applyBlockChange({ ...change, caret }, target)
        }
        return
      }
      if (event.key === '/' && !target.closest('p, li, h1, h2, h3, h4, h5, h6')?.textContent?.trim()) {
        event.preventDefault(); openBlockMenu(target, true); return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) target.blur()
        else if (contentRef.current) applyBlockChange(splitBlock(contentRef.current, markdown, target), target)
      }
      if (event.key === 'Backspace' && contentRef.current) {
        const change = mergeBlock(contentRef.current, markdown, target)
        if (change) { event.preventDefault(); applyBlockChange(change, target) }
      }
      if (event.key === 'Escape') target.blur()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!openImagePreview(event.target)) return
    event.preventDefault()
  }

  const closeImagePreview = useCallback(() => setLightboxMedia(null), [])

  return (
    <>
      {inlineSelection && !inlineLink ? <div ref={inlineRef} className="markdown-inline-toolbar" role="toolbar" aria-label={t('Text formatting')} style={{ top: inlineSelection.top, left: inlineSelection.left }} onKeyDown={(event) => {
        if (event.key === 'Escape') { restoreInlineSelection(inlineSelection.selection.leaf, inlineSelection.selection.from, inlineSelection.selection.to); window.getSelection()?.collapseToEnd(); setInlineSelection(null) }
      }}>
        {(['bold', 'italic', 'code', 'link'] as InlineFormat[]).map((format, index) => {
          const Icon = [Bold, Italic, Code, Link][index]
          const label = t(['Bold', 'Italic', 'Inline code', 'Link'][index])
          return <button key={format} type="button" aria-label={label} title={label} aria-pressed={inlineSelection.selection.active[format]} onPointerDown={(event) => event.preventDefault()} onClick={() => {
            if (format === 'link' && !inlineSelection.selection.active.link) { setInlineLink(inlineSelection); setInlineUrl(''); setInlineLinkError(false) }
            else applyInline(format)
          }}><Icon size={18} aria-hidden="true" /></button>
        })}
      </div> : null}
      {inlineLink ? <form className="markdown-link-form" aria-label={t('Add link')} onSubmit={(event) => {
        event.preventDefault()
        if (!isEditableLink(inlineUrl)) { setInlineLinkError(true); return }
        applyInline('link', inlineLink, inlineUrl.trim())
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restoreInlineSelection(inlineLink.selection.leaf, inlineLink.selection.from, inlineLink.selection.to); setInlineLink(null) }
      }}>
        <label htmlFor="markdown-inline-url">{t('Link address')}</label>
        <div><input id="markdown-inline-url" autoFocus value={inlineUrl} onChange={(event) => { setInlineUrl(event.target.value); setInlineLinkError(false) }} aria-invalid={inlineLinkError} aria-describedby={inlineLinkError ? 'markdown-inline-error' : undefined} /><button type="submit" className="toolbar-button">{t('Apply changes')}</button><button type="button" className="toolbar-button" onClick={() => { restoreInlineSelection(inlineLink.selection.leaf, inlineLink.selection.from, inlineLink.selection.to); setInlineLink(null) }}>{t('Cancel')}</button></div>
        {inlineLinkError ? <p id="markdown-inline-error" role="alert">{t('Enter a valid address, such as https://example.com.')}</p> : null}
      </form> : null}
      {editing ? <BlockControls rootRef={contentRef} source={markdown} version={rendering} onChange={applyBlockChange} onAdd={(target, position) => openBlockMenu(position === undefined ? target : null, false, position === undefined ? undefined : { offset: position, source: markdown })} onUndo={onUndo} onRedo={onRedo} /> : null}
      {editing && blockMenu ? <div ref={blockMenuRef} className="markdown-block-menu" role="dialog" aria-label={t('Add content')} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBlockMenu() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }
      }}>
        <div className="markdown-block-menu-heading"><strong>{t('Add content')}</strong><button type="button" aria-label={t('Close')} onClick={closeBlockMenu}><X size={16} /></button></div>
        {BLOCK_TYPES.map((type, index) => {
          const Icon = [Type, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, Code2, Table2, Minus, ChevronRight][index]
          return <button key={type.id} data-block-type={type.id} type="button" onClick={() => addBlock(type.id, blockMenu.target, blockMenu.replace, blockMenu.position)}><Icon size={18} /><span>{t(type.label)}</span></button>
        })}
        {blockMenu.target ? <button type="button" className="markdown-block-delete" onClick={() => { if (contentRef.current) applyBlockChange(deleteBlock(contentRef.current, markdown, blockMenu.target!), blockMenu.target!) }}><Trash2 size={17} /><span>{t('Delete block')}</span></button> : null}
      </div> : null}
      {link && editing ? <form className="markdown-link-form" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); link.element.focus(); setLink(null) }
      }} onSubmit={(event) => {
        event.preventDefault()
        if (!isEditableLink(link.url)) { setLinkError(true); return }
        if (!link.element.isConnected) { setLink(null); return }
        link.element.setAttribute('href', link.url.trim())
        publishVisualEdit(link.element)
        setLink(null)
      }}>
        <label htmlFor="markdown-link-url">{t('Link address')}</label>
        <div><input id="markdown-link-url" value={link.url} onChange={(event) => { setLink({ ...link, url: event.target.value }); setLinkError(false) }} aria-invalid={linkError} aria-describedby={linkError ? 'markdown-link-error' : undefined} /><button type="submit" className="toolbar-button">{t('Apply changes')}</button><button type="button" className="toolbar-button" onClick={() => setLink(null)}>{t('Cancel')}</button></div>
        {linkError && <p id="markdown-link-error" role="alert">{t('Enter a valid address, such as https://example.com.')}</p>}
        {linkOpenDeferred && <p role="alert">{t('The file has not been opened. Apply or cancel this edit, then open the file again.')}</p>}
      </form> : null}
      <div className="preview-scroll" ref={scrollRef} onScroll={handleScroll} style={{ background: THEME_META[theme].background }}>
        {markdown.trim() || editing ? (
          <article
            ref={contentRef}
            className={`markdown-body theme-${theme.toLowerCase()} ${editing ? 'markdown-body--editing' : ''}`}
            style={{ '--markdown-font-size': `${markdownFontSize}px` } as CSSProperties}
            onClick={handleClick}
            onFocus={(event) => { activeBlockRef.current = contentRef.current && rootBlock(contentRef.current, event.target as Element) }}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true; setInlineSelection(null) }}
            onCompositionEnd={() => { composingRef.current = false }}
            onBlur={(event) => {
              const input = event.target as HTMLElement
              if (!input.matches('[data-markdown-code-input]')) return
              const code = input.parentElement?.querySelector<HTMLElement>('[data-markdown-edit-code]')
              if (code) {
                code.innerHTML = highlightCode(editableCodeText(code), code.className.match(/language-(\S+)/)?.[1] ?? '')
                code.hidden = false
              }
              input.remove()
            }}
            onInput={editing ? (event) => {
              const target = event.target as HTMLElement
              if (target instanceof HTMLTextAreaElement) resizeCodeEditor(target)
              publishVisualEdit(target)
            } : undefined}
            onAuxClick={editing ? (event) => { if ((event.target as Element).closest('a')) event.preventDefault() } : undefined}
          />
        ) : (
          <div className="empty-preview">
            <div className="empty-preview__mark">M↓</div>
            <h2>{t(mode === 'mermaid' ? 'Start a Mermaid diagram' : mode === 'text' ? 'Start writing' : 'Start writing Markdown')}</h2>
            <p>{t('Content entered on the left appears here instantly.')}</p>
          </div>
        )}
        {editing ? <div className="markdown-append" style={{ color: THEME_META[theme].muted }}><button type="button" onClick={() => addBlock('text', null)}><Plus size={18} /><span>{t('Add content')}</span><kbd>/</kbd></button></div> : null}
      </div>
      {sourceEdit ? <SourceBlockEditor initial={sourceEdit.initial} onClose={() => {
        const line = sourceEdit.line
        setSourceEdit(null)
        requestAnimationFrame(() => focusPreviewBlock(contentRef.current, line))
      }} onApply={(value) => {
        const newline = sourceEdit.source.includes('\r\n') ? '\r\n' : '\n'
        const replacement = value.replace(/\r?\n/g, newline) + sourceEdit.ending
        const next = sourceEdit.source.slice(0, sourceEdit.from) + replacement + sourceEdit.source.slice(sourceEdit.to)
        if (!changeRef.current?.(next, sourceEdit.source, sourceEdit.target)) return false
        emittedRef.current = null
        sourceFocusRef.current = sourceEdit.line
        setSourceEdit(null)
        setStructureVersion((version) => version + 1)
        return true
      }} /> : null}
      {lightboxMedia ? <ImageLightbox media={lightboxMedia} onClose={closeImagePreview} /> : null}
    </>
  )
})

export const PreviewPane = memo(PreviewPaneComponent)
