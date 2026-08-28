import { RotateCcw } from 'lucide-react'
import { memo } from 'react'
import { useI18n } from '../i18n'

interface FontSizeMenuProps {
  markdownSize: number
  mermaidSize: number
  markdownRange: readonly [number, number]
  mermaidRange: readonly [number, number]
  markdownDefault: number
  mermaidDefault: number
  onMarkdownSizeChange: (size: number) => void
  onMermaidSizeChange: (size: number) => void
  onReset: () => void
}

interface FontSizeControlProps {
  id: string
  label: string
  description: string
  value: number
  range: readonly [number, number]
  onChange: (size: number) => void
}

function FontSizeControl({ id, label, description, value, range, onChange }: FontSizeControlProps) {
  return (
    <div className="font-size-control">
      <div className="font-size-control__heading">
        <label htmlFor={id}><strong>{label}</strong><small>{description}</small></label>
        <output htmlFor={id}>{value} px</output>
      </div>
      <input
        id={id}
        type="range"
        min={range[0]}
        max={range[1]}
        step="1"
        value={value}
        aria-valuetext={`${value} px`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="font-size-control__range" aria-hidden="true"><span>{range[0]} px</span><span>{range[1]} px</span></div>
    </div>
  )
}

function FontSizeMenuComponent({
  markdownSize,
  mermaidSize,
  markdownRange,
  mermaidRange,
  markdownDefault,
  mermaidDefault,
  onMarkdownSizeChange,
  onMermaidSizeChange,
  onReset,
}: FontSizeMenuProps) {
  const { t } = useI18n()
  const isDefault = markdownSize === markdownDefault && mermaidSize === mermaidDefault

  return (
    <section className="font-size-menu" role="dialog" aria-labelledby="font-size-menu-title">
      <div className="menu-heading">
        <strong id="font-size-menu-title">{t('Font size')}</strong>
        <span>{t('Changes appear immediately in preview')}</span>
      </div>
      <div className="font-size-menu__controls">
        <FontSizeControl
          id="markdown-font-size"
          label={t('Markdown preview')}
          description={t('Body text, headings, lists, and code blocks')}
          value={markdownSize}
          range={markdownRange}
          onChange={onMarkdownSizeChange}
        />
        <FontSizeControl
          id="mermaid-font-size"
          label={t('Mermaid diagrams')}
          description={t('Nodes and connector labels')}
          value={mermaidSize}
          range={mermaidRange}
          onChange={onMermaidSizeChange}
        />
      </div>
      <button className="font-size-menu__reset" type="button" disabled={isDefault} onClick={onReset}>
        <RotateCcw size={14} />{t('Reset font sizes')}
      </button>
    </section>
  )
}

export const FontSizeMenu = memo(FontSizeMenuComponent)
