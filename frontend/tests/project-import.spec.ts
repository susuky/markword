import { expect, test } from './shared-workspace-fixture'
import { type Download, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const projectFile = (entries: Record<string, Uint8Array>) => ({
  name: 'review.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)),
})

async function downloadedEntries(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return unzipSync(Buffer.concat(chunks))
}

test('dropping a wrapped Markdown ZIP loads images, exports attachments, and keeps the previous draft', async ({ page }) => {
  await page.goto('/')
  const original = '# Previous draft\n\nKeep this pending edit.'
  await page.locator('.cm-content').fill(original)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const archive = projectFile({
    'training-review/review.md': strToU8('# Nested review\n\n![Chart](images/chart.png?download=1#view)\n\n[Notes](attachments/notes.pdf#page=2)'),
    'training-review/images/chart.png': png,
    'training-review/attachments/notes.pdf': strToU8('%PDF-1.4\nReview attachment'),
    'training-review/unused.txt': strToU8('Keep the unreferenced attachment too'),
  })
  const transfer = await page.evaluateHandle(({ bytes, name, mimeType }) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }))
    return data
  }, { bytes: [...archive.buffer], name: archive.name, mimeType: archive.mimeType })
  await page.locator('.workspace').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(page.locator('.markdown-body h1')).toHaveText('Nested review')
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  await expect.poll(() => page.locator('.markdown-body img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const sharedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  const shared = await downloadedEntries(await sharedDownload)
  const manifest = JSON.parse(strFromU8(shared['markword.json']))
  expect(strFromU8(shared[manifest.document])).toContain('# Nested review')
  expect(Buffer.from(shared[Object.keys(shared).find((path) => path.endsWith('/chart.png'))!])).toEqual(png)
  expect(strFromU8(shared[Object.keys(shared).find((path) => path.endsWith('/notes.pdf'))!])).toBe('%PDF-1.4\nReview attachment')
  expect(Object.keys(shared).some((path) => path.endsWith('/unused.txt'))).toBe(false)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const libraryDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Document \+ asset library ZIP/ }).click()
  const library = await downloadedEntries(await libraryDownload)
  expect(strFromU8(library[Object.keys(library).find((path) => path.endsWith('/unused.txt'))!])).toBe('Keep the unreferenced attachment too')

  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  const documents = page.getByRole('complementary', { name: 'Documents', exact: true })
  await expect(documents.locator('.document-list__open')).toHaveCount(2)
  await documents.locator('.document-list > li').filter({ has: page.getByText('Previous draft', { exact: true }) }).locator('.document-list__open').click()
  await expect.poll(() => source(page)).toBe(original)
})

test('generic ZIP references resolve from the document directory and preserve code, external links, and archive boundaries', async ({ page }) => {
  await page.goto('/')
  const markdown = [
    '# Relative references',
    '![Chart](../pictures/chart%20one.png?download=1#view "Chart title")',
    '[Report][report]',
    '[report]: <attachments/report (final).pdf> "Report title"',
    '@[audio](./media/recording.mp3)',
    '![Shared](../../shared.png)',
    '[External](https://example.com/chart%20one.png)',
    '[Missing](../missing.pdf)',
    '[Outside](../../../shared.png)',
    '[Encoded outside](%2E%2E/%2E%2E/%2E%2E/shared.png)',
    '`![Inline example](../pictures/chart%20one.png)`',
    '```md\n![Fenced example](../pictures/chart%20one.png)\n```',
  ].join('\n\n')
  const archive = projectFile({
    'bundle/docs/review.md': strToU8(markdown),
    'bundle/pictures/chart one.png': png,
    'bundle/docs/attachments/report (final).pdf': strToU8('Report bytes'),
    'bundle/docs/media/recording.mp3': strToU8('Audio bytes'),
    'bundle/notes/extra.md': strToU8('# Extra attachment'),
    'shared.png': png,
  })
  const imported = await page.evaluate(async (bytes) => {
    const module = '/src/assets.ts'
    const { importProjectArchive, assetMarkdownUrl, createProjectArchive } = await import(/* @vite-ignore */ module)
    const result = await importProjectArchive(new File([new Uint8Array(bytes)], 'review.zip'))
    const exported = await createProjectArchive(result.markdown, 'Round trip', result.assets, result.mode)
    return {
      markdown: result.markdown,
      urls: Object.fromEntries(result.assets.map((asset: { name: string; path: string }) => [asset.name, assetMarkdownUrl(asset.path)])),
      assets: result.assets.map((asset: { path: string; name: string }) => ({ path: asset.path, name: asset.name })),
      exported: [...new Uint8Array(await exported.arrayBuffer())],
    }
  }, [...archive.buffer])
  let expected = markdown
  for (const [from, to] of [
    ['../pictures/chart%20one.png?download=1#view', `${imported.urls['chart one.png']}?download=1#view`],
    ['<attachments/report (final).pdf>', imported.urls['report (final).pdf']],
    ['./media/recording.mp3', imported.urls['recording.mp3']],
    ['../../shared.png', imported.urls['shared.png']],
  ]) expected = expected.replace(from, to)
  expect(imported.markdown).toBe(expected)
  expect(imported.assets.map((asset) => asset.name).sort()).toEqual(['chart one.png', 'extra.md', 'recording.mp3', 'report (final).pdf', 'shared.png'].sort())
  const exported = unzipSync(new Uint8Array(imported.exported))
  const extra = imported.assets.find((asset) => asset.name === 'extra.md')!
  expect(strFromU8(exported[extra.path])).toBe('# Extra attachment')
})

