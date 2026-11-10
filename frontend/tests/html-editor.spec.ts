import { expect, test } from './shared-workspace-fixture'
import { type Page } from '@playwright/test'

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>A page</title>
<style>body{margin:24px;color:rgb(24,72,56)}.note{padding:12px;background:#edf5f0}strong{font-weight:700}</style></head>
<body><h1>Original heading</h1><p class="note">Hello <strong>world</strong>!</p>
<a href="https://example.com/old">Visit the site</a>
<script>window.pageCodeRan = true; parent.document.body.dataset.escaped = 'yes'</script>
</body></html>`

async function editHtml(page: Page, content = html) {
  await page.getByRole('combobox', { name: 'Document mode', exact: true }).selectOption('html')
  await page.locator('.cm-content').fill(content)
}

async function downloaded(page: Page) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search commands', exact: true }).fill('Download source')
  const pending = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), content: Buffer.concat(chunks).toString() }
}

test('visual text and link edits preserve formatting, scripts and editable HTML', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page).toHaveTitle('Markword')
  await editHtml(page)
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
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(preview.locator('h1')).toHaveText('A new heading')
  await expect(preview.getByRole('link')).toHaveAttribute('href', 'https://example.com/new')
  expect(errors).toEqual([])
})

test('source and visual HTML edits share undo history and the workspace view controls', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Undo.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  expect((await downloaded(page)).content).toBe(html)
  const changed = html.replace('Original heading', 'Changed in source')
  await page.locator('.cm-content').fill(changed)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Changed in source')
  expect((await downloaded(page)).content).toBe(changed)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Changed in source')
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
  await expect(page.locator('.pane--editor')).toBeHidden()
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Visual only')
  expect((await downloaded(page)).content).toContain('<h1>Visual only</h1>')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Changed in source')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Visual only')
  await page.getByRole('button', { name: 'Split editing', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('Visual only')
})

test('normal clicks and keyboard edits preserve text styling and work on button labels', async ({ page }) => {
  await page.goto('/')
  await editHtml(page, '<style>span{color:red}h1{color:rgb(24,72,56)}</style><h1>Click here</h1><form><button>Button text</button></form>')
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
  await page.goto('/')
  await editHtml(page)
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Visual version')
  const visual = (await downloaded(page)).content
  await page.locator('.cm-content').fill(visual.replace('Visual version', 'Source version'))
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Source version')
  await page.locator('.cm-content').fill(visual)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Visual version')
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Another visual edit')
  expect((await downloaded(page)).content).toContain('<h1>Another visual edit</h1>')
})

test('switching between Markdown and HTML changes the same document without replacing its source', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill(html)
  const shell = await page.locator('.app-shell').elementHandle()
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('html')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  expect((await downloaded(page)).content).toBe(html)
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('markdown')
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(await shell!.evaluate((node) => node === document.querySelector('.app-shell'))).toBe(true)
  await shell!.dispose()
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('html')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('html')
  expect((await downloaded(page)).content).toBe(html)
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(page.locator('.document-list__open')).toHaveCount(1)
})

test('opening and downloading an HTML file preserves the full source and file name', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open document or project' })).toBeEnabled()
  await page.locator('input[type=file]').first().setInputFiles({ name: '提案.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  const result = await downloaded(page)
  expect(result).toEqual({ name: '提案.html', content: html })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'wrong.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not HTML') })
  await expect(page.locator('.toast')).toContainText('Please choose a Markdown, text, Mermaid, Word (.docx), HTML, or project ZIP file')
  expect((await downloaded(page)).content).toBe(html)
})

test('dropping HTML into the HTML workspace opens the file without leaving the app', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open document or project' })).toBeEnabled()
  const transfer = await page.evaluateHandle((content) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([content], 'Dropped.HTM', { type: 'text/html' }))
    return transfer
  }, html)
  const editor = page.locator('.cm-content')
  const bounds = (await editor.boundingBox())!
  await editor.dispatchEvent('drop', { dataTransfer: transfer, clientX: bounds.x + 20, clientY: bounds.y + 20 })
  await transfer.dispose()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  expect(await downloaded(page)).toEqual({ name: 'Dropped.html', content: html })
  const replacement = '<h1>Dropped on the preview</h1>'
  await page.frameLocator('iframe').locator('body').evaluate((body, content) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([content], 'Preview.html', { type: 'text/html' }))
    body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, replacement)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Dropped on the preview')
  expect(await downloaded(page)).toEqual({ name: 'Preview.html', content: replacement })
})

test('preview blocks executable content, navigation and injected text without changing the source', async ({ page }) => {
  await page.goto('/')
  const source = html.replace('<body>', `<body onload="parent.document.body.dataset.escaped='yes'">
<meta http-equiv="refresh" content="0;url=https://example.com/escaped">
<iframe srcdoc="<script>parent.alert(1)</script>"></iframe>
<object data="https://example.com/escaped"></object>`)
  await editHtml(page, source)
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
  await expect(page).toHaveURL(/\/$/)
  await page.getByLabel('Link address', { exact: true }).fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a valid address, such as https://example.com.')
  await expect(page.locator('body')).not.toHaveAttribute('data-escaped')
})

test('a second tab cannot silently overwrite a newer HTML draft', async ({ page, context }) => {
  await page.goto('/')
  await editHtml(page)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.frameLocator('iframe').locator('h1')).toHaveText('Original heading')
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('First tab update')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await other.frameLocator('iframe').locator('h1 [contenteditable]').fill('Second tab update')
  await expect(other.locator('.save-status')).toHaveText('Changed elsewhere. Save to keep a copy.')
  expect((await downloaded(other)).content).toContain('Second tab update')
  await page.reload()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('First tab update')
})

test('storage failure keeps HTML edits and downloads available in the workspace', async ({ page }) => {
  await page.goto('/')
  await editHtml(page)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.route('**/api/workspace/drafts/*', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    else await route.continue()
  })
  const changed = html.replace('Original heading', 'Keep unsaved HTML')
  await page.locator('.cm-content').fill(changed)
  await expect(page.locator('.save-status')).toHaveText('Could not save. Try again.')
  expect((await downloaded(page)).content).toBe(changed)
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.locator('.toast')).toHaveText('Could not save your current document. Download a backup before switching.')
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Keep unsaved HTML')
})

test('mobile editing can switch between the rendered page and source without overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await editHtml(page)
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(page.locator('.pane--editor')).toBeHidden()
  await page.frameLocator('iframe').locator('h1 [contenteditable]').fill('Edited on mobile')
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('Edited on mobile')
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Edited on mobile')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('html-mode-mobile.png') })
})
