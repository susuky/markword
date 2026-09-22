import type { DocumentMode } from './types'

export const DOCUMENT_MODES = {
  markdown: { label: 'Markdown', extension: 'md', mime: 'text/markdown' },
  text: { label: 'Plain text', extension: 'txt', mime: 'text/plain' },
  mermaid: { label: 'Mermaid', extension: 'mmd', mime: 'text/plain' },
} as const

export function normalizeDocumentMode(value: unknown): DocumentMode {
  return value === 'text' || value === 'mermaid' ? value : 'markdown'
}

export function documentAsMarkdown(source: string, mode: DocumentMode) {
  if (mode === 'markdown') return source
  let fenceLength = 3
  for (const match of source.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1)
  const fence = '`'.repeat(fenceLength)
  return `${fence}${mode === 'mermaid' ? 'mermaid' : 'text'}\n${source}\n${fence}`
}
