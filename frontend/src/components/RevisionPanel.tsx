import { useCallback, useEffect, useState } from 'react'
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
  auto: '自動版本',
  manual: '手動版本',
  'pre-restore': '還原前備份',
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
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
      setMessage(error instanceof Error ? error.message : '無法讀取版本')
    }
  }, [])

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
      setMessage('已建立目前版本')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '建立版本失敗')
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
      setMessage('已還原；原內容已先建立備份版本')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '還原版本失敗')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || !window.confirm('確定刪除這個版本？此操作無法復原。')) return
    setBusy(true)
    try {
      await deleteRevision(selected.id)
      setMessage('版本已刪除')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '刪除版本失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="revision-panel" aria-label="版本歷史">
      <header className="revision-panel__header">
        <div>
          <h2>版本歷史</h2>
          <p>最多保留 120 個本機版本</p>
        </div>
        {onClose ? <button type="button" className="revision-panel__close" onClick={onClose} aria-label="關閉版本歷史">×</button> : null}
      </header>

      <div className="revision-panel__toolbar">
        <button type="button" onClick={handleSnapshot} disabled={busy}>建立目前版本</button>
        <span>{revisions.length} 個版本</span>
      </div>

      <div className="revision-panel__body">
        <ol className="revision-list" aria-label="已儲存版本">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                className={revision.id === selectedId ? 'is-selected' : ''}
                onClick={() => setSelectedId(revision.id)}
              >
                <strong>{formatDate(revision.createdAt)}</strong>
                <span>{REASON_LABELS[revision.reason]} · {revision.content.length.toLocaleString()} 字元</span>
              </button>
            </li>
          ))}
          {revisions.length === 0 ? <li className="revision-list__empty">尚無版本。內容變更後每五分鐘會自動建立。</li> : null}
        </ol>

        <section className="revision-preview" aria-label="版本預覽">
          {selected ? (
            <>
              <div className="revision-preview__meta">
                <div>
                  <strong>{formatDate(selected.createdAt)}</strong>
                  <span>{REASON_LABELS[selected.reason]}</span>
                </div>
                <button type="button" onClick={() => downloadRevision(selected)}>下載 Markdown</button>
              </div>
              <pre>{selected.content || '（空白文件）'}</pre>
              <div className="revision-preview__actions">
                <button type="button" className="revision-action--danger" onClick={handleDelete} disabled={busy}>刪除</button>
                <button type="button" className="revision-action--primary" onClick={handleRestore} disabled={busy}>還原此版本</button>
              </div>
            </>
          ) : <div className="revision-preview__empty">選擇版本即可預覽</div>}
        </section>
      </div>
      {message ? <p className="revision-panel__message" role="status">{message}</p> : null}
    </aside>
  )
}
