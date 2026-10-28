export interface TableLayout {
  widths?: number[]
  heights?: number[]
}

export const MIN_TABLE_COLUMN_WIDTH = 48
export const MIN_TABLE_ROW_HEIGHT = 28
export const MAX_TABLE_DIMENSION = 4000

export function parseTableLayout(line: string): TableLayout | null {
  const match = line.trim().match(/^<!--\s*markword-table:\s*(\{.*\})\s*-->$/)
  if (!match) return null
  let value: unknown
  try { value = JSON.parse(match[1]) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const layout = value as Record<string, unknown>
  const valid = (sizes: unknown, minimum: number): sizes is number[] => Array.isArray(sizes) && sizes.length <= 5000
    && sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && (size === 0 || (size >= minimum && size <= MAX_TABLE_DIMENSION)))
  if (layout.widths !== undefined && !valid(layout.widths, MIN_TABLE_COLUMN_WIDTH)) return null
  if (layout.heights !== undefined && !valid(layout.heights, MIN_TABLE_ROW_HEIGHT)) return null
  return {
    ...(layout.widths !== undefined ? { widths: layout.widths as number[] } : {}),
    ...(layout.heights !== undefined ? { heights: layout.heights as number[] } : {}),
  }
}

export function tableLayoutComment(layout: TableLayout): string {
  const sizes: TableLayout = {
    ...(layout.widths?.some(Boolean) ? { widths: layout.widths } : {}),
    ...(layout.heights?.some(Boolean) ? { heights: layout.heights } : {}),
  }
  return Object.keys(sizes).length ? `<!-- markword-table: ${JSON.stringify(sizes)} -->` : ''
}
