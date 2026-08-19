import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  createSnapshot,
  deleteRevision,
  listRevisions,
  restoreRevision,
  subscribeToRevisions,
  type DraftMetadata,
  type DraftPersistenceSession,
  type Revision,
} from '../storage'

export interface RevisionPanelProps {
  currentContent: string
  currentMetadata?: DraftMetadata
  persistence?: DraftPersistenceSession
  onRestore: (content: string, metadata: DraftMetadata) => void
  onClose?: () => void
}

const REASON_LABELS: Record<Revision['reason'], string> = {
  auto: 'Auto revision',
  manual: 'Manual revision',
  'pre-restore': 'Pre-restore backup',
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

function revisionFileName(revision: Revision): string {
  const date = new Date(revision.createdAt).toISOString().replaceAll(':', '-').replace('T', '_').slice(0, 19)
  return `markword-${date}.md`
}

function downloadRevision(revision: Revision): void {
  const url = URL.createObjectURL(new Blob([revision.content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = revisionFileName(revision)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function RevisionPanel({
  currentContent,
  currentMetadata = {},
  persistence,
  onRestore,
  onClose,
}: RevisionPanelProps) {
  const { locale, t } = useI18n()
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await listRevisions()
      setRevisions(next)
      setSelectedId((current) => current && next.some((revision) => revision.id === current)
        ? current
        : (next[0]?.id ?? null))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Could not read revisions'))
    }
  }, [t])

  useEffect(() => {
    void refresh()
    return subscribeToRevisions(() => void refresh())
  }, [refresh])

  const selected = revisions.find((revision) => revision.id === selectedId) ?? null

  const handleSnapshot = async () => {
    setBusy(true)
    setMessage('')
    try {
      if (persistence) await persistence.snapshot('manual')
      else await createSnapshot(currentContent, currentMetadata, 'manual')
      setMessage(t('Current revision created'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Could not create revision'))
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    if (!selected) return
    setBusy(true)
    setMessage('')
    try {
      const restored = persistence
        ? await persistence.restore(selected.id)
        : await restoreRevision(selected.id, currentContent, currentMetadata)
      onRestore(restored.draft.content, restored.draft.metadata)
      setMessage(t('Restored; the previous content was backed up first'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Could not restore revision'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !window.confirm(t('Delete this revision? This action cannot be undone.'))) return
    setBusy(true)
    try {
      await deleteRevision(selected.id)
      setMessage(t('Revision deleted'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('Could not delete revision'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="revision-panel" aria-label={t('Revision history')}>
      <header className="revision-panel__header">
        <div>
          <h2>{t('Revision history')}</h2>
          <p>{t('Keep up to 120 local revisions')}</p>
        </div>
        {onClose ? <button type="button" className="revision-panel__close" onClick={onClose} aria-label={t('Close revision history')}>×</button> : null}
      </header>

      <div className="revision-panel__toolbar">
        <button type="button" onClick={handleSnapshot} disabled={busy}>{t('Create current revision')}</button>
        <span>{t('{count} revisions', { count: revisions.length })}</span>
      </div>

      <div className="revision-panel__body">
        <ol className="revision-list" aria-label={t('Saved revisions')}>
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                className={revision.id === selectedId ? 'is-selected' : ''}
                onClick={() => setSelectedId(revision.id)}
              >
                <strong>{formatDate(revision.createdAt, locale)}</strong>
                <span>{t('{reason} · {count} characters', { reason: t(REASON_LABELS[revision.reason]), count: revision.content.length.toLocaleString(locale) })}</span>
              </button>
            </li>
          ))}
          {revisions.length === 0 ? <li className="revision-list__empty">{t('No revisions yet. One is created automatically every five minutes after changes.')}</li> : null}
        </ol>

        <section className="revision-preview" aria-label={t('Revision preview')}>
          {selected ? (
            <>
              <div className="revision-preview__meta">
                <div>
                  <strong>{formatDate(selected.createdAt, locale)}</strong>
                  <span>{t(REASON_LABELS[selected.reason])}</span>
                </div>
                <button type="button" onClick={() => downloadRevision(selected)}>{t('Download Markdown')}</button>
              </div>
              <pre>{selected.content || t('(Empty document)')}</pre>
              <div className="revision-preview__actions">
                <button type="button" className="revision-action--danger" onClick={handleDelete} disabled={busy}>{t('Delete')}</button>
                <button type="button" className="revision-action--primary" onClick={handleRestore} disabled={busy}>{t('Restore this revision')}</button>
              </div>
            </>
          ) : <div className="revision-preview__empty">{t('Select a revision to preview it')}</div>}
        </section>
      </div>
      {message ? <p className="revision-panel__message" role="status">{message}</p> : null}
    </aside>
  )
}
