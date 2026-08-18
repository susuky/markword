import {
  AlignCenter,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Code2,
  Download,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  HelpCircle,
  ListTree,
  Maximize2,
  Menu,
  Palette,
  Search,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { exportDocument } from './api'
import { CommandPalette, type CommandAction } from './components/CommandPalette'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { OutlinePanel, type OutlineHeading } from './components/OutlinePanel'
import { PreviewPane, type PreviewHandle } from './components/PreviewPane'
import { RevisionPanel } from './components/RevisionPanel'
import { ShortcutHelp } from './components/ShortcutHelp'
import { StatsPopover } from './components/StatsPopover'
import { useDebouncedStats } from './hooks/useDebouncedStats'
import { renderMarkdown } from './markdown'
import './productivity.css'
import { SAMPLE_MARKDOWN } from './sample'
import { DraftPersistenceSession, loadPreference, savePreference, type PersistenceStatus } from './storage'
import type { ThemeName } from './types'

const THEMES: ThemeName[] = ['Light', 'Dark', 'Nord', 'Dracula']
const THEME_LABELS: Record<ThemeName, string> = { Light: '明亮', Dark: '深色', Nord: 'Nord', Dracula: 'Dracula' }
const THEME_EXPORT_COLORS: Record<ThemeName, { background: string; text: string; muted: string; border: string; code: string; accent: string }> = {
  Light: { background: '#ffffff', text: '#263246', muted: '#64748b', border: '#e2e8f0', code: '#f7f8fb', accent: '#4f46e5' },
  Dark: { background: '#0f172a', text: '#e2e8f0', muted: '#94a3b8', border: '#334155', code: '#1e293b', accent: '#38bdf8' },
  Nord: { background: '#2e3440', text: '#eceff4', muted: '#d8dee9', border: '#4c566a', code: '#3b4252', accent: '#88c0d0' },
  Dracula: { background: '#282a36', text: '#f8f8f2', muted: '#bfbfbf', border: '#44475a', code: '#343746', accent: '#bd93f9' },
}

const MAX_LOCAL_FILE_BYTES = 5_000_000

function documentTitle(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, '').trim() || 'markword-document'
  return title.replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 120) || 'markword-document'
}

function downloadBlob(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function collectHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  let fence = ''
  markdown.split('\n').forEach((line, index) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fence = fence === marker ? '' : (fence || marker)
      return
    }
    if (fence) return
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!match) return
    const text = match[2].replace(/\[([^\]]+)]\([^)]*\)|[*_`~]/g, '$1').trim()
    headings.push({ id: `${index + 1}-${headings.length}`, level: match[1].length, line: index + 1, text })
  })
  return headings
}

function portableHtml(markdown: string, theme: ThemeName) {
  const colors = THEME_EXPORT_COLORS[theme]
  const title = documentTitle(markdown).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:${theme === 'Light' ? 'light' : 'dark'}}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.78}.document{width:min(100% - 40px,880px);margin:auto;padding:48px 0 80px}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:2.25rem}h2{font-size:1.55rem;margin-top:1.5em}h3{font-size:1.2rem;margin-top:1.4em}a{color:${colors.accent}}code{background:${colors.code};padding:.14em .35em;border-radius:4px}pre{overflow:auto;background:${colors.code};border:1px solid ${colors.border};border-radius:8px;padding:16px}pre code{padding:0}.copy-code,.mermaid-loading{display:none}.mermaid-fallback{display:block}.mermaid-block{border:1px solid ${colors.border};border-radius:8px;padding:16px}blockquote{margin:1.2em 0;padding:.6em 1em;border-left:3px solid ${colors.accent};color:${colors.muted};background:${colors.code}}table{width:100%;border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:8px 11px;text-align:left}th{background:${colors.code}}img,svg{max-width:100%;height:auto}@media print{.document{width:auto;padding:0}}
</style></head><body><main class="document">${renderMarkdown(markdown)}</main></body></html>`
}

