import { htmlLanguage } from '@codemirror/lang-html'

export type HtmlDataValue = string | number | boolean | null
type JsonValue = HtmlDataValue | JsonValue[] | { [key: string]: JsonValue }
export type HtmlDataPath = (string | number)[]
export type HtmlDataField = { path: HtmlDataPath; label: string; recordLabel: string; value: HtmlDataValue }
export type HtmlDataBlock = { index: number; label: string; from: number; to: number; data: JsonValue; fields: HtmlDataField[] }

function pathLabel(path: HtmlDataPath) {
  return path.reduce<string>((label, part) => typeof part === 'number' ? `${label}[${part}]`
    : /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(part) ? `${label}${label ? '.' : ''}${part}` : `${label}[${JSON.stringify(part)}]`, '') || '$'
}

function collectFields(data: JsonValue, path: HtmlDataPath = [], recordLabel = '', fields: HtmlDataField[] = []): HtmlDataField[] {
  if (data === null || typeof data !== 'object') {
    fields.push({ path, label: pathLabel(path), recordLabel, value: data })
  } else if (Array.isArray(data)) {
    data.forEach((value, index) => collectFields(value, [...path, index], recordLabel, fields))
  } else {
    const entries = Object.entries(data)
    const record = ['name', 'title', 'label', 'id', 'code'].map((key) => entries.find(([name, value]) => name.toLowerCase() === key && (typeof value === 'string' || typeof value === 'number'))).find(Boolean)
    const label = record ? String(record[1]) : recordLabel
    entries.forEach(([key, value]) => collectFields(value, [...path, key], label, fields))
  }
  return fields
}

export function parseHtmlData(source: string): HtmlDataBlock[] {
  const blocks: HtmlDataBlock[] = []
  let index = 0
  htmlLanguage.parser.parse(source).iterate({ enter(node) {
    if (node.name !== 'Element') return
    const opening = node.node.getChild('OpenTag')
    const tag = opening?.getChild('TagName')
    if (!opening || !tag || source.slice(tag.from, tag.to).toLowerCase() !== 'script') return
    const closing = node.node.getChild('CloseTag')
    if (!closing) return false
    const script = new DOMParser().parseFromString(`${source.slice(opening.from, opening.to)}</script>`, 'text/html').querySelector('script')
    if (script?.getAttribute('type')?.trim().toLowerCase() !== 'application/json') return false
    const blockIndex = index++
    try {
      const data = JSON.parse(source.slice(opening.to, closing.from)) as JsonValue
      blocks.push({ index: blockIndex, label: script.id, from: opening.to, to: closing.from, data, fields: collectFields(data) })
    } catch { /* Invalid JSON remains untouched in the source. */ }
    return false
  } })
  return blocks
}

export function updateHtmlData(source: string, blockIndex: number, path: HtmlDataPath, value: HtmlDataValue): string {
  const block = parseHtmlData(source).find((item) => item.index === blockIndex)
  if (!block || (typeof value === 'number' && !Number.isFinite(value))) return source
  let current = block.data
  for (const key of path.slice(0, -1)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return source
    current = (current as Record<string | number, JsonValue>)[key]
  }
  if (!path.length) {
    if (Object.is(block.data, value)) return source
    block.data = value
  } else {
    const key = path[path.length - 1]
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return source
    const record = current as Record<string | number, JsonValue>
    if (Object.is(record[key], value)) return source
    record[key] = value
  }
  const json = JSON.stringify(block.data, null, 2).replaceAll('<', '\\u003c')
  return source.slice(0, block.from) + json + source.slice(block.to)
}
