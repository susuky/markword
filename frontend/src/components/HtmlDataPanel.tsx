import { Database, X } from 'lucide-react'
import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { parseHtmlData, updateHtmlData, type HtmlDataField, type HtmlDataValue } from '../htmlData'
import { useI18n } from '../i18n'

function DataField({ field, label, onChange }: { field: HtmlDataField; label: string; onChange: (value: HtmlDataValue) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(field.value === null ? '' : String(field.value))
  const [error, setError] = useState(false)
  const type = field.value === null ? 'null' : typeof field.value
  const commit = () => {
    const value = type === 'number' ? Number(draft) : draft
    if (type === 'number' && (!draft.trim() || !Number.isFinite(value))) { setError(true); return }
    setError(false)
    if (!Object.is(value, field.value)) onChange(value)
  }
  const inputProps = {
    'aria-label': label,
    'aria-invalid': error || undefined,
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(event.target.value); setError(false) },
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { setDraft(String(field.value)); setError(false); event.stopPropagation() }
    },
  }
  return <div className="html-data-field">
    <div className="html-data-field-label">
      {field.recordLabel && <span className="html-data-record">{field.recordLabel}</span>}
      <span className="html-data-path">{field.label}</span>
    </div>
    <div className="html-data-value">
      {type === 'boolean'
        ? <input type="checkbox" aria-label={label} checked={field.value === true} onChange={(event) => onChange(event.target.checked)} />
        : type === 'null' ? <span className="html-data-empty">{t('Empty')}</span>
          : type === 'number' ? <input type="number" step="any" {...inputProps} />
            : <textarea rows={draft.includes('\n') ? 3 : 1} {...inputProps} />}
      <select aria-label={`${label} · ${t('Value type')}`} value={type} onChange={(event) => {
        const nextType = event.target.value
        const number = Number(field.value)
        const value = nextType === 'null' ? null : nextType === 'boolean' ? false : nextType === 'number' ? Number.isFinite(number) ? number : 0 : field.value === null ? '' : String(field.value)
        onChange(value)
      }}>
        <option value="string">{t('Text')}</option>
        <option value="number">{t('Number')}</option>
        <option value="boolean">{t('Boolean')}</option>
        <option value="null">{t('Empty')}</option>
      </select>
    </div>
    {error && <span className="html-data-error" role="alert">{t('Enter a valid number.')}</span>}
  </div>
}

export function HtmlDataPanel({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const blocks = useMemo(() => parseHtmlData(value), [value])
  const query = search.trim().toLocaleLowerCase()
  const visible = blocks.map((block) => ({ ...block, fields: block.fields.filter((field) => `${block.label} ${field.label} ${field.recordLabel} ${String(field.value)}`.toLocaleLowerCase().includes(query)) })).filter((block) => block.fields.length)
  return <aside className="html-data-panel html-block-settings" aria-label={t('Page data')}>
    <header><Database size={16} aria-hidden="true" /><strong>{t('Page data')}</strong><button type="button" aria-label={t('Close page data')} onClick={onClose}><X size={17} aria-hidden="true" /></button></header>
    <div className="html-data-search"><input type="search" aria-label={t('Search data')} placeholder={t('Search data')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="html-data-fields">
      {visible.map((block) => <section className="html-data-block" key={block.index}>
        <h3>{block.label || t('Data {number}', { number: block.index + 1 })}</h3>
        {block.fields.map((field) => <DataField key={`${JSON.stringify(field.path)}:${JSON.stringify(field.value)}`} field={field} label={`${block.label || t('Data {number}', { number: block.index + 1 })} · ${field.label}`} onChange={(next) => {
          const result = updateHtmlData(value, block.index, field.path, next)
          if (result !== value) onChange(result)
        }} />)}
      </section>)}
      {!visible.length && <p className="html-data-empty">{t(blocks.some((block) => block.fields.length) ? 'No matching data.' : 'No editable data found.')}</p>}
    </div>
  </aside>
}
