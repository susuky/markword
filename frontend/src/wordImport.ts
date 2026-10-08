import DOMPurify from 'dompurify'
import { zipSync } from 'fflate'
import mammoth from 'mammoth'
import { assetMarkdownUrl, importLocalAssets } from './assets'
import { htmlToMarkdown } from './htmlToMarkdown'
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
  return {
    markdown,
    hasWarnings: result.messages.length > 0 || Boolean(body.querySelector('[colspan], [rowspan]')),
  }
}
