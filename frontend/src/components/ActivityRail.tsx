import { Files, History, Keyboard, Languages, ListTree, Paperclip, Plus } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useI18n } from '../i18n'
import type { DocumentMode } from '../types'

const mobileQuery = window.matchMedia('(max-width: 900px)')
const subscribeMobile = (listener: () => void) => {
  mobileQuery.addEventListener('change', listener)
  return () => mobileQuery.removeEventListener('change', listener)
}

interface ActivityRailProps {
  mode: DocumentMode
  documentsOpen: boolean
  outlineOpen: boolean
  mobileOutlineOpen: boolean
  busy: boolean
  assetsCount: number
  onCreate: () => void
  onDocuments: () => void
  onOutline: () => void
  onAssets: () => void
  onRevisions: () => void
  onLanguage: () => void
  onHelp: () => void
}

export function ActivityRail({ mode, documentsOpen, outlineOpen, mobileOutlineOpen, busy, assetsCount, onCreate, onDocuments, onOutline, onAssets, onRevisions, onLanguage, onHelp }: ActivityRailProps) {
  const { locale, t } = useI18n()
  const mobile = useSyncExternalStore(subscribeMobile, () => mobileQuery.matches)
  const outlineExpanded = mobile ? mobileOutlineOpen : outlineOpen
  return <nav className="activity-rail" aria-label={t('Workspace navigation')}>
    <div className="rail-brand" aria-label="Markword" title="Markword"><span aria-hidden="true">M</span></div>
    <button type="button" className="rail-button new-document-trigger" disabled={busy} onClick={onCreate} aria-label={t('New document')} title={t('New document')}><Plus size={21} aria-hidden="true" /></button>
    <span className="rail-divider" aria-hidden="true" />
    <button type="button" className={`rail-button documents-trigger ${documentsOpen ? 'is-active' : ''}`} onClick={onDocuments} aria-label={t('Documents')} title={t('Documents')} aria-controls="workspace-documents" aria-expanded={documentsOpen}><Files size={21} aria-hidden="true" /></button>
    {mode === 'markdown' ? <button type="button" className={`rail-button outline-trigger ${outlineExpanded ? 'is-active' : ''}`} onClick={onOutline} aria-label={t('Document outline')} title={t('Document outline')} aria-controls="document-outline" aria-expanded={outlineExpanded}><ListTree size={21} aria-hidden="true" /></button> : null}
    <button type="button" className="rail-button asset-trigger" onClick={onAssets} aria-label={t('Manage local assets')} title={t('Manage local assets')}><Paperclip size={21} aria-hidden="true" />{assetsCount ? <span className="rail-count" aria-hidden="true">{assetsCount}</span> : null}</button>
    <button type="button" className="rail-button revision-trigger" onClick={onRevisions} aria-label={t('Revision history')} title={t('Revision history')}><History size={21} aria-hidden="true" /></button>
    <div className="rail-spacer" />
    <button type="button" className="rail-button language-toggle" onClick={onLanguage} aria-label={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')} title={t(locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English')}><Languages size={20} aria-hidden="true" /></button>
    <button type="button" className="rail-button help-trigger" onClick={onHelp} aria-label={t('Keyboard shortcuts')} title={t('Keyboard shortcuts')}><Keyboard size={20} aria-hidden="true" /></button>
  </nav>
}
