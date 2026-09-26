import { markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import DOMPurify from 'dompurify'

export type TableAlignment = '' | 'left' | 'center' | 'right'
export interface TableData {
  rows: string[][]
  alignments: TableAlignment[]
}

export interface TableEdit {
  from: number
  to: number
  source: string
  prefix: string
  continuation: string
  existing: boolean
  data: TableData
}

export const MAX_TABLE_CELLS = 5000
export const TABLE_SIZE_ERROR = 'This table is too large for the table editor. Use the source editor for tables over 5,000 cells.'

export function tableAtPosition(state: EditorState, position: number): TableEdit | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? markdownLanguage.parser.parse(state.doc.toString())
  let node = tree.resolveInner(position, 1)
  while (node.name !== 'Table' && node.parent) node = node.parent
  if (node.name !== 'Table') {
    const line = state.doc.lineAt(position)
    tree.iterate({ from: line.from, to: line.to, enter(entry) {
      if (entry.name === 'Table') { node = entry.node; return false }
    } })
  }
  if (node.name !== 'Table') return null

  const separator = node.getChild('TableDelimiter')!
  const rowNodes = [node.getChild('TableHeader')!, ...node.getChildren('TableRow')]
  const rows = rowNodes.map((row) => {
    const delimiters = row.getChildren('TableDelimiter')
    let from = row.from
    const cells: string[] = []
    for (const delimiter of delimiters) {
      if (delimiter.from !== row.from) cells.push(state.doc.sliceString(from, delimiter.from).trim())
      from = delimiter.to
    }
    if (from !== row.to) cells.push(state.doc.sliceString(from, row.to).trim())
    return cells.map((cell) => cell.replace(/<br\s*\/?>/gi, '\n'))
  })
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  if (width * rows.length > MAX_TABLE_CELLS) throw new Error(TABLE_SIZE_ERROR)
  const markers = state.doc.sliceString(separator.from, separator.to).trim().replace(/^\||\|$/g, '').split('|')
  const alignments: TableAlignment[] = Array.from({ length: width }, (_, column) => {
    const marker = markers[column]?.trim() ?? ''
    return marker.startsWith(':') ? (marker.endsWith(':') ? 'center' : 'left') : marker.endsWith(':') ? 'right' : ''
  })
  return {
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(node.to).to,
    source: state.doc.toString(),
    prefix: state.doc.sliceString(state.doc.lineAt(node.from).from, node.from),
    continuation: state.doc.sliceString(state.doc.lineAt(separator.from).from, separator.from),
    existing: true,
    data: { rows: rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? '')), alignments },
  }
}

export function tableMarkdown(data: TableData, prefix = '', continuation = ''): string {
  const cellText = (cell: string) => cell.trim().replace(/\r\n?|\n/g, '<br>').replace(/(\\*)\|/g,
    (match, slashes: string) => slashes.length % 2 ? match : `${slashes}\\|`,
  )
  const rows = data.rows.map((row) => `| ${row.map(cellText).join(' | ')} |`)
  const separators = data.alignments.map((alignment) => ({ '': '---', left: ':---', center: ':---:', right: '---:' })[alignment])
  rows.splice(1, 0, `| ${separators.join(' | ')} |`)
  return rows.map((row, index) => `${index ? continuation : prefix}${row}`).join('\n')
}

export function clipboardTable(clipboard: Pick<DataTransfer, 'getData'>): string[][] | null {
  const html = clipboard.getData('text/html')
  if (html) {
    const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true })
    const table = fragment.querySelector('table')
    if (table) {
      const rows = Array.from(table.rows).filter((row) => row.closest('table') === table).map((row) =>
        Array.from(row.cells, (cell) => {
          if (cell.colSpan !== 1 || cell.rowSpan !== 1) throw new Error('Unmerge the spreadsheet cells before pasting them here.')
          cell.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
          return cell.textContent?.trim() ?? ''
        }),
      )
      return rectangularTable(rows)
    }
  }
  const text = clipboard.getData('text/plain').replace(/\r\n?/g, '\n')
  if (!text.includes('\t')) return null
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '"' && (quoted || !cell)) {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++ }
      else quoted = !quoted
    } else if (!quoted && (character === '\t' || character === '\n')) {
      rows[rows.length - 1].push(cell)
      cell = ''
      if (character === '\n') rows.push([])
    } else cell += character
  }
  if (quoted) throw new Error('Could not read the pasted table. Try copying the cells again.')
  rows[rows.length - 1].push(cell)
  if (text.endsWith('\n') && rows.at(-1)?.length === 1 && !cell) rows.pop()
  return rectangularTable(rows)
}

function rectangularTable(rows: string[][]): string[][] | null {
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  if (!width) return null
  if (width * rows.length > MAX_TABLE_CELLS) throw new Error(TABLE_SIZE_ERROR)
  return rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ''))
}
