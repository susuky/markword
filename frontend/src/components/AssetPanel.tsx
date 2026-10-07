import {
  Archive,
  Download,
  File,
  FileAudio,
  FileImage,
  FileVideo,
  HardDrive,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../assets'
import { useI18n } from '../i18n'
import { Modal } from './Modal'
import type { AssetKind, StoredAsset } from '../storage'

interface AssetPanelProps {
  open: boolean
  assets: StoredAsset[]
  busy?: boolean
  onAdd: () => void
  onClose: () => void
  onDelete: (asset: StoredAsset) => void
  onDownload: (asset: StoredAsset) => void
  onExportProject: () => void
  onInsert: (asset: StoredAsset) => void
}

interface StorageDetails {
  usage: number
  quota: number
  persistent: boolean
}

function KindIcon({ kind }: { kind: AssetKind }) {
  if (kind === 'image') return <FileImage size={20} />
  if (kind === 'video') return <FileVideo size={20} />
  if (kind === 'audio') return <FileAudio size={20} />
  return <File size={20} />
}

const AssetThumbnail = memo(function AssetThumbnail({ asset }: { asset: StoredAsset }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (asset.kind !== 'image') return
    const nextUrl = URL.createObjectURL(asset.blob)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [asset])

  return (
    <div className={`asset-thumbnail asset-thumbnail--${asset.kind}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : <KindIcon kind={asset.kind} />}
    </div>
  )
})

export function AssetPanel({
  open,
  assets,
  busy = false,
  onAdd,
  onClose,
  onDelete,
  onDownload,
  onExportProject,
  onInsert,
}: AssetPanelProps) {
  const { locale, t } = useI18n()
  const [storage, setStorage] = useState<StorageDetails | null>(null)
  const totalBytes = useMemo(() => assets.reduce((total, asset) => total + asset.size, 0), [assets])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.all([
      navigator.storage?.estimate?.() ?? Promise.resolve({}),
      navigator.storage?.persisted?.() ?? Promise.resolve(false),
    ]).then(([estimate, persistent]) => {
      if (cancelled) return
      setStorage({ usage: estimate.usage ?? totalBytes, quota: estimate.quota ?? 0, persistent })
    }).catch(() => { if (!cancelled) setStorage(null) })
    return () => { cancelled = true }
  }, [open, totalBytes])

  if (!open) return null

  return (
    <Modal onClose={onClose} label={t('Local assets')} className="asset-overlay">
      <section className="asset-panel" aria-labelledby="asset-panel-title">
        <header>
          <div>
            <span className="asset-panel__icon" aria-hidden="true"><HardDrive size={19} /></span>
            <span><h2 id="asset-panel-title">{t('Local assets')}</h2><p>{t('Stored only in this browser')}</p></span>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close local assets')}><X size={18} /></button>
        </header>

        <div className="asset-panel__summary">
          <span><strong>{assets.length.toLocaleString(locale)}</strong>{t('assets')}</span>
          <span><strong>{formatBytes(totalBytes, locale)}</strong>{t('in this project')}</span>
          {storage ? <span><strong>{storage.quota ? formatBytes(storage.usage, locale) : '—'}</strong>{t(storage.persistent ? 'Browser storage protected' : 'Back up before clearing browser data')}</span> : null}
        </div>

        <div className="asset-panel__actions">
          <button type="button" className="asset-primary" disabled={busy} onClick={onAdd}><Plus size={16} />{t('Import files')}</button>
          <button type="button" disabled={busy} onClick={onExportProject}><Archive size={16} />{t('Download document and asset library ZIP')}</button>
        </div>

        <div className="asset-list">
          {assets.length ? assets.map((asset) => (
            <article className="asset-item" key={asset.id}>
              <AssetThumbnail asset={asset} />
              <div className="asset-item__copy">
                <strong title={asset.name}>{asset.name}</strong>
                <span>{t(asset.kind === 'image' ? 'Image' : asset.kind === 'video' ? 'Video' : asset.kind === 'audio' ? 'Audio' : 'Attachment')} · {formatBytes(asset.size, locale)}</span>
                <code>{asset.path}</code>
              </div>
              <div className="asset-item__actions">
                <button type="button" disabled={busy} className="asset-insert" onClick={(event) => { event.currentTarget.closest('dialog')?.close(); onInsert(asset) }}>{t('Insert')}</button>
                <button type="button" disabled={busy} onClick={() => onDownload(asset)} aria-label={t('Download {file}', { file: asset.name })} title={t('Download')}><Download size={15} /></button>
                <button type="button" disabled={busy} className="asset-delete" onClick={() => onDelete(asset)} aria-label={t('Delete {file}', { file: asset.name })} title={t('Delete')}><Trash2 size={15} /></button>
              </div>
            </article>
          )) : (
            <div className="asset-empty"><FileImage size={30} /><strong>{t('No local assets yet')}</strong><p>{t('Import, paste, or drop images, video, audio, and attachments.')}</p></div>
          )}
        </div>

        <footer><HardDrive size={14} /><span>{t('This ZIP saves the current document and asset library, but not revision history.')}</span></footer>
      </section>
    </Modal>
  )
}
