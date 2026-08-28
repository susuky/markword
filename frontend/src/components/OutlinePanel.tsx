import { ChevronLeft, ChevronRight, ListTree, X } from 'lucide-react'
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
  mobileOpen: boolean
  onMobileClose: () => void
}

export function OutlinePanel({ headings, collapsed, activeLine, onCollapsedChange, onJump, mobileOpen, onMobileClose }: OutlinePanelProps) {
  const { t } = useI18n()
  const compact = collapsed && !mobileOpen
  const activeHeading = headings.reduce<OutlineHeading | null>((match, heading) => (
    heading.line <= activeLine ? heading : match
  ), null)

  return (
    <aside id="document-outline" className={`outline-panel ${compact ? 'is-collapsed' : ''}`} aria-label={t('Document outline')}>
      <header>
        <span><ListTree size={16} aria-hidden="true" />{compact ? null : t('Document outline')}</span>
        <button
          type="button"
          onClick={() => mobileOpen ? onMobileClose() : onCollapsedChange(!collapsed)}
          aria-label={compact ? t('Expand document outline') : t('Collapse document outline')}
        >
          {mobileOpen ? <X size={17} aria-hidden="true" /> : compact ? <ChevronRight size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
        </button>
      </header>
      {compact ? null : (
        <nav>
          {headings.length ? headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              className={activeHeading?.id === heading.id ? 'is-active' : ''}
              aria-current={activeHeading?.id === heading.id ? 'location' : undefined}
              style={{ paddingInlineStart: `${12 + (heading.level - 1) * 10}px` }}
              onClick={() => onJump(heading.line)}
              title={t('Line {line}: {heading}', { line: heading.line, heading: heading.text })}
            >
              {heading.text}
            </button>
          )) : <p>{t('Add headings to see them here.')}</p>}
        </nav>
      )}
      {compact ? null : <footer>{t('{count} headings', { count: headings.length })}</footer>}
    </aside>
  )
}
