import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface CommandAction {
  id: string
  label: string
  description?: string
  shortcut?: string
  keywords?: string
  run: () => void
}
interface CommandPaletteProps {
  open: boolean
  actions: CommandAction[]
  onClose: () => void
}

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return actions
    return actions.filter((action) => (
      `${action.label} ${action.description ?? ''} ${action.keywords ?? ''}`
        .toLocaleLowerCase()
        .includes(needle)
    ))
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  const invoke = (action: CommandAction | undefined) => {
    if (!action) return
    onClose()
    action.run()
  }

  return (
    <div className="productivity-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令選單">
        <div className="command-palette__search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                invoke(filtered[activeIndex])
              }
            }}
            placeholder="搜尋命令或輸入「插入」…"
            aria-label="搜尋命令"
          />
          <button type="button" onClick={onClose} aria-label="關閉命令選單"><X size={17} /></button>
        </div>
        <div className="command-palette__list" role="listbox">
          {filtered.length ? filtered.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={index === activeIndex ? 'is-active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => invoke(action)}
              role="option"
              aria-selected={index === activeIndex}
            >
              <span><strong>{action.label}</strong>{action.description ? <small>{action.description}</small> : null}</span>
              {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
            </button>
          )) : <p className="command-palette__empty">找不到符合的命令</p>}
        </div>
        <footer><span><kbd>↑↓</kbd> 選擇</span><span><kbd>Enter</kbd> 執行</span><span><kbd>Esc</kbd> 關閉</span></footer>
      </section>
    </div>
  )
}
