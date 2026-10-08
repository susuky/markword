import { expect, test, type Download, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
const htmlFile = (html: string, name = 'Notes.html') => ({ name, mimeType: 'text/html', buffer: Buffer.from(html) })
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))

async function bytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function exportHtml(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Portable HTML/ }).click()
  return bytes(await download)
}

test('HTML files convert content and embedded images without executing markup, and retain the pre-open draft', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page).toHaveTitle('Markword')
  await page.locator('.cm-content').fill('# Keep my earlier draft')
  const file = htmlFile(`<!doctype html><html><head><style>body{color:red}</style></head><body>
    <h1>HTML meeting notes</h1><p><strong>重要事項</strong> and <em>review</em> <del>old</del>.</p>
    <blockquote>Keep the date.</blockquote><ul><li><input type="checkbox" checked>Done</li><li><input type="checkbox">Review</li></ul>
    <p><a href="https://example.com/">Reference</a></p><pre><code class="language-js">const value = 1;</code></pre>
    <table><tr><th>Task</th><th>Owner</th></tr><tr><td>Review | approve</td><td>王小明</td></tr></table>
    <img alt="Embedded image" title="Embedded caption" src="data:image/png;base64,${png.toString('base64')}" onload="window.htmlAttack=true">
    <script>window.htmlAttack=true</script><iframe srcdoc="<script>parent.htmlAttack=true</script>"></iframe>
    <a href="javascript:window.htmlAttack=true">Unsafe link</a>
  </body></html>`, 'Notes.HTM')
  await page.locator('input[type=file]').first().setInputFiles(file)
  await expect(page.locator('.markdown-body h1')).toHaveText('HTML meeting notes')
  await expect(page.locator('.markdown-body strong')).toHaveText('重要事項')
  await expect(page.locator('.markdown-body em')).toHaveText('review')
  await expect(page.locator('.markdown-body s')).toHaveText('old')
  await expect(page.locator('.markdown-body blockquote')).toContainText('Keep the date.')
  await expect(page.locator('.markdown-body input[type=checkbox]')).toHaveCount(2)
  await expect(page.locator('.markdown-body input[type=checkbox]').first()).toBeChecked()
  await expect(page.locator('.markdown-body table')).toContainText('Review | approve')
  await expect(page.locator('.markdown-body pre')).toContainText('const value = 1;')
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  await expect(page.locator('.markdown-body img')).toHaveAttribute('title', 'Embedded caption')
  await expect.poll(() => page.locator('.markdown-body img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)
  expect(await source(page)).not.toMatch(/htmlAttack|<script|javascript:|onload=/)
  expect(await page.evaluate(() => Reflect.get(window, 'htmlAttack'))).toBeUndefined()
  await expect(page.locator('.toast')).toContainText('please review the result')
  await page.screenshot({ path: testInfo.outputPath('html-import-desktop.png') })
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list')).toContainText('Pre-open backup')
  await page.getByRole('button', { name: 'Restore this revision', exact: true }).click()
  await expect(page.locator('.editor-host .cm-content')).toHaveText('# Keep my earlier draft')
  expect(errors).toEqual([])
})

test('portable HTML restores exact Markdown, formulas, diagrams, and attachments in a clean browser and remaps collisions', async ({ page, browser }) => {
  const markdown = '# Round trip\n\n![Photo][picture]\n\n[picture]: ./assets/photo.png "Title"\n\n[Attachment](./assets/notes.txt)\n\n@[audio](./assets/voice.wav)\n\nFormula $x^2$ and a footnote[^photo].\n\n[^photo]: ![Footnote image](./assets/photo.png)\n\n~~~mermaid\nflowchart LR\nA-->B\n~~~~\n\n```html\n</script><script>window.htmlAttack=true</script>\n![literal](./assets/photo.png)\n```\n'
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'Project.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({
      'Round trip.md': strToU8(markdown), 'assets/photo.png': png,
      'assets/notes.txt': strToU8('Keep this attachment'), 'assets/voice.wav': strToU8('Audio fixture'),
    })),
  })
  await expect(page.locator('.markdown-body h1')).toHaveText('Round trip')
  const html = await exportHtml(page)
  expect(html.toString()).toContain('id="markword-source"')
  expect(html.toString()).toContain('\\u003c/script>')
  const clean = await browser.newContext()
  try {
    const restored = await clean.newPage()
    await restored.goto(page.url())
    await expect(restored.locator('.cm-content')).toBeEditable()
    await restored.locator('input[type=file]').first().setInputFiles({ name: 'Round trip.html', mimeType: 'text/html', buffer: html })
    await expect.poll(() => source(restored)).toBe(markdown)
    await expect(restored.getByRole('combobox', { name: 'Document mode' })).toHaveValue('markdown')
    await expect(restored.locator('.markdown-body .katex')).toHaveCount(1)
    await expect(restored.locator('.markdown-body .mermaid-image')).toHaveCount(1)
    await expect(restored.locator('.markdown-body img[data-asset-path]')).toHaveCount(2)
    for (const image of await restored.locator('.markdown-body img[data-asset-path]').all()) await expect(image).toHaveClass(/is-resolved/)
    await expect(restored.locator('.toast')).toContainText('Restored editable content')
    const assets = await restored.evaluate(async () => {
      const module = '/src/storage.ts'
      const { listAssets } = await import(/* @vite-ignore */ module)
      return (await listAssets()).map((asset: { path: string; blob: Blob }) => ({ path: asset.path, size: asset.blob.size }))
    })
    expect(assets.map((asset: { path: string }) => asset.path).sort()).toEqual(['assets/notes.txt', 'assets/photo.png', 'assets/voice.wav'])
    expect(await restored.evaluate(() => Reflect.get(window, 'htmlAttack'))).toBeUndefined()
  } finally { await clean.close() }
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Round trip.html', mimeType: 'text/html', buffer: html })
  await expect.poll(() => source(page)).toBe(markdown
    .replace('[picture]: ./assets/photo.png', '[picture]: ./assets/photo-2.png')
    .replace('[Attachment](./assets/notes.txt)', '[Attachment](./assets/notes-2.txt)')
    .replace('@[audio](./assets/voice.wav)', '@[audio](./assets/voice-2.wav)')
    .replace('[^photo]: ![Footnote image](./assets/photo.png)', '[^photo]: ![Footnote image](./assets/photo-2.png)'))
  for (const image of await page.locator('.markdown-body img[data-asset-path]').all()) await expect(image).toHaveClass(/is-resolved/)
  await page.getByRole('button', { name: 'Manage local assets', exact: true }).click()
  await expect(page.locator('.asset-item')).toHaveCount(6)
})

