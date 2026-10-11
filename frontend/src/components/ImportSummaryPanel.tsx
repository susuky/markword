import { X } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import type { ImportSummary } from '../importSummary'

export function ImportSummaryPanel({ summary, onClose }: { summary: ImportSummary; onClose: () => void }) {
  const { t } = useI18n()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      if (!panel?.contains(document.activeElement)) return
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="import-summary"]')
      if (trigger) trigger.focus({ preventScroll: true })
      else if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return <aside ref={panelRef} id="import-summary" className="stats-popover import-summary" aria-label={t('Import summary')}>
    <header className="stats-popover__header">
      <div><h2>{t('Import summary')}</h2><p className="import-summary__filename">{summary.fileName}</p></div>
      <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label={t('Close import summary')}><X size={18} aria-hidden="true" /></button>
    </header>
    <p>{t(summary.restoredSource ? 'The editable source was restored.' : 'The file was converted to Markdown.')}</p>
    {summary.warnings.length ? <>
      <ul>{summary.warnings.map((warning) => <li key={warning.message}>
        <p>{t(warning.message, { count: warning.count })}</p>
        {warning.details?.length ? <ul className="import-summary__details">{warning.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul> : null}
      </li>)}</ul>
      <p>{t('Affected positions could not be identified automatically. Compare with the original file; this summary remains available below.')}</p>
    </> : <p>{t('No conversion warnings were detected.')}</p>}
  </aside>
}
