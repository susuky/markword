import DOMPurify from 'dompurify'
import { zipSync } from 'fflate'
import mammoth from 'mammoth'
import { assetMarkdownUrl, importLocalAssets } from './assets'
import { htmlToMarkdown } from './htmlToMarkdown'
import { countMergedCells, type ImportWarning } from './importSummary'
import { unzipBounded } from './zip'

export async function importWordDocument(file: File) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Word file exceeds 15 MiB')
  const entries = await unzipBounded(new Uint8Array(await file.arrayBuffer()), {
    maxTotalBytes: 50_000_000,
    maxEntryBytes: 50_000_000,
    maxEntries: 2000,
  })
  // Mammoth uses a different ZIP parser. Give it only verified, stored bytes so
  // inconsistent headers cannot bypass the expansion budget on a second pass.
  const arrayBuffer = zipSync(entries, { level: 0 }).buffer

  const images: File[] = []
  const imagePrefix = `word-import-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Quote'] => blockquote:fresh", 'strike => del'],
    convertImage: mammoth.images.imgElement(async (image) => {
      const buffer = await image.readAsArrayBuffer()
      const index = images.length
      const extension = image.contentType.split('/')[1]?.replace('+xml', '') || 'bin'
      images.push(new File([buffer], `${file.name.replace(/\.docx$/i, '')}-image-${index + 1}.${extension}`, { type: image.contentType }))
      return { src: `${imagePrefix}-${index}` }
    }),
  })
  if (result.messages.some((message) => message.type === 'error')) throw new Error('Word conversion failed')

  // Never attach Word-generated HTML to the live document.
  const body = DOMPurify.sanitize(result.value, { RETURN_DOM_FRAGMENT: true })
  let markdown = htmlToMarkdown(body)
  if (!markdown.trim()) throw new Error('No convertible Word content')

  const assets = images.length ? await importLocalAssets(images) : []
  assets.forEach((asset, index) => {
    markdown = markdown.replaceAll(`](${imagePrefix}-${index})`, `](${assetMarkdownUrl(asset.path)})`)
  })
  const warnings: ImportWarning[] = []
  const styleMessages = result.messages.filter(({ message }) => /style/i.test(message))
  const imageMessages = result.messages.filter(({ message }) => !/style/i.test(message) && /image|a:blip|v:imagedata/i.test(message))
  if (styleMessages.length) warnings.push({
    message: 'Word style warnings: {count}. Check the formatting of affected paragraphs.',
    count: styleMessages.length,
    details: [...new Set(styleMessages.map(({ message }) => message.match(/^Unrecognised \w+ style: '(.*)' \(Style ID:/)?.[1])
      .filter((style): style is string => Boolean(style)))].slice(0, 20).map((style) => style.slice(0, 200)),
  })
  if (imageMessages.length) warnings.push({
    message: 'Word image warnings: {count}. Some images may be missing or unsupported; compare with the original.',
    count: imageMessages.length,
  })
  const mergedCells = countMergedCells(body)
  if (mergedCells) warnings.push({ message: 'Merged table cells: {count}. The merged layout could not be preserved; check the tables.', count: mergedCells })
  const otherWarnings = result.messages.length - styleMessages.length - imageMessages.length
  if (otherWarnings) warnings.push({ message: 'Other Word conversion warnings: {count}. Compare the content with the original document.', count: otherWarnings })
  return { markdown, warnings }
}
