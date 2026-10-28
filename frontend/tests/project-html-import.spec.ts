import { expect, test } from './shared-workspace-fixture'
import { type Download, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const projectFile = (entries: Record<string, Uint8Array>) => ({
  name: 'html-review.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)),
})

async function bytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function exportFile(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name }).click()
  return bytes(await download)
}

async function expectChart(page: Page, previousPath?: string | null) {
  const image = page.locator('.markdown-body img')
  await expect(image).toHaveCount(1)
  if (previousPath) await expect.poll(async () => {
    const path = await image.getAttribute('data-asset-path')
    return Boolean(path && path !== previousPath)
  }).toBe(true)
  await expect(image).toHaveClass(/is-resolved/)
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1)
}

test('dropping a wrapped report ZIP selects its HTML homepage, resolves images, and preserves attachments and the earlier draft', async ({ page }) => {
  await page.goto('/')
  const original = '# Earlier draft\n\nKeep this pending edit.'
  await page.locator('.cm-content').fill(original)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const audit = '# Audit notes\n\nThe report and its pictures are in index.html.'
  const archive = projectFile({
    'review/audit.md': strToU8(audit),
    'review/report.md': strToU8('# Report source\n\n```html\n<h1>Fenced example only</h1>\n<img src="images/chart.png">\n```'),
    'review/index.html': strToU8(`<!doctype html><html><head><style>main{max-width:60rem}</style></head><body>
      <nav><button>Download original report</button></nav>
      <main><h1>Training report</h1><p>Review the chart below.</p>
        <figure><img src="images/chart.png" alt="Training chart" onload="window.zipHtmlAttack=true"><figcaption>Training progress</figcaption></figure>
        <script>window.zipHtmlAttack=true</script>
      </main>
      <textarea hidden>HIDDEN_SOURCE_SENTINEL</textarea>
    </body></html>`),
    'review/images/chart.png': png,
  })
  const transfer = await page.evaluateHandle(({ data, name, mimeType }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(data)], name, { type: mimeType }))
    return transfer
  }, { data: [...archive.buffer], name: archive.name, mimeType: archive.mimeType })
  await page.locator('.workspace').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()

  await expect(page.locator('.markdown-body h1')).toHaveText('Training report')
  await expectChart(page)
  const imported = await source(page)
  expect(imported).toContain('Training progress')
  expect(imported).not.toMatch(/Audit notes|Fenced example only|Download original report|HIDDEN_SOURCE_SENTINEL|zipHtmlAttack|onload=/)
  expect(await page.evaluate(() => Reflect.get(window, 'zipHtmlAttack'))).toBeUndefined()
  const summary = page.getByRole('complementary', { name: 'Import summary', exact: true })
  await expect(summary).toContainText('Page layout and styles do not carry over to Markdown')
  await expect(summary).not.toContainText('Images with missing or relative paths')
  await page.getByRole('button', { name: 'Close import summary', exact: true }).click()

  const exported = unzipSync(await exportFile(page, /^Document \+ asset library ZIP/))
  const imagePath = Object.keys(exported).find((path) => path.endsWith('/chart.png'))!
  const auditPath = Object.keys(exported).find((path) => path.endsWith('/audit.md'))!
  expect(Buffer.from(exported[imagePath])).toEqual(png)
  expect(strFromU8(exported[auditPath])).toBe(audit)

  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  const documents = page.getByRole('complementary', { name: 'Documents', exact: true })
  await expect(documents.locator('.document-list__open')).toHaveCount(2)
  await documents.locator('.document-list__open').filter({ has: page.getByText('Earlier draft', { exact: true }) }).click()
  await expect.poll(() => source(page)).toBe(original)
})

test('repeated HTML ZIP imports remap image collisions and keep images through project ZIP and portable HTML round trips', async ({ page }) => {
  await page.goto('/')
  const archive = projectFile({
    'audit.md': strToU8('# Earlier audit entry'),
    'index.html': strToU8('<main><h1>Image round trip</h1><img src="images/chart.png" alt="Chart"></main>'),
    'images/chart.png': png,
  })
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(archive)
  await expect(page.locator('.markdown-body h1')).toHaveText('Image round trip')
  await expectChart(page)
  const firstPath = await page.locator('.markdown-body img').getAttribute('data-asset-path')
  await input.setInputFiles(archive)
  await expectChart(page, firstPath)
  const secondPath = await page.locator('.markdown-body img').getAttribute('data-asset-path')
  expect(secondPath).not.toBe(firstPath)
  expect(secondPath).toBeTruthy()

  const project = await exportFile(page, /^Project ZIP Document and referenced local assets$/)
  const entries = unzipSync(project)
  const manifest = JSON.parse(strFromU8(entries['markword.json']))
  expect(manifest.assets).toHaveLength(1)
  expect(Buffer.from(entries[manifest.assets[0].path])).toEqual(png)
  await input.setInputFiles({ name: 'Round trip.zip', mimeType: 'application/zip', buffer: project })
  await expectChart(page, secondPath)
  await expect(page.locator('.markdown-body h1')).toHaveText('Image round trip')
  const projectPath = await page.locator('.markdown-body img').getAttribute('data-asset-path')

  const html = await exportFile(page, /^Portable HTML/)
  expect(html.toString()).toContain('id="markword-source"')
  await input.setInputFiles({ name: 'Round trip.html', mimeType: 'text/html', buffer: html })
  await expectChart(page, projectPath)
  await expect(page.locator('.markdown-body h1')).toHaveText('Image round trip')
  expect(await source(page)).toContain('![Chart](./assets/')
})

