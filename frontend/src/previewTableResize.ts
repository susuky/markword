import { MAX_TABLE_DIMENSION, MIN_TABLE_COLUMN_WIDTH, MIN_TABLE_ROW_HEIGHT, type TableLayout } from './tableLayout'
import { MAX_TABLE_CELLS } from './tableEditing'

type Axis = 'column' | 'row' | 'table'
type ResizeLabels = (axis: Axis, index: number) => string

export function prepareTableResize(table: HTMLTableElement, surface: HTMLElement, labels: ResizeLabels, onCommit: (layout: TableLayout) => boolean, onActive: (active: boolean) => void) {
  const rows = Array.from(table.rows)
  const cells = Array.from(rows[0]?.cells ?? [])
  if (!cells.length || cells.length * rows.length > MAX_TABLE_CELLS) return () => {}
  const handles: Array<{ element: HTMLButtonElement; axis: Axis; index: number }> = []
  let stopDrag: (() => void) | undefined
  let frame = 0

  const measure = () => ({ widths: cells.map((cell) => cell.getBoundingClientRect().width), heights: rows.map((row) => row.getBoundingClientRect().height) })
  const clamp = (size: number, min: number) => Math.round(Math.min(MAX_TABLE_DIMENSION, Math.max(min, size)))
  const apply = (layout: TableLayout) => {
    if (layout.widths) {
      table.style.tableLayout = 'fixed'
      table.style.width = `${layout.widths.reduce((sum, width) => sum + width, 0)}px`
      table.style.maxWidth = 'none'
      cells.forEach((cell, index) => { cell.style.boxSizing = 'border-box'; cell.style.width = `${layout.widths![index]}px` })
    }
    if (layout.heights) rows.forEach((row, index) => { row.style.height = `${layout.heights![index]}px` })
    position()
  }
  const savedHeights = () => rows.map((row) => Number.parseFloat(row.style.height) || 0)
  const resized = (axis: Axis, index: number, dx: number, dy: number, initial: ReturnType<typeof measure>): TableLayout => {
    if (axis === 'table') {
      const width = initial.widths.reduce((sum, value) => sum + value, 0)
      const height = initial.heights.reduce((sum, value) => sum + value, 0)
      return {
        widths: initial.widths.map((value) => clamp(value * (width + dx) / width, MIN_TABLE_COLUMN_WIDTH)),
        heights: initial.heights.map((value) => clamp(value * (height + dy) / height, MIN_TABLE_ROW_HEIGHT)),
      }
    }
    if (axis === 'row') {
      const heights = savedHeights()
      heights[index] = clamp(initial.heights[index] + dy, MIN_TABLE_ROW_HEIGHT)
      return { heights }
    }
    const widths = initial.widths.map((value) => clamp(value, MIN_TABLE_COLUMN_WIDTH))
    const next = initial.widths[index + 1]
    const delta = Math.max(MIN_TABLE_COLUMN_WIDTH - widths[index], Math.min(dx, MAX_TABLE_DIMENSION - widths[index], next === undefined ? Infinity : next - MIN_TABLE_COLUMN_WIDTH))
    widths[index] = clamp(widths[index] + delta, MIN_TABLE_COLUMN_WIDTH)
    if (next !== undefined) widths[index + 1] = clamp(next - delta, MIN_TABLE_COLUMN_WIDTH)
    return { widths }
  }
  const position = () => {
    const origin = surface.getBoundingClientRect()
    const rect = table.getBoundingClientRect()
    const cellRects = cells.map((cell) => cell.getBoundingClientRect())
    const rowRects = rows.map((row) => row.getBoundingClientRect())
    for (const { element, axis, index } of handles) {
      const edge = axis === 'column' ? cellRects[index] : axis === 'row' ? rowRects[index] : rect
      element.style.left = `${(axis === 'row' ? rect.left : edge.right) - origin.left}px`
      element.style.top = `${(axis === 'column' ? rect.top : edge.bottom) - origin.top}px`
      if (axis === 'column') element.style.height = `${rect.height}px`
      if (axis === 'row') element.style.width = `${rect.width}px`
      if (axis !== 'table') element.setAttribute('aria-valuenow', String(Math.round(axis === 'column' ? edge.width : edge.height)))
    }
  }
  const schedulePosition = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(position)
  }

  for (const [axis, count] of [['column', cells.length], ['row', rows.length], ['table', 1]] as const) {
    for (let index = 0; index < count; index++) {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = `preview-table__resize preview-table__resize--${axis}`
      handle.dataset.tableResize = `${axis}-${index}`
      handle.setAttribute('aria-label', labels(axis, index))
      handle.title = labels(axis, index)
      if (axis !== 'table') {
        handle.setAttribute('role', 'separator')
        handle.setAttribute('aria-orientation', axis === 'column' ? 'vertical' : 'horizontal')
        handle.setAttribute('aria-valuemin', String(axis === 'column' ? MIN_TABLE_COLUMN_WIDTH : MIN_TABLE_ROW_HEIGHT))
        handle.setAttribute('aria-valuemax', String(MAX_TABLE_DIMENSION))
      }
      handle.addEventListener('click', (event) => event.stopPropagation())
      handle.addEventListener('dblclick', (event) => event.stopPropagation())
      handle.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 1 : 10
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
        if (!(axis === 'column' ? dx : axis === 'row' ? dy : dx || dy)) return
        event.preventDefault()
        event.stopPropagation()
        const layout = resized(axis, index, dx, dy, measure())
        onCommit(layout)
      })
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        stopDrag?.()
        handle.focus({ preventScroll: true })
        const initial = measure()
        const originals = [table, ...cells, ...rows].map((element) => [element, element.style.cssText] as const)
        let layout: TableLayout | undefined
        const restore = () => { originals.forEach(([element, style]) => { element.style.cssText = style }); position() }
        const finish = (commit: boolean) => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', up)
          handle.removeEventListener('pointercancel', cancel)
          handle.removeEventListener('lostpointercapture', cancel)
          window.removeEventListener('keydown', escape)
          stopDrag = undefined
          surface.removeAttribute('data-resizing')
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
          onActive(false)
          if (!commit || !layout || !onCommit(layout)) restore()
        }
        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return
          const dx = moveEvent.clientX - event.clientX
          const dy = moveEvent.clientY - event.clientY
          if (!layout && Math.abs(axis === 'row' ? dy : dx) < 2 && (axis !== 'table' || Math.abs(dy) < 2)) return
          layout = resized(axis, index, dx, dy, initial)
          apply(layout)
        }
        const up = (upEvent: PointerEvent) => { if (upEvent.pointerId === event.pointerId) finish(true) }
        const cancel = () => finish(false)
        const escape = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(false) } }
        stopDrag = cancel
        surface.dataset.resizing = axis
        onActive(true)
        handle.setPointerCapture(event.pointerId)
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', up)
        handle.addEventListener('pointercancel', cancel)
        handle.addEventListener('lostpointercapture', cancel)
        window.addEventListener('keydown', escape)
      })
      handles.push({ element: handle, axis, index })
      surface.append(handle)
    }
  }
  const observer = new ResizeObserver(schedulePosition)
  observer.observe(table)
  observer.observe(surface)
  position()
  return () => {
    stopDrag?.()
    observer.disconnect()
    cancelAnimationFrame(frame)
    handles.forEach(({ element }) => element.remove())
  }
}
