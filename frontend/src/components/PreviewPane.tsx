import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import {
  collectSourceAnchors,
  elementOffsetToSourceLine,
  lineToPreviewOffset,
  previewOffsetToLine,
  renderMarkdown,
  type SourceAnchor,
} from '../markdown'
import '../markdownFeatures.css'
import { useI18n } from '../i18n'
import type { ThemeName } from '../types'
import { mermaidThemeVariables, THEME_META } from '../themeConfig'

export interface PreviewHandle {
  scrollToLine: (line: number, atEnd?: boolean) => void
  getRenderedHtml: () => string | null
}

interface PreviewPaneProps {
  markdown: string
  theme: ThemeName
  onScrollLine: (line: number, atEnd: boolean) => void
  onLayout: () => void
  onSourceLine?: (line: number) => void
}

const MERMAID_SVG_CACHE_LIMIT = 40
const MERMAID_RENDER_DEBOUNCE_MS = 300
let mermaidRenderSequence = 0

function nextMermaidRenderId(index: number) {
  mermaidRenderSequence += 1
  return `mermaid-${Date.now().toString(36)}-${mermaidRenderSequence.toString(36)}-${index}`
}

const PreviewPaneComponent = forwardRef<PreviewHandle, PreviewPaneProps>(function PreviewPane(
  { markdown, theme, onScrollLine, onLayout, onSourceLine },
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
  const html = useMemo(() => {
    void locale
    return renderMarkdown(markdown)
  }, [locale, markdown])

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
  }, [html, theme])

  useImperativeHandle(ref, () => ({
    scrollToLine(line, atEnd = false) {
      const scroll = scrollRef.current
      if (!scroll) return
      const maxScroll = scroll.scrollHeight - scroll.clientHeight
      suppressScrollRef.current = true
      scroll.scrollTop = atEnd ? maxScroll : lineToPreviewOffset(line, readAnchors(), maxScroll)
      window.setTimeout(() => { suppressScrollRef.current = false }, 100)
    },
    getRenderedHtml() {
      return contentRef.current?.innerHTML ?? null
    },
  }), [readAnchors])

  useLayoutEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('.mermaid-block') || [])
    if (!blocks.length) {
      invalidateGeometry()
      return
    }

    const cache = mermaidSvgCacheRef.current
    const pending: Array<{ block: HTMLElement; cacheKey: string; index: number; source: string }> = []
    for (const [index, block] of blocks.entries()) {
      const source = decodeURIComponent(block.dataset.mermaidSource || '')
      const cacheKey = `${theme}\u0000${index}\u0000${source}`
      const cachedSvg = cache.get(cacheKey)
      if (cachedSvg) {
        block.innerHTML = cachedSvg
        block.classList.add('is-rendered')
      } else {
        pending.push({ block, cacheKey, index, source })
      }
    }
    if (!pending.length) {
      invalidateGeometry()
      return
    }

    const renderTimer = window.setTimeout(() => {
      void (async () => {
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(theme),
          fontFamily: 'Noto Sans TC, sans-serif',
        })
        for (const { block, cacheKey, index, source } of pending) {
          if (cancelled) return
          try {
            const { svg } = await mermaid.render(nextMermaidRenderId(index), source)
            if (cancelled) return
            cache.set(cacheKey, svg)
            if (cache.size > MERMAID_SVG_CACHE_LIMIT) {
              const oldestKey = cache.keys().next().value
              if (oldestKey) cache.delete(oldestKey)
            }
            block.innerHTML = svg
            block.classList.add('is-rendered')
          } catch (error) {
            if (cancelled) return
            block.classList.add('has-error')
            const code = document.createElement('code')
            code.textContent = source
            const pre = document.createElement('pre')
            pre.className = 'mermaid-fallback'
            pre.append(code)
            block.replaceChildren(pre)
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
  }, [html, invalidateGeometry, theme])

  useEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-math-source]') || [])
    if (!blocks.length) return

    void (async () => {
      const [{ default: katex }] = await Promise.all([
        import('katex'),
        import('katex/dist/katex.min.css'),
      ])
      if (cancelled) return
      for (const block of blocks) {
        if (cancelled) return
        const source = decodeURIComponent(block.dataset.mathSource || '')
        katex.render(source, block, {
          displayMode: block.dataset.mathDisplay === 'true',
          output: 'htmlAndMathml',
          strict: 'warn',
          throwOnError: false,
          trust: false,
        })
        block.classList.add('is-rendered')
        invalidateGeometry()
      }
    })()
    return () => { cancelled = true }
  }, [html, invalidateGeometry])

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

  const handleClick = async (event: React.MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.copy-code')
    if (!button) return
    const code = button.parentElement?.querySelector('code')?.textContent || ''
    await navigator.clipboard.writeText(code)
    button.textContent = t('Copied')
    window.setTimeout(() => { button.textContent = t('Copy') }, 1200)
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!onSourceLine) return
    const line = elementOffsetToSourceLine(event.target as HTMLElement, event.clientY)
    if (line !== null) onSourceLine(line)
  }

  return (
      <div className="preview-scroll" ref={scrollRef} onScroll={handleScroll} style={{ background: THEME_META[theme].background }}>
      {markdown.trim() ? (
        <article
          ref={contentRef}
          className={`markdown-body theme-${theme.toLowerCase()}`}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
      ) : (
        <div className="empty-preview">
          <div className="empty-preview__mark">M↓</div>
          <h2>{t('Start writing Markdown')}</h2>
          <p>{t('Content entered on the left appears here instantly.')}</p>
        </div>
      )}
    </div>
  )
})

export const PreviewPane = memo(PreviewPaneComponent)
