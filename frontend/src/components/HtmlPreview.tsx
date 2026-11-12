import { ArrowDown, ArrowUp, Database, Eye, Pencil, FilePlus2, ChevronUp, Copy, GripVertical, ImagePlus, Layers, Link2, ListTree, Settings2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { blobToDataUrl, MAX_EXPORT_IMAGE_BYTES } from '../assets'
import { createHtmlEditingDocument, createStaticHtml, getHtmlBlockId, getHtmlBlockLabel, isEditableLink, serializeHtml } from '../htmlEditing'
import { applyHtmlBlockAction, getHtmlBlockCapabilities, getHtmlBlockImage, getHtmlBlockSettings, moveHtmlBlock, replaceHtmlBlockImage, setHtmlBlockLayout, setHtmlBlockStyle, type HtmlBlock, type HtmlBlockAlign, type HtmlBlockWidth, type HtmlLayout } from '../htmlBlocks'
import { useI18n } from '../i18n'
import { hasHtmlScripts, renderHtmlDocument, type HtmlRenderSnapshot } from '../htmlRuntime'
import { HtmlRuntimePreview } from './HtmlRuntimePreview'
import { HtmlDataPanel } from './HtmlDataPanel'
import { Modal } from './Modal'

const BLOCK_ATTRIBUTE = 'data-markword-edit-block'
const SELECTED_ATTRIBUTE = 'data-markword-edit-selected'
const DRAG_TYPE = 'application/x-markword-html-block'
const colorHex = (value: string) => '#' + (value.match(/\d+/g)?.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('') || 'ffffff')
type Model = ReturnType<typeof createHtmlEditingDocument>
type Selection = { id: string; display: string; gap: number; align: string; fontSize: number; color: string; background: string; padding: number }

export function HtmlPreview({ value, onChange, onSave, onOpenFile, onUndo, onRedo }: { value: string; onChange: (value: string, target?: Element) => void; onSave: () => void; onOpenFile: (file: File) => void; onUndo: () => void; onRedo: () => void }) {
  const { t } = useI18n()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const modelRef = useRef<Model | null>(null)
  const emittedRef = useRef<string | null>(null)
  const pendingRef = useRef<{ source: string; id: string | null; scrollY: number; focus: string | null } | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const actionsRef = useRef({ onSave, onOpenFile, onUndo, onRedo })
  actionsRef.current = { onSave, onOpenFile, onUndo, onRedo }
  const disposeRef = useRef<(() => void) | undefined>(undefined)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const insertImageRef = useRef(false)
  const imageTargetRef = useRef<{ model: Model; element: HTMLElement | null } | null>(null)
  const draggedRef = useRef<string | null>(null)
  const [blocks, setBlocks] = useState<HtmlBlock[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: 'before' | 'after' } | null>(null)
  const [error, setError] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [link, setLink] = useState<{ id: string; url: string } | null>(null)
  const [linkError, setLinkError] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [confirmStatic, setConfirmStatic] = useState(false)
  const [outlineSearch, setOutlineSearch] = useState('')
  const snapshotRef = useRef<{ source: string; snapshot: HtmlRenderSnapshot } | null>(null)
  const scripted = hasHtmlScripts(value)


  const select = useCallback((id: string | null, scroll = false) => {
    const document = frameRef.current?.contentDocument
    document?.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).forEach((node) => node.removeAttribute(SELECTED_ATTRIBUTE))
    const element = id === null ? null : document?.querySelector<HTMLElement>(`[${BLOCK_ATTRIBUTE}="${id}"]`)
    if (!element || !modelRef.current?.elements.has(id!)) { setSelection(null); setSettingsOpen(false); return }
    element.setAttribute(SELECTED_ATTRIBUTE, '')
    const style = document!.defaultView!.getComputedStyle(element)
    setSelection({ id: id!, display: style.display, gap: Number.parseFloat(style.gap) || 0, align: style.textAlign, fontSize: Number.parseFloat(style.fontSize) || 16, color: style.color, background: style.backgroundColor, padding: Number.parseFloat(style.paddingTop) || 0 })
    setSettingsOpen(true)
    setOutlineOpen(false)
    setError('')
    if (scroll) element.scrollIntoView({ block: 'nearest' })
  }, [])

  const publish = () => {
    if (!modelRef.current) return
    const source = serializeHtml(modelRef.current.original)
    emittedRef.current = source
    changeRef.current(source)
  }

  const commit = (element: HTMLElement | null) => {
    const model = modelRef.current
    if (!model) return
    const source = serializeHtml(model.original)
    if (source === value) return
    const active = document.activeElement
    pendingRef.current = { source, id: element ? getHtmlBlockId(element) : null, scrollY: frameRef.current?.contentWindow?.scrollY ?? 0, focus: active?.closest('.html-block-settings') ? active.getAttribute('aria-label') : null }
    emittedRef.current = null
    changeRef.current(source)
  }

  const edit = (operation: (element: HTMLElement) => HTMLElement | null | void) => {
    const element = selection && modelRef.current?.elements.get(selection.id)
    if (!element) return
    try {
      const next = operation(element)
      setError('')
      commit(next === undefined ? element : next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this block.') }
  }

  useEffect(() => {
    const frame = frameRef.current
    // Text edits already changed the frame; reloading would discard the caret.
    if (!frame || value === emittedRef.current) return
    disposeRef.current?.()
    modelRef.current = null
    emittedRef.current = null
    const controller = new AbortController()
    const load = async () => {
    let snapshot: HtmlRenderSnapshot | undefined
    const runScripts = hasHtmlScripts(value)
    setRendering(runScripts)
    if (runScripts) {
      try { snapshot = await renderHtmlDocument(value, controller.signal) }
      catch (cause) {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Could not render this page.')
      }
      if (controller.signal.aborted) return
      setRendering(false)
    }
    snapshotRef.current = snapshot ? { source: value, snapshot } : null
    const model = createHtmlEditingDocument(value, snapshot)
    const pending = pendingRef.current?.source === value ? pendingRef.current : null
    pendingRef.current = null
    imageTargetRef.current = null
    modelRef.current = model
    setBlocks(model.blocks)
    setLink(null)
    setLinkError(false)
    setSelection(null)
    if (!pending?.id) setSettingsOpen(false)
    let dispose: (() => void) | undefined
    const attach = () => {
      dispose?.()
      const document = frame.contentDocument
      if (!document) return
      const style = document.createElement('style')
      style.textContent = `[${SELECTED_ATTRIBUTE}]{outline:2px solid #167469!important;outline-offset:-2px!important}`
      document.head.append(style)
      if (pending) {
        frame.contentWindow?.scrollTo(0, pending.scrollY)
        select(pending.id)
        if (pending.focus) requestAnimationFrame(() => {
          const control = frame.ownerDocument.querySelector<HTMLElement>(`.html-block-settings [aria-label="${CSS.escape(pending.focus!)}"]`)
          if (!control?.matches(':disabled')) control?.focus({ preventScroll: true })
        })
      }
      const input = (event: Event) => {
        if (modelRef.current !== model) return
        const element = event.target as HTMLElement
        const node = model.texts.get(element.getAttribute('data-markword-edit-text') ?? '')
        const control = model.controls.get(element.getAttribute('data-markword-edit-control') ?? '')
        if (!node && !control) return
        if (control) {
          if (control.tagName === 'TEXTAREA') control.textContent = (element as HTMLTextAreaElement).value
          else if (control.tagName === 'SELECT') Array.from((control as HTMLSelectElement).options).forEach((option, index) => option.toggleAttribute('selected', (element as HTMLSelectElement).options[index].selected))
          else if ((control as HTMLInputElement).type === 'radio') {
            for (const peer of model.controls.values()) {
              if (peer.tagName === 'INPUT' && (peer as HTMLInputElement).type === 'radio' && (peer === control || (control.name && peer.name === control.name && peer.form === control.form))) peer.toggleAttribute('checked', peer === control && (element as HTMLInputElement).checked)
            }
          } else if ((control as HTMLInputElement).type === 'checkbox') control.toggleAttribute('checked', (element as HTMLInputElement).checked)
          else control.setAttribute('value', (element as HTMLInputElement).value)
        } else node!.textContent = element.textContent ?? ''
        const source = serializeHtml(model.original)
        emittedRef.current = source
        changeRef.current(source, element)
        setBlocks(model.blocks.map((block) => ({ ...block, label: getHtmlBlockLabel(model.elements.get(block.id)!) })))
      }
      const click = (event: MouseEvent) => {
        const target = event.target as Element
        if (target.closest('button, a')) event.preventDefault()
        const block = target.closest(`[${BLOCK_ATTRIBUTE}]`)
        select(block?.getAttribute(BLOCK_ATTRIBUTE) ?? null)
        const anchor = target.closest('a')
        if (!anchor) return
        const id = anchor.getAttribute('data-markword-edit-link')
        const original = id === null ? null : model.links.get(id)
        if (original) { setLink({ id: id!, url: original.getAttribute('href') ?? '' }); setLinkError(false) }
      }
      const keydown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          actionsRef.current.onSave()
        }
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          if (event.key.toLowerCase() === 'y' || event.shiftKey) actionsRef.current.onRedo()
          else actionsRef.current.onUndo()
        }
        if (event.key === 'Enter' && !event.isComposing && (event.target as HTMLElement).isContentEditable) {
          event.preventDefault()
          ;(event.target as HTMLElement).blur()
        }
        if (event.key === 'Escape') { select(null); setLink(null) }
      }
      const beforeInput = (event: InputEvent) => {
        if ((event.target as HTMLElement).isContentEditable && !event.isComposing && ['insertParagraph', 'insertLineBreak'].includes(event.inputType)) event.preventDefault()
      }
      const submit = (event: Event) => event.preventDefault()
      const dragover = (event: DragEvent) => {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
      }
      const drop = (event: DragEvent) => {
        const file = event.dataTransfer?.files[0]
        if (!file) return
        event.preventDefault()
        actionsRef.current.onOpenFile(file)
      }
      document.addEventListener('input', input)
      document.addEventListener('click', click)
      document.addEventListener('auxclick', click)
      document.addEventListener('keydown', keydown)
      document.addEventListener('beforeinput', beforeInput)
      document.addEventListener('submit', submit)
      document.addEventListener('dragover', dragover)
      document.addEventListener('drop', drop)
      dispose = () => {
        document.removeEventListener('input', input)
        document.removeEventListener('click', click)
        document.removeEventListener('auxclick', click)
        document.removeEventListener('keydown', keydown)
        document.removeEventListener('beforeinput', beforeInput)
        document.removeEventListener('submit', submit)
        document.removeEventListener('dragover', dragover)
        document.removeEventListener('drop', drop)
      }
    }
    frame.addEventListener('load', attach)
    frame.srcdoc = model.preview
    disposeRef.current = () => { frame.removeEventListener('load', attach); dispose?.() }
    }
    void load()
    return () => { controller.abort() }
  }, [value, select])

  useEffect(() => () => disposeRef.current?.(), [])

  const selected = selection ? modelRef.current?.elements.get(selection.id) : undefined
  const capabilities = selected ? getHtmlBlockCapabilities(selected) : null
  const settings = selected ? getHtmlBlockSettings(selected) : null
  const parent = selection ? blocks.find((block) => block.id === selection.id)?.parentId : null
  const hasSpacing = capabilities?.layout && (settings?.layout || ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(selection?.display ?? ''))

  const checkMoveLayout = (element: HTMLElement) => {
    const rendered = frameRef.current?.contentDocument?.querySelector<HTMLElement>(`[${BLOCK_ATTRIBUTE}="${getHtmlBlockId(element)}"]`)
    const parent = rendered?.parentElement
    if (!parent) return
    const view = parent.ownerDocument.defaultView!
    const parentStyle = view.getComputedStyle(parent)
    const fixedPlacement = Array.from(parent.children).some((child) => {
      if (!child.hasAttribute(BLOCK_ATTRIBUTE)) return false
      const style = view.getComputedStyle(child)
      return ['absolute', 'fixed'].includes(style.position) || Number(style.order) !== 0
        || (parentStyle.display.includes('grid') && [style.gridColumnStart, style.gridRowStart].some((value) => value !== 'auto' && !value.startsWith('span ')))
    })
    if (fixedPlacement || parentStyle.flexDirection.endsWith('reverse')) throw new Error('Choose a layout for the parent block before reordering positioned content.')
  }

  const blockLabel = (block: HtmlBlock) => {
    if (block.kind === 'main') return t('Page')
    if (/^h[1-6]$/.test(block.kind) && blocks.find((candidate) => candidate.id === block.parentId)?.label === block.label) return t('Heading')
    return block.label
  }

  const insert = (kind: 'section' | 'paragraph' | 'image-text', imageSource?: string, target = selected) => {
    const model = modelRef.current
    if (!model) return
    const document = model.original
    const element = document.createElement(kind === 'section' ? 'section' : kind === 'paragraph' ? 'p' : 'figure')
    if (kind === 'section') {
      const heading = document.createElement('h2')
      heading.textContent = t('Section title')
      const paragraph = document.createElement('p')
      paragraph.textContent = t('Write here')
      element.append(heading, paragraph)
    } else if (kind === 'image-text') {
      const image = document.createElement('img')
      image.setAttribute('src', imageSource!)
      image.alt = ''
      const caption = document.createElement('figcaption')
      caption.textContent = t('Image description')
      element.append(image, caption)
      setHtmlBlockLayout(element, 'image-left')
    } else element.textContent = t('Write here')
    let anchor = target
    while (anchor && !anchor.parentElement?.matches('body, main, article, section, div, aside, header, footer')) anchor = anchor.parentElement ?? undefined
    if (anchor && !anchor.matches('main, article')) anchor.after(element)
    else (anchor ?? document.querySelector('main') ?? document.body).append(element)
    commit(element)
  }

  const chooseImage = (insertNew: boolean) => {
    if (!modelRef.current) return
    insertImageRef.current = insertNew
    imageTargetRef.current = { model: modelRef.current, element: selected ?? null }
    imageInputRef.current?.click()
  }

  const readImage = async (file: File) => {
    const target = imageTargetRef.current
    const insertNew = insertImageRef.current
    if (!target) return
    setImageBusy(true)
    setError('')
    try {
      if (!/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, BMP, or SVG image.')
      if (file.size > MAX_EXPORT_IMAGE_BYTES) throw new Error('Choose an image smaller than 3 MB.')
      const source = await blobToDataUrl(file)
      const image = new Image()
      image.src = source
      await image.decode().catch(() => { throw new Error('Could not read this image. Choose another file.') })
      if (target.model !== modelRef.current) throw new Error('The document changed. Select the image again.')
      if (insertNew) insert('image-text', source, target.element ?? undefined)
      else if (target.element) {
        replaceHtmlBlockImage(target.element, source)
        commit(target.element)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this image. Choose another file.') }
    finally { setImageBusy(false) }
  }

  return <section className="html-preview-pane" aria-label={t('Editable preview')}>
    <div className="html-edit-toolbar">
      {!interactive && <button type="button" className="toolbar-button html-structure-toggle" aria-label={t('Page structure')} aria-expanded={outlineOpen} aria-controls="html-structure" onClick={() => setOutlineOpen((open) => !open)}><ListTree size={17} aria-hidden="true" /><span>{t('Page structure')}</span></button>}
      {!interactive && <select className="html-add-content" aria-label={t('Add content')} value="" disabled={imageBusy || rendering} onChange={(event) => {
        const kind = event.target.value as 'section' | 'paragraph' | 'image-text'
        if (kind === 'image-text') chooseImage(true)
        else insert(kind)
      }}>
        <option value="" disabled>{t('Add content')}</option>
        <option value="section">{t('Section')}</option>
        <option value="paragraph">{t('Paragraph')}</option>
        <option value="image-text">{t('Image and text')}</option>
      </select>}
      {scripted && <>
        <button type="button" className="toolbar-button" aria-label={t(interactive ? 'Edit page' : 'Interactive preview')} aria-pressed={interactive} onClick={() => setInteractive((open) => !open)}>{interactive ? <Pencil size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}<span>{t(interactive ? 'Edit page' : 'Interactive preview')}</span></button>
        <button type="button" className="toolbar-button" aria-label={t('Data')} aria-expanded={dataOpen} onClick={() => setDataOpen((open) => !open)}><Database size={17} aria-hidden="true" /><span>{t('Data')}</span></button>
        <button type="button" className="toolbar-button" aria-label={t('Create static copy')} disabled={rendering} onClick={() => setConfirmStatic(true)}><FilePlus2 size={17} aria-hidden="true" /><span>{t('Create static copy')}</span></button>
      </>}
      {!interactive && selection && <button type="button" className="toolbar-button html-settings-toggle" aria-label={t('Block settings')} aria-expanded={settingsOpen} aria-controls="html-block-settings" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={17} aria-hidden="true" /><span>{t('Block settings')}</span></button>}
    </div>
    {confirmStatic && <Modal className="html-static-dialog" label={t('Create static copy')} onClose={() => setConfirmStatic(false)}>
      <div><h2>{t('Create static copy')}</h2><p>{t('Scripts and interactive controls will be removed. The original document stays unchanged.')}</p>
      <button type="button" className="toolbar-button" onClick={() => setConfirmStatic(false)}>{t('Cancel')}</button>
      <button type="button" className="toolbar-button" disabled={rendering} onClick={async () => {
        setRendering(true)
        try {
        const cached = snapshotRef.current
        const snapshot = cached?.source === value ? cached.snapshot : await renderHtmlDocument(value)
        const html = createStaticHtml(snapshot.html)
        const title = new DOMParser().parseFromString(value, 'text/html').title || t('Page')
        setConfirmStatic(false)
        onOpenFile(new File([html], `${title} — ${t('Static copy')}.html`, { type: 'text/html' }))
        } catch { setError('Could not render this page.'); setConfirmStatic(false) }
        finally { setRendering(false) }
      }}>{t('Create static copy')}</button></div>
    </Modal>}
    {error && <div className="html-edit-error" role="alert"><span>{t(error)}</span><button type="button" aria-label={t('Dismiss')} onClick={() => setError('')}><X size={16} aria-hidden="true" /></button></div>}
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
    <div className={`html-workbench ${dataOpen ? 'has-data' : ''} ${interactive ? 'is-interactive' : ''} ${dataOpen || (!interactive && settingsOpen && selected) ? 'has-settings' : ''}`} aria-busy={rendering}>
      {rendering && <div className="html-rendering" role="status">{t('Rendering page…')}</div>}
      {!interactive && outlineOpen && <button type="button" className="html-structure-scrim" aria-label={t('Close page structure')} onClick={() => setOutlineOpen(false)} />}
      <aside id="html-structure" hidden={interactive} className={`html-structure ${outlineOpen ? 'is-open' : ''}`} aria-label={t('Page structure')}>
        <header><ListTree size={16} aria-hidden="true" /><strong>{t('Page structure')}</strong><button type="button" className="html-structure-close" aria-label={t('Close page structure')} onClick={() => setOutlineOpen(false)}><X size={17} aria-hidden="true" /></button></header>
        <input className="html-outline-search" aria-label={t('Find block')} placeholder={t('Find block')} value={outlineSearch} onChange={(event) => setOutlineSearch(event.target.value)} />
        <nav>
          {blocks.filter((block) => !outlineSearch || block.label.toLocaleLowerCase().includes(outlineSearch.toLocaleLowerCase())).map((block) => <button key={block.id} type="button" draggable className={`html-block-row ${dropTarget?.id === block.id ? `drop-${dropTarget.placement}` : ''}`} data-html-block-id={block.id} aria-label={t('Select {label}', { label: blockLabel(block) })} aria-pressed={selection?.id === block.id} title={block.label} style={{ paddingInlineStart: 8 + Math.min(block.depth, 5) * 12 }} onClick={() => select(block.id, true)} onDragStart={(event) => {
            draggedRef.current = block.id
            event.dataTransfer.setData(DRAG_TYPE, block.id)
            event.dataTransfer.effectAllowed = 'move'
          }} onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
            event.preventDefault()
            const source = draggedRef.current && modelRef.current?.elements.get(draggedRef.current)
            const destination = modelRef.current?.elements.get(block.id)
            const allowed = source && destination && source !== destination && source.parentElement === destination.parentElement
            event.dataTransfer.dropEffect = allowed ? 'move' : 'none'
            const bounds = event.currentTarget.getBoundingClientRect()
            setDropTarget(allowed ? { id: block.id, placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' } : null)
          }} onDrop={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
            event.preventDefault()
            event.stopPropagation()
            const source = modelRef.current?.elements.get(event.dataTransfer.getData(DRAG_TYPE))
            const destination = modelRef.current?.elements.get(block.id)
            const bounds = event.currentTarget.getBoundingClientRect()
            setDropTarget(null)
            draggedRef.current = null
            if (!source || !destination || source === destination) return
            try { checkMoveLayout(source); commit(moveHtmlBlock(source, destination, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')) }
            catch (cause) { setError((cause as Error).message) }
          }} onDragEnd={() => { setDropTarget(null); draggedRef.current = null }}>
            <GripVertical size={13} aria-hidden="true" /><span>{blockLabel(block)}</span>
          </button>)}
          {!blocks.length && <p className="html-empty-outline">{t('Add a section to start.')}</p>}
        </nav>
      </aside>
      <iframe hidden={interactive} ref={frameRef} title={t('HTML page preview')} className="html-preview-frame" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
      {interactive && <HtmlRuntimePreview value={value} title={t('Interactive HTML preview')} onSnapshot={(snapshot) => { snapshotRef.current = { source: value, snapshot } }} onError={() => setError('Could not run a page interaction.')} />}
      {dataOpen && <HtmlDataPanel value={value} onChange={(source) => { emittedRef.current = null; changeRef.current(source) }} onClose={() => setDataOpen(false)} />}
      {!dataOpen && !interactive && settingsOpen && selected && capabilities && settings && <aside key={selection!.id} id="html-block-settings" className="html-block-settings" aria-label={t('Block settings')}>
        <header><Layers size={16} aria-hidden="true" /><strong title={getHtmlBlockLabel(selected)}>{getHtmlBlockLabel(selected)}</strong><button type="button" aria-label={t('Close block settings')} onClick={() => setSettingsOpen(false)}><X size={17} aria-hidden="true" /></button></header>
        <div className="html-block-actions" role="group" aria-label={t('Block actions')}>
          <button type="button" title={t('Select parent block')} aria-label={t('Select parent block')} disabled={!parent} onClick={() => select(parent!, true)}><ChevronUp size={17} aria-hidden="true" /></button>
          <button type="button" title={t('Move block up')} aria-label={t('Move block up')} disabled={!capabilities.up} onClick={() => edit((element) => { checkMoveLayout(element); return applyHtmlBlockAction(element, 'up') })}><ArrowUp size={17} aria-hidden="true" /></button>
          <button type="button" title={t('Move block down')} aria-label={t('Move block down')} disabled={!capabilities.down} onClick={() => edit((element) => { checkMoveLayout(element); return applyHtmlBlockAction(element, 'down') })}><ArrowDown size={17} aria-hidden="true" /></button>
          <button type="button" title={t('Duplicate block')} aria-label={t('Duplicate block')} disabled={!capabilities.duplicate} onClick={() => edit((element) => applyHtmlBlockAction(element, 'duplicate'))}><Copy size={17} aria-hidden="true" /></button>
          <button type="button" title={t('Delete block')} aria-label={t('Delete block')} disabled={!capabilities.delete} onClick={() => edit((element) => applyHtmlBlockAction(element, 'delete'))}><Trash2 size={17} aria-hidden="true" /></button>
        </div>
        <div className="html-block-fields">
          {Array.from(modelRef.current?.dynamicIds ?? []).some((id) => id === selection!.id || id.startsWith(selection!.id + '.')) && <button type="button" className="toolbar-button" onClick={() => setDataOpen(true)}><Database size={17} aria-hidden="true" />{t('Edit data')}</button>}
          {capabilities.layout && <label>{t('Layout')}<select aria-label={t('Layout')} value={settings.layout ?? ''} onChange={(event) => edit((element) => setHtmlBlockLayout(element, event.target.value as HtmlLayout))}>
            <option value="" disabled>{t('Current layout')}</option><option value="single">{t('Single column')}</option><option value="two-columns">{t('Two columns')}</option><option value="three-columns">{t('Three columns')}</option>
            {capabilities.imageLayout && <><option value="image-left">{t('Image left')}</option><option value="image-right">{t('Image right')}</option></>}
          </select></label>}
          {hasSpacing && <label>{t('Spacing (px)')}<input key={`${selection!.id}-${settings.gap}`} aria-label={t('Spacing (px)')} type="number" min="0" max="160" step="1" defaultValue={settings.gap ?? selection!.gap} onBlur={(event) => {
            if (event.target.value !== '' && event.target.validity.valid) edit((element) => setHtmlBlockStyle(element, { gap: Number(event.target.value) }))
            else { setError('Enter spacing between 0 and 160 pixels.'); event.target.value = String(settings.gap ?? selection!.gap) }
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>}
          <label>{t('Block width')}<select aria-label={t('Block width')} value={settings.width} onChange={(event) => edit((element) => setHtmlBlockStyle(element, { width: event.target.value as HtmlBlockWidth }))}>
            <option value="auto">{t('Automatic')}</option><option value="full">{t('Full width')}</option><option value="wide">{t('Wide')}</option><option value="normal">{t('Reading width')}</option><option value="narrow">{t('Narrow')}</option>
          </select></label>
          <label>{t('Alignment')}<select aria-label={t('Alignment')} value={settings.align ?? (['center', 'right'].includes(selection!.align) ? selection!.align : 'left')} onChange={(event) => edit((element) => setHtmlBlockStyle(element, { align: event.target.value as HtmlBlockAlign }))}>
            <option value="left">{t('Left')}</option><option value="center">{t('Center')}</option><option value="right">{t('Right')}</option>
          </select></label>
          <label>{t('Font size (px)')}<input key={`${selection!.id}-${selected.style.fontSize}`} aria-label={t('Font size (px)')} type="number" min="6" max="240" defaultValue={selection!.fontSize} onBlur={(event) => {
            if (event.target.value && event.target.validity.valid && Number(event.target.value) !== selection!.fontSize) edit((element) => { element.style.setProperty('font-size', `${Number(event.target.value)}px`, 'important') })
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <label>{t('Padding (px)')}<input key={`${selection!.id}-${selected.style.padding}`} aria-label={t('Padding (px)')} type="number" min="0" max="240" defaultValue={selection!.padding} onBlur={(event) => {
            if (event.target.value && event.target.validity.valid && Number(event.target.value) !== selection!.padding) edit((element) => { element.style.setProperty('padding', `${Number(event.target.value)}px`, 'important') })
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <label>{t('Text color')}<input key={`${selection!.id}-${selected.style.color}`} type="color" aria-label={t('Text color')} defaultValue={colorHex(selection!.color)} onChange={(event) => {
            if (CSS.supports('color', event.target.value)) edit((element) => { element.style.setProperty('color', event.target.value, 'important') })
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <label>{t('Background color')}<input key={`${selection!.id}-${selected.style.backgroundColor}`} type="color" aria-label={t('Background color')} defaultValue={colorHex(selection!.background)} onChange={(event) => {
            if (CSS.supports('background-color', event.target.value)) edit((element) => { element.style.setProperty('background-color', event.target.value, 'important') })
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          {capabilities.image && <div className="html-image-fields">
            <button type="button" className="toolbar-button html-replace-image" disabled={imageBusy} onClick={() => chooseImage(false)}><ImagePlus size={17} aria-hidden="true" />{t(imageBusy ? 'Reading image…' : 'Replace image')}</button>
            <label>{t('Image description')}<input key={`${selection!.id}-${settings.imageAlt}`} aria-label={t('Image description')} defaultValue={settings.imageAlt ?? ''} onBlur={(event) => {
              const alt = event.target.value
              if (alt !== settings.imageAlt) edit((element) => { getHtmlBlockImage(element)!.alt = alt })
            }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          </div>}
        </div>
      </aside>}
    </div>
    <input ref={imageInputRef} className="visually-hidden-file" type="file" aria-label={t('Replace image')} accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml" disabled={imageBusy} onChange={(event) => {
      const file = event.target.files?.[0]
      if (!imageTargetRef.current && modelRef.current) imageTargetRef.current = { model: modelRef.current, element: selected ?? null }
      if (file) void readImage(file)
      event.currentTarget.value = ''
    }} />
  </section>
}
