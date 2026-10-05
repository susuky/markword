import {
  AlignCenter, ArrowLeftRight, BarChart3, CheckCircle2, Circle, Command,
  Eye, FileText, FolderOpen, HelpCircle, History, Languages, Link2,
  ListTree, Maximize2, Paperclip, Save, Search, Unlink2, AlertCircle, Table2,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { exportDocument } from './api'
import {
  assetMarkdown,
  createProjectArchive,
  importLocalAssets,
  importProjectArchive,
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
import { DOCUMENT_MODES, documentAsMarkdown, normalizeDocumentMode } from './documentMode'
import { useDebouncedStats } from './hooks/useDebouncedStats'
import { useI18n, type Locale } from './i18n'
import { canOpenLocalFile, canSaveLocalFile, FileChangedError, pickLocalFile, writeLocalFile, type LinkedFile } from './localFiles'
import './productivity.css'
import { SAMPLE_MARKDOWN } from './sample'
import { DEFAULT_SHORTCUTS, formatShortcut, normalizeShortcuts, shortcutFromEvent, type ShortcutMap } from './shortcuts'
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
import type { DocumentMode, ExportStyleName, ThemeName } from './types'

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

function portableHtml(markdown: string, theme: ThemeName, exportStyle: ExportStyleName, locale: Locale, renderedHtml: string, mathCss: string) {
  const colors = THEME_META[theme]
  const title = documentTitle(markdown).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<!doctype html>
<html lang="${locale === 'zh-TW' ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:${colors.dark ? 'dark' : 'light'}}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.78}.document{width:min(100% - 40px,880px);margin:auto;padding:48px 0 80px}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:2.25rem}h2{font-size:1.55rem;margin-top:1.5em}h3{font-size:1.2rem;margin-top:1.4em}a{color:${colors.accent}}code{background:${colors.code};padding:.14em .35em;border-radius:4px}pre{overflow:auto;background:${colors.code};border:1px solid ${colors.border};border-radius:8px;padding:16px}pre code{padding:0}.copy-code,.mermaid-loading{display:none}.mermaid-fallback{display:block}.mermaid-block{border:1px solid ${colors.border};border-radius:8px;padding:16px}blockquote{margin:1.2em 0;padding:.6em 1em;border-left:3px solid ${colors.accent};color:${colors.muted};background:${colors.code}}table{width:100%;border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:8px 11px;text-align:left}th{background:${colors.code}}img,svg,video{max-width:100%;height:auto}audio{width:100%}.local-media{margin:1.25em 0}.local-media figcaption{margin-top:.4em;color:${colors.muted};font-size:.82em}@media print{.document{width:auto;padding:0}}
</style><style>${EXPORT_STYLES[exportStyle].css}</style><style>${mathCss}</style></head><body><main class="document">${renderedHtml}</main></body></html>`
}

export default function App() {
  const { locale, setLocale, t } = useI18n()
  const initialSampleRef = useRef(SAMPLE_MARKDOWN[locale])
  const [mode, setMode] = useState<DocumentMode>('markdown')
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
  const noticeTimerRef = useRef<number | null>(null)
  const [activeLine, setActiveLine] = useState(1)
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false)
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => loadPreference('outline-collapsed', false))
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState(() => {
    try { return normalizeShortcuts(loadPreference('shortcuts', {})) }
    catch { return { ...DEFAULT_SHORTCUTS } }
  })
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
  const fileBusyRef = useRef(false)
  const [fileBusy, setFileBusy] = useState<'opening' | 'saving' | null>(null)
  const [linkedFile, setLinkedFile] = useState<LinkedFile | null>(null)
  const [fileError, setFileError] = useState('')
  const [fileSaveFailed, setFileSaveFailed] = useState(false)
  const [clientExporting, setClientExporting] = useState<'html' | 'project' | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('idle')
  const [persistence] = useState(() => new DraftPersistenceSession({ onStatusChange: setPersistenceStatus }))
  const documentVersionRef = useRef(0)
  const currentDocumentRef = useRef({ markdown, mode, theme })
  currentDocumentRef.current = { markdown, mode, theme }
  const activeLineRef = useRef(1)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const saveWarning = persistenceStatus === 'error' || persistenceStatus === 'conflict'
  const saveLabel = t(persistenceStatus === 'conflict' ? 'Changed in another tab. Download a backup.' : persistenceStatus === 'saved' ? 'Saved in this browser' : persistenceStatus === 'error' ? 'Draft not saved. Download a backup.' : persistenceStatus === 'saving' ? 'Saving…' : 'Draft not saved')
  const fileDirty = linkedFile && (fileSaveFailed || linkedFile.content !== markdown || linkedFile.mode !== mode)
  const fileSaveLabel = t(fileBusy === 'saving' ? 'Saving file…' : fileDirty ? 'File has unsaved changes' : 'Saved to file')
  const totalLines = Math.max(1, markdown.split('\n').length)
  const headings = useMemo(() => mode === 'markdown' ? collectHeadings(markdown) : [], [markdown, mode])
  const title = headings.find((heading) => heading.level === 1)?.text || t('Untitled document')
  const referencedAssets = useMemo(() => mode === 'markdown' ? referencedAssetPaths(markdown) : new Set<string>(), [markdown, mode])
  activeLineRef.current = activeLine

  const changeMarkdown = useCallback((content: string) => {
    if (content !== currentDocumentRef.current.markdown) documentVersionRef.current += 1
    currentDocumentRef.current.markdown = content
    setMarkdown(content)
  }, [])

  const changeMode = useCallback((nextMode: DocumentMode) => {
    if (nextMode !== currentDocumentRef.current.mode) documentVersionRef.current += 1
    currentDocumentRef.current.mode = nextMode
    setMode(nextMode)
  }, [])

  useEffect(() => {
    const onUpdate = () => { setUpdateError(''); setUpdateAvailable(true) }
    window.addEventListener('markword:update-available', onUpdate)
    return () => window.removeEventListener('markword:update-available', onUpdate)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      persistence.initialize(initialSampleRef.current, { theme: 'Light' }),
      listAssets().catch(() => []),
    ]).then(([draft, storedAssets]) => {
      if (cancelled) return
      changeMarkdown(draft.content)
      changeMode(normalizeDocumentMode(draft.metadata.mode))
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
  }, [changeMarkdown, changeMode, persistence])

  useEffect(() => {
    if (hydrated) persistence.update(markdown, { theme, mode })
  }, [hydrated, markdown, mode, persistence, theme])

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
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null
      setNotice('')
    }, 3000)
  }, [])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const saveAndUpdate = async () => {
    if (!hydrated || updateBusy || fileBusyRef.current || assetBusy || clientExporting) return
    setUpdateBusy(true)
    setUpdateError('')
    try {
      const version = documentVersionRef.current
      const current = currentDocumentRef.current
      // Include edits whose React persistence effect has not run yet.
      persistence.update(current.markdown, { theme: current.theme, mode: current.mode })
      const saved = await persistence.flush()
      const latest = currentDocumentRef.current
      if (version !== documentVersionRef.current || saved.content !== latest.markdown
        || saved.metadata.mode !== latest.mode || saved.metadata.theme !== latest.theme
        || fileBusyRef.current) {
        setUpdateError(t('Your document changed while saving. Save again to update.'))
        return
      }
      window.location.reload()
    } catch {
      setUpdateError(t('Your draft could not be saved. Download a backup before reloading, or try saving again.'))
    } finally {
      setUpdateBusy(false)
    }
  }

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

  const loadFile = useCallback(async (inputFile?: File) => {
    if (!hydrated || fileBusyRef.current || wordImportBusyRef.current || assetBusy) return
    if (!inputFile && !canOpenLocalFile) { fileInputRef.current?.click(); return }
    fileBusyRef.current = true
    setFileBusy('opening')
    const openingVersion = documentVersionRef.current
    const canReplaceDocument = () => {
      if (documentVersionRef.current === openingVersion) return true
      showNotice(t('Your document changed while opening this file. Your edits are kept; open the file again when you are ready.'))
      return false
    }
    try {
      const picked = inputFile ? null : await pickLocalFile(t('Documents and projects'))
      const file = inputFile ?? picked?.file
      if (!file) return
      if (/\.zip$/i.test(file.name)) {
        if (assetBusy) return
        setAssetBusy(true)
        try {
          const project = await importProjectArchive(file)
          await refreshAssets()
          if (!canReplaceDocument()) return
          changeMarkdown(project.markdown)
          changeMode(project.mode)
          setLinkedFile(null)
          setFileSaveFailed(false)
          setActiveLine(1)
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
      if (!/\.(md|markdown|txt|mmd|mermaid|docx)$/i.test(file.name)) {
        showNotice(t('Please choose a Markdown, text, Mermaid, Word (.docx), or project ZIP file'))
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
          if (!canReplaceDocument()) return
          changeMarkdown(converted.markdown)
          changeMode('markdown')
          setLinkedFile(null)
          setFileSaveFailed(false)
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
        const content = await file.text()
        if (!canReplaceDocument()) return
        const nextMode = /\.(mmd|mermaid)$/i.test(file.name) ? 'mermaid' : /\.txt$/i.test(file.name) ? 'text' : 'markdown'
        changeMarkdown(content)
        changeMode(nextMode)
        setLinkedFile(picked && canSaveLocalFile ? { handle: picked.handle, content, byteLength: file.size, mode: nextMode } : null)
        setFileSaveFailed(false)
        setActiveLine(1)
        editorRef.current?.jumpToLine(1)
        showNotice(t('Opened {file}', { file: file.name }))
      } catch {
        showNotice(t('Could not read this file. Please try again.'))
      }
    } catch {
      showNotice(t('Could not open the file picker. Try dragging the file into the editor.'))
    } finally {
      fileBusyRef.current = false
      setFileBusy(null)
    }
  }, [assetBusy, changeMarkdown, changeMode, hydrated, refreshAssets, showNotice, t])

  const handleDroppedFiles = useCallback(async (files: readonly File[]) => {
    const documentFile = files.find((file) => /\.(?:md|markdown|txt|mmd|mermaid|docx|doc|zip)$/i.test(file.name))
    const assetFiles = files.filter((file) => file !== documentFile)
    if (documentFile) await loadFile(documentFile)
    if (assetFiles.length) await handleAssetFiles(assetFiles, !documentFile)
  }, [handleAssetFiles, loadFile])

  const downloadSource = useCallback(() => {
    downloadBlob(markdown, `${DOCUMENT_MODES[mode].mime};charset=utf-8`, `${documentTitle(markdown)}.${DOCUMENT_MODES[mode].extension}`)
    showNotice(t('{format} downloaded', { format: t(DOCUMENT_MODES[mode].label) }))
  }, [markdown, mode, showNotice, t])

  const saveFile = useCallback(async (saveAs = false) => {
    if (fileBusyRef.current || wordImportBusyRef.current || assetBusy) return
    if (!canSaveLocalFile) { downloadSource(); return }
    fileBusyRef.current = true
    setFileBusy('saving')
    setFileError('')
    try {
      const saved = await writeLocalFile(markdown, mode, `${documentTitle(markdown)}.${DOCUMENT_MODES[mode].extension}`, linkedFile, saveAs)
      if (saved) {
        setLinkedFile(saved)
        setFileSaveFailed(false)
        showNotice(t('Saved {file}', { file: saved.handle.name }))
      }
    } catch (error) {
      setFileSaveFailed(true)
      setFileError(t(error instanceof FileChangedError
        ? 'The original file was changed elsewhere. Save a new copy, or reopen the original to review those changes.'
        : 'The file could not be saved. Your document is still here. Try saving a new copy or download a backup.'))
    } finally {
      fileBusyRef.current = false
      setFileBusy(null)
    }
  }, [assetBusy, downloadSource, linkedFile, markdown, mode, showNotice, t])

  const downloadHtml = useCallback(async () => {
    if (clientExporting) return
    setClientExporting('html')
    try {
      const { renderHtmlSnapshot } = await import('./htmlExport')
      const snapshot = await renderHtmlSnapshot(markdown, mode, theme, previewTypography.mermaidFontSize)
      downloadBlob(portableHtml(markdown, theme, exportStyle, locale, snapshot.html, snapshot.css), 'text/html;charset=utf-8', `${documentTitle(markdown)}.html`)
      showNotice(t('Portable HTML downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create portable HTML'))
    } finally {
      setClientExporting(null)
    }
  }, [clientExporting, exportStyle, locale, markdown, mode, previewTypography.mermaidFontSize, showNotice, t, theme])

  const downloadProject = useCallback(async () => {
    if (clientExporting) return
    setClientExporting('project')
    try {
      const title = documentTitle(markdown)
      const archive = await createProjectArchive(markdown, title, assets, mode)
      downloadBlob(archive, 'application/zip', `${title}.markword.zip`)
      showNotice(t('Project ZIP downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create project ZIP'))
    } finally {
      setClientExporting(null)
    }
  }, [assets, clientExporting, markdown, mode, showNotice, t])

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

  const editPreviewTable = useCallback((line: number) => {
    setMobileView('editor')
    editorRef.current?.editTable(line)
  }, [])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!workspaceRef.current || window.matchMedia('(max-width: 900px)').matches) return
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
      await exportDocument(format, documentAsMarkdown(markdown, mode), theme, exportStyle)
      showNotice(t('{format} download started', { format: format.toUpperCase() }))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Export failed. Please try again.'))
    } finally {
      setExporting(null)
    }
  }, [exportStyle, exporting, markdown, mode, showNotice, t, theme])

  const createManualSnapshot = useCallback(async () => {
    try {
      await persistence.snapshot('manual')
      showNotice(t('Current revision created'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create revision'))
    }
  }, [persistence, showNotice, t])

  const updateShortcuts = useCallback((next: ShortcutMap) => {
    try {
      savePreference('shortcuts', next)
      setShortcuts(next)
      return true
    } catch {
      return false
    }
  }, [])

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: 'commands', label: t('Open command palette'), run: () => setCommandOpen(true) },
    { id: 'open', label: t('Open document or project'), description: t('Open Markdown, text, Mermaid, Word, or a Markword ZIP'), keywords: 'file upload import word docx project 匯入 轉換 檔案 專案', run: () => void loadFile() },
    { id: 'assets', label: t('Manage local assets'), description: t('Images, video, audio, and attachments'), keywords: 'asset media image video attachment 圖片 影片 附件', run: () => setAssetsOpen(true) },
    { id: 'insert-asset', label: t('Insert: Local asset'), description: t('Import files from this device'), keywords: '/ asset media image video attachment 圖片 影片 附件', run: () => assetInputRef.current?.click() },
    { id: 'save-md', label: canSaveLocalFile ? t('Save file') : t('Download {format}', { format: t(DOCUMENT_MODES[mode].label) }), description: t('Keep the editable source'), keywords: 'file save 儲存', run: () => void saveFile() },
    ...(canSaveLocalFile ? [{ id: 'save-as', label: t('Save as…'), description: t('Choose a file name and location'), keywords: 'save copy 另存新檔', run: () => void saveFile(true) }] : []),
    { id: 'download-source', label: t('Download source'), description: t('Keep the editable source'), keywords: 'download export 匯出 下載', run: downloadSource },
    { id: 'save-project', label: t('Download project ZIP'), description: t('Document and all local assets'), keywords: 'export zip backup 匯出 備份', run: () => void downloadProject() },
    { id: 'save-html', label: t('Download portable HTML'), description: t('Embedded styles and local assets for offline reading'), keywords: 'export self contained 匯出', run: () => void downloadHtml() },
    { id: 'search', label: t('Search document'), run: () => editorRef.current?.search() },
    { id: 'insert-heading', label: t('Insert: Heading 2'), description: t('## Heading'), keywords: '/ heading 標題', run: () => editorRef.current?.insert(`\n${t('## Heading')}\n`, 4) },
    ...(mode === 'markdown' ? [{ id: 'insert-table', label: t('Insert: Table'), description: t('Edit cells, rows, and columns'), keywords: '/ table 表格', run: () => editorRef.current?.editTable() }] : []),
    { id: 'insert-code', label: t('Insert: Code block'), description: t('Fenced code block'), keywords: '/ code 程式碼', run: () => editorRef.current?.insert('\n```text\n\n```\n', 9) },
    { id: 'insert-mermaid', label: t('Insert: Mermaid diagram'), description: t('Basic flowchart'), keywords: '/ diagram 圖表', run: () => editorRef.current?.insert(mode === 'mermaid' ? `flowchart TD\n  A[${t('Start')}] --> B[${t('Done')}]\n` : `\n\`\`\`mermaid\ngraph TD\n  A[${t('Start')}] --> B[${t('Done')}]\n\`\`\`\n`) },
    { id: 'focus', label: t(focusMode ? 'Exit focus mode' : 'Enter focus mode'), run: () => setFocusMode((enabled) => !enabled) },
    { id: 'typewriter', label: t(typewriterMode ? 'Disable typewriter mode' : 'Enable typewriter mode'), run: () => setTypewriterMode((enabled) => !enabled) },
    { id: 'sync', label: t(syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'), run: () => setSyncEnabled((enabled) => !enabled) },
    { id: 'fold', label: t('Fold all sections'), run: () => editorRef.current?.foldAll() },
    { id: 'unfold', label: t('Unfold all sections'), run: () => editorRef.current?.unfoldAll() },
    { id: 'snapshot', label: t('Create current revision'), description: t('Save to local revision history'), run: () => void createManualSnapshot() },
    { id: 'revisions', label: t('Open revision history'), description: t('Preview, download, or restore an older revision'), run: () => setRevisionsOpen(true) },
    { id: 'shortcuts', label: t('Show keyboard shortcuts'), run: () => setHelpOpen(true) },
  ].map((action) => ({ ...action, shortcut: formatShortcut(shortcuts[action.id]) })), [createManualSnapshot, downloadHtml, downloadSource, downloadProject, focusMode, loadFile, mode, saveFile, shortcuts, syncEnabled, t, typewriterMode])

  useEffect(() => {
    if (!hydrated) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('dialog[open], [role="dialog"]')) return
      const shortcut = shortcutFromEvent(event)
      const isTyping = Boolean(target?.closest('input, select, textarea, [contenteditable="true"], .cm-editor'))
      if (shortcut === '?' && isTyping) return
      const action = shortcut && commandActions.find((command) => shortcuts[command.id] === shortcut)
      if (action) {
        event.preventDefault()
        event.stopPropagation()
        action.run()
      } else if (shortcut && Object.values(DEFAULT_SHORTCUTS).includes(shortcut)) {
        // Do not let a removed app binding trigger a competing editor or browser command.
        event.preventDefault()
        event.stopPropagation()
      } else if (event.key === 'Escape' && focusMode) {
        setFocusMode(false)
      } else if (event.key === 'Escape') {
        setMobileOutlineOpen(false)
        setStatsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [commandActions, focusMode, hydrated, shortcuts])

  if (!hydrated) {
    return <main className="app-shell productivity-shell"><div className="app-loading">{t('Loading local draft…')}</div></main>
  }

  return (
    <main className={`app-shell productivity-shell ${focusMode ? 'is-focus-mode' : ''} ${typewriterMode ? 'is-typewriter-mode' : ''}`}>
      <input ref={fileInputRef} className="visually-hidden-file" type="file" disabled={importingWord} accept=".md,.markdown,.txt,.mmd,.mermaid,.docx,.zip,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip" onChange={(event) => {
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
        <div className="document-heading"><FileText size={18} aria-hidden="true" /><span title={title}>{title}</span><span className="document-extension">.{DOCUMENT_MODES[mode].extension}</span></div>
        <nav className="header-actions" aria-label={t('Document tools')}>
          <button className="toolbar-button open-trigger" type="button" disabled={Boolean(fileBusy) || importingWord} onClick={() => void loadFile()} aria-label={t(importingWord ? 'Converting Word…' : 'Open document or project')} title={t('Open document or project')}><FolderOpen size={17} aria-hidden="true" /><span>{t(importingWord ? 'Converting Word…' : 'Open')}</span></button>
          <button className="toolbar-button save-trigger" type="button" disabled={Boolean(fileBusy) || assetBusy} onClick={() => void saveFile()} aria-label={t(canSaveLocalFile ? 'Save file' : 'Download source')} title={t(canSaveLocalFile ? 'Save file' : 'Download source')}><Save size={17} aria-hidden="true" /><span>{t(fileBusy === 'saving' ? 'Saving…' : canSaveLocalFile ? 'Save' : 'Download')}</span></button>
          <button className="toolbar-button language-toggle" type="button" onClick={() => setLocale(locale === 'en' ? 'zh-TW' : 'en')} title={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={17} aria-hidden="true" /><span>{locale === 'en' ? t('Traditional Chinese') : 'EN'}</span></button>
          <ExportMenu mode={mode} disabled={!markdown.trim()} exporting={exporting} clientExporting={clientExporting} exportStyle={exportStyle} onStyleChange={setExportStyle} hasAssets={referencedAssets.size > 0} onSource={downloadSource} onSaveAs={canSaveLocalFile ? () => void saveFile(true) : undefined} onProject={() => void downloadProject()} onHtml={() => void downloadHtml()} onExport={(format) => void handleExport(format)} />
        </nav>
      </header>

      <nav className="workspace-toolbar" aria-label={t('Workspace tools')}>
        <div className="workspace-toolbar__group">
          {mode === 'markdown' ? <button className="toolbar-button outline-trigger" type="button" aria-label={t('Document outline')} aria-controls="document-outline" aria-expanded={window.matchMedia('(max-width: 900px)').matches ? mobileOutlineOpen : !outlineCollapsed} onClick={() => {
            if (window.matchMedia('(max-width: 900px)').matches) setMobileOutlineOpen((open) => !open)
            else setOutlineCollapsed((collapsed) => !collapsed)
          }}><ListTree size={17} aria-hidden="true" /><span>{t('Outline')}</span></button> : null}
          <button className="toolbar-button asset-trigger" type="button" onClick={() => setAssetsOpen(true)} aria-label={t('Manage local assets')}><Paperclip size={17} aria-hidden="true" /><span>{t('Assets')}</span>{assets.length ? <small>{assets.length}</small> : null}</button>
          <button className="toolbar-button revision-trigger" type="button" onClick={() => setRevisionsOpen(true)} aria-label={t('Revision history')}><History size={17} aria-hidden="true" /><span>{t('Revision history')}</span></button>
        </div>
        <div className="workspace-toolbar__group">
          <button className="toolbar-button utility-command" type="button" onClick={() => setCommandOpen(true)} aria-label={t('Command palette')}><Command size={16} aria-hidden="true" /><span>{t('Find a command')}</span>{shortcuts.commands && <kbd>{formatShortcut(shortcuts.commands)}</kbd>}</button>
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
        {mode === 'markdown' && mobileOutlineOpen ? <button className="outline-scrim" type="button" aria-label={t('Collapse document outline')} onClick={() => setMobileOutlineOpen(false)} /> : null}
        {mode === 'markdown' ? <OutlinePanel mobileOpen={mobileOutlineOpen} onMobileClose={() => setMobileOutlineOpen(false)} headings={headings} collapsed={outlineCollapsed} activeLine={activeLine} onCollapsedChange={setOutlineCollapsed} onJump={jumpToLine} /> : null}
        <section className="pane pane--editor" style={{ flex: `${split} 1 0` }}>
          <header className="pane-header"><div className="pane-title"><FileText size={16} aria-hidden="true" />{t('Editor')}<select className="document-mode" aria-label={t('Document mode')} value={mode} onChange={(event) => changeMode(normalizeDocumentMode(event.target.value))}>{(Object.keys(DOCUMENT_MODES) as DocumentMode[]).map((value) => <option key={value} value={value}>{t(DOCUMENT_MODES[value].label)}</option>)}</select></div><div className="pane-tools">{mode === 'markdown' ? <button type="button" className="table-tool" onClick={() => editorRef.current?.editTable()} title={t('Insert or edit table')} aria-label={t('Insert or edit table')}><Table2 size={17} aria-hidden="true" /><span>{t('Table')}</span></button> : null}<button type="button" onClick={() => editorRef.current?.search()} title={t('Search document')} aria-label={t('Search document')}><Search size={17} aria-hidden="true" /></button><button type="button" className={typewriterMode ? 'is-active' : ''} aria-pressed={typewriterMode} onClick={() => setTypewriterMode((enabled) => !enabled)} title={t('Typewriter mode')} aria-label={t('Typewriter mode')}><AlignCenter size={17} aria-hidden="true" /></button></div></header>
          <EditorPane ref={editorRef} mode={mode} value={markdown} onChange={changeMarkdown} onScrollLine={handleEditorScroll} typewriter={typewriterMode} onSlashCommand={() => setCommandOpen(true)} onPasteFiles={(files) => void handleAssetFiles(files)} />
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
          <PreviewPane ref={previewRef} mode={mode} markdown={deferredMarkdown} theme={theme} markdownFontSize={previewTypography.markdownFontSize} mermaidFontSize={previewTypography.mermaidFontSize} assetVersion={assetVersion} onScrollLine={handlePreviewScroll} onLayout={handlePreviewLayout} onSourceLine={jumpToLine} onEditTable={editPreviewTable} />
        </section>

        {dragActive ? <div className="drop-target" aria-hidden="true"><Paperclip size={34} /><strong>{t('Drop to open or insert files')}</strong><span>{t('Markdown, text, Mermaid, Word (.docx), project ZIP, and media')}</span></div> : null}
        {statsOpen ? <StatsPopover stats={stats} available={available} staticDeployment={IS_STATIC_DEPLOYMENT} onClose={() => setStatsOpen(false)} onClear={() => { if (window.confirm(t('Clear this document? Download a copy first if you want to keep it.'))) changeMarkdown('') }} /> : null}
      </section>

      <footer className="status-bar">
        <button className={`status-action ${statsOpen ? 'is-active' : ''}`} type="button" aria-label={t('Word count')} aria-expanded={statsOpen} onClick={() => setStatsOpen((open) => !open)}><BarChart3 size={15} aria-hidden="true" />{t('Characters {count}', { count: stats.chars_no_spaces.toLocaleString(locale) })}</button>
        <span className="status-lines">{t('Lines {count}', { count: stats.line_count.toLocaleString(locale) })}</span>
        <div className="save-status-group">
          {linkedFile ? <span className={`file-save-status ${fileDirty ? 'status-warn' : 'status-ok'}`} role="status" title={`${linkedFile.handle.name} · ${fileSaveLabel}`}><Save size={14} aria-hidden="true" /><span className="file-save-status__name">{linkedFile.handle.name}</span><span>{fileSaveLabel}</span></span> : null}
          <span className={`save-status ${saveWarning ? 'status-warn' : persistenceStatus === 'saved' ? 'status-ok' : ''}`} role="status" title={saveLabel}>{persistenceStatus === 'saved' ? <CheckCircle2 size={14} aria-hidden="true" /> : saveWarning ? <AlertCircle size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}<span>{saveLabel}</span></span>
        </div>
        <span className="status-line">{t('Line {line} / {total}', { line: Math.round(activeLine), total: totalLines })}</span>
        <button className="status-action help-trigger" type="button" onClick={() => setHelpOpen(true)} aria-label={t('Keyboard shortcuts')} title={t('Keyboard shortcuts')}><HelpCircle size={16} aria-hidden="true" /></button>
      </footer>
      {focusMode ? <button className="focus-exit" type="button" onClick={() => setFocusMode(false)}>{t('Esc to exit focus')}</button> : null}
      <CommandPalette open={commandOpen} actions={commandActions.filter((action) => action.id !== 'commands')} onClose={() => setCommandOpen(false)} />
      {helpOpen && <ShortcutHelp open onClose={() => setHelpOpen(false)} actions={commandActions} shortcuts={shortcuts} onChange={updateShortcuts} onReset={() => updateShortcuts({ ...DEFAULT_SHORTCUTS })} />}
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
            currentMetadata={{ theme, mode }}
            persistence={persistence}
            onClose={() => setRevisionsOpen(false)}
            onRestore={(content, metadata) => {
              changeMarkdown(content)
              changeMode(normalizeDocumentMode(metadata.mode))
              const restoredTheme = metadata.theme
              if (isThemeName(restoredTheme)) setTheme(restoredTheme)
            }}
          />
        </Modal>
      ) : null}
      {fileError ? <Modal label={t('File not saved')} onClose={() => setFileError('')} className="file-error-overlay">
        <section className="file-error-panel">
          <h2>{t('File not saved')}</h2>
          <p role="alert">{fileError}</p>
          <div>
            <button type="button" onClick={() => setFileError('')}>{t('Close')}</button>
            <button type="button" onClick={() => { downloadSource(); setFileError('') }}>{t('Download source')}</button>
            <button type="button" className="file-error-panel__primary" onClick={() => void saveFile(true)}>{t('Save as…')}</button>
          </div>
        </section>
      </Modal> : null}
      {updateAvailable ? <Modal label={t('Update available')} onClose={() => { if (!updateBusy) setUpdateAvailable(false) }} className="update-overlay">
        <section className="file-error-panel">
          <h2>{t('Update available')}</h2>
          <p>{t('A new version is ready. Save your draft before updating.')}</p>
          {updateError ? <p role="alert">{updateError}</p> : null}
          <div>
            <button type="button" disabled={updateBusy} onClick={() => setUpdateAvailable(false)}>{t('Later')}</button>
            <button type="button" onClick={downloadSource}>{t('Download source')}</button>
            <button type="button" disabled={Boolean(clientExporting) || assetBusy || Boolean(fileBusy)} onClick={() => void downloadProject()}>{t('Download project ZIP')}</button>
            <button type="button" className="file-error-panel__primary" disabled={updateBusy || Boolean(fileBusy) || assetBusy || Boolean(clientExporting)} onClick={() => void saveAndUpdate()}>{t(updateBusy ? 'Saving…' : 'Save and update')}</button>
          </div>
        </section>
      </Modal> : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