test('a wrapped Markword manifest selects its plain text document and preserves literal paths through asset collisions', async ({ page }) => {
  await page.goto('/')
  const text = '# Literal text\n\n![Logo](./assets/logo.svg)\n\n[Other](./assets/logo-2.svg)\n'
  const archive = projectFile({
    'wrapped/README.md': strToU8('# Do not select this Markdown document'),
    'wrapped/literal.txt': strToU8(text),
    'wrapped/markword.json': strToU8(JSON.stringify({
      version: 1, document: 'literal.txt', mode: 'text',
      assets: [{ path: 'assets/logo.svg', name: 'Brand logo.svg', type: 'image/svg+xml', kind: 'image' }],
    })),
    'wrapped/assets/logo.svg': strToU8('<svg>Imported logo</svg>'),
    'wrapped/assets/logo-2.svg': strToU8('<svg>Reserved sibling</svg>'),
  })
  const result = await page.evaluate(async (bytes) => {
    const module = '/src/assets.ts'
    const storageModule = '/src/storage.ts'
    const { importLocalAssets, importProjectArchive } = await import(/* @vite-ignore */ module)
    const { listAssets } = await import(/* @vite-ignore */ storageModule)
    await importLocalAssets([new File(['Existing logo'], 'logo.svg', { type: 'image/svg+xml' })])
    const imported = await importProjectArchive(new File([new Uint8Array(bytes)], 'wrapped.zip'))
    return {
      markdown: imported.markdown, mode: imported.mode,
      assets: await Promise.all((await listAssets()).map(async (asset: { path: string; name: string; type: string; kind: string; blob: Blob }) => ({
        path: asset.path, name: asset.name, type: asset.type, kind: asset.kind, text: await asset.blob.text(),
      }))),
    }
  }, [...archive.buffer])
  expect(result.markdown).toBe(text)
  expect(result.mode).toBe('text')
  expect(result.assets).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'assets/logo.svg', text: 'Existing logo' }),
    expect.objectContaining({ path: 'assets/logo-3.svg', name: 'Brand logo.svg', type: 'image/svg+xml', kind: 'image', text: '<svg>Imported logo</svg>' }),
    expect.objectContaining({ path: 'assets/logo-2.svg', text: '<svg>Reserved sibling</svg>' }),
  ]))
  expect(result.assets).toHaveLength(3)
})

