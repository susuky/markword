import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import {
  collectSourceAnchors,
  elementOffsetToSourceLine,
  lineToPreviewOffset,
  previewOffsetToLine,
  renderMarkdown,
  type SourceAnchor,
} from '../markdown'
import '../markdownFeatures.css'
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

const PreviewPaneComponent = forwardRef<PreviewHandle, PreviewPaneProps>(function PreviewPane(
  { markdown, theme, onScrollLine, onLayout, onSourceLine },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const suppressScrollRef = useRef(false)
  const anchorsRef = useRef<SourceAnchor[]>([])
  const geometryDirtyRef = useRef(true)
  const layoutFrameRef = useRef<number | null>(null)
  const html = useMemo(() => renderMarkdown(markdown), [markdown])

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

  useEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('.mermaid-block') || [])
    if (!blocks.length) {
      invalidateGeometry()
      return
    }

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
      for (const [index, block] of blocks.entries()) {
        if (cancelled) return
        const source = decodeURIComponent(block.dataset.mermaidSource || '')
        try {
          const { svg } = await mermaid.render(`mermaid-${crypto.randomUUID()}-${index}`, source)
          if (cancelled) return
          block.innerHTML = svg
          block.classList.add('is-rendered')
        } catch (error) {
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
    return () => { cancelled = true }
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
    button.textContent = '已複製'
    window.setTimeout(() => { button.textContent = '複製' }, 1200)
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
          <h2>開始撰寫 Markdown</h2>
          <p>左側輸入的內容會即時顯示在這裡。</p>
        </div>
      )}
    </div>
  )
})

export const PreviewPane = memo(PreviewPaneComponent)
