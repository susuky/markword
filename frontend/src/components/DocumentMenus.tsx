import { Archive, Check, ChevronDown, Code2, Download, FileDown, FileText, Palette, Type } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { IS_STATIC_DEPLOYMENT } from '../deployment'
import { useI18n } from '../i18n'
import { EXPORT_STYLES, THEME_META, THEMES } from '../themeConfig'
import { DEFAULT_PREVIEW_TYPOGRAPHY, MARKDOWN_FONT_SIZE_RANGE, MERMAID_FONT_SIZE_RANGE } from '../typography'
import type { ExportStyleName, ThemeName } from '../types'
import { FontSizeMenu } from './FontSizeMenu'

function ToolbarMenu({ label, trigger, children, disabled = false, primary = false }: {
  label: string
  trigger: ReactNode
  children: (close: () => void) => ReactNode
  disabled?: boolean
  primary?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="menu-wrap" ref={rootRef} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
    }}>
      <button ref={triggerRef} className={`toolbar-button ${primary ? 'export-trigger' : ''} ${open ? 'is-active' : ''}`} type="button" aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)}>
        {trigger}<ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? children(() => { setOpen(false); triggerRef.current?.focus() }) : null}
    </div>
  )
}

export function PreviewSettings({ theme, onThemeChange, markdownSize, mermaidSize, onMarkdownSizeChange, onMermaidSizeChange, onReset }: {
  theme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  markdownSize: number
  mermaidSize: number
  onMarkdownSizeChange: (size: number) => void
  onMermaidSizeChange: (size: number) => void
  onReset: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      <ToolbarMenu label={t('Preview theme: {theme}', { theme: t(THEME_META[theme].label) })} trigger={<><Palette size={16} aria-hidden="true" /><span>{t(THEME_META[theme].label)}</span></>}>
        {(close) => <div className="theme-menu" role="dialog" aria-label={t('Preview theme')}>
          <div className="menu-heading"><strong>{t('Preview theme')}</strong><span>{t('Also applied to exported documents')}</span></div>
          <div className="theme-menu__grid">{THEMES.map((name) => {
            const meta = THEME_META[name]
            return <button key={name} type="button" className={name === theme ? 'is-selected' : ''} aria-pressed={name === theme} onClick={() => { onThemeChange(name); close() }}>
              <span className="theme-palette" aria-hidden="true" style={{ '--swatch-bg': meta.background, '--swatch-code': meta.code, '--swatch-accent': meta.accent } as CSSProperties} />
              <span className="theme-option-copy"><strong>{t(meta.label)}</strong><small>{t(meta.description)}</small></span>
              {name === theme ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          })}</div>
        </div>}
      </ToolbarMenu>
      <ToolbarMenu label={t('Font size settings')} trigger={<><Type size={17} aria-hidden="true" /><span className="font-size-label">{t('Font size')}</span></>}>
        {() => <FontSizeMenu markdownSize={markdownSize} mermaidSize={mermaidSize} markdownRange={MARKDOWN_FONT_SIZE_RANGE} mermaidRange={MERMAID_FONT_SIZE_RANGE} markdownDefault={DEFAULT_PREVIEW_TYPOGRAPHY.markdownFontSize} mermaidDefault={DEFAULT_PREVIEW_TYPOGRAPHY.mermaidFontSize} onMarkdownSizeChange={onMarkdownSizeChange} onMermaidSizeChange={onMermaidSizeChange} onReset={onReset} />}
      </ToolbarMenu>
    </>
  )
}

export function ExportMenu({ disabled, exporting, clientExporting, exportStyle, onStyleChange, hasAssets, onMarkdown, onProject, onHtml, onExport }: {
  disabled: boolean
  exporting: 'pdf' | 'docx' | null
  clientExporting: 'html' | 'project' | null
  exportStyle: ExportStyleName
  onStyleChange: (style: ExportStyleName) => void
  hasAssets: boolean
  onMarkdown: () => void
  onProject: () => void
  onHtml: () => void
  onExport: (format: 'pdf' | 'docx') => void
}) {
  const { t } = useI18n()
  const busy = Boolean(exporting || clientExporting)
  return (
    <ToolbarMenu primary disabled={disabled || busy} label={t(busy ? 'Preparing download…' : 'Export')} trigger={<><Download size={17} aria-hidden="true" /><span>{t(busy ? 'Preparing download…' : 'Export')}</span></>}>
      {(close) => <div className="export-menu" role="dialog" aria-label={t('Download and export')}>
        <div className="menu-heading"><strong>{t('Download and export')}</strong><span>{t('Choose a layout, then select an output format')}</span></div>
        <div className="export-style-picker">
          <span>{t('Document layout')}</span>
          <div>{(Object.keys(EXPORT_STYLES) as ExportStyleName[]).map((name) => <button key={name} type="button" className={name === exportStyle ? 'is-selected' : ''} aria-pressed={name === exportStyle} onClick={() => onStyleChange(name)}>
            <strong>{t(EXPORT_STYLES[name].label)}</strong><small>{t(EXPORT_STYLES[name].description)}</small>
          </button>)}</div>
        </div>
        <div className="export-menu__section">
          <span>{t('Source and web')}</span>
          <button type="button" onClick={() => { close(); onMarkdown() }}><FileDown size={18} aria-hidden="true" /><span><strong>Markdown</strong><small>{t('Keep the editable source')}</small></span></button>
          <button type="button" onClick={() => { close(); onProject() }}><Archive size={18} aria-hidden="true" /><span><strong>{t('Project ZIP')}</strong><small>{t('Markdown and all local assets')}</small></span></button>
          <button type="button" onClick={() => { close(); onHtml() }}><Code2 size={18} aria-hidden="true" /><span><strong>{t('Portable HTML')}</strong><small>{t('Embeds the {style} layout and local assets', { style: t(EXPORT_STYLES[exportStyle].label) })}</small></span></button>
        </div>
        <div className="export-menu__section">
          <span>{t('Document formats')}</span>
          <button type="button" disabled={IS_STATIC_DEPLOYMENT} onClick={() => { close(); onExport('pdf') }}><Download size={18} aria-hidden="true" /><span><strong>PDF</strong><small>{IS_STATIC_DEPLOYMENT ? t('Not available here. Download HTML and print to PDF.') : hasAssets ? t('Local assets are not included; use portable HTML') : t('Uses the {style} print layout', { style: t(EXPORT_STYLES[exportStyle].label) })}</small></span></button>
          <button type="button" disabled={IS_STATIC_DEPLOYMENT} onClick={() => { close(); onExport('docx') }}><FileText size={18} aria-hidden="true" /><span><strong>Word</strong><small>{IS_STATIC_DEPLOYMENT ? t('Word export is not available in this edition.') : hasAssets ? t('Local assets are not included; use portable HTML') : t('Uses the current palette and remains editable')}</small></span></button>
        </div>
      </div>}
    </ToolbarMenu>
  )
}
