import { Copy, Ellipsis, FileText, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n'
import { IS_STATIC_DEPLOYMENT } from '../deployment'
import { documentName, listWorkspaceDrafts, subscribeToDocuments } from '../storage'
import { Modal } from './Modal'

const mobileQuery = window.matchMedia('(max-width: 900px)')
function subscribeToMobile(listener: () => void) {
  mobileQuery.addEventListener('change', listener)
  return () => mobileQuery.removeEventListener('change', listener)
}

interface DocumentItem { id: string; name: string; version: number; updatedAt: number; trashed: boolean }
type DocumentAction = (retry: boolean) => Promise<void>
interface DocumentPanelProps {
  currentId: string
  busy: boolean
  onClose: () => void
  onOpen: (id: string) => Promise<void>
  onDuplicate: (id: string) => Promise<void>
  onRename: (id: string, name: string, version: number) => Promise<void>
  onTrash: (id: string, version: number) => Promise<void>
  onRestore: (id: string, version: number) => Promise<void>
  onSaveCopy?: () => Promise<void>
}

export function DocumentPanel({ currentId, busy, onClose, onOpen, onDuplicate, onRename, onTrash, onRestore, onSaveCopy }: DocumentPanelProps) {
  const { locale, t } = useI18n()
  const mobile = useSyncExternalStore(subscribeToMobile, () => mobileQuery.matches)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [trash, setTrash] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string; version: number } | null>(null)
  const [message, setMessage] = useState('')
  const [readError, setReadError] = useState('')
  const generation = useRef(0)
  const mounted = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const retryAction = useRef<DocumentAction | null>(null)
  const versions = useRef(new Map<string, number>())
  const currentVersion = (id: string) => {
    const version = versions.current.get(id)
    if (version === undefined) throw new Error(t('Document not found'))
    return version
  }
  const clearAction = () => { retryAction.current = null; setMessage('') }
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const drafts = await listWorkspaceDrafts()
      if (!mounted.current || current !== generation.current) return
      versions.current = new Map(drafts.map((draft) => [draft.id, draft.version ?? 0]))
      setDocuments(drafts.map((draft) => ({ id: draft.id, name: documentName(draft), version: draft.version ?? 0,
        updatedAt: draft.updatedAt, trashed: Boolean(draft.trashedAt) })))
      setLoading(false)
      setReadError('')
    } catch {
      if (!mounted.current || current !== generation.current) return
      setReadError(t('Could not read documents. Try again, or download your current document.'))
      setLoading(false)
    }
  }, [t])
  useEffect(() => {
    mounted.current = true
    searchRef.current?.focus({ preventScroll: true })
    void refresh()
    const unsubscribe = subscribeToDocuments(() => void refresh())
    return () => { mounted.current = false; unsubscribe() }
  }, [refresh])
  const run = async (action: DocumentAction, retry = false) => {
    setMessage('')
    retryAction.current = action
    try { await action(retry); retryAction.current = null; setRenaming(null); await refresh() }
    catch (error) { setMessage(error instanceof Error ? error.message : t('Could not update the document. Please try again.')); await refresh() }
  }
  const visible = documents.filter((document) => document.trashed === trash && document.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))

  const panel = <aside className="document-panel" id="workspace-documents" aria-label={t('Documents')} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (renaming) { setRenaming(null); clearAction() } else onClose() }
  }}>
    <header><h2>{t('Documents')}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t('Close documents')}><X size={18} aria-hidden="true" /></button></header>
    <label className="document-panel__search"><Search size={16} aria-hidden="true" /><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search by name')} aria-label={t('Search documents')} /></label>
    <div className="document-panel__tabs" role="group" aria-label={t('Document list')}>
      <button type="button" aria-pressed={!trash} onClick={() => { setTrash(false); setRenaming(null); clearAction() }}>{t('Documents')}</button>
      <button type="button" aria-pressed={trash} onClick={() => { setTrash(true); setRenaming(null); clearAction() }}><Trash2 size={14} aria-hidden="true" />{t('Trash')}</button>
    </div>
    {message || readError || onSaveCopy ? <p className="document-panel__message" role="alert">
      {message || readError || t('Another tab saved changes. Save a copy to keep these edits.')}
      {onSaveCopy
        ? <button type="button" disabled={busy} onClick={() => void run(onSaveCopy)}>{t('Save a copy')}</button>
        : <button type="button" disabled={busy} onClick={() => { if (retryAction.current) void run(retryAction.current, true); else void refresh() }}>{t('Try again')}</button>}
    </p> : null}
    <ul className="document-list" aria-label={t(trash ? 'Trashed documents' : 'Saved documents')} aria-busy={loading || busy}>
      {visible.map((document) => <li key={document.id} className={currentId === document.id ? 'is-current' : ''}>
        <div className="document-list__row">
          <button type="button" className="document-list__open" disabled={busy || trash} aria-current={currentId === document.id ? 'page' : undefined} onClick={() => void run(() => onOpen(document.id))} title={document.name}>
            <FileText size={16} aria-hidden="true" /><span><strong>{document.name}</strong><small>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(document.updatedAt)}</small></span>
          </button>
          {trash ? <button type="button" className="document-list__restore" disabled={busy} onClick={() => void run((retry) => onRestore(document.id, retry ? currentVersion(document.id) : document.version))} aria-label={t('Restore {name}', { name: document.name })} title={t('Restore')}><RotateCcw size={17} aria-hidden="true" /></button>
            : <details className="document-list__actions"><summary aria-label={t('Actions for {name}', { name: document.name })}><Ellipsis size={18} aria-hidden="true" /></summary><div>
              <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setRenaming(document); clearAction() }}>{t('Rename')}</button>
              <button type="button" disabled={busy} onClick={() => void run(() => onDuplicate(document.id))}><Copy size={14} aria-hidden="true" />{t('Duplicate')}</button>
              <button type="button" disabled={busy} onClick={() => void run((retry) => onTrash(document.id, retry ? currentVersion(document.id) : document.version))}><Trash2 size={14} aria-hidden="true" />{t('Move to trash')}</button>
            </div></details>}
        </div>
        {renaming?.id === document.id ? <form className="document-list__rename" onSubmit={(event) => { event.preventDefault(); void run((retry) => onRename(renaming.id, renaming.name, retry ? currentVersion(renaming.id) : renaming.version)) }}>
          <input aria-label={t('Document name')} autoFocus maxLength={120} value={renaming.name} onChange={(event) => { setRenaming({ ...renaming, name: event.target.value }); clearAction() }} />
          <div><button type="button" disabled={busy} onClick={() => { setRenaming(null); clearAction() }}>{t('Cancel')}</button><button type="submit" disabled={busy || !renaming.name.trim()}>{t('Save name')}</button></div>
        </form> : null}
      </li>)}
      {!visible.length ? <li className="document-list__empty">{t(loading ? 'Opening documents…' : query.trim() ? 'No documents match this name.' : trash ? 'The trash is empty.' : 'Create a document to start writing.')}</li> : null}
    </ul>
    <footer>{t(trash ? 'Restore a document to use it again.' : IS_STATIC_DEPLOYMENT ? 'Documents are saved in this browser. Download copies for backup.' : 'Documents are saved locally.')}</footer>
  </aside>
  return mobile ? <Modal label={t('Documents')} onClose={onClose} closeOnBackdrop={false} className="documents-overlay">{panel}</Modal> : panel
}
