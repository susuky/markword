import {
  AlignCenter, ArrowLeftRight, BarChart3, CheckCircle2, Circle, Command,
  Eye, FileText, FolderOpen, HelpCircle, History, Languages, Link2,
  ListTree, Maximize2, Paperclip, Search, Unlink2, AlertCircle,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { exportDocument } from './api'
import {
  assetMarkdown,
  createProjectArchive,
  importLocalAssets,
  importProjectArchive,
  inlineAssetsInHtml,
  referencedAssetPaths,
  requestPersistentStorage,
} from './assets'
import { AssetPanel } from './components/AssetPanel'
import { CommandPalette, type CommandAction } from './components/CommandPalette'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { ExportMenu, PreviewSettings } from './components/DocumentMenus'
import { Modal } from './components/Modal'
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
import {
  deleteAsset,
  DraftPersistenceSession,
  listAssets,
  loadPreference,
  savePreference,
  type PersistenceStatus,
  type StoredAsset,
} from './storage'
import { EXPORT_STYLES, isThemeName, THEME_META } from './themeConfig'
import {
  DEFAULT_PREVIEW_TYPOGRAPHY,
  normalizePreviewTypography,
} from './typography'
import type { ExportStyleName, ThemeName } from './types'

const MAX_LOCAL_FILE_BYTES = 15 * 1024 * 1024

function documentTitle(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, '').trim() || 'markword-document'
  return title.replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 120) || 'markword-document'
}

