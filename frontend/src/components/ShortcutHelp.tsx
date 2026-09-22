import { RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { formatShortcut, isReservedShortcut, shortcutFromEvent, type ShortcutMap } from '../shortcuts'
import type { CommandAction } from './CommandPalette'
import { Modal } from './Modal'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
  actions: CommandAction[]
  shortcuts: ShortcutMap
  onChange: (shortcuts: ShortcutMap) => boolean
  onReset: () => boolean
}
const SHORTCUTS = [
  ['Shift + Enter', 'New line without a list marker'],
  ['Tab / Shift + Tab', 'Indent / unindent in Markdown or Mermaid'],
  ['Esc, Tab', 'Move focus out of the editor'],
  ['Cmd / Ctrl + Shift + [', 'Fold current section'],
  ['Cmd / Ctrl + Shift + ]', 'Unfold current section'],
  ['Esc', 'Close panel / exit focus mode'],
]

export function ShortcutHelp({ open, onClose, actions, shortcuts, onChange, onReset }: ShortcutHelpProps) {
  const { t } = useI18n()
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  if (!open) return null
  const finish = () => { setRecording(null); setMessage('') }
  return (
    <Modal onClose={() => { finish(); onClose() }} label={t('Keyboard shortcuts')}>
      <section className="shortcut-help" aria-labelledby="shortcut-title">
        <header><div><h2 id="shortcut-title">{t('Keyboard shortcuts')}</h2><p>{t('Choose a shortcut, then press your preferred key combination.')}</p></div><button type="button" onClick={() => { finish(); onClose() }} aria-label={t('Close keyboard shortcuts')}><X size={18} aria-hidden="true" /></button></header>
        <p className="shortcut-help__hint">{t('Use Ctrl or Cmd with a letter, number, or punctuation key. Esc cancels; Tab moves on.')}</p>
        <div className="shortcut-help__scroll">
          <ul className="shortcut-list" aria-label={t('Custom shortcuts')}>
            {actions.map((action) => <li key={action.id}>
              <span>{action.label}</span>
              <div className="shortcut-list__controls">
                <button
                  type="button"
                  className={`shortcut-record ${recording === action.id ? 'is-recording' : ''}`}
                  aria-label={t('Set shortcut: {action}', { action: action.label })}
                  aria-pressed={recording === action.id}
                  aria-describedby="shortcut-feedback"
                  onClick={() => { setRecording(action.id); setMessage(t('Press a key combination.')) }}
                  onBlur={() => { if (recording === action.id) finish() }}
                  onKeyDown={(event) => {
                    if (recording !== action.id) return
                    if (event.key === 'Tab') { finish(); return }
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.key === 'Escape') { finish(); return }
                    if (event.nativeEvent.isComposing || event.repeat || ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return
                    const shortcut = shortcutFromEvent(event.nativeEvent)
                    if (!shortcut) { setMessage(t('Include Ctrl or Cmd and a letter, number, or punctuation key.')); return }
                    if (isReservedShortcut(shortcut)) { setMessage(t('This shortcut is reserved for the browser or basic editing. Choose another.')); return }
                    const conflict = actions.find((other) => other.id !== action.id && shortcuts[other.id] === shortcut)
                    if (conflict) { setMessage(t('Already used by {action}. Clear that shortcut first.', { action: conflict.label })); return }
                    if (!onChange({ ...shortcuts, [action.id]: shortcut })) { setMessage(t('Could not save shortcuts. Your settings are unchanged.')); return }
                    setRecording(null)
                    setMessage(t('Shortcut saved in this browser.'))
                  }}
                >{recording === action.id ? t('Press keys…') : shortcuts[action.id] ? <kbd>{formatShortcut(shortcuts[action.id])}</kbd> : t('Not assigned')}</button>
                <button type="button" className="shortcut-clear" disabled={!shortcuts[action.id]} aria-label={t('Clear shortcut: {action}', { action: action.label })} title={t('Clear shortcut')} onClick={() => {
                  setMessage(t(onChange({ ...shortcuts, [action.id]: '' }) ? 'Shortcut cleared.' : 'Could not save shortcuts. Your settings are unchanged.'))
                }}><X size={14} aria-hidden="true" /></button>
              </div>
            </li>)}
          </ul>
          <h3>{t('Editing keys')}</h3>
          <dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{t(action)}</dd></div>)}</dl>
        </div>
        <footer className="shortcut-help__footer">
          <p id="shortcut-feedback" role="status">{message || t('Changes apply immediately and are saved in this browser.')}</p>
          <button type="button" onClick={() => { finish(); setMessage(t(onReset() ? 'Default shortcuts restored.' : 'Could not save shortcuts. Your settings are unchanged.')) }}><RotateCcw size={15} aria-hidden="true" />{t('Restore defaults')}</button>
        </footer>
      </section>
    </Modal>
  )
}
