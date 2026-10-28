import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './shared-workspace-fixture'

const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const library = (page: Page) => page.locator('#workspace-documents')
const documentButton = (page: Page, name: string) => library(page).locator('.document-list__open').filter({ has: page.getByText(name, { exact: true }) })

async function seedDocument(request: APIRequestContext, content: string) {
  const id = `quick-${randomUUID()}`
  const response = await request.post(`/api/workspace/drafts/${id}`, { data: { content, metadata: { mode: 'markdown', theme: 'Light' }, expectedVersion: null } })
  expect(response.ok()).toBe(true)
  return id
}

async function startAt(page: Page, id: string) {
  await page.addInitScript((documentId) => {
    localStorage.setItem('markword.preference.active-document', JSON.stringify(documentId))
  }, id)
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
}

test('Ctrl+S and Save persist the latest capture in the shared database without opening a file picker', async ({ page, request, browser }) => {
  const id = await seedDocument(request, '# Quick capture')
  await page.addInitScript(() => {
    Reflect.set(window, 'savePickerCalls', 0)
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
      Reflect.set(window, 'savePickerCalls', Number(Reflect.get(window, 'savePickerCalls')) + 1)
      throw new DOMException('File picker must not open for quick capture', 'AbortError')
    } })
  })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await startAt(page, id)
  const first = '# Quick capture\n\nSave immediately with Ctrl+S.'
  await page.locator('.cm-content').fill(first)
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/workspace/drafts/${id}`)),
    page.keyboard.press('Control+s'),
  ])
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  expect((await (await request.get(`/api/workspace/drafts/${id}`)).json()).content).toBe(first)

  const latest = first + '\n\nThe top Save button also uses the database.'
  await page.locator('.cm-content').fill(latest)
  await page.locator('.save-trigger').click()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  expect((await (await request.get(`/api/workspace/drafts/${id}`)).json()).content).toBe(latest)
  expect(await page.evaluate(() => Reflect.get(window, 'savePickerCalls'))).toBe(0)
  expect(downloads).toEqual([])

  const independent = await browser.newContext({ locale: 'en' })
  try {
    const other = await independent.newPage()
    await startAt(other, id)
    await expect.poll(() => source(other)).toBe(latest)
  } finally { await independent.close() }
})

test('Ctrl+S saves a new capture after the local service recovers from an initialization failure', async ({ page, request, browser }) => {
  const original = '# Existing note\n\nKeep the unavailable original.'
  const response = await request.post('/api/workspace/drafts/current', { data: { content: original, metadata: { mode: 'markdown', theme: 'Light', retainedSetting: true }, expectedVersion: null } })
  expect(response.ok()).toBe(true)
  await page.addInitScript(() => {
    Reflect.set(window, 'savePickerCalls', 0)
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
      Reflect.set(window, 'savePickerCalls', Number(Reflect.get(window, 'savePickerCalls')) + 1)
      throw new DOMException('File picker must not open for quick capture', 'AbortError')
    } })
  })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.route('**/api/workspace/drafts**', (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Local service unavailable' }) })
    : route.continue())
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Could not save. Try again.')
  await expect.poll(() => source(page)).toBe('')
  await expect(page.locator('.save-trigger')).toBeEnabled()
  const capture = '# Capture during startup failure\n\nSave this once the service returns.'
  await page.locator('.cm-content').fill(capture)
  await page.unroute('**/api/workspace/drafts**')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect.poll(() => source(page)).toBe(capture)
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('markword.preference.active-document')!))
  expect(id).not.toBe('current')
  const saved = await (await request.get(`/api/workspace/drafts/${id}`)).json()
  expect(saved.content).toBe(capture)
  expect(saved.metadata).toMatchObject({ mode: 'markdown', theme: 'Light', importSummary: null, name: null })
  expect(saved.metadata.retainedSetting).toBeUndefined()
  expect(await (await request.get('/api/workspace/drafts/current')).json()).toMatchObject({ content: original, metadata: { retainedSetting: true } })
  expect(await page.evaluate(() => Reflect.get(window, 'savePickerCalls'))).toBe(0)
  expect(downloads).toEqual([])

  const independent = await browser.newContext({ locale: 'en' })
  try {
    const other = await independent.newPage()
    await startAt(other, id)
    await expect.poll(() => source(other)).toBe(capture)
  } finally { await independent.close() }
})

test('three captures remain in the open sidebar while switching, importing, and copying documents', async ({ page, request }, testInfo) => {
  const prefix = `Capture ${randomUUID().slice(0, 8)}`
  const names = [`${prefix} one`, `${prefix} two`, `${prefix} three`]
  await startAt(page, await seedDocument(request, `# ${names[0]}\n\nFirst capture.`))
  await page.locator('.documents-trigger').click()
  for (const name of names.slice(1)) {
    await page.locator('.header-actions').getByRole('button', { name: 'New document', exact: true }).click()
    await expect(library(page)).toBeVisible()
    await expect.poll(() => source(page)).toBe('')
    await page.locator('.cm-content').fill(`# ${name}\n\nKeep every capture.`)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
  }
  for (const name of names) await expect(documentButton(page, name)).toBeVisible()
  await expect(library(page).locator('.document-list__open')).toHaveCount(3)
  await documentButton(page, names[0]).click()
  await expect(page.locator('.document-heading')).toContainText(names[0])
  await expect(library(page)).toBeVisible()
  await expect(documentButton(page, names[0])).toHaveAttribute('aria-current', 'page')
  await documentButton(page, names[0]).click()
  await expect(library(page)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('quick-capture-desktop.png') })

  const imported = `${prefix} imported`
  await page.locator('input[type=file]').first().setInputFiles({ name: `${imported}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`# ${imported}\n\nImported capture.`) })
  await expect(page.locator('.document-heading')).toContainText(imported)
  await expect(library(page)).toBeVisible()
  const importedRow = documentButton(page, imported).locator('..')
  await importedRow.locator('summary').click()
  await importedRow.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.document-heading')).toContainText(`Copy of ${imported}`)
  await expect(library(page)).toBeVisible()
  await page.reload()
  await expect(library(page)).toBeVisible()
  await page.locator('.documents-trigger').click()
  await expect(library(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect(library(page)).toHaveCount(0)
})

test('Ctrl+S keeps conflicting captures as separate documents', async ({ page, request, browser }) => {
  const title = `Conflicting ${randomUUID().slice(0, 8)}`
  const id = await seedDocument(request, `# ${title}\n\nInitial capture.`)
  await startAt(page, id)
  await page.locator('.documents-trigger').click()
  const independent = await browser.newContext({ locale: 'en' })
  try {
    const other = await independent.newPage()
    await startAt(other, id)
    const first = `# ${title}\n\nSaved by the other browser.`
    await other.locator('.cm-content').fill(first)
    await other.keyboard.press('Control+s')
    await expect(other.locator('.save-status')).toHaveText('Saved locally')
    const second = `# ${title}\n\nKeep this capture too.`
    await page.locator('.cm-content').fill(second)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.document-heading')).toContainText(`Copy of ${title}`)
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    await expect(library(page)).toBeVisible()
    await expect.poll(() => source(page)).toBe(second)
    const copyId = await page.evaluate(() => JSON.parse(localStorage.getItem('markword.preference.active-document')!))
    expect(copyId).not.toBe(id)
    expect((await (await request.get(`/api/workspace/drafts/${id}`)).json()).content).toBe(first)
    expect((await (await request.get(`/api/workspace/drafts/${copyId}`)).json()).content).toBe(second)
  } finally { await independent.close() }
})

test('mobile navigation stays open after selection and closes explicitly', async ({ page, request }, testInfo) => {
  const first = `Mobile ${randomUUID().slice(0, 8)}`
  const firstId = await seedDocument(request, `# ${first}`)
  const second = `${first} second`
  await seedDocument(request, `# ${second}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await startAt(page, firstId)
  await page.locator('.documents-trigger').click()
  await documentButton(page, second).click()
  await expect(page.locator('.document-heading')).toContainText(second)
  await expect(page.getByRole('dialog', { name: 'Documents', exact: true })).toBeVisible()
  await expect(documentButton(page, second)).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('quick-capture-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(library(page)).toHaveCount(0)
  await expect(page.locator('.documents-trigger')).toBeFocused()
})
