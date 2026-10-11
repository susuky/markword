export interface ExportSettings {
  pageSize: 'A4' | 'Letter'
  marginMm: number
  fontSize: number
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { pageSize: 'A4', marginMm: 18, fontSize: 16 }

export function normalizeExportSettings(value: unknown): ExportSettings {
  const settings = value && typeof value === 'object' ? value as Partial<ExportSettings> : {}
  return {
    pageSize: settings.pageSize === 'Letter' ? 'Letter' : 'A4',
    marginMm: typeof settings.marginMm === 'number' && Number.isFinite(settings.marginMm) ? Math.max(10, Math.min(40, settings.marginMm)) : 18,
    fontSize: typeof settings.fontSize === 'number' && Number.isFinite(settings.fontSize) ? Math.max(12, Math.min(24, settings.fontSize)) : 16,
  }
}

export function exportPageCss(settings: ExportSettings) {
  const width = settings.pageSize === 'Letter' ? 215.9 : 210
  return `@page{size:${settings.pageSize};margin:${settings.marginMm}mm}html{font-size:${settings.fontSize}px}.document{font-size:${settings.fontSize}px;max-width:${width - settings.marginMm * 2}mm}@media print{.document{width:auto;max-width:none;padding:0}}`
}