export default function App() {
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN)
  const deferredMarkdown = useDeferredValue(markdown)
  const [theme, setTheme] = useState<ThemeName>(() => loadPreference('theme', 'Light'))
  const [split, setSplit] = useState(() => loadPreference('split', 49))
  const [statsOpen, setStatsOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
  const [notice, setNotice] = useState('')
  const [activeLine, setActiveLine] = useState(1)
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => loadPreference('outline-collapsed', false))
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(() => loadPreference('sync-enabled', true))
  const [mobileView, setMobileView] = useState<'editor' | 'preview'>('editor')
  const [dragActive, setDragActive] = useState(false)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('idle')
  const [persistence] = useState(() => new DraftPersistenceSession({ onStatusChange: setPersistenceStatus }))
  const activeLineRef = useRef(1)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const totalLines = Math.max(1, markdown.split('\n').length)
  const headings = useMemo(() => collectHeadings(markdown), [markdown])
  activeLineRef.current = activeLine

  useEffect(() => {
    let cancelled = false
    void persistence.initialize(SAMPLE_MARKDOWN, { theme: 'Light' }).then((draft) => {
      if (cancelled) return
      setMarkdown(draft.content)
      const savedTheme = draft.metadata.theme
      if (typeof savedTheme === 'string' && THEMES.includes(savedTheme as ThemeName)) setTheme(savedTheme as ThemeName)
      setHydrated(true)
      persistence.start()
    }).catch(() => {
      if (!cancelled) setHydrated(true)
    })
    return () => {
      cancelled = true
      persistence.stop()
    }
  }, [persistence])

  useEffect(() => {
    if (hydrated) persistence.update(markdown, { theme })
  }, [hydrated, markdown, persistence, theme])

  useEffect(() => {
    savePreference('theme', theme)
    savePreference('split', split)
    savePreference('outline-collapsed', outlineCollapsed)
    savePreference('sync-enabled', syncEnabled)
  }, [outlineCollapsed, split, syncEnabled, theme])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }, [])

  const loadFile = useCallback(async (file: File) => {
    if (!/\.(md|markdown)$/i.test(file.name)) {
      showNotice('請選擇 .md 或 .markdown 檔案')
      return
    }
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      showNotice('檔案超過 5 MB，請先縮小後再開啟')
      return
    }
    setMarkdown(await file.text())
    setActiveLine(1)
    editorRef.current?.jumpToLine(1)
    showNotice(`已開啟 ${file.name}`)
  }, [showNotice])

  const downloadMarkdown = useCallback(() => {
    downloadBlob(markdown, 'text/markdown;charset=utf-8', `${documentTitle(markdown)}.md`)
    showNotice('Markdown 已下載')
  }, [markdown, showNotice])

  const downloadHtml = useCallback(() => {
    downloadBlob(portableHtml(markdown, theme), 'text/html;charset=utf-8', `${documentTitle(markdown)}.html`)
    showNotice('可攜 HTML 已下載')
  }, [markdown, showNotice, theme])

  const handleEditorScroll = useCallback((line: number, atEnd: boolean) => {
    setActiveLine(line)
    if (syncEnabled) previewRef.current?.scrollToLine(line, atEnd)
  }, [syncEnabled])

  const handlePreviewScroll = useCallback((line: number) => {
    setActiveLine(line)
    if (syncEnabled) editorRef.current?.scrollToLine(line)
  }, [syncEnabled])

  const handlePreviewLayout = useCallback(() => {
    if (syncEnabled) previewRef.current?.scrollToLine(activeLineRef.current)
  }, [syncEnabled])

  const jumpToLine = useCallback((line: number) => {
    setMobileView('editor')
    setActiveLine(line)
    editorRef.current?.jumpToLine(line)
    if (syncEnabled) previewRef.current?.scrollToLine(line)
  }, [syncEnabled])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!workspaceRef.current || window.matchMedia('(max-width: 760px)').matches) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const workspace = workspaceRef.current
    const onMove = (moveEvent: PointerEvent) => {
      const rect = workspace.getBoundingClientRect()
      setSplit(Math.min(70, Math.max(30, ((moveEvent.clientX - rect.left) / rect.width) * 100)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleExport = useCallback(async (format: 'pdf' | 'docx') => {
    if (!markdown.trim() || exporting) return
    setExporting(format)
    setNotice('')
    try {
      await exportDocument(format, markdown, theme)
      showNotice(`${format.toUpperCase()} 已開始下載`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '匯出失敗，請稍後再試')
    } finally {
      setExporting(null)
    }
  }, [exporting, markdown, showNotice, theme])

  const createManualSnapshot = useCallback(async () => {
    try {
      await persistence.snapshot('manual')
      showNotice('已建立目前版本')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '建立版本失敗')
    }
  }, [persistence, showNotice])

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: 'open', label: '開啟 Markdown', description: '從本機開啟 .md 檔', shortcut: 'Ctrl O', keywords: '檔案 upload', run: () => fileInputRef.current?.click() },
    { id: 'save-md', label: '下載 Markdown', description: '保留原始內容', shortcut: 'Ctrl S', keywords: '匯出 save', run: downloadMarkdown },
    { id: 'save-html', label: '下載可攜 HTML', description: '內嵌樣式，可離線閱讀', keywords: '匯出 self contained', run: downloadHtml },
    { id: 'search', label: '搜尋文件', shortcut: 'Ctrl F', run: () => editorRef.current?.search() },
    { id: 'insert-heading', label: '插入：二級標題', description: '## 標題', keywords: '/ heading', run: () => editorRef.current?.insert('\n## 標題\n', 4) },
    { id: 'insert-table', label: '插入：表格', description: '三欄 Markdown 表格', keywords: '/ table', run: () => editorRef.current?.insert('\n| 欄位一 | 欄位二 | 欄位三 |\n| --- | --- | --- |\n| 內容 | 內容 | 內容 |\n') },
    { id: 'insert-code', label: '插入：程式碼區塊', description: 'fenced code block', keywords: '/ code', run: () => editorRef.current?.insert('\n```text\n\n```\n', 9) },
    { id: 'insert-mermaid', label: '插入：Mermaid 圖表', description: '基本流程圖', keywords: '/ diagram', run: () => editorRef.current?.insert('\n```mermaid\ngraph TD\n  A[開始] --> B[完成]\n```\n') },
    { id: 'focus', label: focusMode ? '離開專注模式' : '進入專注模式', shortcut: 'Ctrl ⇧ F', run: () => setFocusMode((enabled) => !enabled) },
    { id: 'typewriter', label: typewriterMode ? '關閉打字機模式' : '開啟打字機模式', shortcut: 'Ctrl Alt T', run: () => setTypewriterMode((enabled) => !enabled) },
    { id: 'sync', label: syncEnabled ? '關閉同步捲動' : '開啟同步捲動', run: () => setSyncEnabled((enabled) => !enabled) },
    { id: 'fold', label: '收合所有區塊', run: () => editorRef.current?.foldAll() },
    { id: 'unfold', label: '展開所有區塊', run: () => editorRef.current?.unfoldAll() },
    { id: 'snapshot', label: '建立目前版本', description: '保存到本機版本歷史', run: () => void createManualSnapshot() },
    { id: 'revisions', label: '開啟版本歷史', description: '預覽、下載或還原舊版本', run: () => setRevisionsOpen(true) },
    { id: 'shortcuts', label: '顯示快捷鍵', shortcut: '?', run: () => setHelpOpen(true) },
  ], [createManualSnapshot, downloadHtml, downloadMarkdown, focusMode, syncEnabled, typewriterMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const target = event.target as HTMLElement | null
      const isTyping = Boolean(target?.closest('input, textarea, [contenteditable="true"], .cm-editor'))
      if (mod && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      } else if (mod && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        downloadMarkdown()
      } else if (mod && event.shiftKey && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        setFocusMode((enabled) => !enabled)
      } else if (mod && event.altKey && event.key.toLocaleLowerCase() === 't') {
        event.preventDefault()
        setTypewriterMode((enabled) => !enabled)
      } else if (event.key === '?' && !isTyping) {
        event.preventDefault()
        setHelpOpen(true)
      } else if (event.key === 'Escape' && focusMode && !commandOpen && !helpOpen) {
        setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandOpen, downloadMarkdown, focusMode, helpOpen])

  if (!hydrated) {
    return <main className="app-shell productivity-shell"><div className="app-loading">正在載入本機草稿…</div></main>
  }

  return (
    <main className={`app-shell productivity-shell ${focusMode ? 'is-focus-mode' : ''} ${typewriterMode ? 'is-typewriter-mode' : ''}`}>
      <input ref={fileInputRef} className="visually-hidden-file" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void loadFile(file)
        event.currentTarget.value = ''
      }} />
      <header className="app-header">
        <div className="brand"><div className="brand__mark" aria-hidden="true">M↓</div><span>文字工具箱</span></div>
        <nav className="header-actions" aria-label="文件工具">
          <button className="toolbar-button" type="button" onClick={() => fileInputRef.current?.click()} title="開啟 Markdown"><FolderOpen size={17} /><span>開啟</span></button>
          <button className="toolbar-button" type="button" onClick={downloadMarkdown} title="下載 Markdown"><FileDown size={17} /><span>Markdown</span></button>
          <button className="toolbar-button" type="button" onClick={downloadHtml} title="下載可攜 HTML"><Code2 size={17} /><span>HTML</span></button>
          <button className={`toolbar-button ${statsOpen ? 'is-active' : ''}`} type="button" onClick={() => setStatsOpen((open) => !open)}><BarChart3 size={17} /><span>字數統計</span></button>
          <div className="menu-wrap">
            <button className="toolbar-button" type="button" onClick={() => setThemeOpen((open) => !open)}><Palette size={17} /><span>{THEME_LABELS[theme]}</span><ChevronDown size={15} /></button>
            {themeOpen ? <div className="theme-menu" role="menu">{THEMES.map((name) => <button key={name} type="button" className={name === theme ? 'is-selected' : ''} onClick={() => { setTheme(name); setThemeOpen(false) }} role="menuitem"><span className={`theme-swatch theme-swatch--${name.toLowerCase()}`} />{THEME_LABELS[name]}{name === theme ? <CheckCircle2 size={15} /> : null}</button>)}</div> : null}
          </div>
          <button className={`toolbar-button sync-toggle ${syncEnabled ? 'is-active' : ''}`} type="button" aria-pressed={syncEnabled} onClick={() => setSyncEnabled((enabled) => !enabled)} title="切換同步捲動"><span>{syncEnabled ? '同步開' : '同步關'}</span></button>
          <button className="toolbar-button utility-command" type="button" onClick={() => setCommandOpen(true)} title="命令選單 (Cmd/Ctrl+K)"><Menu size={17} /><span>命令</span><kbd>⌘K</kbd></button>
          <button className="toolbar-button utility-help" type="button" onClick={() => setHelpOpen(true)} title="快捷鍵"><HelpCircle size={17} /></button>
          <span className="header-divider" />
          <button className="toolbar-button" type="button" disabled={!markdown.trim() || Boolean(exporting)} onClick={() => void handleExport('pdf')}><Download size={17} /><span>{exporting === 'pdf' ? '匯出中…' : 'PDF'}</span></button>
          <button className="toolbar-button" type="button" disabled={!markdown.trim() || Boolean(exporting)} onClick={() => void handleExport('docx')}><FileText size={17} /><span>{exporting === 'docx' ? '匯出中…' : 'Word'}</span></button>
          <button className="toolbar-button revision-hook" type="button" onClick={() => void createManualSnapshot()}><FileDown size={17} /><span>建立版本</span></button>
          <button className="toolbar-button revision-hook" type="button" onClick={() => setRevisionsOpen(true)}><ListTree size={17} /><span>版本記錄</span></button>
        </nav>
      </header>

      <div className="mobile-view-tabs" role="tablist" aria-label="編輯與預覽">
        <button type="button" role="tab" aria-selected={mobileView === 'editor'} className={mobileView === 'editor' ? 'is-active' : ''} onClick={() => setMobileView('editor')}><FileText size={15} />編輯</button>
        <button type="button" role="tab" aria-selected={mobileView === 'preview'} className={mobileView === 'preview' ? 'is-active' : ''} onClick={() => setMobileView('preview')}><Eye size={15} />預覽</button>
      </div>

      <section
        className={`workspace productivity-workspace mobile-view-${mobileView} ${dragActive ? 'is-drag-active' : ''}`}
        ref={workspaceRef}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          const file = event.dataTransfer.files[0]
          if (file) void loadFile(file)
        }}
      >
        <OutlinePanel headings={headings} collapsed={outlineCollapsed} activeLine={activeLine} onCollapsedChange={setOutlineCollapsed} onJump={jumpToLine} />
        <section className="pane pane--editor" style={{ width: `${split}%` }}>
          <header className="pane-header"><div><span className="pane-dot" />Markdown 原始碼</div><div className="pane-tools"><button type="button" onClick={() => editorRef.current?.search()} title="搜尋"><Search size={14} /></button><button type="button" className={typewriterMode ? 'is-active' : ''} onClick={() => setTypewriterMode((enabled) => !enabled)} title="打字機模式"><AlignCenter size={14} /></button><span>自動儲存</span></div></header>
          <EditorPane ref={editorRef} value={markdown} onChange={setMarkdown} onScrollLine={handleEditorScroll} typewriter={typewriterMode} onSlashCommand={() => setCommandOpen(true)} />
        </section>

        <button className="splitter" type="button" onPointerDown={beginResize} aria-label="調整編輯器與預覽寬度"><span className="sync-rail" aria-hidden="true"><i style={{ top: `${Math.min(96, Math.max(2, (activeLine / totalLines) * 100))}%` }} /></span><span className="splitter-grip">↔</span></button>

        <section className="pane pane--preview" style={{ width: `${100 - split}%` }}>
          <header className="pane-header"><div><Eye size={15} />即時預覽</div><span>{THEME_LABELS[theme]}主題</span></header>
          <PreviewPane ref={previewRef} markdown={deferredMarkdown} theme={theme} onScrollLine={handlePreviewScroll} onLayout={handlePreviewLayout} onSourceLine={jumpToLine} />
        </section>

        {dragActive ? <div className="drop-target" aria-hidden="true"><FolderOpen size={34} /><strong>放開以開啟 Markdown</strong><span>支援 .md 與 .markdown，最大 5 MB</span></div> : null}
        {statsOpen ? <StatsPopover stats={stats} available={available} onClose={() => setStatsOpen(false)} onClear={() => setMarkdown('')} /> : null}
      </section>

      <footer className="status-bar">
        <span><FileText size={14} />字數 {stats.chars_no_spaces.toLocaleString()}</span><span>行數 {stats.line_count.toLocaleString()}</span>
        <button className="status-action" type="button" onClick={() => setOutlineCollapsed((collapsed) => !collapsed)}><ListTree size={14} />大綱</button>
        <button className={`status-action ${focusMode ? 'is-active' : ''}`} type="button" onClick={() => setFocusMode((enabled) => !enabled)}><Maximize2 size={14} />專注</button>
        <span className={persistenceStatus === 'error' ? 'status-warn' : 'status-ok'}><CheckCircle2 size={14} />{persistenceStatus === 'saving' ? '儲存中' : persistenceStatus === 'error' ? '草稿未儲存' : '草稿已儲存'}</span>
        {!available ? <span className="status-warn">本機統計</span> : null}
        <span className="status-line">第 {Math.round(activeLine)} 行 / {totalLines}</span>
      </footer>
      {focusMode ? <button className="focus-exit" type="button" onClick={() => setFocusMode(false)}>Esc 離開專注</button> : null}
      <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {revisionsOpen ? (
        <div className="productivity-overlay revision-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setRevisionsOpen(false)
        }}>
          <RevisionPanel
            currentContent={markdown}
            currentMetadata={{ theme }}
            persistence={persistence}
            onClose={() => setRevisionsOpen(false)}
            onRestore={(content, metadata) => {
              setMarkdown(content)
              const restoredTheme = metadata.theme
              if (typeof restoredTheme === 'string' && THEMES.includes(restoredTheme as ThemeName)) setTheme(restoredTheme as ThemeName)
            }}
          />
        </div>
      ) : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
