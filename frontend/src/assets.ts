import { translate } from './i18n'
import { DOCUMENT_MODES, normalizeDocumentMode } from './documentMode'
import type { DocumentMode } from './types'
import { unzipBounded } from './zip'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { unescapeAll } from 'markdown-it/lib/common/utils.mjs'
import {
  getAssetsByPaths,
  listAssets,
  putAssets,
  type AssetKind,
  type StoredAsset,
} from './storage'

export const MAX_LOCAL_ASSET_BYTES = 200 * 1024 * 1024
export const PROJECT_ARCHIVE_MIME = 'application/zip'

const ASSET_DIRECTORY = 'assets/'
const PROJECT_MANIFEST = 'markword.json'
const MAX_PROJECT_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_PROJECT_UNPACKED_BYTES = 500 * 1024 * 1024
const MAX_PROJECT_ENTRIES = 2000
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm'])
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav', 'webm'])

interface ProjectManifest {
  mode?: DocumentMode
  version: 1
  document: string
  createdAt: string
  assets?: Array<{
    path: string
    name: string
    type: string
    kind: AssetKind
  }>
}

export interface ProjectArchive {
  mode: DocumentMode
  markdown: string
  documentName: string
  assets: StoredAsset[]
}

function createId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function extensionOf(name: string): string {
  const match = name.toLocaleLowerCase().match(/\.([a-z0-9]{1,12})$/)
  return match?.[1] ?? ''
}

function mimeTypeFromName(name: string): string {
  const extension = extensionOf(name)
  const known: Record<string, string> = {
    aac: 'audio/aac',
    avif: 'image/avif',
    bmp: 'image/bmp',
    flac: 'audio/flac',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4a: 'audio/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    ogv: 'video/ogg',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    webm: VIDEO_EXTENSIONS.has(extension) ? 'video/webm' : 'application/octet-stream',
    webp: 'image/webp',
  }
  return known[extension] ?? 'application/octet-stream'
}

export function assetKind(type: string, name = ''): AssetKind {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  const extension = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return 'file'
}

function safeFilename(input: string): string {
  const basename = input.split(/[\\/]/).pop()?.normalize('NFC') ?? 'asset'
  const withoutControls = Array.from(basename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? '-' : character
  }).join('')
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*#%]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
  return (cleaned || 'asset').slice(0, 120)
}

function splitFilename(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' }
  return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

function uniqueAssetPath(filename: string, usedPaths: Set<string>): string {
  const safe = safeFilename(filename)
  const { stem, extension } = splitFilename(safe)
  let suffix = 1
  let candidate = `${ASSET_DIRECTORY}${safe}`
  while (usedPaths.has(candidate.toLocaleLowerCase())) {
    suffix += 1
    candidate = `${ASSET_DIRECTORY}${stem}-${suffix}${extension}`
  }
  usedPaths.add(candidate.toLocaleLowerCase())
  return candidate
}

export function normalizeAssetPath(value: string | null | undefined): string | null {
  if (!value) return null
  let path = value.trim()
  if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1)
  path = path.replace(/^\.\//, '').replace(/^\//, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  const parts = path.split('/')
  if (parts[0] !== 'assets' || parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) return null
  return parts.join('/')
}

function strictEncodeURIComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function assetMarkdownUrl(path: string): string {
  return `./${path.split('/').map(strictEncodeURIComponent).join('/')}`
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

export function assetMarkdown(asset: StoredAsset): string {
  const url = assetMarkdownUrl(asset.path)
  const label = escapeMarkdownLabel(asset.name)
  if (asset.kind === 'image') return `![${label}](${url})`
  if (asset.kind === 'video') return `@[video](${url})`
  if (asset.kind === 'audio') return `@[audio](${url})`
  return `[📎 ${label}](${url})`
}

export function referencedAssetPaths(markdown: string): Set<string> {
  const paths = new Set<string>()
  const matches = markdown.matchAll(/(?:\.\/|\/)assets\/[A-Za-z0-9_%.,+@()\-~]+/g)
  for (const match of matches) {
    const path = normalizeAssetPath(match[0])
    if (path) paths.add(path)
  }
  return paths
}

export async function importLocalAssets(files: readonly File[]): Promise<StoredAsset[]> {
  const existing = await listAssets()
  const usedPaths = new Set(existing.map((asset) => asset.path.toLocaleLowerCase()))
  const now = Date.now()
  const assets = files.map((file, index): StoredAsset => {
    if (file.size > MAX_LOCAL_ASSET_BYTES) {
      throw new Error(translate('{file} is larger than 200 MB', { file: file.name }))
    }
    const type = file.type || mimeTypeFromName(file.name)
    return {
      id: createId(),
      path: uniqueAssetPath(file.name, usedPaths),
      name: safeFilename(file.name),
      type,
      kind: assetKind(type, file.name),
      size: file.size,
      blob: file,
      createdAt: now + index,
      updatedAt: now + index,
    }
  })
  await putAssets(assets)
  return assets
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(translate('Could not read local asset')))
    reader.readAsDataURL(blob)
  })
}

