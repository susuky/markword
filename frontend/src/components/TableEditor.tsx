import { Columns3, Plus, Rows3, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import { clipboardTable, MAX_TABLE_CELLS, TABLE_SIZE_ERROR, type TableAlignment, type TableData } from '../tableEditing'
import { Modal } from './Modal'
import './tableEditor.css'

export function TableEditor({ initial, existing, onApply, onClose }: {
  initial: TableData
  existing: boolean
  onApply: (data: TableData) => boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  const [data, setData] = useState(initial)
  const [message, setMessage] = useState('')
  const gridRef = useRef<HTMLTableElement>(null)
  const width = data.alignments.length

  useEffect(() => {
    const frame = requestAnimationFrame(() => gridRef.current?.querySelector('textarea')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const focusCell = (row: number, column: number) => {
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLTextAreaElement>(`[data-cell="${row}-${column}"]`)?.focus())
  }

  const resize = (rows: number, columns: number) => {
    if (rows * columns > MAX_TABLE_CELLS) { setMessage(t(TABLE_SIZE_ERROR)); return false }
    setData((current) => ({
      rows: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => current.rows[row]?.[column] ?? '')),
      alignments: Array.from({ length: columns }, (_, column) => current.alignments[column] ?? ''),
    }))
    setMessage('')
    return true
  }

  const navigate = (event: KeyboardEvent<HTMLTextAreaElement>, row: number, column: number) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    let nextRow = row
    let nextColumn = column
    if (event.key === 'Tab') {
      const index = row * width + column + (event.shiftKey ? -1 : 1)
      // Leave the grid at its edges so keyboard users can reach Apply and Cancel.
      if (index < 0 || index >= data.rows.length * width) return
      nextRow = Math.floor(index / width)
      nextColumn = index % width
    } else if (event.key === 'Enter' && !event.shiftKey) {
      nextRow++
      if (nextRow === data.rows.length && !resize(data.rows.length + 1, width)) { event.preventDefault(); return }
    } else return
    event.preventDefault()
    focusCell(nextRow, nextColumn)
  }

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>, row: number, column: number) => {
    try {
      const pasted = clipboardTable(event.clipboardData)
      if (!pasted) return
      event.preventDefault()
      const replace = !existing && data === initial && row === 0 && column === 0
      const rows = replace ? pasted.length : Math.max(data.rows.length, row + pasted.length)
      const columns = replace ? pasted[0].length : Math.max(width, column + pasted[0].length)
      if (rows * columns > MAX_TABLE_CELLS) throw new Error(TABLE_SIZE_ERROR)
      setData((current) => ({
        rows: Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) =>
          pasted[y - row]?.[x - column] ?? current.rows[y]?.[x] ?? '',
        )),
        alignments: Array.from({ length: columns }, (_, x) => current.alignments[x] ?? ''),
      }))
      setMessage('')
    } catch (error) {
      event.preventDefault()
      setMessage(t(error instanceof Error ? error.message : 'Could not read the pasted table. Try copying the cells again.'))
    }
  }

  const title = t(existing ? 'Edit table' : 'Insert table')
  return <Modal label={title} onClose={onClose} className="table-editor-overlay" closeOnBackdrop={false}>
    <section className="table-editor">
      <header className="table-editor__header">
        <div><h2>{title}</h2><p>{t('The first row is the header. Paste cells from a spreadsheet directly into the table.')}</p></div>
        <button type="button" className="table-icon-button" onClick={onClose} aria-label={t('Close table editor')}><X size={20} aria-hidden="true" /></button>
      </header>
      <div className="table-editor__toolbar">
        <button type="button" onClick={() => { if (resize(data.rows.length + 1, width)) focusCell(data.rows.length, 0) }}><Rows3 size={16} aria-hidden="true" /><Plus size={13} aria-hidden="true" />{t('Add row')}</button>
        <button type="button" onClick={() => { if (resize(data.rows.length, width + 1)) focusCell(0, width) }}><Columns3 size={16} aria-hidden="true" /><Plus size={13} aria-hidden="true" />{t('Add column')}</button>
        <span>{t('{rows} rows · {columns} columns', { rows: data.rows.length, columns: width })}</span>
      </div>
      <div className="table-editor__scroll">
        <table ref={gridRef} aria-label={t('Table cells')}>
          <thead><tr><th className="table-editor__row-label" aria-label={t('Row')} />{data.alignments.map((alignment, column) => <th key={column} scope="col">
            <div className="table-editor__column">
              <span>{t('Column {number}', { number: column + 1 })}</span>
              <button type="button" className="table-icon-button" disabled={width === 1} aria-label={t('Delete column {number}', { number: column + 1 })} onClick={() => {
                setData((current) => ({ rows: current.rows.map((row) => row.filter((_, x) => x !== column)), alignments: current.alignments.filter((_, x) => x !== column) }))
                focusCell(0, Math.min(column, width - 2))
              }}><Trash2 size={15} aria-hidden="true" /></button>
            </div>
            <select aria-label={t('Alignment for column {number}', { number: column + 1 })} value={alignment} onChange={(event) => {
              const next = event.target.value as TableAlignment
              setData((current) => ({ ...current, alignments: current.alignments.map((value, x) => x === column ? next : value) }))
            }}>
              <option value="">{t('Default alignment')}</option><option value="left">{t('Align left')}</option><option value="center">{t('Align center')}</option><option value="right">{t('Align right')}</option>
            </select>
          </th>)}<th className="table-editor__row-actions" /></tr></thead>
          <tbody>{data.rows.map((row, y) => <tr key={y} className={y === 0 ? 'table-editor__heading-row' : ''}>
            <th scope="row" className="table-editor__row-label">{y === 0 ? t('Header') : y}</th>
            {row.map((cell, x) => <td key={x}><textarea
              data-cell={`${y}-${x}`}
              aria-label={y === 0 ? t('Header, column {column}', { column: x + 1 }) : t('Row {row}, column {column}', { row: y, column: x + 1 })}
              rows={Math.min(5, Math.max(1, cell.split('\n').length))}
              value={cell}
              style={{ textAlign: data.alignments[x] || 'left' }}
              onChange={(event) => {
                const value = event.target.value
                setData((current) => ({ ...current, rows: current.rows.map((values, index) => index === y ? values.map((text, column) => column === x ? value : text) : values) }))
              }}
              onKeyDown={(event) => navigate(event, y, x)}
              onPaste={(event) => paste(event, y, x)}
            /></td>)}
            <td className="table-editor__row-actions">{y > 0 ? <button type="button" className="table-icon-button" aria-label={t('Delete row {number}', { number: y })} onClick={() => {
              setData((current) => ({ ...current, rows: current.rows.filter((_, index) => index !== y) }))
              focusCell(Math.min(y, data.rows.length - 2), 0)
            }}><Trash2 size={15} aria-hidden="true" /></button> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {message ? <p className="table-editor__error" role="alert">{message}</p> : null}
      <footer className="table-editor__footer">
        <p>{t('Tab: next cell · Enter: next row · Shift+Enter: new line')}</p>
        <div><button type="button" onClick={onClose}>{t('Cancel')}</button><button type="button" className="table-editor__apply" onClick={() => {
          if (!onApply(data)) setMessage(t('The document changed. Close this table and reopen it before applying changes.'))
        }}>{t(existing ? 'Apply changes' : 'Insert table')}</button></div>
      </footer>
    </section>
  </Modal>
}
