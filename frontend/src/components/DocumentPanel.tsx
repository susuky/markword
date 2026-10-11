import { Copy, Ellipsis, FileText, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useI18n } from '../i18n'
import { documentName, listWorkspaceDrafts, subscribeToDocuments } from '../storage'
import { Modal } from './Modal'

const mobileQuery = window.matchMedia('(max-width: 900px)')
function subscribeToMobile(listener: () => void) {
  mobileQuery.addEventListener('change', listener)
  return () => mobileQuery.removeEventListener('change', listener)
}

interface DocumentItem { id: string; name: string; version: number; updatedAt: number; trashed: boolean }
interface DocumentPanelProps {
  currentId: string
  busy: boolean
  onClose: () => void
  onOpen: (id: string) => Promise<void>
  onCreate: () => Promise<void>
  onDuplicate: (id: string) => Promise<void>
  onRename: (id: string, name: string, version: number) => Promise<void>
  onTrash: (id: string, version: number) => Promise<void>
  onRestore: (id: string, version: number) => Promise<void>
}

export function DocumentPanel({ currentId, busy, onClose, onOpen, onCreate, onDuplicate, onRename, onTrash, onRestore }: DocumentPanelProps) {
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
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const drafts = await listWorkspaceDrafts()
      if (!mounted.current || current !== generation.current) return
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
  const run = async (action: () => Promise<void>) => {
    setMessage('')
    try { await action(); setRenaming(null); await refresh() }
    catch (error) { setMessage(error instanceof Error ? error.message : t('Could not update the document. Please try again.')) }
  }
  const visible = documents.filter((document) => document.trashed === trash && document.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))

  const panel = <aside className="document-panel" id="workspace-documents" aria-label={t('Documents')} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (renaming) setRenaming(null); else onClose() }
  }}>
    <header><h2>{t('Documents')}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t('Close documents')}><X size={18} aria-hidden="true" /></button></header>
    <button type="button" className="document-panel__new" disabled={busy} onClick={() => void run(onCreate)}><Plus size={17} aria-hidden="true" />{t('New document')}</button>
    <label className="document-panel__search"><Search size={16} aria-hidden="true" /><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search by name')} aria-label={t('Search documents')} /></label>
    <div className="document-panel__tabs" role="group" aria-label={t('Document list')}>
      <button type="button" aria-pressed={!trash} onClick={() => { setTrash(false); setRenaming(null) }}>{t('Documents')}</button>
      <button type="button" aria-pressed={trash} onClick={() => { setTrash(true); setRenaming(null) }}><Trash2 size={14} aria-hidden="true" />{t('Trash')}</button>
    </div>
    {message || readError ? <p className="document-panel__message" role="alert">{message || readError}<button type="button" disabled={busy} onClick={() => { setMessage(''); void refresh() }}>{t('Try again')}</button></p> : null}
    <ul className="document-list" aria-label={t(trash ? 'Trashed documents' : 'Saved documents')} aria-busy={loading || busy}>
      {visible.map((document) => <li key={document.id} className={currentId === document.id ? 'is-current' : ''}>
        <div className="document-list__row">
          <button type="button" className="document-list__open" disabled={busy || trash} aria-current={currentId === document.id ? 'page' : undefined} onClick={() => void run(() => onOpen(document.id))} title={document.name}>
            <FileText size={16} aria-hidden="true" /><span><strong>{document.name}</strong><small>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(document.updatedAt)}</small></span>
          </button>
          {trash ? <button type="button" className="document-list__restore" disabled={busy} onClick={() => void run(() => onRestore(document.id, document.version))} aria-label={t('Restore {name}', { name: document.name })} title={t('Restore')}><RotateCcw size={17} aria-hidden="true" /></button>
            : <details className="document-list__actions"><summary aria-label={t('Actions for {name}', { name: document.name })}><Ellipsis size={18} aria-hidden="true" /></summary><div>
              <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setRenaming(document) }}>{t('Rename')}</button>
              <button type="button" disabled={busy} onClick={() => void run(() => onDuplicate(document.id))}><Copy size={14} aria-hidden="true" />{t('Duplicate')}</button>
              <button type="button" disabled={busy} onClick={() => void run(() => onTrash(document.id, document.version))}><Trash2 size={14} aria-hidden="true" />{t('Move to trash')}</button>
            </div></details>}
        </div>
        {renaming?.id === document.id ? <form className="document-list__rename" onSubmit={(event) => { event.preventDefault(); void run(() => onRename(renaming.id, renaming.name, renaming.version)) }}>
          <input aria-label={t('Document name')} autoFocus maxLength={120} value={renaming.name} onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} />
          <div><button type="button" disabled={busy} onClick={() => setRenaming(null)}>{t('Cancel')}</button><button type="submit" disabled={busy || !renaming.name.trim()}>{t('Save name')}</button></div>
        </form> : null}
      </li>)}
      {!visible.length ? <li className="document-list__empty">{t(loading ? 'Opening documents…' : query.trim() ? 'No documents match this name.' : trash ? 'The trash is empty.' : 'Create a document to start writing.')}</li> : null}
    </ul>
    <footer>{t(trash ? 'Restore a document to use it again.' : 'Documents are saved in this browser. Download copies for backup.')}</footer>
  </aside>
  return mobile ? <Modal label={t('Documents')} onClose={onClose} className="documents-overlay">{panel}</Modal> : panel
}
