import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { Modal } from './Modal'

export function SourceBlockEditor({ initial, onApply, onClose }: {
  initial: string
  onApply: (value: string) => boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [openDeferred, setOpenDeferred] = useState(false)
  useEffect(() => {
    const deferred = () => setOpenDeferred(true)
    window.addEventListener('markword:open-deferred', deferred)
    return () => window.removeEventListener('markword:open-deferred', deferred)
  }, [])
  const apply = () => { if (!onApply(value)) setChangedElsewhere(true) }
  return <Modal label={t('Edit block source')} onClose={onClose} className="source-block-overlay" closeOnBackdrop={false}>
    <section className="source-block-editor" onKeyDown={(event) => {
      if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); apply()
      }
    }}>
      <h2>{t('Edit block source')}</h2>
      <p id="source-block-help">{t('Edit the text, formula, or media reference in this block. Other blocks stay unchanged.')}</p>
      <label className="source-block-editor__label" htmlFor="source-block-input">{t('Block source')}</label>
      <textarea id="source-block-input" autoFocus value={value} onChange={(event) => setValue(event.target.value)} aria-describedby="source-block-help" spellCheck={false} />
      {changedElsewhere ? <p role="alert">{t('The document changed while this editor was open. Close it and reopen the block to keep your latest edits.')}</p> : null}
      {openDeferred && !changedElsewhere ? <p role="alert">{t('The file has not been opened. Apply or cancel this edit, then open the file again.')}</p> : null}
      <footer><button type="button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="source-block-editor__apply" onClick={apply}>{t('Apply changes')}</button></footer>
    </section>
  </Modal>
}
