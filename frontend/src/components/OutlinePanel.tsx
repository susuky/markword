import { ChevronLeft, ChevronRight, ListTree } from 'lucide-react'

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
  const activeHeading = headings.reduce<OutlineHeading | null>((match, heading) => (
    heading.line <= activeLine ? heading : match
  ), null)

  return (
    <aside className={`outline-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="文件大綱">
      <header>
        <span><ListTree size={15} />{collapsed ? null : '文件大綱'}</span>
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? '展開文件大綱' : '收合文件大綱'}
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
              title={`第 ${heading.line} 行：${heading.text}`}
            >
              {heading.text}
            </button>
          )) : <p>加入標題後會顯示在這裡。</p>}
        </nav>
      )}
    </aside>
  )
}
