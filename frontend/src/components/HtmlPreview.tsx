import { Eye, Link2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createHtmlEditingDocument, isEditableLink, serializeHtml } from '../htmlEditing'
import { useI18n } from '../i18n'

export function HtmlPreview({ value, onChange, onDownload }: { value: string; onChange: (value: string) => void; onDownload: () => void }) {
  const { t } = useI18n()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const modelRef = useRef<ReturnType<typeof createHtmlEditingDocument> | null>(null)
  const emittedRef = useRef<string | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const downloadRef = useRef(onDownload)
  downloadRef.current = onDownload
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  const [link, setLink] = useState<{ id: string; url: string } | null>(null)
  const [linkError, setLinkError] = useState(false)

  const publish = () => {
    if (!modelRef.current) return
    const source = serializeHtml(modelRef.current.original)
    emittedRef.current = source
    changeRef.current(source)
  }

  useEffect(() => {
    const frame = frameRef.current
    // A visual edit already changed the frame. Reloading it would discard the caret.
    if (!frame || value === emittedRef.current) return
    disposeRef.current?.()
    emittedRef.current = null
    const model = createHtmlEditingDocument(value)
    modelRef.current = model
    setLink(null)
    setLinkError(false)
    let dispose: (() => void) | undefined
    const attach = () => {
      dispose?.()
      const document = frame.contentDocument
      if (!document) return
      const input = (event: Event) => {
        const element = event.target as HTMLElement
        const node = model.texts.get(element.getAttribute('data-markword-edit-text') ?? '')
        if (!node) return
        node.textContent = element.textContent ?? ''
        const source = serializeHtml(model.original)
        emittedRef.current = source
        changeRef.current(source)
      }
      const click = (event: MouseEvent) => {
        if ((event.target as Element).closest('button')) event.preventDefault()
        const anchor = (event.target as Element).closest('a')
        if (!anchor) return
        event.preventDefault()
        const id = anchor.getAttribute('data-markword-edit-link')
        const original = id === null ? null : model.links.get(id)
        if (original) { setLink({ id: id!, url: original.getAttribute('href') ?? '' }); setLinkError(false) }
      }
      const keydown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          downloadRef.current()
        }
        if (event.key === 'Enter' && !event.isComposing && (event.target as HTMLElement).isContentEditable) {
          event.preventDefault()
          ;(event.target as HTMLElement).blur()
        }
      }
      const beforeInput = (event: InputEvent) => {
        if (!event.isComposing && ['insertParagraph', 'insertLineBreak'].includes(event.inputType)) event.preventDefault()
      }
      const submit = (event: Event) => event.preventDefault()
      document.addEventListener('input', input)
      document.addEventListener('click', click)
      document.addEventListener('auxclick', click)
      document.addEventListener('keydown', keydown)
      document.addEventListener('beforeinput', beforeInput)
      document.addEventListener('submit', submit)
      dispose = () => {
        document.removeEventListener('input', input)
        document.removeEventListener('click', click)
        document.removeEventListener('auxclick', click)
        document.removeEventListener('keydown', keydown)
        document.removeEventListener('beforeinput', beforeInput)
        document.removeEventListener('submit', submit)
      }
    }
    frame.addEventListener('load', attach)
    frame.srcdoc = model.preview
    disposeRef.current = () => { frame.removeEventListener('load', attach); dispose?.() }
  }, [value])

  useEffect(() => () => disposeRef.current?.(), [])

  return <section className="html-preview-pane" aria-label={t('Editable preview')}>
    <header className="pane-header"><div className="pane-title"><Eye size={17} aria-hidden="true" />{t('Editable preview')}</div><span className="html-editing-label">{t('Click text to edit')}</span></header>
    <p className="html-editing-hint">{t('Click text to edit. Press Enter to finish. Select a link to change its address.')}</p>
    {link && <form className="html-link-form" onSubmit={(event) => {
      event.preventDefault()
      if (!isEditableLink(link.url)) { setLinkError(true); return }
      const anchor = modelRef.current?.links.get(link.id)
      if (!anchor) return
      anchor.setAttribute('href', link.url.trim())
      frameRef.current?.contentDocument?.querySelector(`[data-markword-edit-link="${link.id}"]`)?.setAttribute('href', link.url.trim())
      publish()
      setLink(null)
    }}>
      <label htmlFor="html-link-url"><Link2 size={16} aria-hidden="true" />{t('Link address')}</label>
      <div><input id="html-link-url" value={link.url} onChange={(event) => { setLink({ ...link, url: event.target.value }); setLinkError(false) }} aria-invalid={linkError} aria-describedby={linkError ? 'html-link-error' : undefined} /><button type="submit" className="toolbar-button">{t('Apply changes')}</button><button type="button" className="toolbar-button" aria-label={t('Cancel')} onClick={() => setLink(null)}><X size={17} aria-hidden="true" /></button></div>
      {linkError && <p id="html-link-error" role="alert">{t('Enter a valid address, such as https://example.com.')}</p>}
    </form>}
    <iframe ref={frameRef} title={t('HTML page preview')} className="html-preview-frame" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
    <p className="html-preview-note">{t('Page scripts are paused while editing. The downloaded HTML keeps the original scripts.')}</p>
  </section>
}
