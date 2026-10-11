import {
  AlignCenter, ArrowLeftRight, BarChart3, CheckCircle2, Circle, Command,
  Ellipsis, Eye, FileText, FolderOpen, HelpCircle, History, Languages, Link2,
  ListTree, Maximize2, Paperclip, Save, Search, Unlink2, AlertCircle, Table2, PanelsTopLeft, PanelTopClose, PanelTopOpen, Undo2, Redo2, Plus, Files,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { exportDocument } from './api'
import {
  assetMarkdown,
  assetUsedElsewhere,
  createProjectArchive,
  importLocalAssets,
  importProjectArchive,
  referencedAssetPaths,
  requestPersistentStorage,
} from './assets'
import { AssetPanel } from './components/AssetPanel'
import { CommandPalette, type CommandAction } from './components/CommandPalette'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { DocumentPanel } from './components/DocumentPanel'
import { ImportSummaryPanel } from './components/ImportSummaryPanel'
import { ExportMenu, PreviewSettings, ToolbarMenu } from './components/DocumentMenus'
import { ExportPreview } from './components/ExportPreview'
import { Modal } from './components/Modal'
import { OutlinePanel, type OutlineHeading } from './components/OutlinePanel'
import { PreviewPane, type PreviewHandle } from './components/PreviewPane'
import { RevisionPanel } from './components/RevisionPanel'
import { ShortcutHelp } from './components/ShortcutHelp'
import { StatsPopover } from './components/StatsPopover'
import { IS_STATIC_DEPLOYMENT } from './deployment'
import { DOCUMENT_MODES, documentAsMarkdown, normalizeDocumentMode } from './documentMode'
import { useDebouncedStats } from './hooks/useDebouncedStats'
import { useI18n } from './i18n'
import { readImportSummary, type ImportSummary } from './importSummary'
import { canOpenLocalFile, canSaveLocalFile, FileChangedError, pickLocalFile, writeLocalFile, type LinkedFile } from './localFiles'
import './productivity.css'
import './markdownEditing.css'
import './workspaceDocuments.css'
import { SAMPLE_MARKDOWN } from './sample'
import { DEFAULT_SHORTCUTS, formatShortcut, normalizeShortcuts, shortcutFromEvent, type ShortcutMap } from './shortcuts'
import {
  deleteAsset,
  CURRENT_DRAFT_ID,
  createWorkspaceDocument,
  documentName as storedDocumentName,
  DraftConflictError,
  DraftPersistenceSession,
  getCurrentDraft,
  listAssets,
  listWorkspaceDrafts,
  loadPreference,
  renameWorkspaceDocument,
  savePreference,
  setDocumentTrashed,
  type PersistenceStatus,
  type StoredAsset,
  type StoredDraft,
} from './storage'
import { isThemeName } from './themeConfig'
import { DEFAULT_EXPORT_SETTINGS, normalizeExportSettings } from './exportSettings'
import { portableHtml } from './portableHtml'
import {
  DEFAULT_PREVIEW_TYPOGRAPHY,
  normalizePreviewTypography,
} from './typography'
import type { DocumentMode, ExportStyleName, ThemeName } from './types'

const MAX_LOCAL_FILE_BYTES = 15 * 1024 * 1024
class DocumentActionError extends Error {}

function documentTitle(markdown: string, name?: string | null) {
  const title = name?.trim() || markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, '').trim() || 'markword-document'
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

interface AppProps {
  documentId: string
  revealImportSummary?: boolean
  initialNotice?: string
  updateAvailable: boolean
  onUpdateAvailableChange: (available: boolean) => void
  initialLinkedFile: LinkedFile | null
  onDocumentChange: (id: string, revealSummary?: boolean, notice?: string) => void
  onLinkedFileChange: (id: string, file: LinkedFile | null) => void
}

export default function App({ documentId, revealImportSummary = false, initialNotice = '', initialLinkedFile, onDocumentChange, onLinkedFileChange, updateAvailable, onUpdateAvailableChange: setUpdateAvailable }: AppProps) {
  const { locale, setLocale, t } = useI18n()
  const initialSampleRef = useRef(documentId === CURRENT_DRAFT_ID ? SAMPLE_MARKDOWN[locale] : '')
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
  const [exportSettings, setExportSettings] = useState(() => normalizeExportSettings(loadPreference<unknown>('export-settings', DEFAULT_EXPORT_SETTINGS)))
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)
  const [notice, setNotice] = useState('')
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importSummaryOpen, setImportSummaryOpen] = useState(false)
  const [name, setDocumentName] = useState<string | null>(null)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const [documentBusy, setDocumentBusy] = useState(false)
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
  const visualEditing = mode === 'markdown'
  const [showVisualSource, setShowVisualSource] = useState(() => loadPreference<unknown>('show-source', !loadPreference('live-editing', false)) !== false)
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => loadPreference('toolbar-collapsed', false))
  const toggleSource = useCallback(() => { setShowVisualSource((shown) => !shown); setMobileView('preview') }, [])
  const runInSource = useCallback((action: () => void) => {
    setShowVisualSource(true)
    setMobileView('editor')
    requestAnimationFrame(action)
  }, [])
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
  const [linkedFile, setLinkedFile] = useState<LinkedFile | null>(initialLinkedFile)
  const [fileError, setFileError] = useState('')
  const [fileSaveFailed, setFileSaveFailed] = useState(false)
  const [clientExporting, setClientExporting] = useState<'html' | 'project' | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('idle')
  const [persistence] = useState(() => new DraftPersistenceSession({ documentId, onStatusChange: setPersistenceStatus }))
  const documentVersionRef = useRef(0)
  const importSummaryData = importSummary ? JSON.stringify(importSummary) : null
  const currentDocumentRef = useRef({ markdown, mode, theme, importSummary: importSummaryData, name })
  currentDocumentRef.current = { markdown, mode, theme, importSummary: importSummaryData, name }
  const activeLineRef = useRef(1)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const writingPaneRef = useRef<'source' | 'preview' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const { stats, available } = useDebouncedStats(markdown)
  const saveWarning = persistenceStatus === 'error' || persistenceStatus === 'conflict'
  const saveLabel = t(persistenceStatus === 'conflict' ? 'Changed in another tab. Download a backup.' : persistenceStatus === 'saved' ? 'Saved in this browser' : persistenceStatus === 'error' ? 'Draft not saved. Download a backup.' : persistenceStatus === 'saving' ? 'Saving…' : 'Draft not saved')
  const fileDirty = linkedFile && (fileSaveFailed || linkedFile.content !== markdown || linkedFile.mode !== mode)
  const fileSaveLabel = t(fileBusy === 'saving' ? 'Saving file…' : fileDirty ? 'File has unsaved changes' : 'Saved to file')
  const totalLines = Math.max(1, markdown.split('\n').length)
  const headings = useMemo(() => mode === 'markdown' ? collectHeadings(markdown) : [], [markdown, mode])
  const title = name || headings.find((heading) => heading.level === 1)?.text || t('Untitled document')
  const referencedAssets = useMemo(() => mode === 'markdown' ? referencedAssetPaths(markdown) : new Set<string>(), [markdown, mode])
  activeLineRef.current = activeLine

  const changeMarkdown = useCallback((content: string) => {
    if (content !== currentDocumentRef.current.markdown) documentVersionRef.current += 1
    currentDocumentRef.current.markdown = content
    setMarkdown(content)
  }, [])

  const changeVisualMarkdown = useCallback((next: string, previous: string, target: Element) => {
    if (previous !== currentDocumentRef.current.markdown) return false
    editorRef.current?.replaceFromPreview(next, target)
    return true
  }, [])

  const changeMode = useCallback((nextMode: DocumentMode) => {
    if (nextMode !== currentDocumentRef.current.mode) documentVersionRef.current += 1
    currentDocumentRef.current.mode = nextMode
    setMode(nextMode)
  }, [])

  const changeImportSummary = useCallback((summary: ImportSummary | null) => {
    currentDocumentRef.current.importSummary = summary ? JSON.stringify(summary) : null
    setImportSummary(summary)
    setImportSummaryOpen(Boolean(summary?.warnings.length))
    setStatsOpen(false)
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
      const summary = readImportSummary(draft.metadata.importSummary)
      setImportSummary(summary)
      setImportSummaryOpen(revealImportSummary && Boolean(summary?.warnings.length))
      setDocumentName(typeof draft.metadata.name === 'string' ? draft.metadata.name : null)
      setAssets(storedAssets)
      const savedTheme = draft.metadata.theme
      if (isThemeName(savedTheme)) setTheme(savedTheme)
      setHydrated(true)
      setStorageReady(true)
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
  }, [changeMarkdown, changeMode, persistence, revealImportSummary])

  useEffect(() => {
    if (storageReady) persistence.update(markdown, { theme, mode, importSummary: importSummaryData, name })
  }, [storageReady, markdown, mode, persistence, theme, importSummaryData, name])

  useEffect(() => { onLinkedFileChange(documentId, linkedFile) }, [documentId, linkedFile, onLinkedFileChange])

  useEffect(() => {
    savePreference('theme', theme)
    savePreference('split', split)
    savePreference('outline-collapsed', outlineCollapsed)
    savePreference('sync-enabled', syncEnabled)
    savePreference('export-style', exportStyle)
    savePreference('export-settings', exportSettings)
    savePreference('preview-typography', previewTypography)
    savePreference('show-source', showVisualSource)
    savePreference('toolbar-collapsed', toolbarCollapsed)
  }, [exportSettings, exportStyle, outlineCollapsed, previewTypography, showVisualSource, split, syncEnabled, theme, toolbarCollapsed])

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

  useEffect(() => { if (initialNotice) showNotice(initialNotice) }, [initialNotice, showNotice])

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
      persistence.update(current.markdown, { theme: current.theme, mode: current.mode, importSummary: current.importSummary, name: current.name })
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
      if (document.querySelector('dialog.source-block-overlay[open], dialog.table-editor-overlay[open], .markdown-link-form')) {
        window.dispatchEvent(new Event('markword:open-deferred'))
        showNotice(t('The file has not been opened. Apply or cancel this edit, then open the file again.'))
        return false
      }
      if (documentVersionRef.current === openingVersion) return true
      showNotice(t('Your document changed while opening this file. Your edits are kept; open the file again when you are ready.'))
      return false
    }
    const backUpBeforeReplacing = async () => {
      if (!canReplaceDocument()) return false
      const current = currentDocumentRef.current
      persistence.update(current.markdown, { theme: current.theme, mode: current.mode, importSummary: current.importSummary, name: current.name })
      try {
        await persistence.snapshot('pre-open')
      } catch {
        showNotice(t('Could not back up the current document. It has not been replaced. Download a backup and try again.'))
        return false
      }
      return canReplaceDocument()
    }
    const openDocument = async (content: string, nextMode: DocumentMode, summary: ImportSummary | null, linked: LinkedFile | null, message: string, fileName: string) => {
      if (!await backUpBeforeReplacing()) return
      const draft = await createWorkspaceDocument(content, {
        theme: currentDocumentRef.current.theme, mode: nextMode,
        name: /^#\s+\S/m.test(content) ? null : fileName.replace(/\.[^.]+$/, '').slice(0, 120) || null,
        importSummary: summary ? JSON.stringify(summary) : null,
      })
      if (!canReplaceDocument()) return
      onLinkedFileChange(draft.id, linked)
      onDocumentChange(draft.id, Boolean(summary?.warnings.length), message)
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
          await openDocument(project.markdown, project.mode, null, null, t('Opened project {file}', { file: file.name }), file.name)
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
      if (!/\.(md|markdown|txt|mmd|mermaid|docx|html|htm)$/i.test(file.name)) {
        showNotice(t('Please choose a Markdown, text, Mermaid, Word (.docx), HTML, or project ZIP file'))
        return
      }
      if (file.size > MAX_LOCAL_FILE_BYTES) {
        showNotice(t('This file is larger than 15 MiB. Please choose a smaller file.'))
        return
      }
      if (/\.html?$/i.test(file.name)) {
        setAssetBusy(true)
        showNotice(t('Converting HTML…'))
        try {
          const { importHtmlDocument } = await import('./htmlImport')
          const converted = await importHtmlDocument(file)
          await refreshAssets()
          const message = converted.warnings.length ? '' : t(converted.restoredSource
            ? 'Restored editable content from {file}'
            : 'Converted {file} to Markdown', { file: file.name })
          await openDocument(converted.markdown, converted.mode, { fileName: file.name, restoredSource: converted.restoredSource, warnings: converted.warnings }, null, message, file.name)
        } catch {
          showNotice(t('Could not import this HTML file. It may be empty, damaged, or missing embedded attachments. Your current document is unchanged.'))
        } finally {
          setAssetBusy(false)
        }
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
          await openDocument(converted.markdown, 'markdown', { fileName: file.name, restoredSource: false, warnings: converted.warnings }, null,
            converted.warnings.length ? '' : t('Converted {file} to Markdown', { file: file.name }), file.name)
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
        const nextMode = /\.(mmd|mermaid)$/i.test(file.name) ? 'mermaid' : /\.txt$/i.test(file.name) ? 'text' : 'markdown'
        await openDocument(content, nextMode, null, picked && canSaveLocalFile ? { handle: picked.handle, content, byteLength: file.size, mode: nextMode } : null,
          t('Opened {file}', { file: file.name }), file.name)
      } catch {
        showNotice(t('Could not read this file. Please try again.'))
      }
    } catch {
      showNotice(t('Could not open the file picker. Try dragging the file into the editor.'))
    } finally {
      fileBusyRef.current = false
      setFileBusy(null)
    }
  }, [assetBusy, hydrated, onDocumentChange, onLinkedFileChange, persistence, refreshAssets, showNotice, t])

  const handleDroppedFiles = useCallback(async (files: readonly File[]) => {
    const documentFile = files.find((file) => /\.(?:md|markdown|txt|mmd|mermaid|docx|doc|html|htm|zip)$/i.test(file.name))
    const assetFiles = files.filter((file) => file !== documentFile)
    if (documentFile) await loadFile(documentFile)
    if (assetFiles.length) await handleAssetFiles(assetFiles, !documentFile)
  }, [handleAssetFiles, loadFile])

  const downloadSource = useCallback(() => {
    downloadBlob(markdown, `${DOCUMENT_MODES[mode].mime};charset=utf-8`, `${documentTitle(markdown, name)}.${DOCUMENT_MODES[mode].extension}`)
    showNotice(t('{format} downloaded', { format: t(DOCUMENT_MODES[mode].label) }))
  }, [markdown, mode, name, showNotice, t])

  const saveFile = useCallback(async (saveAs = false) => {
    if (fileBusyRef.current || wordImportBusyRef.current || assetBusy) return
    if (!canSaveLocalFile) { downloadSource(); return }
    fileBusyRef.current = true
    setFileBusy('saving')
    setFileError('')
    try {
      const saved = await writeLocalFile(markdown, mode, `${documentTitle(markdown, name)}.${DOCUMENT_MODES[mode].extension}`, linkedFile, saveAs)
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
  }, [assetBusy, downloadSource, linkedFile, markdown, mode, name, showNotice, t])

  const downloadHtml = useCallback(async () => {
    if (clientExporting) return
    setClientExporting('html')
    try {
      const { renderHtmlSnapshot } = await import('./htmlExport')
      const snapshot = await renderHtmlSnapshot(markdown, mode, theme, previewTypography.mermaidFontSize)
      downloadBlob(portableHtml(markdown, mode, theme, exportStyle, locale, snapshot.html, snapshot.css, documentTitle(markdown, name), exportSettings), 'text/html;charset=utf-8', `${documentTitle(markdown, name)}.html`)
      showNotice(t('Portable HTML downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create portable HTML'))
    } finally {
      setClientExporting(null)
    }
  }, [clientExporting, exportSettings, exportStyle, locale, markdown, mode, name, previewTypography.mermaidFontSize, showNotice, t, theme])

  const downloadProject = useCallback(async (scope: 'all' | 'document' = 'document') => {
    if (clientExporting) return
    setClientExporting('project')
    try {
      const title = documentTitle(markdown, name)
      const archive = await createProjectArchive(markdown, title, assets, mode, scope)
      downloadBlob(archive, 'application/zip', `${title}.markword.zip`)
      const available = new Set(assets.map((asset) => asset.path))
      const missingCount = [...referencedAssets].filter((path) => !available.has(path)).length
      showNotice(scope === 'all' && missingCount
        ? t('ZIP downloaded with {count} missing assets listed in the archive.', { count: missingCount })
        : t('Project ZIP downloaded'))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Could not create project ZIP'))
    } finally {
      setClientExporting(null)
    }
  }, [assets, clientExporting, markdown, mode, name, referencedAssets, showNotice, t])

  const downloadLocalAsset = useCallback((asset: StoredAsset) => {
    downloadBlob(asset.blob, asset.type || 'application/octet-stream', asset.name)
  }, [])

  const removeLocalAsset = useCallback(async (asset: StoredAsset) => {
    setAssetBusy(true)
    let deleted = false
    try {
      const elsewhere = await assetUsedElsewhere(asset.path, documentId)
      const message = elsewhere
        ? t('Another document or saved revision uses this asset. Deleting it affects those copies too. Delete it anyway?')
        : referencedAssets.has(asset.path) ? t('This asset is referenced by the document. Delete it anyway?') : t('Delete this local asset?')
      if (!window.confirm(message)) return
      await deleteAsset(asset.id)
      deleted = true
      await refreshAssets()
      showNotice(t('Local asset deleted'))
    } catch {
      showNotice(t(deleted ? 'The asset was deleted, but the list could not be refreshed. Reopen the asset list to check it.'
        : 'Could not delete local asset. Your documents and the asset are kept. Try again.'))
    } finally {
      setAssetBusy(false)
    }
  }, [documentId, referencedAssets, refreshAssets, showNotice, t])

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
    setShowVisualSource(true)
    setMobileView('editor')
    setMobileOutlineOpen(false)
    setActiveLine(line)
    editorRef.current?.jumpToLine(line)
    if (syncEnabled) previewRef.current?.scrollToLine(line)
  }, [syncEnabled])

  const editPreviewTable = useCallback((line: number) => {
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
      await exportDocument(format, documentAsMarkdown(markdown, mode), theme, exportStyle, exportSettings, documentTitle(markdown, name))
      showNotice(t('{format} download started', { format: format.toUpperCase() }))
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('Export failed. Please try again.'))
    } finally {
      setExporting(null)
    }
  }, [exportSettings, exportStyle, exporting, markdown, mode, name, showNotice, t, theme])

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

  const runDocumentAction = useCallback(async (operation: (draft: StoredDraft, select: (id: string) => void) => Promise<void>) => {
    if (!storageReady) throw new DocumentActionError(t('Could not save your current document. Download a backup before switching.'))
    if (document.querySelector('.markdown-link-form')) throw new DocumentActionError(t('Apply or cancel the link edit before changing documents.'))
    if (fileBusyRef.current || wordImportBusyRef.current || assetBusy || clientExporting) {
      throw new DocumentActionError(t('Finish the current operation before switching documents.'))
    }
    fileBusyRef.current = true
    setDocumentBusy(true)
    setFileBusy('opening')
    try {
      const version = documentVersionRef.current
      const current = currentDocumentRef.current
      persistence.update(current.markdown, { theme: current.theme, mode: current.mode, importSummary: current.importSummary, name: current.name })
      let draft: StoredDraft
      try { draft = await persistence.flush() }
      catch { throw new DocumentActionError(t('Could not save your current document. Download a backup before switching.')) }
      const select = (id: string) => {
        if (version !== documentVersionRef.current) throw new DocumentActionError(t('Your document changed while switching. Your edits are kept; try again.'))
        onDocumentChange(id)
      }
      if (version !== documentVersionRef.current) throw new DocumentActionError(t('Your document changed while switching. Your edits are kept; try again.'))
      await operation(draft, select)
    } catch (error) {
      if (error instanceof DocumentActionError) throw error
      throw new DocumentActionError(t(error instanceof DraftConflictError
        ? 'The document changed in another tab. Refresh the list and try again.'
        : 'Could not update the document. Your content is kept. Try again, or download a backup.'))
    } finally {
      fileBusyRef.current = false
      setDocumentBusy(false)
      setFileBusy(null)
    }
  }, [assetBusy, clientExporting, onDocumentChange, persistence, storageReady, t])

  const createDocument = useCallback(() => runDocumentAction(async (_draft, select) => {
    select((await createWorkspaceDocument('', { mode: 'markdown', theme: currentDocumentRef.current.theme, name: null })).id)
  }), [runDocumentAction])

  const openDocument = (id: string) => id === documentId ? Promise.resolve(closeDocuments()) : runDocumentAction(async (_draft, select) => {
    const target = await getCurrentDraft(id)
    if (!target || target.trashedAt) throw new DocumentActionError(t('This document is unavailable. Refresh the list and try again.'))
    select(id)
  })

  const duplicateDocument = (id: string) => runDocumentAction(async (draft, select) => {
    const original = id === documentId ? draft : await getCurrentDraft(id)
    if (!original || original.trashedAt) throw new DocumentActionError(t('Document not found'))
    const copy = await createWorkspaceDocument(original.content, { ...original.metadata, name: t('Copy of {name}', { name: storedDocumentName(original) }).slice(0, 120) })
    select(copy.id)
  })

  const renameDocument = (id: string, nextName: string, version: number) => runDocumentAction(async (draft) => {
    if (id !== documentId) { await renameWorkspaceDocument(id, nextName, version); return }
    const trimmed = nextName.trim().slice(0, 120)
    if (!trimmed) throw new DocumentActionError(t('Enter a document name'))
    currentDocumentRef.current.name = trimmed
    setDocumentName(trimmed)
    persistence.update(draft.content, { ...draft.metadata, name: trimmed })
    await persistence.flush()
  })

  const trashDocument = (id: string, version: number) => runDocumentAction(async (draft, select) => {
    let nextId: string | undefined
    if (id === documentId) {
      nextId = (await listWorkspaceDrafts()).find((entry) => !entry.trashedAt && entry.id !== id)?.id
      if (!nextId) nextId = (await createWorkspaceDocument('', { mode: 'markdown', theme: currentDocumentRef.current.theme })).id
    }
    await setDocumentTrashed(id, true, id === documentId ? draft.version ?? 0 : version)
    if (nextId) select(nextId)
  })

  const restoreDocument = (id: string, version: number) => runDocumentAction(async () => {
    await setDocumentTrashed(id, false, version)
  })

  const closeDocuments = () => {
    setDocumentsOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-controls="workspace-documents"]')?.focus())
  }

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: 'commands', label: t('Open command palette'), run: () => setCommandOpen(true) },
    { id: 'documents', label: t('Documents'), description: t('Find and switch between saved documents'), keywords: 'notes workspace library 文件 工作區', run: () => { setImportSummaryOpen(false); setStatsOpen(false); setDocumentsOpen(true) } },
    { id: 'new-document', label: t('New document'), keywords: 'create blank 新建 文件', run: () => { void createDocument().catch((error: Error) => showNotice(error.message)) } },
    { id: 'open', label: t('Open document or project'), description: t('Open Markdown, text, Mermaid, Word, HTML, or a Markword ZIP'), keywords: 'file upload import word docx html project 匯入 轉換 檔案 專案', run: () => void loadFile() },
    { id: 'assets', label: t('Manage local assets'), description: t('Images, video, audio, and attachments'), keywords: 'asset media image video attachment 圖片 影片 附件', run: () => setAssetsOpen(true) },
    { id: 'insert-asset', label: t('Insert: Local asset'), description: t('Import files from this device'), keywords: '/ asset media image video attachment 圖片 影片 附件', run: () => assetInputRef.current?.click() },
    { id: 'save-md', label: canSaveLocalFile ? t('Save file') : t('Download {format}', { format: t(DOCUMENT_MODES[mode].label) }), description: t('Keep the editable source'), keywords: 'file save 儲存', run: () => void saveFile() },
    ...(canSaveLocalFile ? [{ id: 'save-as', label: t('Save as…'), description: t('Choose a file name and location'), keywords: 'save copy 另存新檔', run: () => void saveFile(true) }] : []),
    { id: 'download-source', label: t('Download source'), description: t('Keep the editable source'), keywords: 'download export 匯出 下載', run: downloadSource },
    { id: 'save-project', label: t('Download project ZIP'), description: t('Document and referenced local assets'), keywords: 'export zip share 匯出 分享', run: () => void downloadProject() },
    { id: 'save-asset-library', label: t('Download document and asset library ZIP'), description: t('Current document and all local assets; revisions not included'), keywords: 'export zip backup library 匯出 備份 資產庫', run: () => void downloadProject('all') },
    { id: 'save-html', label: t('Download portable HTML'), description: t('Read offline or reopen with editable source and local assets'), keywords: 'export self contained 匯出', run: () => void downloadHtml() },
    { id: 'search', label: t('Search document'), run: () => runInSource(() => editorRef.current?.search()) },
    ...(mode === 'markdown' ? [{ id: 'live-editing', label: t(showVisualSource ? 'Single-page editing' : 'Split editing'), keywords: 'single split source 單頁 雙欄 原始碼', run: toggleSource }] : []),
    { id: 'insert-heading', label: t('Insert: Heading 2'), description: t('## Heading'), keywords: '/ heading 標題', run: () => runInSource(() => editorRef.current?.insert(`\n${t('## Heading')}\n`, 4)) },
    ...(mode === 'markdown' ? [{ id: 'insert-table', label: t('Insert: Table'), description: t('Edit cells, rows, and columns'), keywords: '/ table 表格', run: () => editorRef.current?.editTable() }] : []),
    { id: 'insert-code', label: t('Insert: Code block'), description: t('Fenced code block'), keywords: '/ code 程式碼', run: () => runInSource(() => editorRef.current?.insert('\n```text\n\n```\n', 9)) },
    { id: 'insert-mermaid', label: t('Insert: Mermaid diagram'), description: t('Basic flowchart'), keywords: '/ diagram 圖表', run: () => runInSource(() => editorRef.current?.insert(mode === 'mermaid' ? `flowchart TD\n  A[${t('Start')}] --> B[${t('Done')}]\n` : `\n\`\`\`mermaid\ngraph TD\n  A[${t('Start')}] --> B[${t('Done')}]\n\`\`\`\n`)) },
    { id: 'focus', label: t(focusMode ? 'Exit focus mode' : 'Enter focus mode'), run: () => setFocusMode((enabled) => !enabled) },
    { id: 'typewriter', label: t(typewriterMode ? 'Disable typewriter mode' : 'Enable typewriter mode'), run: () => setTypewriterMode((enabled) => !enabled) },
    { id: 'sync', label: t(syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'), run: () => setSyncEnabled((enabled) => !enabled) },
    { id: 'fold', label: t('Fold all sections'), run: () => runInSource(() => editorRef.current?.foldAll()) },
    { id: 'unfold', label: t('Unfold all sections'), run: () => runInSource(() => editorRef.current?.unfoldAll()) },
    { id: 'snapshot', label: t('Create current revision'), description: t('Save to local revision history'), run: () => void createManualSnapshot() },
    { id: 'revisions', label: t('Open revision history'), description: t('Preview, download, or restore an older revision'), run: () => setRevisionsOpen(true) },
    { id: 'shortcuts', label: t('Show keyboard shortcuts'), run: () => setHelpOpen(true) },
  ].map((action) => ({ ...action, shortcut: formatShortcut(shortcuts[action.id]) })), [createDocument, createManualSnapshot, downloadHtml, downloadSource, downloadProject, focusMode, loadFile, mode, runInSource, saveFile, shortcuts, showNotice, showVisualSource, syncEnabled, t, toggleSource, typewriterMode])

  useEffect(() => {
    if (!hydrated) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('dialog[open], [role="dialog"]')) return
      const shortcut = shortcutFromEvent(event)
      const isTyping = Boolean(target?.closest('input, select, textarea, [contenteditable], .cm-editor'))
      if (shortcut === '?' && isTyping) return
      const action = shortcut && commandActions.find((command) => shortcuts[command.id] === shortcut)
      if (documentBusy) { if (action) event.preventDefault(); return }
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
        setImportSummaryOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [commandActions, documentBusy, focusMode, hydrated, shortcuts])

  if (!hydrated) {
    return <main className="app-shell productivity-shell"><div className="app-loading">{t('Loading local draft…')}</div></main>
  }

  return (
    <main className={`app-shell productivity-shell ${focusMode ? 'is-focus-mode' : ''} ${typewriterMode ? 'is-typewriter-mode' : ''} ${toolbarCollapsed ? 'is-toolbar-collapsed' : ''} ${visualEditing && !showVisualSource ? 'is-visual-only' : ''}`}>
      <input ref={fileInputRef} className="visually-hidden-file" type="file" disabled={importingWord} accept=".md,.markdown,.txt,.mmd,.mermaid,.docx,.html,.htm,.zip,text/plain,text/markdown,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip" onChange={(event) => {
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
        <nav className="header-actions" aria-label={t('Document tools')} inert={documentBusy}>
          <button className={`toolbar-button documents-trigger ${documentsOpen ? 'is-active' : ''}`} type="button" onClick={() => { setImportSummaryOpen(false); setStatsOpen(false); setDocumentsOpen((open) => !open); setMobileOutlineOpen(false) }} aria-label={t('Documents')} title={t('Documents')} aria-controls="workspace-documents" aria-expanded={documentsOpen}><Files size={17} aria-hidden="true" /><span>{t('Documents')}</span></button>
          <button className="toolbar-button open-trigger" type="button" disabled={Boolean(fileBusy) || importingWord} onClick={() => void loadFile()} aria-label={t(importingWord ? 'Converting Word…' : 'Open document or project')} title={t('Open document or project')}><FolderOpen size={17} aria-hidden="true" /><span>{t(importingWord ? 'Converting Word…' : 'Open')}</span></button>
          <button className="toolbar-button save-trigger" type="button" disabled={Boolean(fileBusy) || assetBusy} onClick={() => void saveFile()} aria-label={t(canSaveLocalFile ? 'Save file' : 'Download source')} title={t(canSaveLocalFile ? 'Save file' : 'Download source')}><Save size={17} aria-hidden="true" /><span>{t(fileBusy === 'saving' ? 'Saving…' : canSaveLocalFile ? 'Save' : 'Download')}</span></button>
          <button className="toolbar-button language-toggle" type="button" onClick={() => setLocale(locale === 'en' ? 'zh-TW' : 'en')} title={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={17} aria-hidden="true" /><span>{locale === 'en' ? t('Traditional Chinese') : 'EN'}</span></button>
          <button className="toolbar-button workspace-toolbar-toggle" type="button" aria-label={t(toolbarCollapsed ? 'Show toolbar' : 'Hide toolbar')} title={t(toolbarCollapsed ? 'Show toolbar' : 'Hide toolbar')} aria-controls="workspace-tools" aria-expanded={!toolbarCollapsed} onClick={() => setToolbarCollapsed((collapsed) => !collapsed)}>{toolbarCollapsed ? <PanelTopOpen size={17} aria-hidden="true" /> : <PanelTopClose size={17} aria-hidden="true" />}</button>
          <ExportMenu mode={mode} disabled={!markdown.trim()} exporting={exporting} clientExporting={clientExporting} exportStyle={exportStyle} onStyleChange={setExportStyle} onPreview={() => setExportPreviewOpen(true)} hasAssets={referencedAssets.size > 0} onSource={downloadSource} onSaveAs={canSaveLocalFile ? () => void saveFile(true) : undefined} onProject={(scope) => void downloadProject(scope)} onHtml={() => void downloadHtml()} onExport={(format) => void handleExport(format)} />
        </nav>
      </header>

      <nav id="workspace-tools" className="workspace-toolbar" aria-label={t('Workspace tools')}>
        <div className="workspace-toolbar__group">
          {mode === 'markdown' ? <button className="toolbar-button outline-trigger" type="button" aria-label={t('Document outline')} aria-controls="document-outline" aria-expanded={window.matchMedia('(max-width: 900px)').matches ? mobileOutlineOpen : !outlineCollapsed} onClick={() => {
            setDocumentsOpen(false)
            if (window.matchMedia('(max-width: 900px)').matches) setMobileOutlineOpen((open) => !open)
            else setOutlineCollapsed((collapsed) => !collapsed)
          }}><ListTree size={17} aria-hidden="true" /><span>{t('Outline')}</span></button> : null}
          <button className="toolbar-button asset-trigger" type="button" onClick={() => setAssetsOpen(true)} aria-label={t('Manage local assets')}><Paperclip size={17} aria-hidden="true" /><span>{t('Assets')}</span>{assets.length ? <small>{assets.length}</small> : null}</button>
          <button className="toolbar-button revision-trigger" type="button" onClick={() => setRevisionsOpen(true)} aria-label={t('Revision history')}><History size={17} aria-hidden="true" /><span>{t('Revision history')}</span></button>
        </div>
        <div className="workspace-toolbar__group">
          {visualEditing ? <button className={`toolbar-button view-mode-trigger ${!showVisualSource ? 'is-active' : ''}`} type="button" onClick={toggleSource} aria-pressed={!showVisualSource} aria-label={t(showVisualSource ? 'Single-page editing' : 'Split editing')} title={t(showVisualSource ? 'Single-page editing' : 'Split editing')}><PanelsTopLeft size={17} aria-hidden="true" /><span>{t(showVisualSource ? 'Single-page editing' : 'Split editing')}</span></button> : null}
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
        onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragActive(true) } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length) void handleDroppedFiles(files)
        }}
      >
        {mode === 'markdown' && mobileOutlineOpen ? <button className="outline-scrim" type="button" aria-label={t('Collapse document outline')} onClick={() => setMobileOutlineOpen(false)} /> : null}
        {documentsOpen ? <DocumentPanel currentId={documentId} busy={Boolean(fileBusy) || assetBusy || Boolean(clientExporting)} onClose={closeDocuments}
          onOpen={openDocument} onCreate={createDocument} onDuplicate={duplicateDocument} onRename={renameDocument} onTrash={trashDocument} onRestore={restoreDocument} /> : null}
        {mode === 'markdown' && !documentsOpen ? <OutlinePanel mobileOpen={mobileOutlineOpen} onMobileClose={() => setMobileOutlineOpen(false)} headings={headings} collapsed={outlineCollapsed} activeLine={activeLine} onCollapsedChange={setOutlineCollapsed} onJump={(line) => {
          if (visualEditing && !showVisualSource) {
            setMobileOutlineOpen(false)
            setMobileView('preview')
            setActiveLine(line)
            previewRef.current?.scrollToLine(line)
          } else jumpToLine(line)
        }} /> : null}
        <section className="pane pane--editor" style={{ flex: `${split} 1 0` }} inert={documentBusy} onFocusCapture={(event) => {
          if ((event.target as Element).closest('.cm-editor')) writingPaneRef.current = 'source'
        }}>
          <header className="pane-header">
            <div className="pane-title">
              <FileText size={16} aria-hidden="true" />{t('Editor')}
              <select className="document-mode" aria-label={t('Document mode')} value={mode} onChange={(event) => {
                if (event.target.value === 'html-page') window.location.hash = '/html'
                else changeMode(normalizeDocumentMode(event.target.value))
              }}>
                {(Object.keys(DOCUMENT_MODES) as DocumentMode[]).map((value) => <option key={value} value={value}>{t(DOCUMENT_MODES[value].label)}</option>)}
                <option value="html-page">{t('HTML editor')}</option>
              </select>
            </div>
            <div className="editor-pane-actions">
              <div className="pane-tools">
                {mode === 'markdown' ? <button type="button" className="table-tool" onClick={() => editorRef.current?.editTable()} title={t('Insert or edit table')} aria-label={t('Insert or edit table')}><Table2 size={17} aria-hidden="true" /><span>{t('Table')}</span></button> : null}
                <button type="button" onClick={() => editorRef.current?.search()} title={t('Search document')} aria-label={t('Search document')}><Search size={17} aria-hidden="true" /></button>
                <button type="button" className={typewriterMode ? 'is-active' : ''} aria-pressed={typewriterMode} onClick={() => setTypewriterMode((enabled) => !enabled)} title={t('Typewriter mode')} aria-label={t('Typewriter mode')}><AlignCenter size={17} aria-hidden="true" /></button>
              </div>
            </div>
          </header>
          <EditorPane ref={editorRef} mode={mode} value={markdown} onChange={changeMarkdown} onScrollLine={handleEditorScroll} typewriter={typewriterMode} onSlashCommand={() => setCommandOpen(true)} onPasteFiles={(files) => void handleAssetFiles(files)} />
        </section>

        <button className="splitter" type="button" onPointerDown={beginResize} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
          event.preventDefault()
          setSplit((value) => event.key === 'Home' ? 50 : Math.min(70, Math.max(30, value + (event.key === 'ArrowRight' ? 5 : -5))))
        }} aria-label={t('Resize editor and preview')} title={t('Drag or use arrow keys to resize')}><ArrowLeftRight size={14} aria-hidden="true" /></button>

        <section className="pane pane--preview" style={{ flex: `${100 - split} 1 0` }} inert={documentBusy} onFocusCapture={(event) => {
          if ((event.target as Element).closest('.markdown-body, .markdown-block-controls')) writingPaneRef.current = 'preview'
        }}>
          <header className="pane-header preview-header"><div className="pane-title"><Eye size={16} aria-hidden="true" />{t('Preview')}</div><div className="preview-tools">
            {visualEditing ? <button className="toolbar-button" type="button" aria-label={t('Add content')} title={t('Add content')} onClick={() => previewRef.current?.addBlock(writingPaneRef.current === 'source' ? editorRef.current?.cursorPosition() : undefined)}><Plus size={17} aria-hidden="true" /></button> : null}
            {visualEditing ? <div className="markdown-edit-controls">
              <ToolbarMenu label={t('Preview editing tools')} trigger={<Ellipsis size={17} aria-hidden="true" />}>
                {(close) => <div className="markdown-edit-menu" role="dialog" aria-label={t('Preview editing tools')}>
                  <button type="button" className="toolbar-button" onClick={() => { editorRef.current?.undo(); close() }}><Undo2 size={17} aria-hidden="true" />{t('Undo')}</button>
                  <button type="button" className="toolbar-button" onClick={() => { editorRef.current?.redo(); close() }}><Redo2 size={17} aria-hidden="true" />{t('Redo')}</button>
                  <div className="markdown-edit-help"><p>{t('Enter creates a paragraph or list item. Press / on an empty line to add a block.')}</p><p>{t('Click code to edit. Enter adds a line; Esc finishes editing.')}</p><p>{t('Edit tables with “Edit table”. Use “Edit source” for formulas and media.')}</p></div>
                </div>}
              </ToolbarMenu>
            </div> : null}
            <PreviewSettings theme={theme} onThemeChange={setTheme} markdownSize={previewTypography.markdownFontSize} mermaidSize={previewTypography.mermaidFontSize} onMarkdownSizeChange={setMarkdownFontSize} onMermaidSizeChange={setMermaidFontSize} onReset={resetPreviewFontSizes} />
            <button className={`toolbar-button sync-toggle ${syncEnabled ? 'is-active' : ''}`} type="button" aria-label={t('Toggle synchronized scrolling')} title={t(syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling')} aria-pressed={syncEnabled} onClick={() => setSyncEnabled((enabled) => !enabled)}>{syncEnabled ? <Link2 size={17} aria-hidden="true" /> : <Unlink2 size={17} aria-hidden="true" />}</button>
          </div></header>
          <PreviewPane ref={previewRef} mode={mode} markdown={visualEditing ? markdown : deferredMarkdown} theme={theme} markdownFontSize={previewTypography.markdownFontSize} mermaidFontSize={previewTypography.mermaidFontSize} assetVersion={assetVersion} onScrollLine={handlePreviewScroll} onLayout={handlePreviewLayout} onSourceLine={jumpToLine} onEditTable={editPreviewTable} editing={visualEditing} onVisualChange={changeVisualMarkdown} onUndo={() => editorRef.current?.undo()} onRedo={() => editorRef.current?.redo()} />
        </section>

        {dragActive ? <div className="drop-target" aria-hidden="true"><Paperclip size={34} /><strong>{t('Drop to open or insert files')}</strong><span>{t('Markdown, text, Mermaid, Word (.docx), HTML, project ZIP, and media')}</span></div> : null}
        {statsOpen ? <StatsPopover stats={stats} available={available} staticDeployment={IS_STATIC_DEPLOYMENT} onClose={() => setStatsOpen(false)} onClear={() => { if (window.confirm(t('Clear this document? Download a copy first if you want to keep it.'))) { changeMarkdown(''); changeImportSummary(null) } }} /> : null}
        {importSummaryOpen && importSummary ? <ImportSummaryPanel summary={importSummary} onClose={() => setImportSummaryOpen(false)} /> : null}
      </section>

      <footer className="status-bar">
        <button className={`status-action ${statsOpen ? 'is-active' : ''}`} type="button" aria-label={t('Word count')} aria-expanded={statsOpen} onClick={() => { setImportSummaryOpen(false); setStatsOpen((open) => !open) }}><BarChart3 size={15} aria-hidden="true" />{t('Characters {count}', { count: stats.chars_no_spaces.toLocaleString(locale) })}</button>
        {importSummary ? <button className={`status-action import-summary-trigger ${importSummaryOpen ? 'is-active' : ''}`} type="button" aria-label={t('Import summary')} aria-controls="import-summary" aria-expanded={importSummaryOpen} onClick={() => { setStatsOpen(false); setImportSummaryOpen((open) => !open) }}><FileText size={15} aria-hidden="true" /><span>{t('Import summary')}</span>{importSummary.warnings.length ? <small>{importSummary.warnings.length}</small> : null}</button> : null}
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
      {exportPreviewOpen ? <ExportPreview markdown={markdown} mode={mode} theme={theme} title={documentTitle(markdown, name)} style={exportStyle} onStyleChange={setExportStyle} settings={exportSettings} onSettingsChange={setExportSettings} mermaidFontSize={previewTypography.mermaidFontSize} onClose={() => setExportPreviewOpen(false)} /> : null}
      <AssetPanel
        open={assetsOpen}
        assets={assets}
        busy={assetBusy || importingWord || Boolean(clientExporting)}
        onAdd={() => assetInputRef.current?.click()}
        onClose={() => setAssetsOpen(false)}
        onDelete={(asset) => void removeLocalAsset(asset)}
        onDownload={downloadLocalAsset}
        onExportProject={() => void downloadProject('all')}
        onInsert={(asset) => { insertAssets([asset]); setAssetsOpen(false) }}
      />
      {revisionsOpen ? (
        <Modal onClose={() => setRevisionsOpen(false)} label={t('Revision history')} className="revision-overlay">
          <RevisionPanel
            currentContent={markdown}
            currentMetadata={{ theme, mode, importSummary: importSummaryData, name }}
            persistence={persistence}
            onClose={() => setRevisionsOpen(false)}
            onRestore={(content, metadata) => {
              changeMarkdown(content)
              changeMode(normalizeDocumentMode(metadata.mode))
              setDocumentName(typeof metadata.name === 'string' ? metadata.name : null)
              changeImportSummary(readImportSummary(metadata.importSummary))
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
            <button type="button" disabled={Boolean(clientExporting) || assetBusy || Boolean(fileBusy)} onClick={() => void downloadProject('all')}>{t('Download document and asset library ZIP')}</button>
            <button type="button" className="file-error-panel__primary" disabled={updateBusy || Boolean(fileBusy) || assetBusy || Boolean(clientExporting)} onClick={() => void saveAndUpdate()}>{t(updateBusy ? 'Saving…' : 'Save and update')}</button>
          </div>
        </section>
      </Modal> : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
    </main>
  )
}
