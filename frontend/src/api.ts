import type { ExportStyleName, TextStats, ThemeName } from './types'
import { translate } from './i18n'

async function parseError(response: Response) {
  try {
    const body = await response.json()
    return body.detail || translate('The server could not process the request')
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

export async function exportDocument(format: 'pdf' | 'docx', markdown: string, theme: ThemeName, style: ExportStyleName) {
  const response = await fetch(`/api/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, theme, style }),
  })
  if (!response.ok) throw new Error(await parseError(response))
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = decodeURIComponent(utf8Name || plainName || `document.${format}`)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
