import type { TextStats, ThemeName } from './types'

async function parseError(response: Response) {
  try {
    const body = await response.json()
    return body.detail || '伺服器暫時無法處理要求'
  } catch {
    return '伺服器暫時無法處理要求'
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

export async function exportDocument(format: 'pdf' | 'docx', markdown: string, theme: ThemeName) {
  const response = await fetch(`/api/export/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, theme }),
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
