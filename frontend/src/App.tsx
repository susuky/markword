import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Palette,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { exportDocument } from './api'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { PreviewPane, type PreviewHandle } from './components/PreviewPane'
import { StatsPopover } from './components/StatsPopover'
import { useDebouncedStats } from './hooks/useDebouncedStats'
import { SAMPLE_MARKDOWN } from './sample'
import type { ThemeName } from './types'

const THEMES: ThemeName[] = ['Light', 'Dark', 'Nord', 'Dracula']
const THEME_LABELS: Record<ThemeName, string> = {
  Light: '明亮',
  Dark: '深色',
  Nord: 'Nord',
  Dracula: 'Dracula',
}

function loadSavedMarkdown() {
  return localStorage.getItem('markword.document') ?? SAMPLE_MARKDOWN
}

export default function App() {
  const [markdown, setMarkdown] = useState(loadSavedMarkdown)
  const deferredMarkdown = useDeferredValue(markdown)
  const [theme, setTheme] = useState<ThemeName>('Light')
  const [split, setSplit] = useState(49)
  const [statsOpen, setStatsOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
  const [notice, setNotice] = useState('')
  const [activeLine, setActiveLine] = useState(1)
  const activeLineRef = useRef(1)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const totalLines = Math.max(1, markdown.split('\n').length)
  activeLineRef.current = activeLine

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem('markword.document', markdown), 300)
    return () => window.clearTimeout(timer)
  }, [markdown])

  const handleEditorScroll = useCallback((line: number, atEnd: boolean) => {
    setActiveLine(line)
    previewRef.current?.scrollToLine(line, atEnd)
  }, [])

  const handlePreviewScroll = useCallback((line: number) => {
    setActiveLine(line)
    editorRef.current?.scrollToLine(line)
  }, [])

  const handlePreviewLayout = useCallback(() => {
    previewRef.current?.scrollToLine(activeLineRef.current)
  }, [])

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!workspaceRef.current || window.matchMedia('(max-width: 760px)').matches) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const workspace = workspaceRef.current
    const onMove = (moveEvent: PointerEvent) => {
      const rect = workspace.getBoundingClientRect()
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100
      setSplit(Math.min(70, Math.max(30, next)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleExport = async (format: 'pdf' | 'docx') => {
    if (!markdown.trim() || exporting) return
    setExporting(format)
    setNotice('')
    try {
      await exportDocument(format, markdown, theme)
      setNotice(`${format.toUpperCase()} 已開始下載`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '匯出失敗，請稍後再試')
    } finally {
      setExporting(null)
      window.setTimeout(() => setNotice(''), 3000)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">M↓</div>
          <span>文字工具箱</span>
        </div>
        <nav className="header-actions" aria-label="文件工具">
          <button
            className={`toolbar-button ${statsOpen ? 'is-active' : ''}`}
            type="button"
            onClick={() => setStatsOpen((open) => !open)}
          >
            <BarChart3 size={17} />
            <span>字數統計</span>
          </button>
          <div className="active-mode" aria-current="page">
            <Eye size={17} />
            <span>Markdown 預覽</span>
          </div>
          <div className="menu-wrap">
            <button className="toolbar-button" type="button" onClick={() => setThemeOpen((open) => !open)}>
              <Palette size={17} />
              <span>{THEME_LABELS[theme]}</span>
              <ChevronDown size={15} />
            </button>
            {themeOpen ? (
              <div className="theme-menu" role="menu">
                {THEMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={name === theme ? 'is-selected' : ''}
                    onClick={() => { setTheme(name); setThemeOpen(false) }}
                    role="menuitem"
                  >
                    <span className={`theme-swatch theme-swatch--${name.toLowerCase()}`} />
                    {THEME_LABELS[name]}
                    {name === theme ? <CheckCircle2 size={15} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="header-divider" />
          <button className="toolbar-button" type="button" disabled={!markdown.trim() || Boolean(exporting)} onClick={() => handleExport('pdf')}>
            <Download size={17} />
            <span>{exporting === 'pdf' ? '匯出中…' : '匯出 PDF'}</span>
          </button>
          <button className="toolbar-button" type="button" disabled={!markdown.trim() || Boolean(exporting)} onClick={() => handleExport('docx')}>
            <FileText size={17} />
            <span>{exporting === 'docx' ? '匯出中…' : '匯出 Word'}</span>
          </button>
        </nav>
      </header>

      <section className="workspace" ref={workspaceRef}>
        <section className="pane pane--editor" style={{ width: `${split}%` }}>
          <header className="pane-header">
            <div><span className="pane-dot" />Markdown 原始碼</div>
            <span>自動儲存</span>
          </header>
          <EditorPane ref={editorRef} value={markdown} onChange={setMarkdown} onScrollLine={handleEditorScroll} />
        </section>

        <button className="splitter" type="button" onPointerDown={beginResize} aria-label="調整編輯器與預覽寬度">
          <span className="sync-rail" aria-hidden="true">
            <i style={{ top: `${Math.min(96, Math.max(2, (activeLine / totalLines) * 100))}%` }} />
          </span>
          <span className="splitter-grip">↔</span>
        </button>

        <section className="pane pane--preview" style={{ width: `${100 - split}%` }}>
          <header className="pane-header">
            <div><Eye size={15} />即時預覽</div>
            <span>{THEME_LABELS[theme]}主題</span>
          </header>
          <PreviewPane
            ref={previewRef}
            markdown={deferredMarkdown}
            theme={theme}
            onScrollLine={handlePreviewScroll}
            onLayout={handlePreviewLayout}
          />
        </section>

        {statsOpen ? (
          <StatsPopover stats={stats} available={available} onClose={() => setStatsOpen(false)} onClear={() => setMarkdown('')} />
        ) : null}
      </section>

      <footer className="status-bar">
        <span><FileText size={14} />字數 {stats.chars_no_spaces.toLocaleString()}</span>
        <span>行數 {stats.line_count.toLocaleString()}</span>
        <span className={available ? 'status-ok' : 'status-warn'}><CheckCircle2 size={14} />{available ? '已同步' : '離線'}</span>
        <span className="status-line">第 {Math.round(activeLine)} 行 / {totalLines}</span>
      </footer>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
