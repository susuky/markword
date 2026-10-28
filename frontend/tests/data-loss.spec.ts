import { expect, test } from './shared-workspace-fixture'
import { type Download, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

declare global {
  interface Window {
    dataLossHarness: {
      releaseRead?: () => void
      pickerCalls?: number
    }
  }
}

const notifyUpdate = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('markword:update-available')))
const updateDialog = (page: Page) => page.getByRole('dialog', { name: 'Update available' })
const openButton = (page: Page) => page.getByRole('button', { name: 'Open document or project', exact: true })

async function downloadedText(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

test('updating saves the pending debounce before reloading', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window)
    window.setTimeout = (handler, delay, ...args) => original(handler, delay === 350 ? 60_000 : delay, ...args)
  })
  await page.goto('/')
  await page.locator('.cm-content').fill('# The very latest edit')
  await notifyUpdate(page)
  await expect(updateDialog(page)).toBeVisible()
  await expect(page.locator('.save-status')).toHaveText('Saving…')
  await expect(page.locator('.cm-content')).toHaveText('# The very latest edit')
  const reloaded = page.waitForEvent('load')
  await updateDialog(page).getByRole('button', { name: 'Save and update', exact: true }).click()
  await reloaded
  await expect(page.locator('.cm-content')).toHaveText('# The very latest edit')
  await expect(updateDialog(page)).toHaveCount(0)
})

test('failed update saves preserve edits, allow backups, and can be retried', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let failWrites = false
  await page.route('**/api/workspace/drafts/**', async (route) => {
    if (failWrites && route.request().method() === 'POST') {
      await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  failWrites = true
  await page.locator('.cm-content').fill('# Keep my unsaved work')
  await notifyUpdate(page)
  await updateDialog(page).getByRole('button', { name: 'Save and update', exact: true }).click()
  await expect(updateDialog(page).getByRole('alert')).toContainText('could not be saved')
  await expect(page.locator('.save-status')).toHaveText('Could not save. Try again.')
  await expect(page.locator('.cm-content')).toHaveText('# Keep my unsaved work')
  const backup = page.waitForEvent('download')
  await updateDialog(page).getByRole('button', { name: 'Download source', exact: true }).click()
  expect(await downloadedText(await backup)).toBe('# Keep my unsaved work')
  await expect(updateDialog(page)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('update-save-failed-desktop.png') })
  await updateDialog(page).getByRole('button', { name: 'Later', exact: true }).click()
  await page.locator('.cm-content').fill('# Newer work after the failed update')
  failWrites = false
  await notifyUpdate(page)
  const reloaded = page.waitForEvent('load')
  await updateDialog(page).getByRole('button', { name: 'Save and update', exact: true }).click()
  await reloaded
  await expect(page.locator('.cm-content')).toHaveText('# Newer work after the failed update')
  expect(errors).toEqual([])
})

test('a conflicting update keeps both tab copies and offers a project backup on mobile', async ({ page, context }, testInfo) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared starting point')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const stale = await context.newPage()
  await stale.goto('/')
  await expect(stale.locator('.save-status')).toHaveText('Saved locally')
  await page.locator('.cm-content').fill('# Newer saved copy')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await stale.setViewportSize({ width: 390, height: 844 })
  await stale.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await stale.locator('.cm-content').fill('# 保留此分頁的修改')
  await notifyUpdate(stale)
  const dialog = stale.getByRole('dialog', { name: '有新版本可更新' })
  await dialog.getByRole('button', { name: '儲存並更新', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('草稿無法儲存')
  await expect(stale.locator('.save-status')).toContainText('其他分頁已更新')
  await expect(stale.locator('.cm-content')).toHaveText('# 保留此分頁的修改')
  const backup = stale.waitForEvent('download')
  await dialog.getByRole('button', { name: '下載文件與資產庫 ZIP', exact: true }).click()
  expect((await backup).suggestedFilename()).toMatch(/\.markword\.zip$/)
  await expect(dialog).toBeVisible()
  expect(await stale.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await stale.screenshot({ path: testInfo.outputPath('update-conflict-mobile.png') })
  await page.reload()
  await expect(page.locator('.cm-content')).toHaveText('# Newer saved copy')
})

const slowFiles = [
  { name: 'Slow.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported source') },
  { name: 'Slow.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Imported source</h1>') },
  { name: 'Slow.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'document.md': strToU8('# Imported source') })) },
  { name: 'Slow.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Imported source</w:t></w:r></w:p></w:body></w:document>'),
  })) },
]

