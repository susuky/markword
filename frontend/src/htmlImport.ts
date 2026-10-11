import DOMPurify from 'dompurify'
import { assetMarkdownUrl, importLocalAssets, normalizeAssetPath, referencedAssetPaths, remapAssetPaths } from './assets'
import { htmlToMarkdown } from './htmlToMarkdown'
import { countMergedCells, type ImportWarning } from './importSummary'
import type { DocumentMode } from './types'

const MAX_HTML_BYTES = 15 * 1024 * 1024

async function embeddedFile(url: string, name: string): Promise<File> {
  if (!/^data:/i.test(url)) throw new Error('HTML attachment is not embedded')
  const blob = await (await fetch(url)).blob()
  if (blob.size > MAX_HTML_BYTES) throw new Error('HTML attachment exceeds the import limit')
  return new File([blob], name, { type: blob.type })
}

export async function importHtmlDocument(file: File) {
  if (file.size > MAX_HTML_BYTES) throw new Error('HTML file exceeds 15 MiB')
  // Parse in an inert document; neither the original nor sanitized HTML enters
  // the live page. Saved source is data, never evaluated as JavaScript.
  const document = new DOMParser().parseFromString(await file.text(), 'text/html')
  const saved = document.querySelector('script#markword-source[type="application/json"]')
  const body = DOMPurify.sanitize(document.body, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style', 'srcset'],
    ADD_DATA_URI_TAGS: ['a'],
  })
  if (saved) {
    const source = JSON.parse(saved.textContent || '') as { version?: unknown; markdown?: unknown; mode?: unknown }
    if (source?.version !== 1 || typeof source.markdown !== 'string' || typeof source.mode !== 'string' || !['markdown', 'text', 'mermaid'].includes(source.mode)) {
      throw new Error('Invalid saved HTML document')
    }
    const mode = source.mode as DocumentMode
    const paths = mode === 'markdown' ? referencedAssetPaths(source.markdown) : new Set<string>()
    if (paths.size > 2000) throw new Error('Too many HTML attachments')
    const embedded = new Map<string, string>()
    body.querySelectorAll<HTMLElement>('[data-markword-asset-path]').forEach((element) => {
      const path = normalizeAssetPath(element.dataset.markwordAssetPath)
      const url = element.getAttribute(element.tagName === 'A' ? 'href' : 'src')
      if (path && paths.has(path) && url && /^data:/i.test(url) && !embedded.has(path)) embedded.set(path, url)
    })
    const files: File[] = []
    for (const path of paths) {
      const url = embedded.get(path)
      if (!url) throw new Error('Saved HTML attachment is missing')
      files.push(await embeddedFile(url, path.split('/').at(-1)!))
    }
    const assets = files.length ? await importLocalAssets(files) : []
    const replacements = new Map([...paths].map((path, index) => [path, assets[index].path]))
    return { markdown: remapAssetPaths(source.markdown, replacements), mode, restoredSource: true, warnings: [] as ImportWarning[] }
  }

  const images = Array.from(body.querySelectorAll('img'))
  if (images.length > 2000) throw new Error('Too many HTML images')
  const files: File[] = []
  const prefix = `html-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const warnings: ImportWarning[] = []
  if (document.querySelector('style, [style]')) warnings.push({ message: 'Page layout and styles do not carry over to Markdown. Check headings, spacing, and emphasis.', count: 1 })
  const mergedCells = countMergedCells(body)
  if (mergedCells) warnings.push({ message: 'Merged table cells: {count}. The merged layout could not be preserved; check the tables.', count: mergedCells })
  const graphics = document.querySelectorAll('svg, math').length
  if (graphics) warnings.push({ message: 'Diagrams and formulas: {count}. Check that their content was preserved.', count: graphics })
  const interactive = document.querySelectorAll('iframe, object, embed, form').length
  if (interactive) warnings.push({ message: 'Interactive sections not imported: {count}. Check that the document still contains the information you need.', count: interactive })
  const missingImages: string[] = []
  let remoteImages = 0
  for (const image of images) {
    const url = image.getAttribute('src') || ''
    if (/^data:image\//i.test(url)) {
      const index = files.length
      const mime = url.slice(5).split(/[;,]/)[0].toLowerCase()
      const extension = mime.split('/')[1].replace('+xml', '') || 'bin'
      files.push(await embeddedFile(url, `${file.name.replace(/\.html?$/i, '')}-image-${index + 1}.${extension}`))
      image.setAttribute('src', assetMarkdownUrl(`assets/${prefix}-${index}`))
    } else if (/^https?:\/\//i.test(url)) remoteImages++
    else missingImages.push((image.alt || url).slice(0, 200))
  }
  const markdown = htmlToMarkdown(body)
  if (!markdown.trim()) throw new Error('No convertible HTML content')
  const assets = files.length ? await importLocalAssets(files) : []
  const replacements = new Map(assets.map((asset, index) => [`assets/${prefix}-${index}`, asset.path]))
  if (missingImages.length) warnings.push({ message: 'Images with missing or relative paths: {count}. They were not saved as local attachments.', count: missingImages.length, details: missingImages.filter(Boolean).slice(0, 20) })
  if (remoteImages) warnings.push({ message: 'Images using web addresses: {count}. They need a connection and were not saved as local attachments.', count: remoteImages })
  return { markdown: remapAssetPaths(markdown, replacements), mode: 'markdown' as const, restoredSource: false, warnings }
}
