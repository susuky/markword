import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}
const SHORTCUTS = [
  ['Cmd / Ctrl + K', 'Open command palette'],
  ['Cmd / Ctrl + O', 'Open Markdown or project'],
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
    <Modal onClose={onClose} label={t('Keyboard shortcuts')}>
      <section className="shortcut-help" aria-labelledby="shortcut-title">
        <header><div><h2 id="shortcut-title">{t('Keyboard shortcuts')}</h2><p>{t('Keep your hands on the keyboard and your ideas flowing.')}</p></div><button type="button" onClick={onClose} aria-label={t('Close keyboard shortcuts')}><X size={18} aria-hidden="true" /></button></header>
        <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{t(action)}</dd></div>)}</dl>
      </section>
    </Modal>
  )
}
