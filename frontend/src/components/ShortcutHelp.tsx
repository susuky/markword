import { X } from 'lucide-react'
import { useI18n } from '../i18n'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}
const SHORTCUTS = [
  ['Cmd / Ctrl + K', 'Open command palette'],
  ['Cmd / Ctrl + F', 'Search document'],
  ['Cmd / Ctrl + S', 'Download Markdown'],
  ['Cmd / Ctrl + Shift + F', 'Toggle focus mode'],
  ['Cmd / Ctrl + Alt + T', 'Toggle typewriter mode'],
  ['Cmd / Ctrl + Shift + [', 'Fold current section'],
  ['Cmd / Ctrl + Shift + ]', 'Unfold current section'],
  ['?', 'Show keyboard shortcuts'],
  ['Esc', 'Close panel / exit focus mode'],
]

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="productivity-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <header><div><h2 id="shortcut-title">{t('Keyboard shortcuts')}</h2><p>{t('Keep CodeMirror’s standard shortcuts available in the editor.')}</p></div><button type="button" onClick={onClose} aria-label={t('Close keyboard shortcuts')}><X size={18} /></button></header>
        <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{t(action)}</dd></div>)}</dl>
      </section>
    </div>
  )
}
