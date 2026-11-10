import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import { useI18n } from './i18n'
import { SAMPLE_MARKDOWN } from './sample'
import { chooseWorkspaceDocument, CURRENT_DRAFT_ID, loadPreference, savePreference } from './storage'
import type { LinkedFile } from './localFiles'

export default function Workspace() {
  const { locale, t } = useI18n()
  const initialSample = useRef(SAMPLE_MARKDOWN[locale])
  const [selection, setSelection] = useState<string | null>(null)
  const [documentsOpen, setDocumentsOpen] = useState(() => loadPreference('documents-open', false))
  const linkedFiles = useRef(new Map<string, LinkedFile>())
  const [updateAvailable, setUpdateAvailable] = useState(false)
  useEffect(() => { savePreference('documents-open', documentsOpen) }, [documentsOpen])
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true)
    window.addEventListener('markword:update-available', onUpdate)
    return () => window.removeEventListener('markword:update-available', onUpdate)
  }, [])
  useEffect(() => {
    if (selection) return
    const blockFileShortcuts = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['o', 's', 'k'].includes(event.key.toLowerCase())) event.preventDefault()
    }
    window.addEventListener('keydown', blockFileShortcuts, true)
    return () => window.removeEventListener('keydown', blockFileShortcuts, true)
  }, [selection])
  useEffect(() => {
    let cancelled = false
    let preferred = CURRENT_DRAFT_ID
    try { preferred = loadPreference('active-document', CURRENT_DRAFT_ID) } catch { /* Draft recovery does not depend on preferences. */ }
    void chooseWorkspaceDocument(preferred, initialSample.current)
      .then((id) => { if (!cancelled) setSelection(id) })
      .catch(() => { if (!cancelled) setSelection(CURRENT_DRAFT_ID) })
    return () => { cancelled = true }
  }, [])
  const selectDocument = useCallback((id: string) => {
    try { savePreference('active-document', id) } catch { /* The document can still be opened. */ }
    setSelection(id)
  }, [])
  const getLinkedFile = useCallback((id: string) => linkedFiles.current.get(id) ?? null, [])
  const rememberLinkedFile = useCallback((id: string, file: LinkedFile | null) => {
    if (file) linkedFiles.current.set(id, file)
    else linkedFiles.current.delete(id)
  }, [])
  return selection ? <App initialDocumentId={selection} getLinkedFile={getLinkedFile}
      onDocumentSelect={selectDocument} onLinkedFileChange={rememberLinkedFile}
      documentsOpen={documentsOpen} onDocumentsOpenChange={setDocumentsOpen}
      updateAvailable={updateAvailable} onUpdateAvailableChange={setUpdateAvailable} />
      : <div className="app-loading">{t('Opening documents…')}</div>
}
