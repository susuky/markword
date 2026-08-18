import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import mermaid from 'mermaid'
import { collectSourceAnchors, lineToPreviewOffset, previewOffsetToLine, renderMarkdown } from '../markdown'
import type { ThemeName } from '../types'

export interface PreviewHandle {
  scrollToLine: (line: number, atEnd?: boolean) => void
}

interface PreviewPaneProps {
  markdown: string
  theme: ThemeName
  onScrollLine: (line: number, atEnd: boolean) => void
  onLayout: () => void
}

const PreviewPaneComponent = forwardRef<PreviewHandle, PreviewPaneProps>(function PreviewPane(
  { markdown, theme, onScrollLine, onLayout },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const suppressScrollRef = useRef(false)
  const html = useMemo(() => renderMarkdown(markdown), [markdown])

  const readAnchors = () => contentRef.current ? collectSourceAnchors(contentRef.current) : []

  useImperativeHandle(ref, () => ({
    scrollToLine(line, atEnd = false) {
      const scroll = scrollRef.current
      if (!scroll) return
      const maxScroll = scroll.scrollHeight - scroll.clientHeight
      suppressScrollRef.current = true
      scroll.scrollTop = atEnd ? maxScroll : lineToPreviewOffset(line, readAnchors(), maxScroll)
      window.setTimeout(() => { suppressScrollRef.current = false }, 90)
    },
  }))

  useEffect(() => {
    let cancelled = false
    const blocks = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('.mermaid-block') || [])
    if (!blocks.length) {
      onLayout()
      return
    }

    void (async () => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'Light' ? 'default' : 'dark',
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
          block.innerHTML = `<pre class="mermaid-fallback"><code>${source.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>`
          console.warn('Mermaid render failed', error)
        }
      }
      onLayout()
    })()
    return () => { cancelled = true }
  }, [html, onLayout, theme])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(onLayout)
    observer.observe(content)
    return () => observer.disconnect()
  }, [onLayout])

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

  return (
    <div className="preview-scroll" ref={scrollRef} onScroll={handleScroll}>
      {markdown.trim() ? (
        <article
          ref={contentRef}
          className={`markdown-body theme-${theme.toLowerCase()}`}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={handleClick}
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
