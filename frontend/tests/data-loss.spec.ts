import { expect, test, type Download, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

declare global {
  interface Window {
    dataLossHarness: {
      failWrites?: boolean
      releaseRead?: () => void
      releaseDraft?: () => void
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
  await page.addInitScript(() => {
    window.dataLossHarness = { failWrites: false }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts' && window.dataLossHarness.failWrites) throw new DOMException('Storage full', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.evaluate(() => { window.dataLossHarness.failWrites = true })
  await page.locator('.cm-content').fill('# Keep my unsaved work')
  await notifyUpdate(page)
  await updateDialog(page).getByRole('button', { name: 'Save and update', exact: true }).click()
  await expect(updateDialog(page).getByRole('alert')).toContainText('could not be saved')
  await expect(page.locator('.save-status')).toContainText('Draft not saved')
  await expect(page.locator('.cm-content')).toHaveText('# Keep my unsaved work')
  const backup = page.waitForEvent('download')
  await updateDialog(page).getByRole('button', { name: 'Download source', exact: true }).click()
  expect(await downloadedText(await backup)).toBe('# Keep my unsaved work')
  await expect(updateDialog(page)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('update-save-failed-desktop.png') })
  await updateDialog(page).getByRole('button', { name: 'Later', exact: true }).click()
  await page.locator('.cm-content').fill('# Newer work after the failed update')
  await page.evaluate(() => { window.dataLossHarness.failWrites = false })
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
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  const stale = await context.newPage()
  await stale.goto('/')
  await expect(stale.locator('.save-status')).toHaveText('Saved in this browser')
  await page.locator('.cm-content').fill('# Newer saved copy')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
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
  await dialog.getByRole('button', { name: '下載專案 ZIP', exact: true }).click()
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
    await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
    await page.reload()
    await expect(page.locator('.cm-content')).toHaveText('# Keep these edits')
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
  })
}

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
  await page.addInitScript(() => {
    window.dataLossHarness = { pickerCalls: 0 }
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => { window.dataLossHarness.pickerCalls! += 1; return [] } })
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (...args) => {
      const request = open(...args)
      request.addEventListener('success', (event) => {
        event.stopImmediatePropagation()
        window.dataLossHarness.releaseDraft = () => request.dispatchEvent(new Event('success'))
      }, { once: true })
      return request
    }
  })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(window.dataLossHarness.releaseDraft))).toBe(true)
  await expect(page.getByText('Loading local draft…', { exact: true })).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })))
  expect(await page.evaluate(() => window.dataLossHarness.pickerCalls)).toBe(0)
  await notifyUpdate(page)
  await expect(updateDialog(page)).toHaveCount(0)
  await page.evaluate(() => window.dataLossHarness.releaseDraft?.())
  await expect(updateDialog(page)).toBeVisible()
  await updateDialog(page).getByRole('button', { name: 'Later', exact: true }).click()
  await expect(page.locator('.cm-content')).toBeVisible()
  await openButton(page).click()
  await expect.poll(() => page.evaluate(() => window.dataLossHarness.pickerCalls)).toBe(1)
})
