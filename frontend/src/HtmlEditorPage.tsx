import { ArrowLeft, CheckCircle2, Code2, Download, FolderOpen, Languages, ClipboardPaste, Redo2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorPane, type EditorHandle } from './components/EditorPane'
import { HtmlPreview } from './components/HtmlPreview'
import { Modal } from './components/Modal'
import { useHtmlDraft } from './hooks/useHtmlDraft'
import { htmlSample } from './htmlSample'
import { useI18n } from './i18n'
import './htmlEditor.css'

const MAX_FILE_BYTES = 15 * 1024 * 1024

export default function HtmlEditorPage() {
  const { locale, setLocale, t } = useI18n()
  const [sample] = useState(() => htmlSample(locale))
  const { draft, ready, status, update, flush } = useHtmlDraft(sample)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [showSource, setShowSource] = useState(true)
  const [mobileView, setMobileView] = useState<'source' | 'preview'>('preview')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const statusLabel = t(status === 'conflict' ? 'Changed in another tab. Download a backup.'
    : status === 'error' ? 'Draft not saved. Download a backup.'
    : status === 'saved' ? 'Saved in this browser' : 'Saving…')

  const changeContent = useCallback((content: string) => {
    if (content !== draftRef.current.content) update({ ...draftRef.current, content })
  }, [update])

  const download = useCallback(() => {
    const current = draftRef.current
    // eslint-disable-next-line no-control-regex -- Remove filesystem control characters from download names.
    const name = current.filename.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-') || 'page.html'
    const url = URL.createObjectURL(new Blob([current.content], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = /\.html?$/i.test(name) ? name : `${name}.html`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  useEffect(() => {
    document.title = `${t('HTML editor')} · Markword`
    return () => { document.title = 'Markword' }
  }, [t])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); download() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [download])

  const openFile = async (file: File) => {
    setError('')
    if (!/\.html?$/i.test(file.name)) { setError(t('Please choose an HTML file (.html or .htm).')); return }
    if (file.size > MAX_FILE_BYTES) { setError(t('This file is larger than 15 MiB. Please choose a smaller file.')); return }
    const previous = draftRef.current
    if (previous.content !== sample && previous.content.trim() && !window.confirm(t('Replace this page? Download a copy first if you want to keep it.'))) return
    setOpening(true)
    try {
      const content = await file.text()
      if (draftRef.current !== previous) { setError(t('Your document changed while opening this file. Your edits are kept; open the file again when you are ready.')); return }
      update({ content, filename: file.name })
      setMobileView('preview')
    } catch { setError(t('Could not read this file. Please try again.')) }
    finally { setOpening(false) }
  }

  if (!ready) return <div className="app-loading">{t('Opening HTML editor…')}</div>

  return <main className="html-editor-page">
    <input ref={inputRef} hidden type="file" accept=".html,.htm,text/html" onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void openFile(file)
    }} />
    <header className="app-header">
      <div className="brand"><img src={`${import.meta.env.BASE_URL}markword-icon.svg`} width="36" height="36" alt="" /><span>Markword<span className="brand-caption">{t('HTML editor')}</span></span></div>
      <label className="html-filename"><span>{t('File name')}</span><input value={draft.filename} onChange={(event) => update({ ...draftRef.current, filename: event.target.value })} /></label>
      <nav className="header-actions" aria-label={t('Document tools')}>
        <button type="button" className="toolbar-button open-trigger" onClick={() => inputRef.current?.click()} disabled={opening} aria-label={t('Open HTML file')}><FolderOpen size={17} aria-hidden="true" /><span>{t(opening ? 'Opening…' : 'Open')}</span></button>
        <button type="button" className="toolbar-button language-toggle" onClick={() => setLocale(locale === 'en' ? 'zh-TW' : 'en')} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={17} aria-hidden="true" /><span>{locale === 'en' ? t('Traditional Chinese') : 'EN'}</span></button>
        <button type="button" className="toolbar-button export-trigger" onClick={download} aria-label={t('Download HTML')}><Download size={17} aria-hidden="true" /><span>{t('Download')}</span></button>
      </nav>
    </header>
    <div className="html-toolbar-area">
      <nav className="html-toolbar" aria-label={t('HTML editing tools')}>
        <a className="toolbar-button" href="#" onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          void flush().then(() => { window.location.hash = '' }).catch(() => setError(t('Draft not saved. Download a backup.')))
        }}><ArrowLeft size={17} aria-hidden="true" />Markdown</a>
        <div className="html-toolbar-actions">
          <button type="button" className="toolbar-button" onClick={() => { setPasted(''); setError(''); setPasteOpen(true) }}><ClipboardPaste size={17} aria-hidden="true" />{t('Paste HTML')}</button>
          <button type="button" className="toolbar-button" aria-label={t('Undo')} title={t('Undo')} onClick={() => editorRef.current?.undo()}><Undo2 size={17} aria-hidden="true" /></button>
          <button type="button" className="toolbar-button" aria-label={t('Redo')} title={t('Redo')} onClick={() => editorRef.current?.redo()}><Redo2 size={17} aria-hidden="true" /></button>
          <button type="button" className="toolbar-button html-source-toggle" onClick={() => setShowSource((current) => !current)} aria-pressed={showSource}><Code2 size={17} aria-hidden="true" />{t(showSource ? 'Hide source' : 'Show source')}</button>
        </div>
      </nav>
      <div className="html-mobile-tabs" role="tablist" aria-label={t('Editor and preview')}>
        <button type="button" role="tab" aria-selected={mobileView === 'preview'} onClick={() => setMobileView('preview')}>{t('Editable preview')}</button>
        <button type="button" role="tab" aria-selected={mobileView === 'source'} onClick={() => setMobileView('source')}>{t('HTML source')}</button>
      </div>
      {error && !pasteOpen && <p className="html-error" role="alert">{error}<button type="button" aria-label={t('Dismiss message')} onClick={() => setError('')}><X size={16} aria-hidden="true" /></button></p>}
    </div>
    <div className={`html-workspace ${showSource ? '' : 'html-workspace--visual'} html-mobile-${mobileView}`}>
      <section className="html-source-pane" aria-label={t('HTML source')}>
        <header className="pane-header"><div className="pane-title"><Code2 size={17} aria-hidden="true" />{t('HTML source')}</div><button type="button" className="toolbar-button" onClick={() => editorRef.current?.search()}>{t('Search document')}</button></header>
        <EditorPane ref={editorRef} mode="html" value={draft.content} onChange={changeContent} onScrollLine={() => {}} />
      </section>
      <HtmlPreview value={draft.content} onChange={changeContent} onDownload={download} />
    </div>
    <footer className="html-status-bar"><span>{t('HTML editor')}</span><span role="status" className={`html-save-status ${status === 'error' || status === 'conflict' ? 'status-warn' : ''}`}>{status === 'saved' && <CheckCircle2 size={15} aria-hidden="true" />}{statusLabel}</span></footer>
    {pasteOpen && <Modal label={t('Paste HTML')} onClose={() => setPasteOpen(false)} className="html-paste-modal">
      <form onSubmit={(event) => {
        event.preventDefault()
        if (new Blob([pasted]).size > MAX_FILE_BYTES) { setError(t('This file is larger than 15 MiB. Please choose a smaller file.')); return }
        changeContent(pasted)
        setPasteOpen(false)
        setMobileView('preview')
      }}>
        <header><h2>{t('Paste HTML')}</h2><button type="button" className="toolbar-button" aria-label={t('Cancel')} onClick={() => setPasteOpen(false)}><X size={20} aria-hidden="true" /></button></header>
        <p>{t('Paste a complete page or an HTML fragment. This replaces the current page; Undo can bring it back.')}</p>
        <label htmlFor="html-paste-content">{t('HTML content')}</label>
        <textarea id="html-paste-content" value={pasted} onChange={(event) => setPasted(event.target.value)} autoFocus spellCheck={false} required />
        {error && <p className="html-error" role="alert">{error}</p>}
        <footer><button type="button" className="toolbar-button" onClick={() => setPasteOpen(false)}>{t('Cancel')}</button><button type="submit" className="toolbar-button export-trigger">{t('Open in editor')}</button></footer>
      </form>
    </Modal>}
  </main>
}
