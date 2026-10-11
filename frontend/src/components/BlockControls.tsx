import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, IndentDecrease, IndentIncrease, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { BLOCK_TYPES, type BlockChange, type BlockType } from '../markdownBlocks'
import { blockAction, canBlockAction, canConvertBlock, CONVERT_TYPES, convertBlocks, documentBlocks, moveBlocks, normalizedBlocks, type BlockAction, type BlockPlacement, type DocumentBlock } from '../blockOperations'
import '../blockControls.css'

interface Props {
  rootRef: RefObject<HTMLElement | null>
  source: string
  version: unknown
  onChange: (change: BlockChange | null, target: Element) => boolean
  onAdd: (target: HTMLElement, position?: number) => void
  onUndo?: () => void
  onRedo?: () => void
}
interface Handle { block: DocumentBlock; top: number; left: number }
function isVisible(block: DocumentBlock) {
  return !block.anchor.parentElement?.closest('details:not([open])') && block.element.getBoundingClientRect().height > 0
}

export function BlockControls({ rootRef, source, version, onChange, onAdd, onUndo, onRedo }: Props) {
  const { t } = useI18n()
  const [handles, setHandles] = useState<Handle[]>([])
  const [selected, setSelected] = useState<DocumentBlock[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const hoveredRef = useRef<number | null>(null)
  const [notice, setNotice] = useState('')
  const [drop, setDrop] = useState<{ block: DocumentBlock; placement: BlockPlacement } | null>(null)
  const dropRef = useRef<typeof drop>(null)
  const blocksRef = useRef<DocumentBlock[]>([])
  const blocksByLineRef = useRef(new Map<number, DocumentBlock>())
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const selectionAnchorRef = useRef<DocumentBlock | null>(null)
  const dragRef = useRef<{ source: string; selected: DocumentBlock[] } | null>(null)
  const pendingLineRef = useRef<number | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source

  const clear = useCallback(() => { setSelected([]); setMultiSelect(false); selectionAnchorRef.current = null; dropRef.current = null; setDrop(null); setNotice('') }, [])
  const select = useCallback((block: DocumentBlock, extend = false, toggle = false) => {
    setNotice('')
    window.getSelection()?.removeAllRanges()
    if (extend && selectionAnchorRef.current) {
      const blocks = blocksRef.current.filter(isVisible)
      const from = blocks.indexOf(selectionAnchorRef.current)
      const to = blocks.indexOf(block)
      if (from >= 0 && to >= 0) { setSelected(blocks.slice(Math.min(from, to), Math.max(from, to) + 1)); return }
    }
    selectionAnchorRef.current = block
    setSelected(toggle ? selectedRef.current.includes(block) ? selectedRef.current.filter((item) => item !== block) : [...selectedRef.current, block] : [block])
  }, [])
  useEffect(() => {
    const root = rootRef.current
    const scroll = root?.closest<HTMLElement>('.preview-scroll')
    const pane = scroll?.parentElement
    if (!root || !scroll || !pane) return
    const blocks = documentBlocks(root, source)
    blocksRef.current = blocks
    blocksByLineRef.current = new Map(blocks.map((block) => [block.line, block]))
    root.querySelectorAll('.markdown-block-selected').forEach((element) => element.classList.remove('markdown-block-selected'))
    root.querySelectorAll('[data-document-block]').forEach((element) => element.removeAttribute('data-document-block'))
    blocks.forEach((block) => block.element.dataset.documentBlock = String(block.line))
    const pending = pendingLineRef.current
    pendingLineRef.current = null
    const next = pending === null ? [] : [blocks.find((block) => block.line >= pending) ?? blocks.at(-1)].filter((block): block is DocumentBlock => Boolean(block))
    setSelected(next)
    selectionAnchorRef.current = next[0] ?? null
    setDrop(null)
    dropRef.current = null
    hoveredRef.current = null
    setHovered(null)
    const reveal = (line: number | null) => {
      if (hoveredRef.current === line) return
      hoveredRef.current = line
      setHovered(line)
    }
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = event.target instanceof Element ? event.target : null
      const handle = target?.closest<HTMLElement>('[data-block-row]')
      const element = target?.closest<HTMLElement>('[data-document-block]')
      const line = Number(handle?.dataset.blockRow ?? element?.dataset.documentBlock)
      if (Number.isInteger(line)) { reveal(line); return }
      // Keep the handle reachable while crossing the gap beside its row.
      const previous = blocksByLineRef.current.get(hoveredRef.current ?? -1)
      const anchor = previous?.kind === 'details' ? previous.anchor.querySelector('summary') : previous?.element
      const rect = anchor?.getBoundingClientRect()
      const rowHeight = anchor ? parseFloat(getComputedStyle(anchor).lineHeight) : 0
      reveal(rect && event.clientX < rect.left && event.clientY >= rect.top && event.clientY <= rect.top + rowHeight ? previous!.line : null)
    }
    const pointerLeave = () => reveal(null)
    const pointerDown = (event: PointerEvent) => {
      if (!event.shiftKey && event.target instanceof Node && scroll.contains(event.target)) clear()
    }
    const shiftClick = (event: MouseEvent) => {
      if (!event.shiftKey || !selectedRef.current.length || !(event.target instanceof Element)) return
      const element = event.target.closest<HTMLElement>('[data-document-block]')
      const block = blocksByLineRef.current.get(Number(element?.dataset.documentBlock))
      if (!block) return
      event.preventDefault()
      event.stopPropagation()
      select(block, true)
    }
    const position = () => {
      const paneRect = pane.getBoundingClientRect()
      const scrollRect = scroll.getBoundingClientRect()
      setHandles(blocks.flatMap((block) => {
        if (!isVisible(block)) return []
        const anchor = block.kind === 'details' ? block.anchor.querySelector(':scope > summary') ?? block.element : block.element
        const rect = anchor.getBoundingClientRect()
        if (!rect.width || !rect.height || rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) return []
        const style = getComputedStyle(anchor)
        const markerSpace = block.kind === 'li' && style.listStyleType !== 'none' ? parseFloat(style.fontSize) * 1.5 : 0
        return [{ block, top: Math.max(scrollRect.top, rect.top) - paneRect.top, left: Math.max(2, rect.left - paneRect.left - (innerWidth <= 900 ? 44 : 60) - markerSpace) }]
      }))
    }
    position()
    let frame = 0
    const refresh = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; position() }) }
    const observer = new ResizeObserver(refresh)
    observer.observe(root)
    scroll.addEventListener('scroll', refresh)
    pane.addEventListener('pointermove', pointerMove)
    pane.addEventListener('pointerleave', pointerLeave)
    pane.addEventListener('pointerdown', pointerDown)
    pane.addEventListener('click', shiftClick, true)
    window.addEventListener('resize', refresh)
    root.addEventListener('input', refresh)
    // DOM table/source controls are installed in effects after the writing model.
    const mutation = new MutationObserver(refresh)
    mutation.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame)
      scroll.removeEventListener('scroll', refresh); window.removeEventListener('resize', refresh); root.removeEventListener('input', refresh)
      pane.removeEventListener('pointermove', pointerMove); pane.removeEventListener('pointerleave', pointerLeave)
      pane.removeEventListener('pointerdown', pointerDown); pane.removeEventListener('click', shiftClick, true)
      blocks.forEach((block) => { block.element.classList.remove('markdown-block-selected'); block.element.removeAttribute('data-document-block') })
    }
  }, [rootRef, source, version, clear, select])

  useLayoutEffect(() => {
    const root = rootRef.current
    root?.querySelectorAll('.markdown-block-selected').forEach((element) => element.classList.remove('markdown-block-selected'))
    selected.forEach((block) => block.element.classList.add('markdown-block-selected'))
  }, [rootRef, selected])

  const apply = useCallback((change: BlockChange | null, target: Element) => {
    if (!change) { setNotice(t('Choose a different block or position for this action.')); return false }
    if (!onChange(change, target)) { setNotice(t('The document changed. Select the blocks again.')); return false }
    pendingLineRef.current = change.line
    setMultiSelect(false)
    setNotice('')
    return true
  }, [onChange, t])
  const act = (action: BlockAction) => {
    const target = selected[0]?.element
    if (target) apply(blockAction(source, blocksRef.current, selected, action, t('Toggle')), target)
  }

  const handleKey = (event: React.KeyboardEvent, block?: DocumentBlock) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const modifier = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') { event.preventDefault(); clear(); return }
    if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo?.(); else onUndo?.(); return }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); onRedo?.(); return }
    if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(blocksRef.current.filter(isVisible)); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); act('delete'); return }
    if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); act('duplicate'); return }
    if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); act(({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'outdent', ArrowRight: 'indent' } as const)[event.key as 'ArrowUp']); return
    }
    if (block && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      const index = handles.findIndex((handle) => handle.block === block)
      const next = handles[index + (event.key === 'ArrowDown' ? 1 : -1)]?.block
      if (next) {
        if (event.shiftKey) select(next, true)
        controlsRef.current?.querySelector<HTMLButtonElement>(`[data-block-handle="${next.line}"]`)?.focus()
      }
    }
  }

  const dragOver = useCallback((event: DragEvent) => {
    const dragged = dragRef.current
    const root = rootRef.current
    if (!dragged || !root || dragged.source !== sourceRef.current) return
    event.stopPropagation()
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const handle = hit?.closest<HTMLElement>('[data-block-row]')
    const element = hit?.closest<HTMLElement>('[data-document-block]')
    const target = blocksByLineRef.current.get(Number(handle?.dataset.blockRow ?? element?.dataset.documentBlock))
    if (!target || dragged.selected.some((block) => block.from <= target.from && block.to >= target.to)) {
      if (dropRef.current) { dropRef.current = null; setDrop(null) }
      return
    }
    const rect = (target.kind === 'details' ? target.anchor.querySelector('summary') ?? target.element : target.element).getBoundingClientRect()
    const placement: BlockPlacement = event.clientX > rect.left + 60 && target.kind !== 'pre' && target.kind !== 'table' ? 'inside' : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (dropRef.current?.block === target && dropRef.current.placement === placement) return
    dropRef.current = { block: target, placement }; setDrop(dropRef.current)
  }, [rootRef])
  const dropEvent = useCallback((event: DragEvent) => {
    const dragged = dragRef.current
    if (!dragged) return
    event.preventDefault(); event.stopPropagation()
    const destination = dropRef.current
    if (destination && dragged.source === sourceRef.current) apply(moveBlocks(sourceRef.current, dragged.selected, destination.block, destination.placement, t('Toggle')), dragged.selected[0].element)
    dropRef.current = null
    dragRef.current = null; setDrop(null)
  }, [apply, t])
  useLayoutEffect(() => {
    const pane = rootRef.current?.closest<HTMLElement>('.pane--preview')
    if (!pane) return
    pane.addEventListener('dragover', dragOver); pane.addEventListener('drop', dropEvent)
    return () => { pane.removeEventListener('dragover', dragOver); pane.removeEventListener('drop', dropEvent) }
  }, [rootRef, dragOver, dropEvent])

  const dropRect = drop?.block.element.getBoundingClientRect()
  const paneRect = rootRef.current?.closest('.pane--preview')?.getBoundingClientRect()
  const operationSelection = normalizedBlocks(selected)
  return <div ref={controlsRef} className="markdown-block-controls" onKeyDown={(event) => {
    if ((event.target as Element).matches('select')) { if (event.key === 'Escape') clear(); return }
    if (!(event.target as Element).matches('[data-block-handle]')) handleKey(event)
    }}>
    {handles.map(({ block, top, left }) => <div key={block.line + ':' + block.kind} className="markdown-block-row" data-block-row={block.line} data-hovered={hovered === block.line || undefined} data-selected={selected.includes(block) || undefined} style={{ top, left }}>
      <button type="button" className="markdown-block-add" data-block-add={block.line} aria-label={t('Add content')} title={t('Add content')} onClick={() => onAdd(block.anchor, block.to)}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" className="markdown-block-handle" data-block-handle={block.line} data-hovered={hovered === block.line || undefined} aria-label={t('Select block at line {line}', { line: block.line })} title={t('Select or drag block. Shift selects a range.')} aria-pressed={selected.includes(block)} draggable onClick={(event) => select(block, event.shiftKey, multiSelect || event.ctrlKey || event.metaKey)} onKeyDown={(event) => handleKey(event, block)} onDragStart={(event) => {
      const chosen = selected.includes(block) ? selected : [block]
      setSelected(chosen); dragRef.current = { source, selected: chosen }
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', '')
    }} onDragEnd={() => { dragRef.current = null; dropRef.current = null; setDrop(null) }}><GripVertical size={16} aria-hidden="true" /></button>
    </div>)}
    {selected.length ? <div className="markdown-block-actions" role="toolbar" aria-label={t('Block actions')}>
      <span className="markdown-block-count">{t('{count} blocks selected', { count: selected.length })}</span>
      <button type="button" aria-label={t('Select more blocks')} title={t('Select more blocks')} aria-pressed={multiSelect} onClick={() => setMultiSelect((value) => !value)}><ListChecks size={17} aria-hidden="true" /></button>
      <select aria-label={t('Convert blocks to')} value="" onChange={(event) => {
        const type = event.target.value as BlockType
        apply(convertBlocks(source, blocksRef.current, selected, type, t('Toggle')), selected[0].element)
      }}><option value="" disabled>{t('Turn into…')}</option>{CONVERT_TYPES.map((type) => <option key={type} value={type} disabled={operationSelection.some((block) => !canConvertBlock(block, type, blocksRef.current, source))}>{t(BLOCK_TYPES.find((spec) => spec.id === type)!.label)}</option>)}</select>
      {(['up', 'down', 'indent', 'outdent', 'duplicate', 'delete'] as BlockAction[]).map((action, index) => {
        const Icon = [ArrowUp, ArrowDown, IndentIncrease, IndentDecrease, Copy, Trash2][index]
        const label = t(['Move blocks up', 'Move blocks down', 'Nest blocks', 'Unnest blocks', 'Duplicate blocks', 'Delete blocks'][index])
        return <button key={action} type="button" aria-label={label} title={label} disabled={!canBlockAction(action, blocksRef.current, selected)} onClick={() => act(action)}><Icon size={17} aria-hidden="true" /></button>
      })}
      <button type="button" aria-label={t('Add content')} title={t('Add content')} onClick={() => onAdd(selected.at(-1)!.anchor)}><Plus size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={t('Clear block selection')} title={t('Clear block selection')} onClick={clear}><X size={17} aria-hidden="true" /></button>
      <span className="markdown-block-help">{t('Shift-click selects a range. Ctrl or ⌘ adds a block.')}</span>
      {notice ? <span role="alert">{notice}</span> : null}
    </div> : null}
    {drop && dropRect && paneRect ? <div className={`markdown-block-drop markdown-block-drop--${drop.placement}`} style={{ top: (drop.placement === 'after' ? dropRect.bottom : dropRect.top) - paneRect.top, left: dropRect.left - paneRect.left, width: dropRect.width }}><span style={{ maxWidth: Math.max(28, dropRect.left - paneRect.left - 8) }}>{drop.placement === 'inside' ? t('Nest here') : t('Move here')}</span></div> : null}
  </div>
}