test('a Markword manifest keeps its selected Markdown and fenced HTML even when an HTML homepage is present', async ({ page }) => {
  await page.goto('/')
  const markdown = '# Manifest document\n\n```html\n<h1>Literal HTML example</h1>\n<img src="images/chart.png" onload="window.zipHtmlAttack=true">\n```'
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'wrapped/index.html': strToU8('<main><h1>Do not choose this homepage</h1><img src="assets/chart.png"></main>'),
    'wrapped/audit.md': strToU8('# Do not choose this audit'),
    'wrapped/document.md': strToU8(markdown),
    'wrapped/markword.json': strToU8(JSON.stringify({ version: 1, document: 'document.md', mode: 'markdown', assets: [] })),
    'wrapped/assets/chart.png': png,
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('Manifest document')
  await expect.poll(() => source(page)).toBe(markdown)
  await expect(page.locator('.markdown-body pre')).toContainText('<h1>Literal HTML example</h1>')
  await expect(page.locator('.markdown-body img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import summary', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'zipHtmlAttack'))).toBeUndefined()
})

test('a ZIP containing only an HTML document uses its body and reports an image absent from the archive', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'Report.HTM': strToU8('<h1>HTML-only report</h1><p>Keep the body content.</p><img src="images/missing.png" alt="Missing training chart">'),
    'notes.txt': strToU8('A separate attachment'),
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('HTML-only report')
  await expect(page.locator('.markdown-body')).toContainText('Keep the body content.')
  expect(await source(page)).toContain('![Missing training chart](images/missing.png)')
  const summary = page.getByRole('complementary', { name: 'Import summary', exact: true })
  await expect(summary).toContainText('Images with missing or relative paths: 1')
  await expect(summary).toContainText('Missing training chart')
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('portable HTML inside a generic ZIP prefers its embedded image while preserving a different archive sibling', async ({ page }) => {
  await page.goto('/')
  const markdown = '# Embedded priority\n\n![Photo](./assets/photo.png)'
  const sibling = 'Different sibling bytes'
  await page.locator('input[type=file]').first().setInputFiles(projectFile({
    'index.html': strToU8(`<!doctype html><html><body>
      <h1>Embedded priority</h1>
      <img data-markword-asset-path="assets/photo.png" src="data:image/png;base64,${png.toString('base64')}" alt="Photo">
      <script id="markword-source" type="application/json">${JSON.stringify({ version: 1, mode: 'markdown', markdown })}</script>
    </body></html>`),
    'assets/photo.png': strToU8(sibling),
  }))
  await expect(page.locator('.markdown-body h1')).toHaveText('Embedded priority')
  await expectChart(page)
  const embeddedPath = await page.locator('.markdown-body img').getAttribute('data-asset-path')
  expect(embeddedPath).toBeTruthy()
  expect(embeddedPath).not.toBe('assets/photo.png')
  const stored = await page.evaluate(async () => {
    const module = '/src/storage.ts'
    const { listAssets } = await import(/* @vite-ignore */ module)
    return Promise.all((await listAssets()).map(async (asset: { path: string; blob: Blob }) => ({
      path: asset.path, bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
    })))
  })
  expect(Buffer.from(stored.find((asset) => asset.path === 'assets/photo.png')!.bytes).toString()).toBe(sibling)
  expect(Buffer.from(stored.find((asset) => asset.path === embeddedPath)!.bytes)).toEqual(png)

  const exported = unzipSync(await exportFile(page, /^Project ZIP Document and referenced local assets$/))
  const manifest = JSON.parse(strFromU8(exported['markword.json']))
  expect(manifest.assets).toHaveLength(1)
  expect(manifest.assets[0].path).toBe(embeddedPath)
  expect(Buffer.from(exported[manifest.assets[0].path])).toEqual(png)
  expect(exported['assets/photo.png']).toBeUndefined()
})
