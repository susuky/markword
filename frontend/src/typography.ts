export interface PreviewTypography {
  markdownFontSize: number
  mermaidFontSize: number
}

export const MARKDOWN_FONT_SIZE_RANGE = [13, 36] as const
export const MERMAID_FONT_SIZE_RANGE = [10, 48] as const

export const DEFAULT_PREVIEW_TYPOGRAPHY: PreviewTypography = {
  markdownFontSize: 16,
  mermaidFontSize: 14,
}

function normalizeFontSize(value: unknown, fallback: number, range: readonly [number, number]) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range[1], Math.max(range[0], Math.round(value)))
}

export function normalizePreviewTypography(value: unknown): PreviewTypography {
  const preference = typeof value === 'object' && value !== null ? value as Partial<PreviewTypography> : {}
  return {
    markdownFontSize: normalizeFontSize(
      preference.markdownFontSize,
      DEFAULT_PREVIEW_TYPOGRAPHY.markdownFontSize,
      MARKDOWN_FONT_SIZE_RANGE,
    ),
    mermaidFontSize: normalizeFontSize(
      preference.mermaidFontSize,
      DEFAULT_PREVIEW_TYPOGRAPHY.mermaidFontSize,
      MERMAID_FONT_SIZE_RANGE,
    ),
  }
}
