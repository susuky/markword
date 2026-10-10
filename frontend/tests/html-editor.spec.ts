import { expect, test, type Page } from '@playwright/test'

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>A page</title>
<style>body{margin:24px;color:rgb(24,72,56)}.note{padding:12px;background:#edf5f0}strong{font-weight:700}</style></head>
<body><h1>Original heading</h1><p class="note">Hello <strong>world</strong>!</p>
<a href="https://example.com/old">Visit the site</a>
<script>window.pageCodeRan = true; parent.document.body.dataset.escaped = 'yes'</script>
</body></html>`

async function paste(page: Page, content = html) {
  await page.getByRole('button', { name: 'Paste HTML', exact: true }).click()
  await page.getByLabel('HTML content', { exact: true }).fill(content)
  await page.getByRole('button', { name: 'Open in editor', exact: true }).click()
}

async function downloaded(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download HTML', exact: true }).click()
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), content: Buffer.concat(chunks).toString() }
}

test('visual text and link edits preserve formatting, scripts and editable HTML', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#/html')
  await expect(page).toHaveTitle('HTML editor · Markword')
  await paste(page)
  const preview = page.frameLocator('iframe')
  await expect(preview.locator('h1')).toHaveText('Original heading')
  await expect(preview.locator('body')).toHaveCSS('color', 'rgb(24, 72, 56)')
  await preview.locator('h1 [contenteditable]').fill('A new heading')
  await preview.locator('strong [contenteditable]').fill('everyone')
  await expect(preview.locator('.note')).toHaveText('Hello everyone!')
  await preview.getByRole('link').click()
  await page.getByLabel('Link address', { exact: true }).fill('https://example.com/new')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(preview.getByRole('link')).toHaveAttribute('href', 'https://example.com/new')
  const result = await downloaded(page)
  expect(result.content).toContain('<h1>A new heading</h1>')
  expect(result.content).toContain('<strong>everyone</strong>')
  expect(result.content).toContain('<style>body{margin:24px')
  expect(result.content).toContain("<script>window.pageCodeRan = true; parent.document.body.dataset.escaped = 'yes'</script>")
  expect(result.content).not.toMatch(/data-markword-edit-|contenteditable|Content-Security-Policy/)
  await expect(preview.locator('script')).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('data-escaped')
  await expect(page.getByRole('status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(preview.locator('h1')).toHaveText('A new heading')
  await expect(preview.getByRole('link')).toHaveAttribute('href', 'https://example.com/new')
  expect(errors).toEqual([])
})

test('source editing is lossless, updates the preview, and supports undo and redo', async ({ page }) => {
  await page.goto('/#/html')
  await paste(page)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  expect((await downloaded(page)).content).toBe(html)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Make room for a clear idea.')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  const changed = html.replace('Original heading', 'Changed in source')
  await page.locator('.cm-content').fill(changed)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Changed in source')
  expect((await downloaded(page)).content).toBe(changed)
  await page.getByRole('button', { name: 'Hide source', exact: true }).click()
  await expect(page.locator('.html-source-pane')).toBeHidden()
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Visual only')
  expect((await downloaded(page)).content).toContain('<h1>Visual only</h1>')
  await page.getByRole('button', { name: 'Show source', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('Visual only')
})

test('normal clicks and keyboard edits preserve text styling and work on button labels', async ({ page }) => {
  await page.goto('/#/html')
  await paste(page, '<style>span{color:red}h1{color:rgb(24,72,56)}</style><h1>Click here</h1><form><button>Button text</button></form>')
  const preview = page.frameLocator('iframe')
  const heading = preview.locator('h1 [contenteditable]')
  await expect(heading).toHaveCSS('color', 'rgb(24, 72, 56)')
  await heading.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Edited by typing')
  await page.keyboard.press('Enter')
  await expect(preview.locator('h1')).toHaveText('Edited by typing')
  await preview.locator('button [contenteditable]').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('New button label')
  await page.keyboard.press('Enter')
  await expect(preview.getByRole('button')).toHaveText('New button label')
  expect((await downloaded(page)).content).toContain('<button>New button label</button>')
})

test('returning to an earlier visual edit refreshes the preview and its editing bindings', async ({ page }) => {
  await page.goto('/#/html')
  await paste(page)
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Visual version')
  const visual = (await downloaded(page)).content
  await page.locator('.cm-content').fill(visual.replace('Visual version', 'Source version'))
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Source version')
  await page.locator('.cm-content').fill(visual)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Visual version')
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Another visual edit')
  expect((await downloaded(page)).content).toContain('<h1>Another visual edit</h1>')
})

test('HTML has an independent draft and does not replace the Markdown draft', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Keep this Markdown draft')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('html-page')
  await paste(page)
  await expect(page.getByRole('status')).toHaveText('Saved in this browser')
  await page.getByRole('link', { name: 'Markdown', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('# Keep this Markdown draft')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('html-page')
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
})

test('opening and downloading an HTML file preserves the full source and file name', async ({ page }) => {
  await page.goto('/#/html')
  await expect(page.getByRole('button', { name: 'Open HTML file' })).toBeEnabled()
  await page.locator('input[type=file]').setInputFiles({ name: '提案.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  const result = await downloaded(page)
  expect(result).toEqual({ name: '提案.html', content: html })
  await page.locator('input[type=file]').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('not HTML') })
  await expect(page.getByRole('alert')).toHaveText('Please choose an HTML file (.html or .htm).')
  expect((await downloaded(page)).content).toBe(html)
})

test('preview blocks executable content, navigation and injected text without changing the source', async ({ page }) => {
  await page.goto('/#/html')
  const source = html.replace('<body>', `<body onload="parent.document.body.dataset.escaped='yes'">
<meta http-equiv="refresh" content="0;url=https://example.com/escaped">
<iframe srcdoc="<script>parent.alert(1)</script>"></iframe>
<object data="https://example.com/escaped"></object>`)
  await paste(page, source)
  const preview = page.frameLocator('iframe')
  await expect(preview.locator('h1')).toHaveText('Original heading')
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin')
  await expect(preview.locator('script, iframe, object, [onload], meta[http-equiv="refresh"]')).toHaveCount(0)
  expect((await downloaded(page)).content).toBe(source)
  const text = '<img src=x onerror=alert(1)>'
  await preview.locator('h1 [contenteditable]').fill(text)
  await expect(preview.locator('h1 img')).toHaveCount(0)
  expect((await downloaded(page)).content).toContain('&lt;img src=x onerror=alert(1)&gt;')
  await preview.getByRole('link').click()
  await expect(page).toHaveURL(/#\/html$/)
  await page.getByLabel('Link address', { exact: true }).fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a valid address, such as https://example.com.')
  await expect(page.locator('body')).not.toHaveAttribute('data-escaped')
})

test('a second tab cannot silently overwrite a newer HTML draft', async ({ page, context }) => {
  await page.goto('/#/html')
  await paste(page)
  await expect(page.getByRole('status')).toHaveText('Saved in this browser')
  const other = await context.newPage()
  await other.goto('/#/html')
  await expect(other.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('First tab update')
  await expect(page.getByRole('status')).toHaveText('Saved in this browser')
  await other.frameLocator('iframe').locator('h1 [contenteditable]').fill('Second tab update')
  await expect(other.getByRole('status')).toHaveText('Changed in another tab. Download a backup.')
  expect((await downloaded(other)).content).toContain('Second tab update')
  await page.reload()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('First tab update')
})

test('storage failure keeps editing and downloads available with an honest status', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }))
  await page.goto('/#/html')
  await expect(page.getByRole('status')).toHaveText('Draft not saved. Download a backup.')
  await paste(page)
  await expect(page.getByRole('status')).toHaveText('Draft not saved. Download a backup.')
  expect((await downloaded(page)).content).toBe(html)
  await page.getByRole('link', { name: 'Markdown', exact: true }).click()
  await expect(page).toHaveURL(/#\/html$/)
})

test('mobile editing can switch between the rendered page and source without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/html')
  await paste(page)
  await expect(page.locator('.html-source-pane')).toBeHidden()
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Edited on mobile')
  await page.getByRole('tab', { name: 'HTML source', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('Edited on mobile')
  await page.getByRole('tab', { name: 'Editable preview', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Edited on mobile')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
