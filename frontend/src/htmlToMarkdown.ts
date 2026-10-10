import TurndownService from 'turndown'

export function htmlToMarkdown(body: HTMLElement | DocumentFragment, literalText = false): string {
  const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' })
  if (literalText) {
    const escape = converter.escape.bind(converter)
    converter.escape = (text) => escape(text).replace(/[$~]/g, '\\$&')
  }
  converter.addRule('strikethrough', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  })
  converter.addRule('taskCheckbox', {
    filter: (node) => node.nodeName === 'INPUT' && (node as HTMLInputElement).type === 'checkbox',
    replacement: (_content, node) => (node as HTMLInputElement).checked ? '[x] ' : '[ ] ',
  })
  converter.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows, (row) =>
        Array.from(row.cells, (cell) => converter.turndown(cell.innerHTML).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|')),
      )
      if (!rows.length) return ''
      const columns = Math.max(...rows.map((row) => row.length))
      const lines = rows.map((row) => `| ${Array.from({ length: columns }, (_, index) => row[index] || '').join(' | ')} |`)
      // Markdown tables use the first row as column headings.
      lines.splice(1, 0, `| ${Array(columns).fill('---').join(' | ')} |`)
      return `\n\n${lines.join('\n')}\n\n`
    },
  })
  return converter.turndown(body)
}