async function holdFileRead(page: Page) {
  await page.addInitScript(() => {
    window.dataLossHarness = {}
    const arrayBuffer = File.prototype.arrayBuffer
    const text = File.prototype.text
    const hold = (file: File) => file.name.startsWith('Slow.')
      ? new Promise<void>((resolve) => { window.dataLossHarness.releaseRead = resolve }) : Promise.resolve()
    File.prototype.arrayBuffer = async function () { await hold(this); return arrayBuffer.call(this) }
    File.prototype.text = async function () { await hold(this); return text.call(this) }
  })
}

for (const file of slowFiles) {
  test(`opening ${file.name} preserves the previous document and its settings and versions`, async ({ page }, testInfo) => {
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
    await page.getByRole('button', { name: 'Preview theme: Light', exact: true }).click()
    await page.locator('.theme-menu__grid button').nth(1).click()
    const original = 'Latest text before opening another document'
    const imported = file.name.endsWith('.docx') ? 'Imported source' : '# Imported source'
    await page.locator('.cm-content').fill(original)
    await page.locator('input[type=file]').first().setInputFiles(file)
    await expect(page.locator('.cm-content')).toHaveText(imported)
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    await page.reload()
    await expect(page.locator('.cm-content')).toHaveText(imported)
    await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
    await page.locator('.document-list__open').filter({ has: page.getByText('Untitled document', { exact: true }) }).click()
    await expect(page.locator('.cm-content')).toHaveText(original)
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
    await page.getByRole('button', { name: 'Revision history', exact: true }).click()
    await expect(page.locator('.revision-list')).toContainText('Pre-open backup')
    await page.getByRole('button', { name: 'Restore this revision', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Source editor', exact: true })).toHaveText(original)
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
    await expect(page.getByRole('button', { name: 'Preview theme: Paper', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close revision history', exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath(`pre-open-${file.name}.png`) })
    await page.reload()
    await expect(page.locator('.cm-content')).toHaveText(original)
  })

  test(`delayed ${file.name} imports keep intervening edits and document mode`, async ({ page }) => {
    await holdFileRead(page)
    await page.goto('/')
    await page.locator('.cm-content').fill('# Keep these edits')
    await page.locator('input[type=file]').first().setInputFiles(file)
    await expect.poll(() => page.evaluate(() => Boolean(window.dataLossHarness.releaseRead))).toBe(true)
    await page.locator('.cm-content').fill('# A temporary change')
    await page.locator('.cm-content').fill('# Keep these edits')
    await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
    await page.evaluate(() => window.dataLossHarness.releaseRead?.())
    await expect(openButton(page)).toBeEnabled()
    await expect(page.locator('.toast')).toContainText('Your document changed while opening this file')
    await expect(page.locator('.cm-content')).toHaveText('# Keep these edits')
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    await page.reload()
    await expect(page.locator('.cm-content')).toHaveText('# Keep these edits')
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
  })
}

test('a failed pre-open backup keeps the current document and can be retried', async ({ page }) => {
  let failRevisionWrites = false
  await page.route('**/api/workspace/revisions', async (route) => {
    if (failRevisionWrites && route.request().method() === 'POST') {
      await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    } else await route.continue()
  })
  await page.goto('/')
  await page.locator('.cm-content').fill('# Keep before opening')
  failRevisionWrites = true
  await page.locator('input[type=file]').first().setInputFiles(slowFiles[0])
  await expect(page.locator('.toast')).toContainText('It has not been replaced')
  await expect(page.locator('.cm-content')).toHaveText('# Keep before opening')
  failRevisionWrites = false
  await page.reload()
  await expect(page.locator('.cm-content')).toHaveText('# Keep before opening')
  await page.locator('input[type=file]').first().setInputFiles(slowFiles[0])
  await expect(page.locator('.cm-content')).toHaveText('# Imported source')
})

test('a conflicting pre-open backup does not replace either tab copy', async ({ page, context }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared copy')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const stale = await context.newPage()
  await stale.goto('/')
  await expect(stale.locator('.cm-content')).toHaveText('# Shared copy')
  await page.locator('.cm-content').fill('# Newer copy in another tab')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await stale.locator('.cm-content').fill('# Unsaved stale copy')
  await stale.locator('input[type=file]').first().setInputFiles(slowFiles[0])
  await expect(stale.locator('.toast')).toContainText('It has not been replaced')
  await expect(stale.locator('.cm-content')).toHaveText('# Unsaved stale copy')
  await page.reload()
  await expect(page.locator('.cm-content')).toHaveText('# Newer copy in another tab')
})

test('edits made while the pre-open snapshot commits are preserved', async ({ page }) => {
  let releaseSnapshot: (() => void) | undefined
  let holdSnapshot = true
  await page.route('**/api/workspace/revisions', async (route) => {
    if (route.request().method() === 'POST' && holdSnapshot) {
      holdSnapshot = false
      const response = await route.fetch()
      await new Promise<void>((resolve) => { releaseSnapshot = resolve })
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.goto('/')
  await page.locator('.cm-content').fill('# Before snapshot')
  await page.locator('input[type=file]').first().setInputFiles(slowFiles[0])
  await expect.poll(() => Boolean(releaseSnapshot)).toBe(true)
  await page.locator('.cm-content').fill('# Edited while backing up')
  releaseSnapshot?.()
  await expect(page.locator('.toast')).toContainText('Your document changed while opening this file')
  await expect(page.locator('.cm-content')).toHaveText('# Edited while backing up')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(page.locator('.cm-content')).toHaveText('# Edited while backing up')
})

test('updates wait for a pending import to finish', async ({ page }) => {
  await holdFileRead(page)
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(slowFiles[1])
  await expect.poll(() => page.evaluate(() => Boolean(window.dataLossHarness.releaseRead))).toBe(true)
  await notifyUpdate(page)
  await expect(updateDialog(page).getByRole('button', { name: 'Save and update', exact: true })).toBeDisabled()
  await page.evaluate(() => window.dataLossHarness.releaseRead?.())
  await expect(updateDialog(page).getByRole('button', { name: 'Save and update', exact: true })).toBeEnabled()
  const reloaded = page.waitForEvent('load')
  await updateDialog(page).getByRole('button', { name: 'Save and update', exact: true }).click()
  await reloaded
  await expect(page.locator('.cm-content')).toHaveText('# Imported source')
})

test('draft loading blocks editing and file shortcuts until hydration completes', async ({ page }) => {
  let releaseDraft: (() => void) | undefined
  let draftBlocked = false
  const draftReady = new Promise<void>((resolve) => { releaseDraft = resolve })
  await page.route('**/api/workspace/drafts', async (route) => {
    if (route.request().method() === 'GET') {
      draftBlocked = true
      await draftReady
    }
    await route.continue()
  })
  await page.addInitScript(() => {
    window.dataLossHarness = { pickerCalls: 0 }
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => { window.dataLossHarness.pickerCalls! += 1; return [] } })
  })
  await page.goto('/')
  await expect.poll(() => draftBlocked).toBe(true)
  await expect(page.getByText('Opening documents…', { exact: true })).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })))
  expect(await page.evaluate(() => window.dataLossHarness.pickerCalls)).toBe(0)
  await notifyUpdate(page)
  await expect(updateDialog(page)).toHaveCount(0)
  releaseDraft?.()
  await expect(updateDialog(page)).toBeVisible()
  await updateDialog(page).getByRole('button', { name: 'Later', exact: true }).click()
  await expect(page.locator('.cm-content')).toBeVisible()
  await openButton(page).click()
  await expect.poll(() => page.evaluate(() => window.dataLossHarness.pickerCalls)).toBe(1)
})
