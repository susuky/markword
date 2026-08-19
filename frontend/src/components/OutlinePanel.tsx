import { ChevronLeft, ChevronRight, ListTree } from 'lucide-react'
import { useI18n } from '../i18n'

export interface OutlineHeading {
  id: string
  level: number
  line: number
  text: string
}
interface OutlinePanelProps {
  headings: OutlineHeading[]
  collapsed: boolean
  activeLine: number
  onCollapsedChange: (collapsed: boolean) => void
  onJump: (line: number) => void
}

export function OutlinePanel({ headings, collapsed, activeLine, onCollapsedChange, onJump }: OutlinePanelProps) {
  const { t } = useI18n()
  const activeHeading = headings.reduce<OutlineHeading | null>((match, heading) => (
    heading.line <= activeLine ? heading : match
  ), null)

  return (
    <aside className={`outline-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label={t('Document outline')}>
      <header>
        <span><ListTree size={15} />{collapsed ? null : t('Document outline')}</span>
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? t('Expand document outline') : t('Collapse document outline')}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </header>
      {collapsed ? null : (
        <nav>
          {headings.length ? headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              className={activeHeading?.id === heading.id ? 'is-active' : ''}
              style={{ paddingInlineStart: `${12 + (heading.level - 1) * 10}px` }}
              onClick={() => onJump(heading.line)}
              title={t('Line {line}: {heading}', { line: heading.line, heading: heading.text })}
            >
              {heading.text}
            </button>
          )) : <p>{t('Add headings to see them here.')}</p>}
        </nav>
      )}
    </aside>
  )
}