export async function inlineAssetsInHtml(html: string): Promise<string> {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const elements = Array.from(document.body.querySelectorAll<HTMLElement>('[data-asset-path]'))
  const paths = [...new Set(elements.map((element) => normalizeAssetPath(element.dataset.assetPath)).filter((path): path is string => Boolean(path)))]
  const assets = await getAssetsByPaths(paths)
  const dataUrls = new Map<string, string>()
  for (const [path, asset] of assets) dataUrls.set(path, await blobToDataUrl(asset.blob))

  elements.forEach((element) => {
    const path = normalizeAssetPath(element.dataset.assetPath)
    const dataUrl = path ? dataUrls.get(path) : undefined
    if (dataUrl) {
      if (element instanceof HTMLAnchorElement) element.href = dataUrl
      else if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) element.src = dataUrl
      element.classList.remove('is-loading', 'is-missing', 'is-resolved')
    }
    element.removeAttribute('data-asset-path')
  })
  return document.body.innerHTML
}

export async function createProjectArchive(markdown: string, title: string, assets: readonly StoredAsset[], mode: DocumentMode = 'markdown'): Promise<Blob> {
  const projectBytes = new Blob([markdown]).size + assets.reduce((total, asset) => total + asset.size, 0)
  if (projectBytes > MAX_PROJECT_UNPACKED_BYTES) throw new Error(translate('Project contents exceed 500 MB'))
  if (assets.length + 2 > MAX_PROJECT_ENTRIES) throw new Error(translate('Archive contents exceed the import limits'))
  const [fflate, assetEntries] = await Promise.all([
    import('fflate'),
    Promise.all(assets.map(async (asset) => [asset.path, new Uint8Array(await asset.blob.arrayBuffer())] as const)),
  ])
  const documentName = `${safeFilename(title).replace(/\.(?:md|markdown|txt|mmd|mermaid)$/i, '') || 'markword-document'}.${DOCUMENT_MODES[mode].extension}`
  const manifest: ProjectManifest = {
    mode,
    version: 1,
    document: documentName,
    createdAt: new Date().toISOString(),
    assets: assets.map(({ path, name, type, kind }) => ({ path, name, type, kind })),
  }
  const entries: Record<string, Uint8Array> = {
    [documentName]: fflate.strToU8(markdown),
    [PROJECT_MANIFEST]: fflate.strToU8(JSON.stringify(manifest, null, 2)),
  }
  assetEntries.forEach(([path, bytes]) => { entries[path] = bytes })
  const contents = Object.values(entries)
  if (contents.some((bytes) => bytes.length > MAX_LOCAL_ASSET_BYTES) || contents.reduce((total, bytes) => total + bytes.length, 0) > MAX_PROJECT_UNPACKED_BYTES) {
    throw new Error(translate('Archive contents exceed the import limits'))
  }
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    fflate.zip(entries, { level: 0 }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
  return new Blob([archive], { type: PROJECT_ARCHIVE_MIME })
}

export async function importProjectArchive(file: File): Promise<ProjectArchive> {
  if (file.size > MAX_PROJECT_ARCHIVE_BYTES) throw new Error(translate('Project archive is larger than 512 MB'))
  const [fflate, archive] = await Promise.all([
    import('fflate'),
    file.arrayBuffer(),
  ])
  const entries = await unzipBounded(new Uint8Array(archive), {
    maxTotalBytes: MAX_PROJECT_UNPACKED_BYTES,
    maxEntryBytes: MAX_LOCAL_ASSET_BYTES,
    maxEntries: MAX_PROJECT_ENTRIES,
  })

  let manifest: ProjectManifest | null = null
  if (entries[PROJECT_MANIFEST]) {
    try {
      const parsed = JSON.parse(fflate.strFromU8(entries[PROJECT_MANIFEST])) as Partial<ProjectManifest>
      if (parsed.version === 1 && typeof parsed.document === 'string') manifest = parsed as ProjectManifest
    } catch {
      throw new Error(translate('Project manifest is invalid'))
    }
  }
  const markdownNames = Object.keys(entries).filter((name) => !name.includes('/') && /\.(?:md|markdown)$/i.test(name))
  const documentName = manifest?.document && entries[manifest.document] ? manifest.document : markdownNames[0]
  if (!documentName) throw new Error(translate('Project archive does not contain a Markdown document'))

  const existing = await listAssets()
  const usedPaths = new Set(existing.map((asset) => asset.path.toLocaleLowerCase()))
  const archivePaths = new Set(Object.keys(entries).map(normalizeAssetPath).filter((path): path is string => Boolean(path)))
  const reservedPaths = new Set([...usedPaths, ...Array.from(archivePaths, (path) => path.toLocaleLowerCase())])
  const replacements = new Map<string, string>()
  const manifestAssetEntries = Array.isArray(manifest?.assets) ? manifest.assets : []
  const manifestAssets = new Map(manifestAssetEntries.flatMap((asset) => {
    if (!asset || typeof asset !== 'object' || typeof asset.path !== 'string') return []
    const path = normalizeAssetPath(asset.path)
    return path ? [[path, asset] as const] : []
  }))
  const now = Date.now()
  const importedPaths = new Set<string>()
  const importedAssets = Object.entries(entries).flatMap(([rawPath, bytes], index): StoredAsset[] => {
    const originalPath = normalizeAssetPath(rawPath)
    if (!originalPath || rawPath.endsWith('/')) return []
    if (importedPaths.has(originalPath)) throw new Error(translate('Archive is damaged or uses an unsupported format'))
    importedPaths.add(originalPath)
    const path = usedPaths.has(originalPath.toLocaleLowerCase())
      ? uniqueAssetPath(originalPath.split('/').at(-1)!, reservedPaths) : originalPath
    usedPaths.add(path.toLocaleLowerCase())
    if (path !== originalPath) replacements.set(originalPath, path)
    const metadata = manifestAssets.get(originalPath)
    const name = safeFilename(typeof metadata?.name === 'string' ? metadata.name : originalPath.split('/').at(-1) ?? 'asset')
    const type = typeof metadata?.type === 'string' && metadata.type.length <= 200 ? metadata.type : mimeTypeFromName(name)
    const kind = metadata?.kind && ['image', 'video', 'audio', 'file'].includes(metadata.kind)
      ? metadata.kind
      : assetKind(type, name)
    return [{
      id: createId(),
      path,
      name,
      type,
      kind,
      size: bytes.byteLength,
      blob: new Blob([bytes], { type }),
      createdAt: now + index,
      updatedAt: now + index,
    }]
  })
  let markdown = fflate.strFromU8(entries[documentName])
  const mode = normalizeDocumentMode(manifest?.mode)
  if (replacements.size && mode === 'markdown') {
    // Reuse the editor parser's exact URL ranges: reference links, angle
    // brackets and media work, while code examples and labels remain literal.
    const edits: Array<{ from: number; to: number; path: string }> = []
    markdownLanguage.parser.parse(markdown).iterate({ enter(node) {
      if (node.name !== 'URL') return
      const original = normalizeAssetPath(unescapeAll(markdown.slice(node.from, node.to)))
      const path = original ? replacements.get(original) : undefined
      if (path) edits.push({ from: node.from, to: node.to, path })
    } })
    edits.reverse().forEach(({ from, to, path }) => {
      markdown = markdown.slice(0, from) + assetMarkdownUrl(path) + markdown.slice(to)
    })
  }
  await putAssets(importedAssets)
  return { markdown, mode, documentName, assets: importedAssets }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value >= 10 ? 1 : 2 })} ${unit}`
}
