import { Eraser, X } from 'lucide-react'
import type { TextStats } from '../types'

const METRICS: Array<[keyof TextStats, string]> = [
  ['total_chars', '總字數（含空白）'],
  ['chars_no_spaces', '總字數（不含空白）'],
  ['cjk_count', '中文字數'],
  ['cjk_punct_count', '全形標點'],
  ['english_words', '英文單字'],
  ['digit_count', '數字'],
  ['line_count', '行數'],
]

interface StatsPopoverProps {
  stats: TextStats
  available: boolean
  staticDeployment?: boolean
  onClose: () => void
  onClear: () => void
}

export function StatsPopover({ stats, available, staticDeployment = false, onClose, onClear }: StatsPopoverProps) {
  return (
    <aside className="stats-popover" aria-label="字數統計">
      <header className="stats-popover__header">
        <div>
          <h2>字數統計</h2>
          <p>{staticDeployment ? '由瀏覽器本機即時計算' : available ? '依目前文件即時計算' : '正在等待後端服務'}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="關閉字數統計">
          <X size={18} />
        </button>
      </header>
      <dl className="stats-grid">
        {METRICS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{stats[key].toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <button className="clear-button" type="button" onClick={onClear}>
        <Eraser size={16} />
        清除文件
      </button>
    </aside>
  )
}