test('root Markdown wins over earlier nested candidates and a ZIP without Markdown keeps the current document', async ({ page }) => {
  await page.goto('/')
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(projectFile({
    'nested/first.md': strToU8('# Nested candidate'),
    'Root.MARKDOWN': strToU8('# Root document\n\nKeep this content.'),
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('Root document')
  const before = await source(page)
  const assetPaths = () => page.evaluate(async () => {
    const module = '/src/storage.ts'
    const { listAssets } = await import(/* @vite-ignore */ module)
    return (await listAssets()).map((asset: { path: string }) => asset.path).sort()
  })
  const beforeAssets = await assetPaths()
  await input.setInputFiles(projectFile({
    'folder/notes.txt': strToU8('No Markdown document'),
    'folder/assets/chart.png': png,
  }))
  await expect(page.locator('.toast')).toHaveText('Project archive does not contain a Markdown or HTML document')
  expect(await source(page)).toBe(before)
  expect(await assetPaths()).toEqual(beforeAssets)
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Documents', exact: true }).locator('.document-list__open')).toHaveCount(2)
})

test('manifest ZIPs accept dot-prefixed asset entries and reject duplicate canonical paths without adding assets', async ({ page }) => {
  await page.goto('/')
  const markdown = '# Canonical paths\n\n![Logo](./assets/logo.png)'
  const manifest = strToU8(JSON.stringify({ version: 1, document: 'document.md', mode: 'markdown', assets: [] }))
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'document.md': strToU8(markdown),
    'markword.json': manifest,
    './assets/logo.png': png,
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('Canonical paths')
  await expect.poll(() => page.locator('.markdown-body img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await expect.poll(() => source(page)).toBe(markdown)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  const exported = await downloadedEntries(await download)
  expect(Buffer.from(exported['assets/logo.png'])).toEqual(png)

  const duplicate = projectFile({
    'document.md': strToU8(markdown),
    'markword.json': manifest,
    'assets/new.png': png,
    'assets/logo.png': png,
    './assets/logo.png': strToU8('Duplicate alias'),
  })
  const result = await page.evaluate(async (bytes) => {
    const module = '/src/assets.ts'
    const storageModule = '/src/storage.ts'
    const { importProjectArchive } = await import(/* @vite-ignore */ module)
    const { listAssets } = await import(/* @vite-ignore */ storageModule)
    const stored = async () => (await listAssets()).map((asset: { id: string; path: string }) => ({ id: asset.id, path: asset.path }))
    const before = await stored()
    let error = ''
    try { await importProjectArchive(new File([new Uint8Array(bytes)], 'duplicate.zip')) }
    catch (failure) { error = (failure as Error).message }
    return { error, before, after: await stored() }
  }, [...duplicate.buffer])
  expect(result.error).toBe('Archive is damaged or uses an unsupported format')
  expect(result.after).toEqual(result.before)
  expect(await source(page)).toBe(markdown)
})

test('manifest asset filenames containing a hash load through encoded URLs and retain their bytes on export', async ({ page }) => {
  await page.goto('/')
  const markdown = '# Hash filename\n\n![Photo](./assets/photo%231.png)'
  const metadata = { path: 'assets/photo#1.png', name: 'Original photograph.png', type: 'image/png', kind: 'image' }
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'document.md': strToU8(markdown),
    'markword.json': strToU8(JSON.stringify({ version: 1, document: 'document.md', mode: 'markdown', assets: [metadata] })),
    'assets/photo#1.png': png,
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('Hash filename')
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  await expect.poll(() => page.locator('.markdown-body img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await expect.poll(() => source(page)).toBe(markdown)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  const exported = await downloadedEntries(await download)
  const manifest = JSON.parse(strFromU8(exported['markword.json']))
  expect(Buffer.from(exported['assets/photo#1.png'])).toEqual(png)
  expect(manifest.assets).toEqual([metadata])
  expect(strFromU8(exported[manifest.document])).toBe(markdown)
})

test('remapping URL suffixes preserves links with spaces and escaped parentheses and exports their attachment', async ({ page }) => {
  await page.goto('/')
  const markdown = String.raw`# URL suffixes

[Space](<reports/a.pdf?name=some value>)

[Parenthesis](reports/a.pdf#section\))`
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'report.md': strToU8(markdown),
    'reports/a.pdf': strToU8('Keep the complete PDF attachment'),
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('URL suffixes')
  await expect(page.locator('.markdown-body a[data-asset-path]')).toHaveCount(2)
  const imported = await source(page)
  expect(imported).toContain('?name=some%20value')
  expect(imported).toContain('#section%29')
  await expect(page.locator('.markdown-body a[data-asset-path]').first()).toHaveAttribute('href', /^blob:/)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  const exported = await downloadedEntries(await download)
  const manifest = JSON.parse(strFromU8(exported['markword.json']))
  expect(manifest.assets).toHaveLength(1)
  expect(strFromU8(exported[manifest.assets[0].path])).toBe('Keep the complete PDF attachment')
})

test('macOS ZIP metadata does not prevent a wrapped manifest from selecting its text document', async ({ page }) => {
  await page.goto('/')
  const text = 'Keep this text verbatim\n\n![Literal](./assets/example.png)'
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'bundle/markword.json': strToU8(JSON.stringify({ version: 1, document: 'content.txt', mode: 'text', assets: [] })),
    'bundle/content.txt': strToU8(text),
    'bundle/index.html': strToU8('<main><h1>Wrong HTML</h1></main>'),
    '__MACOSX/._bundle': strToU8('macOS metadata'),
    '.DS_Store': strToU8('Finder metadata'),
  }))
  await expect.poll(() => source(page)).toBe(text)
  await expect(page.getByRole('combobox', { name: 'Document mode', exact: true })).toHaveValue('text')
})

test('a dot-prefixed manifest document path selects the canonical file instead of a Markdown fallback', async ({ page }) => {
  await page.goto('/')
  const text = 'Keep the selected text document\n\n![Literal](./assets/example.png)'
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    './content.txt': strToU8(text),
    'README.md': strToU8('# Wrong README'),
    'markword.json': strToU8(JSON.stringify({ version: 1, document: './content.txt', mode: 'text', assets: [] })),
  }))
  await expect.poll(() => source(page)).toBe(text)
  await expect(page.getByRole('combobox', { name: 'Document mode', exact: true })).toHaveValue('text')
})
