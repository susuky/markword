import { Eraser, X } from 'lucide-react'
import { useI18n } from '../i18n'
import type { TextStats } from '../types'

const METRICS: Array<[keyof TextStats, string]> = [
  ['total_chars', 'Total characters (with spaces)'],
  ['chars_no_spaces', 'Total characters (without spaces)'],
  ['cjk_count', 'Chinese characters'],
  ['cjk_punct_count', 'Full-width punctuation'],
  ['english_words', 'English words'],
  ['digit_count', 'Digits'],
  ['line_count', 'Lines'],
]

interface StatsPopoverProps {
  stats: TextStats
  available: boolean
  staticDeployment?: boolean
  onClose: () => void
  onClear: () => void
}

export function StatsPopover({ stats, available, staticDeployment = false, onClose, onClear }: StatsPopoverProps) {
  const { locale, t } = useI18n()
  return (
    <aside className="stats-popover" aria-label={t('Word count')}>
      <header className="stats-popover__header">
        <div>
          <h2>{t('Word count')}</h2>
          <p>{staticDeployment ? t('Calculated locally in your browser') : available ? t('Calculated live from this document') : t('Waiting for the backend service')}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t('Close word count')}>
          <X size={18} />
        </button>
      </header>
      <dl className="stats-grid">
        {METRICS.map(([key, label]) => (
          <div key={key}>
            <dt>{t(label)}</dt>
            <dd>{stats[key].toLocaleString(locale)}</dd>
          </div>
        ))}
      </dl>
      <button className="clear-button" type="button" onClick={onClear}>
        <Eraser size={16} />
        {t('Clear document')}
      </button>
    </aside>
  )
}