for (const mode of ['text', 'mermaid'] as const) {
  test(`portable HTML restores ${mode} mode and unchanged source`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Document mode' }).selectOption(mode)
    const content = mode === 'text' ? '# Literal heading\n\n<not-html> **literal**\n' : 'flowchart LR\nA[原始內容]-->B[可繼續編輯]\n'
    await page.locator('.cm-content').fill(content)
    const html = await exportHtml(page)
    await page.getByRole('combobox', { name: 'Document mode' }).selectOption('markdown')
    await page.locator('.cm-content').fill('# Different document')
    await page.locator('input[type=file]').first().setInputFiles({ name: 'Export.html', mimeType: 'text/html', buffer: html })
    await expect.poll(() => source(page)).toBe(content)
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue(mode)
  })
}

test('HTML drops work and invalid, missing-attachment, or oversized files preserve the draft', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['<h1>Dropped HTML</h1><p>Keep this content.</p>'], 'Dropped.html', { type: 'text/html' }))
    document.querySelector('.workspace')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.locator('.markdown-body h1')).toHaveText('Dropped HTML')
  const original = await source(page)
  for (const file of [
    htmlFile('<script>window.htmlAttack=true</script>'),
    htmlFile('<script type="application/json" id="markword-source">{"version":99,"markdown":"lost","mode":"markdown"}</script>'),
    htmlFile('<script type="application/json" id="markword-source">{"version":1,"markdown":"lost","mode":["markdown"]}</script>'),
    htmlFile('<script type="application/json" id="markword-source">{"version":1,"markdown":"![Missing](./assets/missing.png)","mode":"markdown"}</script>'),
    htmlFile('<h1>Too large</h1>' + ' '.repeat(15 * 1024 * 1024)),
  ]) {
    await page.locator('input[type=file]').first().setInputFiles(file)
    await expect(page.getByRole('button', { name: 'Open document or project', exact: true })).toBeEnabled()
    await expect(page.locator('.toast')).toContainText(file.buffer.length > 15 * 1024 * 1024 ? 'larger than 15 MiB' : 'Your current document is unchanged')
    expect(await source(page)).toBe(original)
  }
})

test('HTML opens through the native picker and saving selects a Markdown target', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: async (options: unknown) => {
      Reflect.set(window, 'htmlPickerOptions', options)
      return [{ getFile: async () => new File(['<h1>Picked HTML</h1>'], 'Original.html', { type: 'text/html' }) }]
    } })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async (options: unknown) => {
      Reflect.set(window, 'htmlSaveOptions', options)
      throw new DOMException('Cancelled', 'AbortError')
    } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open document or project', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('Picked HTML')
  expect(await page.evaluate(() => Reflect.get(window, 'htmlPickerOptions').types[0].accept['text/html'])).toEqual(['.html', '.htm'])
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'htmlSaveOptions')?.suggestedName)).toBe('Picked HTML.md')
  expect(await source(page)).toBe('# Picked HTML')
})

test('HTML conversion and review notices remain readable on mobile in Traditional Chinese', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await page.locator('input[type=file]').first().setInputFiles(htmlFile('<h1>HTML 匯入示範</h1><p>保留標題、<strong>重要內容</strong>與表格，轉換後可繼續編輯。</p><table><tr><th>項目</th><th>狀態</th></tr><tr><td colspan="2">檢查轉換結果</td></tr></table>'))
  await expect(page.locator('.toast')).toContainText('HTML 已轉換，部分格式或圖片可能需要調整')
  await page.getByRole('tab', { name: '預覽', exact: true }).click()
  await expect(page.locator('.markdown-body h1')).toHaveText('HTML 匯入示範')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('html-import-mobile.png') })
  await page.getByRole('button', { name: '匯出', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '下載與匯出', exact: true })).toContainText('可編輯原文與本機附件')
  expect(errors).toEqual([])
})
