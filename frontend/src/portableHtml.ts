import { exportPageCss, type ExportSettings } from './exportSettings'
import { EXPORT_STYLES, THEME_META } from './themeConfig'
import type { DocumentMode, ExportStyleName, ThemeName } from './types'
import type { Locale } from './i18n'
import toggleCss from './toggleStyles.css?raw'

export function portableHtml(markdown: string, mode: DocumentMode, theme: ThemeName, exportStyle: ExportStyleName, locale: Locale, renderedHtml: string, mathCss: string, title: string, settings: ExportSettings) {
  const colors = THEME_META[theme]
  const safeTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const source = JSON.stringify({ version: 1, mode, markdown }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="${locale === 'zh-TW' ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>
:root{color-scheme:${colors.dark ? 'dark' : 'light'}}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.78}.document{width:min(100% - 40px,880px);margin:auto;padding:48px 0 80px}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:2.25rem}h2{font-size:1.55rem;margin-top:1.5em}h3{font-size:1.2rem;margin-top:1.4em}a{color:${colors.accent}}code{background:${colors.code};padding:.14em .35em;border-radius:4px}pre{overflow:auto;background:${colors.code};border:1px solid ${colors.border};border-radius:8px;padding:16px}pre code{padding:0}.copy-code,.mermaid-loading{display:none}.mermaid-fallback{display:block}.mermaid-block{border:1px solid ${colors.border};border-radius:8px;padding:16px}blockquote{margin:1.2em 0;padding:.6em 1em;border-left:3px solid ${colors.accent};color:${colors.muted};background:${colors.code}}table{width:100%;border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:8px 11px;text-align:left}th{background:${colors.code}}img,svg,video{max-width:100%;height:auto}audio{width:100%}.local-media{margin:1.25em 0}.local-media figcaption{margin-top:.4em;color:${colors.muted};font-size:.82em}@media print{.document{width:auto;padding:0}}
</style><style>${EXPORT_STYLES[exportStyle].css}</style><style>${toggleCss}</style><style>${mathCss}</style><style>${exportPageCss(settings)}</style></head><body><main class="document">${renderedHtml}</main><script type="application/json" id="markword-source">${source}</script></body></html>`
}
