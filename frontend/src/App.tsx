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
  Languages,
  ListTree,
  Maximize2,
  Menu,
  Palette,
  Search,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { exportDocument } from './api'
import { CommandPalette, type CommandAction } from './components/CommandPalette'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { OutlinePanel, type OutlineHeading } from './components/OutlinePanel'
import { PreviewPane, type PreviewHandle } from './components/PreviewPane'
import { RevisionPanel } from './components/RevisionPanel'
import { ShortcutHelp } from './components/ShortcutHelp'
import { StatsPopover } from './components/StatsPopover'
import { IS_STATIC_DEPLOYMENT } from './deployment'
import { useDebouncedStats } from './hooks/useDebouncedStats'
import { useI18n, type Locale } from './i18n'
import { renderMarkdown } from './markdown'
import './productivity.css'
import { SAMPLE_MARKDOWN } from './sample'
import { DraftPersistenceSession, loadPreference, savePreference, type PersistenceStatus } from './storage'
import { EXPORT_STYLES, isThemeName, THEME_META, THEMES } from './themeConfig'
import type { ExportStyleName, ThemeName } from './types'

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

function portableHtml(markdown: string, theme: ThemeName, exportStyle: ExportStyleName, locale: Locale, renderedHtml?: string | null) {
  const colors = THEME_META[theme]
  const title = documentTitle(markdown).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html>
<html lang="${locale === 'zh-TW' ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:${colors.dark ? 'dark' : 'light'}}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.78}.document{width:min(100% - 40px,880px);margin:auto;padding:48px 0 80px}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:2.25rem}h2{font-size:1.55rem;margin-top:1.5em}h3{font-size:1.2rem;margin-top:1.4em}a{color:${colors.accent}}code{background:${colors.code};padding:.14em .35em;border-radius:4px}pre{overflow:auto;background:${colors.code};border:1px solid ${colors.border};border-radius:8px;padding:16px}pre code{padding:0}.copy-code,.mermaid-loading{display:none}.mermaid-fallback{display:block}.mermaid-block{border:1px solid ${colors.border};border-radius:8px;padding:16px}blockquote{margin:1.2em 0;padding:.6em 1em;border-left:3px solid ${colors.accent};color:${colors.muted};background:${colors.code}}table{width:100%;border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:8px 11px;text-align:left}th{background:${colors.code}}img,svg{max-width:100%;height:auto}@media print{.document{width:auto;padding:0}}
</style><style>${EXPORT_STYLES[exportStyle].css}</style></head><body><main class="document">${renderedHtml || renderMarkdown(markdown)}</main></body></html>`
}

export default function App() {
  const { locale, setLocale, t } = useI18n()
  const initialSampleRef = useRef(SAMPLE_MARKDOWN[locale])
  const [markdown, setMarkdown] = useState(initialSampleRef.current)
  const deferredMarkdown = useDeferredValue(markdown)
  const [theme, setTheme] = useState<ThemeName>(() => loadPreference('theme', 'Light'))
  const [split, setSplit] = useState(() => loadPreference('split', 49))
  const [statsOpen, setStatsOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportStyle, setExportStyle] = useState<ExportStyleName>(() => loadPreference('export-style', 'Classic'))
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
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const totalLines = Math.max(1, markdown.split('\n').length)
  const headings = useMemo(() => collectHeadings(markdown), [markdown])
  activeLineRef.current = activeLine

  useEffect(() => {
    let cancelled = false
    void persistence.initialize(initialSampleRef.current, { theme: 'Light' }).then((draft) => {
      if (cancelled) return
      setMarkdown(draft.content)
      const savedTheme = draft.metadata.theme
      if (isThemeName(savedTheme)) setTheme(savedTheme)
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
    savePreference('export-style', exportStyle)
  }, [exportStyle, outlineCollapsed, split, syncEnabled, theme])

  useEffect(() => {
    if (!themeOpen && !exportOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (themeOpen && !themeMenuRef.current?.contains(target)) setThemeOpen(false)
      if (exportOpen && !exportMenuRef.current?.contains(target)) setExportOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [exportOpen, themeOpen])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }, [])

  const loadFile = useCallback(async (file: File) => {
    if (!/\.(md|markdown)$/i.test(file.name)) {
      showNotice(t('Please choose a .md or .markdown file'))
      return
    }
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      showNotice(t('This file is larger than 5 MB. Please choose a smaller file.'))
      return
    }
    setMarkdown(await file.text())
    setActiveLine(1)
    editorRef.current?.jumpToLine(1)
    showNotice(t('Opened {file}', { file: file.name }))
  }, [showNotice, t])

  const downloadMarkdown = useCallback(() => {
    downloadBlob(markdown, 'text/markdown;charset=utf-8', `${documentTitle(markdown)}.md`)
    showNotice(t('Markdown downloaded'))
  }, [markdown, showNotice, t])

  const downloadHtml = useCallback(() => {
    downloadBlob(portableHtml(markdown, theme, exportStyle, locale, previewRef.current?.getRenderedHtml()), 'text/html;charset=utf-8', `${documentTitle(markdown)}.html`)
    showNotice(t('Portable HTML downloaded'))
  }, [exportStyle, locale, markdown, showNotice, t, theme])

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
    if (IS_STATIC_DEPLOYMENT || !markdown.trim() || exporting) return
    setExporting(format)
    setNotice('')
    try {
      await exportDocument(format, markdown, theme, exportStyle)
      showNotice(t('{format} download started', { format: format.toUpperCase() }))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Export failed. Please try again.'))
    } finally {
      setExporting(null)
    }
  }, [exportStyle, exporting, markdown, showNotice, t, theme])

  const createManualSnapshot = useCallback(async () => {
    try {
      await persistence.snapshot('manual')
      showNotice(t('Current revision created'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create revision'))
    }
  }, [persistence, showNotice, t])

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: 'open', label: t('Open Markdown'), description: t('Open a local .md file'), shortcut: 'Ctrl O', keywords: 'file upload 檔案', run: () => fileInputRef.current?.click() },
    { id: 'save-md', label: t('Download Markdown'), description: t('Keep the editable source'), shortcut: 'Ctrl S', keywords: 'export save 匯出', run: downloadMarkdown },
    { id: 'save-html', label: t('Download portable HTML'), description: t('Embedded styles for offline reading'), keywords: 'export self contained 匯出', run: downloadHtml },
    { id: 'search', label: t('Search document'), shortcut: 'Ctrl F', run: () => editorRef.current?.search() },
    { id: 'insert-heading', label: t('Insert: Heading 2'), description: t('## Heading'), keywords: '/ heading 標題', run: () => editorRef.current?.insert(`\n${t('## Heading')}\n`, 4) },
    { id: 'insert-table', label: t('Insert: Table'), description: t('Three-column Markdown table'), keywords: '/ table 表格', run: () => editorRef.current?.insert(locale === 'zh-TW' ? '\n| 欄位一 | 欄位二 | 欄位三 |\n| --- | --- | --- |\n| 內容 | 內容 | 內容 |\n' : '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Content | Content | Content |\n') },
    { id: 'insert-code', label: t('Insert: Code block'), description: t('Fenced code block'), keywords: '/ code 程式碼', run: () => editorRef.current?.insert('\n```text\n\n```\n', 9) },
    { id: 'insert-mermaid', label: t('Insert: Mermaid diagram'), description: t('Basic flowchart'), keywords: '/ diagram 圖表', run: () => editorRef.current?.insert(`\n\`\`\`mermaid\ngraph TD\n  A[${t('Start')}] --> B[${t('Done')}]\n\`\`\`\n`) },
    { id: 'focus', label: t(focusMode ? 'Exit focus mode' : 'Enter focus mode'), shortcut: 'Ctrl ⇧ F', run: () => setFocusMode((enabled) => !enabled) },
    { id: 'typewriter', label: t(typewriterMode ? 'Disable typewriter mode' : 'Enable typewriter mode'), shortcut: 'Ctrl Alt T', run: () => setTypewriterMode((enabled) => !enabled) },
    { id: 'sync', label: t(syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'), run: () => setSyncEnabled((enabled) => !enabled) },
    { id: 'fold', label: t('Fold all sections'), run: () => editorRef.current?.foldAll() },
    { id: 'unfold', label: t('Unfold all sections'), run: () => editorRef.current?.unfoldAll() },
    { id: 'snapshot', label: t('Create current revision'), description: t('Save to local revision history'), run: () => void createManualSnapshot() },
    { id: 'revisions', label: t('Open revision history'), description: t('Preview, download, or restore an older revision'), run: () => setRevisionsOpen(true) },
    { id: 'shortcuts', label: t('Show keyboard shortcuts'), shortcut: '?', run: () => setHelpOpen(true) },
  ], [createManualSnapshot, downloadHtml, downloadMarkdown, focusMode, locale, syncEnabled, t, typewriterMode])

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
      } else if (event.key === 'Escape') {
        setThemeOpen(false)
        setExportOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandOpen, downloadMarkdown, focusMode, helpOpen])

  if (!hydrated) {
    return <main className="app-shell productivity-shell"><div className="app-loading">{t('Loading local draft…')}</div></main>
  }

  return (
    <main className={`app-shell productivity-shell ${focusMode ? 'is-focus-mode' : ''} ${typewriterMode ? 'is-typewriter-mode' : ''}`}>
      <input ref={fileInputRef} className="visually-hidden-file" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void loadFile(file)
        event.currentTarget.value = ''
      }} />
      <header className="app-header">
        <div className="brand"><div className="brand__mark" aria-hidden="true">M↓</div><span>{t('Markword')}</span></div>
        <nav className="header-actions" aria-label={t('Document tools')}>
          <button className="toolbar-button" type="button" onClick={() => fileInputRef.current?.click()} title={t('Open Markdown')}><FolderOpen size={17} /><span>{t('Open')}</span></button>
          <button className={`toolbar-button ${statsOpen ? 'is-active' : ''}`} type="button" aria-label={t('Word count')} onClick={() => setStatsOpen((open) => !open)}><BarChart3 size={17} /><span>{t('Word count')}</span></button>
          <div className="menu-wrap" ref={themeMenuRef}>
            <button className={`toolbar-button ${themeOpen ? 'is-active' : ''}`} type="button" aria-label={t('Preview theme: {theme}', { theme: t(THEME_META[theme].label) })} aria-haspopup="menu" aria-expanded={themeOpen} onClick={() => { setThemeOpen((open) => !open); setExportOpen(false) }}><Palette size={17} /><span>{t(THEME_META[theme].label)}</span><ChevronDown size={15} /></button>
            {themeOpen ? <div className="theme-menu" role="menu" aria-label={t('Preview theme')}><div className="menu-heading"><strong>{t('Preview theme')}</strong><span>{t('Also applied to exported documents')}</span></div><div className="theme-menu__grid">{THEMES.map((name) => {
              const meta = THEME_META[name]
              return <button key={name} type="button" className={name === theme ? 'is-selected' : ''} onClick={() => { setTheme(name); setThemeOpen(false) }} role="menuitemradio" aria-checked={name === theme}><span className="theme-palette" aria-hidden="true" style={{ '--swatch-bg': meta.background, '--swatch-code': meta.code, '--swatch-accent': meta.accent } as CSSProperties} /><span className="theme-option-copy"><strong>{t(meta.label)}</strong><small>{t(meta.description)}</small></span>{name === theme ? <CheckCircle2 size={15} /> : null}</button>
            })}</div></div> : null}
          </div>
          <button className={`toolbar-button sync-toggle ${syncEnabled ? 'is-active' : ''}`} type="button" aria-pressed={syncEnabled} onClick={() => setSyncEnabled((enabled) => !enabled)} title={t('Toggle synchronized scrolling')}><span>{t(syncEnabled ? 'Synchronized scrolling on' : 'Synchronized scrolling off')}</span></button>
          <button className="toolbar-button utility-command" type="button" onClick={() => setCommandOpen(true)} title={`${t('Command palette')} (Cmd/Ctrl+K)`}><Menu size={17} /><span>{t('Commands')}</span><kbd>⌘K</kbd></button>
          <button className="toolbar-button utility-help" type="button" onClick={() => setHelpOpen(true)} title={t('Keyboard shortcuts')}><HelpCircle size={17} /></button>
          <button className="toolbar-button language-toggle" type="button" onClick={() => setLocale(locale === 'en' ? 'zh-TW' : 'en')} title={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={17} /><span>{locale === 'en' ? t('Traditional Chinese') : 'EN'}</span></button>
          <span className="header-divider" />
          <div className="menu-wrap" ref={exportMenuRef}>
            <button className={`toolbar-button export-trigger ${exportOpen ? 'is-active' : ''}`} type="button" disabled={!markdown.trim()} aria-label={exporting ? t('{format} export in progress', { format: exporting === 'pdf' ? 'PDF' : 'Word' }) : t('Export')} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => { setExportOpen((open) => !open); setThemeOpen(false) }}><Download size={17} /><span>{exporting ? t('{format} export in progress…', { format: exporting === 'pdf' ? 'PDF' : 'Word' }) : t('Export')}</span><ChevronDown size={15} /></button>
            {exportOpen ? (
              <div className="export-menu" role="menu" aria-label={t('Download and export')}>
                <div className="menu-heading"><strong>{t('Download and export')}</strong><span>{t('Choose a layout, then select an output format')}</span></div>
                <div className="export-style-picker">
                  <span>{t('Document layout')}</span>
                  <div>{(Object.keys(EXPORT_STYLES) as ExportStyleName[]).map((styleName) => (
                    <button key={styleName} type="button" className={styleName === exportStyle ? 'is-selected' : ''} aria-pressed={styleName === exportStyle} onClick={() => setExportStyle(styleName)}>
                      <strong>{t(EXPORT_STYLES[styleName].label)}</strong>
                      <small>{t(EXPORT_STYLES[styleName].description)}</small>
                    </button>
                  ))}</div>
                </div>
                <div className="export-menu__section">
                  <span>{t('Source and web')}</span>
                  <button type="button" role="menuitem" onClick={() => { downloadMarkdown(); setExportOpen(false) }}><FileDown size={17} /><span><strong>Markdown</strong><small>{t('Keep the editable source')}</small></span></button>
                  <button type="button" role="menuitem" onClick={() => { downloadHtml(); setExportOpen(false) }}><Code2 size={17} /><span><strong>{t('Portable HTML')}</strong><small>{t('Uses the {style} layout and current theme', { style: t(EXPORT_STYLES[exportStyle].label) })}</small></span></button>
                </div>
                <div className="export-menu__section">
                  <span>{t('Document formats')}</span>
                  <button type="button" role="menuitem" disabled={IS_STATIC_DEPLOYMENT || Boolean(exporting)} onClick={() => { setExportOpen(false); void handleExport('pdf') }}><Download size={17} /><span><strong>PDF</strong><small>{IS_STATIC_DEPLOYMENT ? t('Unavailable on GitHub Pages; use the full server edition') : t('Uses the {style} print layout', { style: t(EXPORT_STYLES[exportStyle].label) })}</small></span></button>
                  <button type="button" role="menuitem" disabled={IS_STATIC_DEPLOYMENT || Boolean(exporting)} onClick={() => { setExportOpen(false); void handleExport('docx') }}><FileText size={17} /><span><strong>Word</strong><small>{IS_STATIC_DEPLOYMENT ? t('Unavailable on GitHub Pages; use the full server edition') : t('Uses the current palette and remains editable')}</small></span></button>
                </div>
              </div>
            ) : null}
          </div>
          <button className="toolbar-button revision-hook" type="button" onClick={() => void createManualSnapshot()}><FileDown size={17} /><span>{t('Create current revision')}</span></button>
          <button className="toolbar-button revision-hook" type="button" onClick={() => setRevisionsOpen(true)}><ListTree size={17} /><span>{t('Revision history')}</span></button>
        </nav>
      </header>

      <div className="mobile-view-tabs" role="tablist" aria-label={t('Editor and preview')}>
        <button type="button" role="tab" aria-selected={mobileView === 'editor'} className={mobileView === 'editor' ? 'is-active' : ''} onClick={() => setMobileView('editor')}><FileText size={15} />{t('Editor')}</button>
        <button type="button" role="tab" aria-selected={mobileView === 'preview'} className={mobileView === 'preview' ? 'is-active' : ''} onClick={() => setMobileView('preview')}><Eye size={15} />{t('Preview')}</button>
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
          <header className="pane-header"><div><span className="pane-dot" />{t('Markdown source')}</div><div className="pane-tools"><button type="button" onClick={() => editorRef.current?.search()} title={t('Search')}><Search size={14} /></button><button type="button" className={typewriterMode ? 'is-active' : ''} onClick={() => setTypewriterMode((enabled) => !enabled)} title={t('Typewriter mode')}><AlignCenter size={14} /></button><span>{t('Autosave')}</span></div></header>
          <EditorPane ref={editorRef} value={markdown} onChange={setMarkdown} onScrollLine={handleEditorScroll} typewriter={typewriterMode} onSlashCommand={() => setCommandOpen(true)} />
        </section>

        <button className="splitter" type="button" onPointerDown={beginResize} aria-label={t('Resize editor and preview')}><span className="sync-rail" aria-hidden="true"><i style={{ top: `${Math.min(96, Math.max(2, (activeLine / totalLines) * 100))}%` }} /></span><span className="splitter-grip">↔</span></button>

        <section className="pane pane--preview" style={{ width: `${100 - split}%` }}>
          <header className="pane-header"><div><Eye size={15} />{t('Live preview')}</div><span>{t('{theme} theme', { theme: t(THEME_META[theme].label) })}</span></header>
          <PreviewPane ref={previewRef} markdown={deferredMarkdown} theme={theme} onScrollLine={handlePreviewScroll} onLayout={handlePreviewLayout} onSourceLine={jumpToLine} />
        </section>

        {dragActive ? <div className="drop-target" aria-hidden="true"><FolderOpen size={34} /><strong>{t('Drop to open Markdown')}</strong><span>{t('Supports .md and .markdown, up to 5 MB')}</span></div> : null}
        {statsOpen ? <StatsPopover stats={stats} available={available} staticDeployment={IS_STATIC_DEPLOYMENT} onClose={() => setStatsOpen(false)} onClear={() => setMarkdown('')} /> : null}
      </section>

      <footer className="status-bar">
        <span><FileText size={14} />{t('Characters {count}', { count: stats.chars_no_spaces.toLocaleString(locale) })}</span><span>{t('Lines {count}', { count: stats.line_count.toLocaleString(locale) })}</span>
        <button className="status-action" type="button" onClick={() => setOutlineCollapsed((collapsed) => !collapsed)}><ListTree size={14} />{t('Outline')}</button>
        <button className={`status-action ${focusMode ? 'is-active' : ''}`} type="button" onClick={() => setFocusMode((enabled) => !enabled)}><Maximize2 size={14} />{t('Focus')}</button>
        <span className={persistenceStatus === 'error' ? 'status-warn' : 'status-ok'}><CheckCircle2 size={14} />{t(persistenceStatus === 'saving' ? 'Saving' : persistenceStatus === 'error' ? 'Draft not saved' : 'Draft saved')}</span>
        {!available ? <span className="status-warn">{t(IS_STATIC_DEPLOYMENT ? 'GitHub Pages · local statistics' : 'Local statistics')}</span> : null}
        <span className="status-line">{t('Line {line} / {total}', { line: Math.round(activeLine), total: totalLines })}</span>
      </footer>
      {focusMode ? <button className="focus-exit" type="button" onClick={() => setFocusMode(false)}>{t('Esc to exit focus')}</button> : null}
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
              if (isThemeName(restoredTheme)) setTheme(restoredTheme)
            }}
          />
        </div>
      ) : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
