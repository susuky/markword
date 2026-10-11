import type { ExportStyleName, TextStats, ThemeName } from './types'
import { translate } from './i18n'
import { inlineLocalImagesForExport } from './assets'
import type { ExportSettings } from './exportSettings'

async function parseError(response: Response) {
  try {
    const body = await response.json()
    return typeof body.detail === 'string' ? translate(body.detail) : translate('The server could not process the request')
  } catch {
    return translate('The server could not process the request')
  }
}

export async function analyzeText(text: string, signal?: AbortSignal): Promise<TextStats> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json()
}

export async function exportDocument(format: 'pdf' | 'docx', markdown: string, theme: ThemeName, style: ExportStyleName, settings: ExportSettings, name: string) {
  const source = await inlineLocalImagesForExport(markdown)
  const response = await fetch(`/api/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: source, theme, ...(format === 'pdf' ? { style } : {}), page_size: settings.pageSize, margin_mm: settings.marginMm, font_size: settings.fontSize }),
  })
  if (!response.ok) throw new Error(await parseError(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}