function downloadBlob(content: BlobPart, type: string, filename: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
:root{color-scheme:${colors.dark ? 'dark' : 'light'}}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.78}.document{width:min(100% - 40px,880px);margin:auto;padding:48px 0 80px}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:2.25rem}h2{font-size:1.55rem;margin-top:1.5em}h3{font-size:1.2rem;margin-top:1.4em}a{color:${colors.accent}}code{background:${colors.code};padding:.14em .35em;border-radius:4px}pre{overflow:auto;background:${colors.code};border:1px solid ${colors.border};border-radius:8px;padding:16px}pre code{padding:0}.copy-code,.mermaid-loading{display:none}.mermaid-fallback{display:block}.mermaid-block{border:1px solid ${colors.border};border-radius:8px;padding:16px}blockquote{margin:1.2em 0;padding:.6em 1em;border-left:3px solid ${colors.accent};color:${colors.muted};background:${colors.code}}table{width:100%;border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:8px 11px;text-align:left}th{background:${colors.code}}img,svg,video{max-width:100%;height:auto}audio{width:100%}.local-media{margin:1.25em 0}.local-media figcaption{margin-top:.4em;color:${colors.muted};font-size:.82em}@media print{.document{width:auto;padding:0}}
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
  const [previewTypography, setPreviewTypography] = useState(() => normalizePreviewTypography(
    loadPreference<unknown>('preview-typography', DEFAULT_PREVIEW_TYPOGRAPHY),
  ))
  const [exportStyle, setExportStyle] = useState<ExportStyleName>(() => loadPreference('export-style', 'Classic'))
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
  const [notice, setNotice] = useState('')
  const [activeLine, setActiveLine] = useState(1)
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false)
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => loadPreference('outline-collapsed', false))
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(() => loadPreference('sync-enabled', true))
  const [mobileView, setMobileView] = useState<'editor' | 'preview'>('editor')
  const [dragActive, setDragActive] = useState(false)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [assets, setAssets] = useState<StoredAsset[]>([])
  const [assetVersion, setAssetVersion] = useState(0)
  const [assetBusy, setAssetBusy] = useState(false)
  const [importingWord, setImportingWord] = useState(false)
  const wordImportBusyRef = useRef(false)
  const [clientExporting, setClientExporting] = useState<'html' | 'project' | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('idle')
  const [persistence] = useState(() => new DraftPersistenceSession({ onStatusChange: setPersistenceStatus }))
  const activeLineRef = useRef(1)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const saveLabel = t(persistenceStatus === 'saved' ? 'Saved in this browser' : persistenceStatus === 'error' ? 'Draft not saved. Download a backup.' : persistenceStatus === 'saving' ? 'Saving…' : 'Draft not saved')
  const totalLines = Math.max(1, markdown.split('\n').length)
  const headings = useMemo(() => collectHeadings(markdown), [markdown])
  const title = headings.find((heading) => heading.level === 1)?.text || t('Untitled document')
  const referencedAssets = useMemo(() => referencedAssetPaths(markdown), [markdown])
  activeLineRef.current = activeLine

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      persistence.initialize(initialSampleRef.current, { theme: 'Light' }),
      listAssets().catch(() => []),
    ]).then(([draft, storedAssets]) => {
      if (cancelled) return
      setMarkdown(draft.content)
      setAssets(storedAssets)
      const savedTheme = draft.metadata.theme
      if (isThemeName(savedTheme)) setTheme(savedTheme)
      setHydrated(true)
      persistence.start()
    }).catch(() => {
      if (!cancelled) {
        setPersistenceStatus('error')
        setHydrated(true)
      }
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
    savePreference('preview-typography', previewTypography)
  }, [exportStyle, outlineCollapsed, previewTypography, split, syncEnabled, theme])

  const setMarkdownFontSize = useCallback((size: number) => {
    setPreviewTypography((current) => normalizePreviewTypography({ ...current, markdownFontSize: size }))
  }, [])

  const setMermaidFontSize = useCallback((size: number) => {
    setPreviewTypography((current) => normalizePreviewTypography({ ...current, mermaidFontSize: size }))
  }, [])

  const resetPreviewFontSizes = useCallback(() => {
    setPreviewTypography(DEFAULT_PREVIEW_TYPOGRAPHY)
  }, [])

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3000)
  }, [])

  const refreshAssets = useCallback(async () => {
    const storedAssets = await listAssets()
    setAssets(storedAssets)
    setAssetVersion((version) => version + 1)
    return storedAssets
  }, [])

  const insertAssets = useCallback((importedAssets: readonly StoredAsset[]) => {
    if (!importedAssets.length) return
    const source = importedAssets.map(assetMarkdown).join('\n\n')
    editorRef.current?.insert(`\n${source}\n`)
    setMobileView('editor')
  }, [])

  const handleAssetFiles = useCallback(async (files: readonly File[], insert = true) => {
    if (!files.length || assetBusy || wordImportBusyRef.current) return
    setAssetBusy(true)
    try {
      const importedAssets = await importLocalAssets(files)
      await refreshAssets()
      if (insert) insertAssets(importedAssets)
      void requestPersistentStorage()
      showNotice(t('{count} local assets imported', { count: importedAssets.length }))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not import local assets'))
    } finally {
      setAssetBusy(false)
    }
  }, [assetBusy, insertAssets, refreshAssets, showNotice, t])

  const loadFile = useCallback(async (file: File) => {
    if (wordImportBusyRef.current) return
    if (/\.zip$/i.test(file.name)) {
      if (assetBusy) return
      setAssetBusy(true)
      try {
        const project = await importProjectArchive(file)
        setMarkdown(project.markdown)
        setActiveLine(1)
        await refreshAssets()
        editorRef.current?.jumpToLine(1)
        showNotice(t('Opened project {file}', { file: file.name }))
      } catch (error) {
        showNotice(error instanceof Error ? error.message : t('Could not open project archive'))
      } finally {
        setAssetBusy(false)
      }
      return
    }
    if (/\.doc$/i.test(file.name)) {
      showNotice(t('Save this Word file as .docx, then try again.'))
      return
    }
    if (!/\.(md|markdown|docx)$/i.test(file.name)) {
      showNotice(t('Please choose a Markdown, Word (.docx), or project ZIP file'))
      return
    }
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      showNotice(t('This file is larger than 15 MiB. Please choose a smaller file.'))
      return
    }
    if (/\.docx$/i.test(file.name)) {
      if (assetBusy) return
      wordImportBusyRef.current = true
      setImportingWord(true)
      setNotice('')
      try {
        const { importWordDocument } = await import('./wordImport')
        const converted = await importWordDocument(file)
        await refreshAssets()
        setMarkdown(converted.markdown)
        setActiveLine(1)
        setMobileView('editor')
        editorRef.current?.jumpToLine(1)
        showNotice(t(converted.hasWarnings
          ? 'Word converted. Some content or formatting could not be preserved; please review the result.'
          : 'Converted {file} to Markdown', { file: file.name }))
      } catch {
        showNotice(t('Could not convert this Word file. Try saving it as .docx again; your current document is unchanged.'))
      } finally {
        wordImportBusyRef.current = false
        setImportingWord(false)
      }
      return
    }
    try {
      setMarkdown(await file.text())
      setActiveLine(1)
      editorRef.current?.jumpToLine(1)
      showNotice(t('Opened {file}', { file: file.name }))
    } catch {
      showNotice(t('Could not read this file. Please try again.'))
    }
  }, [assetBusy, refreshAssets, showNotice, t])

  const handleDroppedFiles = useCallback(async (files: readonly File[]) => {
    const documentFile = files.find((file) => /\.(?:md|markdown|docx|doc|zip)$/i.test(file.name))
    const assetFiles = files.filter((file) => file !== documentFile)
    if (documentFile) await loadFile(documentFile)
    if (assetFiles.length) await handleAssetFiles(assetFiles, !documentFile)
  }, [handleAssetFiles, loadFile])

  const downloadMarkdown = useCallback(() => {
    downloadBlob(markdown, 'text/markdown;charset=utf-8', `${documentTitle(markdown)}.md`)
    showNotice(t('Markdown downloaded'))
  }, [markdown, showNotice, t])

  const downloadHtml = useCallback(async () => {
    if (clientExporting) return
    setClientExporting('html')
    try {
      const renderedHtml = previewRef.current?.getRenderedHtml() ?? renderMarkdown(markdown)
      const embeddedHtml = await inlineAssetsInHtml(renderedHtml)
      downloadBlob(portableHtml(markdown, theme, exportStyle, locale, embeddedHtml), 'text/html;charset=utf-8', `${documentTitle(markdown)}.html`)
      showNotice(t('Portable HTML downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create portable HTML'))
    } finally {
      setClientExporting(null)
    }
  }, [clientExporting, exportStyle, locale, markdown, showNotice, t, theme])

  const downloadProject = useCallback(async () => {
    if (clientExporting) return
    setClientExporting('project')
    try {
      const title = documentTitle(markdown)
      const archive = await createProjectArchive(markdown, title, assets)
      downloadBlob(archive, 'application/zip', `${title}.markword.zip`)
      showNotice(t('Project ZIP downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create project ZIP'))
    } finally {
      setClientExporting(null)
    }
  }, [assets, clientExporting, markdown, showNotice, t])

  const downloadLocalAsset = useCallback((asset: StoredAsset) => {
    downloadBlob(asset.blob, asset.type || 'application/octet-stream', asset.name)
  }, [])

  const removeLocalAsset = useCallback(async (asset: StoredAsset) => {
    const referenced = referencedAssets.has(asset.path)
    const message = referenced
      ? t('This asset is referenced by the document. Delete it anyway?')
      : t('Delete this local asset?')
    if (!window.confirm(message)) return
    setAssetBusy(true)
    try {
      await deleteAsset(asset.id)
      await refreshAssets()
      showNotice(t('Local asset deleted'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not delete local asset'))
    } finally {
      setAssetBusy(false)
    }
  }, [referencedAssets, refreshAssets, showNotice, t])

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
    setMobileOutlineOpen(false)
    setActiveLine(line)
    editorRef.current?.jumpToLine(line)
    if (syncEnabled) previewRef.current?.scrollToLine(line)
  }, [syncEnabled])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!workspaceRef.current || window.matchMedia('(max-width: 760px)').matches) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const editor = workspaceRef.current.querySelector('.pane--editor')
    const preview = workspaceRef.current.querySelector('.pane--preview')
    if (!editor || !preview) return
    const onMove = (moveEvent: PointerEvent) => {
      const left = editor.getBoundingClientRect().left
      const width = editor.getBoundingClientRect().width + preview.getBoundingClientRect().width
      setSplit(Math.min(70, Math.max(30, ((moveEvent.clientX - left) / width) * 100)))
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
    { id: 'open', label: t('Open Markdown, Word, or project'), description: t('Open .md, convert .docx, or restore a Markword ZIP'), shortcut: 'Ctrl O', keywords: 'file upload import word docx project 匯入 轉換 檔案 專案', run: () => fileInputRef.current?.click() },
    { id: 'assets', label: t('Manage local assets'), description: t('Images, video, audio, and attachments'), keywords: 'asset media image video attachment 圖片 影片 附件', run: () => setAssetsOpen(true) },
    { id: 'insert-asset', label: t('Insert: Local asset'), description: t('Import files from this device'), keywords: '/ asset media image video attachment 圖片 影片 附件', run: () => assetInputRef.current?.click() },
    { id: 'save-md', label: t('Download Markdown'), description: t('Keep the editable source'), shortcut: 'Ctrl S', keywords: 'export save 匯出', run: downloadMarkdown },
    { id: 'save-project', label: t('Download project ZIP'), description: t('Markdown and all local assets'), keywords: 'export zip backup 匯出 備份', run: () => void downloadProject() },
    { id: 'save-html', label: t('Download portable HTML'), description: t('Embedded styles and local assets for offline reading'), keywords: 'export self contained 匯出', run: () => void downloadHtml() },
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
  ], [createManualSnapshot, downloadHtml, downloadMarkdown, downloadProject, focusMode, locale, syncEnabled, t, typewriterMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && target?.closest('dialog[open]')) return
      const isTyping = Boolean(target?.closest('input, textarea, [contenteditable="true"], .cm-editor'))
      if (mod && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      } else if (mod && event.key.toLocaleLowerCase() === 'o') {
        event.preventDefault()
        fileInputRef.current?.click()
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
        setMobileOutlineOpen(false)
        setHelpOpen(false)
        setStatsOpen(false)
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
      <input ref={fileInputRef} className="visually-hidden-file" type="file" disabled={importingWord} accept=".md,.markdown,.docx,.zip,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void loadFile(file)
        event.currentTarget.value = ''
      }} />
      <input ref={assetInputRef} className="visually-hidden-file" type="file" multiple onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        if (files.length) void handleAssetFiles(files)
        event.currentTarget.value = ''
      }} />
      <header className="app-header">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}markword-icon.svg`} width="36" height="36" alt="" /><span>Markword<span className="brand-caption">{t('A space for your words')}</span></span></div>
        <div className="document-heading"><FileText size={18} aria-hidden="true" /><span title={title}>{title}</span><span className="document-extension">.md</span></div>
        <nav className="header-actions" aria-label={t('Document tools')}>
          <button className="toolbar-button open-trigger" type="button" disabled={importingWord} onClick={() => fileInputRef.current?.click()} aria-label={t(importingWord ? 'Converting Word…' : 'Open Markdown, Word, or project')} title={t('Open Markdown, Word, or project')}><FolderOpen size={17} aria-hidden="true" /><span>{t(importingWord ? 'Converting Word…' : 'Open')}</span></button>
          <button className="toolbar-button language-toggle" type="button" onClick={() => setLocale(locale === 'en' ? 'zh-TW' : 'en')} title={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={17} aria-hidden="true" /><span>{locale === 'en' ? t('Traditional Chinese') : 'EN'}</span></button>
          <ExportMenu disabled={!markdown.trim()} exporting={exporting} clientExporting={clientExporting} exportStyle={exportStyle} onStyleChange={setExportStyle} hasAssets={referencedAssets.size > 0} onMarkdown={downloadMarkdown} onProject={() => void downloadProject()} onHtml={() => void downloadHtml()} onExport={(format) => void handleExport(format)} />
        </nav>
      </header>

      <nav className="workspace-toolbar" aria-label={t('Workspace tools')}>
        <div className="workspace-toolbar__group">
          <button className="toolbar-button outline-trigger" type="button" aria-label={t('Document outline')} aria-controls="document-outline" aria-expanded={window.matchMedia('(max-width: 760px)').matches ? mobileOutlineOpen : !outlineCollapsed} onClick={() => {
            if (window.matchMedia('(max-width: 760px)').matches) setMobileOutlineOpen((open) => !open)
            else setOutlineCollapsed((collapsed) => !collapsed)
          }}><ListTree size={17} aria-hidden="true" /><span>{t('Outline')}</span></button>
          <button className="toolbar-button asset-trigger" type="button" onClick={() => setAssetsOpen(true)} aria-label={t('Manage local assets')}><Paperclip size={17} aria-hidden="true" /><span>{t('Assets')}</span>{assets.length ? <small>{assets.length}</small> : null}</button>
          <button className="toolbar-button revision-trigger" type="button" onClick={() => setRevisionsOpen(true)} aria-label={t('Revision history')}><History size={17} aria-hidden="true" /><span>{t('Revision history')}</span></button>
        </div>
        <div className="workspace-toolbar__group">
          <button className="toolbar-button utility-command" type="button" onClick={() => setCommandOpen(true)} aria-label={t('Command palette')}><Command size={16} aria-hidden="true" /><span>{t('Find a command')}</span><kbd>Ctrl K</kbd></button>
          <button className={`toolbar-button focus-trigger ${focusMode ? 'is-active' : ''}`} type="button" onClick={() => { setMobileView('editor'); setFocusMode((enabled) => !enabled) }} aria-pressed={focusMode} aria-label={t('Toggle focus mode')}><Maximize2 size={16} aria-hidden="true" /><span>{t('Focus')}</span></button>
        </div>
      </nav>

      <div className="mobile-view-tabs" role="tablist" aria-label={t('Editor and preview')}>
        <button type="button" role="tab" aria-selected={mobileView === 'editor'} className={mobileView === 'editor' ? 'is-active' : ''} onClick={() => setMobileView('editor')}><FileText size={15} />{t('Editor')}</button>
        <button type="button" role="tab" aria-selected={mobileView === 'preview'} className={mobileView === 'preview' ? 'is-active' : ''} onClick={() => setMobileView('preview')}><Eye size={15} />{t('Preview')}</button>
      </div>

      <section
        className={`workspace productivity-workspace ${mobileOutlineOpen ? 'has-mobile-outline' : ''} mobile-view-${mobileView} ${dragActive ? 'is-drag-active' : ''}`}
        ref={workspaceRef}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length) void handleDroppedFiles(files)
        }}
      >
        {mobileOutlineOpen ? <button className="outline-scrim" type="button" aria-label={t('Collapse document outline')} onClick={() => setMobileOutlineOpen(false)} /> : null}
        <OutlinePanel mobileOpen={mobileOutlineOpen} onMobileClose={() => setMobileOutlineOpen(false)} headings={headings} collapsed={outlineCollapsed} activeLine={activeLine} onCollapsedChange={setOutlineCollapsed} onJump={jumpToLine} />
        <section className="pane pane--editor" style={{ flex: `${split} 1 0` }}>
          <header className="pane-header"><div className="pane-title"><FileText size={16} aria-hidden="true" />{t('Editor')}<span>Markdown</span></div><div className="pane-tools"><button type="button" onClick={() => editorRef.current?.search()} title={t('Search document')} aria-label={t('Search document')}><Search size={17} aria-hidden="true" /></button><button type="button" className={typewriterMode ? 'is-active' : ''} aria-pressed={typewriterMode} onClick={() => setTypewriterMode((enabled) => !enabled)} title={t('Typewriter mode')} aria-label={t('Typewriter mode')}><AlignCenter size={17} aria-hidden="true" /></button></div></header>
          <EditorPane ref={editorRef} value={markdown} onChange={setMarkdown} onScrollLine={handleEditorScroll} typewriter={typewriterMode} onSlashCommand={() => setCommandOpen(true)} onPasteFiles={(files) => void handleAssetFiles(files)} />
        </section>

        <button className="splitter" type="button" onPointerDown={beginResize} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
          event.preventDefault()
          setSplit((value) => event.key === 'Home' ? 50 : Math.min(70, Math.max(30, value + (event.key === 'ArrowRight' ? 5 : -5))))
        }} aria-label={t('Resize editor and preview')} title={t('Drag or use arrow keys to resize')}><ArrowLeftRight size={14} aria-hidden="true" /></button>

        <section className="pane pane--preview" style={{ flex: `${100 - split} 1 0` }}>
          <header className="pane-header preview-header"><div className="pane-title"><Eye size={16} aria-hidden="true" />{t('Preview')}</div><div className="preview-tools">
            <PreviewSettings theme={theme} onThemeChange={setTheme} markdownSize={previewTypography.markdownFontSize} mermaidSize={previewTypography.mermaidFontSize} onMarkdownSizeChange={setMarkdownFontSize} onMermaidSizeChange={setMermaidFontSize} onReset={resetPreviewFontSizes} />
            <button className={`toolbar-button sync-toggle ${syncEnabled ? 'is-active' : ''}`} type="button" aria-label={t('Toggle synchronized scrolling')} title={t(syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling')} aria-pressed={syncEnabled} onClick={() => setSyncEnabled((enabled) => !enabled)}>{syncEnabled ? <Link2 size={17} aria-hidden="true" /> : <Unlink2 size={17} aria-hidden="true" />}</button>
          </div></header>
          <PreviewPane ref={previewRef} markdown={deferredMarkdown} theme={theme} markdownFontSize={previewTypography.markdownFontSize} mermaidFontSize={previewTypography.mermaidFontSize} assetVersion={assetVersion} onScrollLine={handlePreviewScroll} onLayout={handlePreviewLayout} onSourceLine={jumpToLine} />
        </section>

        {dragActive ? <div className="drop-target" aria-hidden="true"><Paperclip size={34} /><strong>{t('Drop to open or insert files')}</strong><span>{t('Markdown, Word (.docx), project ZIP, images, video, audio, and attachments')}</span></div> : null}
        {statsOpen ? <StatsPopover stats={stats} available={available} staticDeployment={IS_STATIC_DEPLOYMENT} onClose={() => setStatsOpen(false)} onClear={() => { if (window.confirm(t('Clear this document? Download a copy first if you want to keep it.'))) setMarkdown('') }} /> : null}
      </section>

      <footer className="status-bar">
        <button className={`status-action ${statsOpen ? 'is-active' : ''}`} type="button" aria-label={t('Word count')} aria-expanded={statsOpen} onClick={() => setStatsOpen((open) => !open)}><BarChart3 size={15} aria-hidden="true" />{t('Characters {count}', { count: stats.chars_no_spaces.toLocaleString(locale) })}</button>
        <span className="status-lines">{t('Lines {count}', { count: stats.line_count.toLocaleString(locale) })}</span>
        <span className={`save-status ${persistenceStatus === 'error' ? 'status-warn' : persistenceStatus === 'saved' ? 'status-ok' : ''}`} role="status" title={saveLabel}>{persistenceStatus === 'saved' ? <CheckCircle2 size={14} aria-hidden="true" /> : persistenceStatus === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}<span>{saveLabel}</span></span>
        <span className="status-line">{t('Line {line} / {total}', { line: Math.round(activeLine), total: totalLines })}</span>
        <button className="status-action help-trigger" type="button" onClick={() => setHelpOpen(true)} aria-label={t('Keyboard shortcuts')} title={t('Keyboard shortcuts')}><HelpCircle size={16} aria-hidden="true" /></button>
      </footer>
      {focusMode ? <button className="focus-exit" type="button" onClick={() => setFocusMode(false)}>{t('Esc to exit focus')}</button> : null}
      <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AssetPanel
        open={assetsOpen}
        assets={assets}
        busy={assetBusy || importingWord || Boolean(clientExporting)}
        onAdd={() => assetInputRef.current?.click()}
        onClose={() => setAssetsOpen(false)}
        onDelete={(asset) => void removeLocalAsset(asset)}
        onDownload={downloadLocalAsset}
        onExportProject={() => void downloadProject()}
        onInsert={(asset) => { insertAssets([asset]); setAssetsOpen(false) }}
      />
      {revisionsOpen ? (
        <Modal onClose={() => setRevisionsOpen(false)} label={t('Revision history')} className="revision-overlay">
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
        </Modal>
      ) : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
