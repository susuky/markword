import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  collectSourceAnchors,
  elementOffsetToSourceLine,
  lineToPreviewOffset,
  previewOffsetToLine,
  renderMarkdown,
  type SourceAnchor,
} from '../markdown'
import { normalizeAssetPath } from '../assets'
import '../markdownFeatures.css'
import { useI18n } from '../i18n'
import { getAssetsByPaths } from '../storage'
import type { DocumentMode, ThemeName } from '../types'
import { THEME_META } from '../themeConfig'
import { mermaidFontScale, normalizeMermaidLabelWidths, renderMathBlocks, renderMermaidSvg, showMermaidError } from '../dynamicMarkdown'
import { ImageLightbox, type LightboxMedia } from './ImageLightbox'

export interface PreviewHandle {
  scrollToLine: (line: number, atEnd?: boolean) => void
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
}

const MERMAID_SVG_CACHE_LIMIT = 40
const MERMAID_RENDER_DEBOUNCE_MS = 300
const MERMAID_BASE_PREVIEW_MAX_HEIGHT = 360
const IMAGE_PREVIEW_TRIGGER = 'data-image-preview-trigger'
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
  { markdown, mode, theme, markdownFontSize = 16, mermaidFontSize = 14, assetVersion = 0, onScrollLine, onLayout, onSourceLine, onEditTable },
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
  const html = useMemo(() => {
    void locale
    return renderMarkdown(markdown, mode)
  }, [locale, markdown, mode])
  const renderedHtml = useMemo(() => ({ __html: html }), [html])

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
  }, [html, markdownFontSize, mermaidFontSize, theme])

  useImperativeHandle(ref, () => ({
    scrollToLine(line, atEnd = false) {
      const scroll = scrollRef.current
      if (!scroll) return
      const maxScroll = scroll.scrollHeight - scroll.clientHeight
      suppressScrollRef.current = true
      scroll.scrollTop = atEnd ? maxScroll : lineToPreviewOffset(line, readAnchors(), maxScroll)
      window.setTimeout(() => { suppressScrollRef.current = false }, 100)
    },
  }), [readAnchors])

  useEffect(() => {
    setLightboxMedia(null)
  }, [assetVersion, html, mermaidFontSize, theme])

  useLayoutEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('.mermaid-block') || [])
    if (!blocks.length) {
      invalidateGeometry()
      return
    }

    const cache = mermaidSvgCacheRef.current
    const pending: Array<{ block: HTMLElement; cacheKey: string; source: string }> = []
    for (const [index, block] of blocks.entries()) {
      const source = decodeURIComponent(block.dataset.mermaidSource || '')
      const cacheKey = `${theme}\u0000${mermaidFontSize}\u0000${index}\u0000${source}`
      const cachedSvg = cache.get(cacheKey)
      if (cachedSvg) {
        block.innerHTML = cachedSvg
        const svg = block.querySelector<SVGSVGElement>('svg')
        if (svg) {
          normalizeMermaidLabelWidths(svg)
          configureMermaidPreview(block, svg, mermaidFontSize)
        }
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
            block.innerHTML = svg
            const renderedSvg = block.querySelector<SVGSVGElement>('svg')
            if (renderedSvg) {
              normalizeMermaidLabelWidths(renderedSvg)
              configureMermaidPreview(block, renderedSvg, mermaidFontSize)
            }
            cache.set(cacheKey, block.innerHTML)
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
  }, [html, invalidateGeometry, mermaidFontSize, theme, t])

  useEffect(() => {
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-math-source]') || [])
    if (!blocks.length) return
    void Promise.all([renderMathBlocks(blocks), import('katex/dist/katex.min.css')])
      .then(invalidateGeometry)
      .catch((error) => console.warn('Math render failed', error))
  }, [html, invalidateGeometry])

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
  }, [assetVersion, html, invalidateGeometry, t])

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
  }, [html, invalidateGeometry])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    content.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const label = image.alt.trim()
        ? t('Open image preview: {label}', { label: image.alt.trim() })
        : t('Open image preview')
      decoratePreviewTrigger(image, label, t('Click to enlarge'))
    })
    content.querySelectorAll<HTMLElement>('.mermaid-block').forEach((block) => {
      decoratePreviewTrigger(block, t('Open diagram preview'), t('Click to enlarge'))
    })
  }, [html, t])

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
  }, [html, invalidateGeometry, onEditTable, t])

  useEffect(() => () => {
    if (layoutFrameRef.current !== null) window.cancelAnimationFrame(layoutFrameRef.current)
  }, [])

  const handleScroll = () => {
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

    const image = target.closest<HTMLImageElement>(`img[${IMAGE_PREVIEW_TRIGGER}]`)
    if (image && content.contains(image)) {
      if (image.classList.contains('is-missing') || !image.complete || image.naturalWidth <= 0) return false
      setLightboxMedia({
        src: image.currentSrc || image.src,
        label: image.alt.trim() || t('Image preview'),
        filename: imageFilename(image),
        width: image.naturalWidth || image.getBoundingClientRect().width,
        height: image.naturalHeight || image.getBoundingClientRect().height,
      })
      return true
    }

    const block = target.closest<HTMLElement>(`.mermaid-block.is-rendered[${IMAGE_PREVIEW_TRIGGER}]`)
    const svg = block?.querySelector<SVGSVGElement>('svg')
    if (!block || !svg || !content.contains(block)) return false
    setLightboxMedia(mermaidMedia(svg, block, theme, t('Diagram preview')))
    return true
  }, [t, theme])

  const handleClick = async (event: React.MouseEvent<HTMLElement>) => {
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
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!openImagePreview(event.target)) return
    event.preventDefault()
  }

  const closeImagePreview = useCallback(() => setLightboxMedia(null), [])

  return (
    <>
      <div className="preview-scroll" ref={scrollRef} onScroll={handleScroll} style={{ background: THEME_META[theme].background }}>
        {markdown.trim() ? (
          <article
            ref={contentRef}
            className={`markdown-body theme-${theme.toLowerCase()}`}
            style={{ '--markdown-font-size': `${markdownFontSize}px` } as CSSProperties}
            dangerouslySetInnerHTML={renderedHtml}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div className="empty-preview">
            <div className="empty-preview__mark">M↓</div>
            <h2>{t(mode === 'mermaid' ? 'Start a Mermaid diagram' : mode === 'text' ? 'Start writing' : 'Start writing Markdown')}</h2>
            <p>{t('Content entered on the left appears here instantly.')}</p>
          </div>
        )}
      </div>
      {lightboxMedia ? <ImageLightbox media={lightboxMedia} onClose={closeImagePreview} /> : null}
    </>
  )
})

export const PreviewPane = memo(PreviewPaneComponent)
