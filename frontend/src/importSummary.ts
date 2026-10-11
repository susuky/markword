export interface ImportWarning {
  message: string
  count: number
  details?: string[]
}

export interface ImportSummary {
  fileName: string
  restoredSource: boolean
  warnings: ImportWarning[]
}

export function readImportSummary(value: unknown): ImportSummary | null {
  if (typeof value !== 'string' || value.length > 30_000) return null
  try {
    const summary = JSON.parse(value) as ImportSummary
    if (!summary || typeof summary.fileName !== 'string' || summary.fileName.length > 255
      || typeof summary.restoredSource !== 'boolean' || !Array.isArray(summary.warnings) || summary.warnings.length > 8
      || !summary.warnings.every((warning) => warning && typeof warning.message === 'string' && warning.message.length <= 300
        && Number.isSafeInteger(warning.count) && warning.count >= 0
        && (warning.details === undefined || (Array.isArray(warning.details) && warning.details.length <= 20
          && warning.details.every((detail) => typeof detail === 'string' && detail.length <= 200))))) return null
    return summary
  } catch { return null }
}

export function countMergedCells(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLTableCellElement>('td[colspan], th[colspan], td[rowspan], th[rowspan]'))
    .filter((cell) => cell.colSpan > 1 || cell.rowSpan !== 1).length
}
