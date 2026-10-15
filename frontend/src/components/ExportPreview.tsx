import { X, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '../exportSettings'
import { useI18n } from '../i18n'
import { portableHtml } from '../portableHtml'
import { EXPORT_STYLES } from '../themeConfig'
import type { DocumentMode, ExportStyleName, ThemeName } from '../types'
import { Modal } from './Modal'
import '../exportPreview.css'

export function ExportPreview({ markdown, mode, theme, title, style, onStyleChange, settings, onSettingsChange, mermaidFontSize, onClose }: {
  markdown: string
  mode: DocumentMode
  theme: ThemeName
  title: string
  style: ExportStyleName
  onStyleChange: (style: ExportStyleName) => void
  settings: ExportSettings
  onSettingsChange: (settings: ExportSettings) => void
  mermaidFontSize: number
  onClose: () => void
}) {
  const { locale, t } = useI18n()
  const [snapshot, setSnapshot] = useState<{ html: string; css: string } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setSnapshot(null)
    setError('')
    void import('../htmlExport').then(({ renderHtmlSnapshot }) => renderHtmlSnapshot(markdown, mode, theme, mermaidFontSize)).then((result) => {
      if (active) setSnapshot(result)
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? t(failure.message) : t('Could not prepare the export preview.'))
    })
    return () => { active = false }
  }, [markdown, mermaidFontSize, mode, retry, t, theme])
  const html = useMemo(() => snapshot ? portableHtml(markdown, mode, theme, style, locale, snapshot.html, snapshot.css, title, settings) : '', [locale, markdown, mode, settings, snapshot, style, theme, title])

  return <Modal label={t('Export settings and preview')} className="export-preview-overlay" onClose={onClose}>
    <header className="export-preview-header"><div><h2>{t('Export settings and preview')}</h2><p>{title}</p></div><button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={20} /></button></header>
    <div className="export-preview-content">
      <section className="export-preview-settings" aria-label={t('Export settings')}>
        <div className="export-preview-field"><label htmlFor="export-page-size">{t('Paper size')}</label><select id="export-page-size" value={settings.pageSize} onChange={(event) => onSettingsChange({ ...settings, pageSize: event.target.value as ExportSettings['pageSize'] })}><option>A4</option><option>Letter</option></select></div>
        <div className="export-preview-field"><label htmlFor="export-margin">{t('Page margin (mm)')}</label><input id="export-margin" type="range" min="10" max="40" step="1" value={settings.marginMm} onChange={(event) => onSettingsChange({ ...settings, marginMm: Number(event.target.value) })} /><output htmlFor="export-margin">{settings.marginMm} mm</output></div>
        <div className="export-preview-field"><label htmlFor="export-font-size">{t('Body font size (px)')}</label><input id="export-font-size" type="range" min="12" max="24" step="1" value={settings.fontSize} onChange={(event) => onSettingsChange({ ...settings, fontSize: Number(event.target.value) })} /><output htmlFor="export-font-size">{settings.fontSize} px</output></div>
        <div className="export-preview-field"><label htmlFor="export-layout">{t('Document layout')}</label><select id="export-layout" value={style} onChange={(event) => onStyleChange(event.target.value as ExportStyleName)}>{(Object.keys(EXPORT_STYLES) as ExportStyleName[]).map((name) => <option key={name} value={name}>{t(EXPORT_STYLES[name].label)}</option>)}</select></div>
        <p>{t('Paper size, margins and body font size apply to HTML, PDF and Word. Word keeps its Classic layout.')}</p>
        <button type="button" className="toolbar-button" onClick={() => { onSettingsChange({ ...DEFAULT_EXPORT_SETTINGS }); onStyleChange('Classic') }}><RotateCcw size={16} />{t('Reset export settings')}</button>
      </section>
      <section className="export-preview-document" aria-label={t('Export appearance')}>
        {error ? <div className="export-preview-message" role="alert"><p>{error}</p><button type="button" className="toolbar-button" onClick={() => setRetry((value) => value + 1)}>{t('Try again')}</button></div> : !snapshot ? <p className="export-preview-message" role="status">{t('Preparing export preview…')}</p> : <iframe title={t('Export appearance')} sandbox="" tabIndex={-1} srcDoc={html} />}
      </section>
    </div>
    <footer className="export-preview-footer"><span>{t('Settings are remembered in this browser.')}</span><button type="button" className="toolbar-button export-trigger" onClick={onClose}>{t('Done')}</button></footer>
  </Modal>
}
