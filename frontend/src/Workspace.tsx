import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import App from './App'
import { useI18n } from './i18n'
import { SAMPLE_MARKDOWN } from './sample'
import { chooseWorkspaceDocument, CURRENT_DRAFT_ID, loadPreference, savePreference } from './storage'
import type { LinkedFile } from './localFiles'

const HtmlEditorPage = lazy(() => import('./HtmlEditorPage'))

class HtmlEditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function HtmlEditorLoadError() {
  const { t } = useI18n()
  return <main className="workspace-load-error">
    <section className="file-error-panel" aria-labelledby="html-load-error-title">
      <h1 id="html-load-error-title">{t('The HTML editor could not be opened')}</h1>
      <p role="alert">{t('Check your connection and try again, or return to Markdown to continue writing.')}</p>
      <div>
        <button type="button" onClick={() => { window.location.hash = '/' }}>{t('Return to Markdown')}</button>
        <button type="button" className="file-error-panel__primary" onClick={() => window.location.reload()}>{t('Try again')}</button>
      </div>
    </section>
  </main>
}

function subscribeToRoute(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export default function Workspace() {
  const { locale, t } = useI18n()
  const htmlPage = useSyncExternalStore(subscribeToRoute, () => window.location.hash === '#/html')
  const initialSample = useRef(SAMPLE_MARKDOWN[locale])
  const [selection, setSelection] = useState<{ id: string; revealSummary?: boolean; notice?: string } | null>(null)
  const [documentsOpen, setDocumentsOpen] = useState(() => loadPreference('documents-open', false))
  const linkedFiles = useRef(new Map<string, LinkedFile>())
  const [updateAvailable, setUpdateAvailable] = useState(false)
  useEffect(() => { savePreference('documents-open', documentsOpen) }, [documentsOpen])
  useEffect(() => { if (htmlPage) setSelection((current) => current ? { id: current.id } : null) }, [htmlPage])
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true)
    window.addEventListener('markword:update-available', onUpdate)
    return () => window.removeEventListener('markword:update-available', onUpdate)
  }, [])
  useEffect(() => {
    if (selection || htmlPage) return
    const blockFileShortcuts = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['o', 's', 'k'].includes(event.key.toLowerCase())) event.preventDefault()
    }
    window.addEventListener('keydown', blockFileShortcuts, true)
    return () => window.removeEventListener('keydown', blockFileShortcuts, true)
  }, [htmlPage, selection])
  useEffect(() => {
    let cancelled = false
    let preferred = CURRENT_DRAFT_ID
    try { preferred = loadPreference('active-document', CURRENT_DRAFT_ID) } catch { /* Draft recovery does not depend on preferences. */ }
    void chooseWorkspaceDocument(preferred, initialSample.current)
      .then((id) => { if (!cancelled) setSelection({ id }) })
      .catch(() => { if (!cancelled) setSelection({ id: CURRENT_DRAFT_ID }) })
    return () => { cancelled = true }
  }, [])
  const selectDocument = useCallback((id: string, revealSummary = false, notice = '') => {
    try { savePreference('active-document', id) } catch { /* The document can still be opened. */ }
    setSelection({ id, revealSummary, notice })
  }, [])
  const rememberLinkedFile = useCallback((id: string, file: LinkedFile | null) => {
    if (file) linkedFiles.current.set(id, file)
    else linkedFiles.current.delete(id)
  }, [])
  return htmlPage
    ? <HtmlEditorBoundary fallback={<HtmlEditorLoadError />}>
      <Suspense fallback={<div className="app-loading">{t('Opening HTML editor…')}</div>}><HtmlEditorPage /></Suspense>
    </HtmlEditorBoundary>
    : selection ? <App key={selection.id} documentId={selection.id} revealImportSummary={selection.revealSummary} initialNotice={selection.notice}
      initialLinkedFile={linkedFiles.current.get(selection.id) ?? null} onDocumentChange={selectDocument} onLinkedFileChange={rememberLinkedFile}
      documentsOpen={documentsOpen} onDocumentsOpenChange={setDocumentsOpen}
      updateAvailable={updateAvailable} onUpdateAvailableChange={setUpdateAvailable} />
      : <div className="app-loading">{t('Opening documents…')}</div>
}
