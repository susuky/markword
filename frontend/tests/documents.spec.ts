import { expect, test, type Page } from '@playwright/test'

const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const library = (page: Page) => page.getByRole('complementary', { name: 'Documents', exact: true })
async function showDocuments(page: Page) {
  if (!await library(page).isVisible()) await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(library(page)).toBeVisible()
}
function documentRow(page: Page, name: string) {
  return library(page).locator('.document-list > li').filter({ has: page.getByText(name, { exact: true }) })
}
async function openDocument(page: Page, name: string) {
  await showDocuments(page)
  await documentRow(page, name).locator('.document-list__open').click()
  await expect(library(page)).toHaveCount(0)
  await expect(page.locator('.document-heading')).toContainText(name)
}
async function createDocument(page: Page) {
  await showDocuments(page)
  await library(page).getByRole('button', { name: 'New document', exact: true }).click()
  await expect.poll(() => source(page)).toBe('')
}
async function snapshot(page: Page) {
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Create current revision', exact: true }).click()
  await expect(page.locator('.revision-panel__message')).toHaveText('Current revision created')
  await page.getByRole('button', { name: 'Close revision history', exact: true }).click()
}

test('documents keep pending edits, separate revisions, and remember the last document', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const original = '# Meeting\n\nKeep the original document.'
  await page.locator('.cm-content').fill(original)
  await snapshot(page)
  const pending = original + '\n\nA final edit just before switching.'
  await page.locator('.cm-content').fill(pending)
  await createDocument(page)
  await page.locator('.cm-content').fill('# Proposal\n\nA different document.')
  await snapshot(page)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText('# Proposal\n\nA different document.')
  await page.keyboard.press('Escape')
  await openDocument(page, 'Meeting')
  await expect.poll(() => source(page)).toBe(pending)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText(original)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect.poll(() => source(page)).toBe(pending)
  await openDocument(page, 'Proposal')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe('# Proposal\n\nA different document.')
  expect(errors).toEqual([])
})

test('renaming, searching, copying, trashing, and restoring preserve the source', async ({ page }) => {
  await page.goto('/')
  const original = '# Meeting\n\n**Original source** stays unchanged.'
  await page.locator('.cm-content').fill(original)
  await showDocuments(page)
  await documentRow(page, 'Meeting').locator('summary').click()
  await documentRow(page, 'Meeting').getByRole('button', { name: 'Rename', exact: true }).click()
  await library(page).getByRole('textbox', { name: 'Document name', exact: true }).fill('工作筆記')
  await library(page).getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.locator('.document-heading')).toContainText('工作筆記')
  await expect.poll(() => source(page)).toBe(original)
  await library(page).getByRole('searchbox', { name: 'Search documents', exact: true }).fill('找不到的名稱')
  await expect(library(page)).toContainText('No documents match this name.')
  await library(page).getByRole('searchbox', { name: 'Search documents', exact: true }).fill('工作')
  await expect(library(page).locator('.document-list__open')).toHaveCount(1)
  await documentRow(page, '工作筆記').locator('summary').click()
  await documentRow(page, '工作筆記').getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.document-heading')).toContainText('Copy of 工作筆記')
  await expect.poll(() => source(page)).toBe(original)
  await page.locator('.cm-content').fill('# Copy edited\n\nOnly the copy changed.')
  await openDocument(page, '工作筆記')
  await expect.poll(() => source(page)).toBe(original)
  await showDocuments(page)
  await documentRow(page, '工作筆記').locator('summary').click()
  await documentRow(page, '工作筆記').getByRole('button', { name: 'Move to trash', exact: true }).click()
  await expect(page.locator('.document-heading')).toContainText('Copy of 工作筆記')
  await showDocuments(page)
  await library(page).getByRole('button', { name: 'Trash', exact: true }).click()
  await expect(documentRow(page, '工作筆記')).toBeVisible()
  await library(page).getByRole('button', { name: 'Restore 工作筆記', exact: true }).click()
  await expect(library(page)).toContainText('The trash is empty.')
  await library(page).getByRole('button', { name: 'Documents', exact: true }).click()
  await documentRow(page, '工作筆記').locator('.document-list__open').click()
  await expect.poll(() => source(page)).toBe(original)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown Keep the editable source', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('工作筆記.md')
})

test('opening a file keeps the previous document and gives the imported file its own revisions', async ({ page }) => {
  await page.goto('/')
  const original = '# Before import\n\nDo not replace this document.'
  await page.locator('.cm-content').fill(original)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Imported.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported\n\nSeparate content.') })
  await expect.poll(() => source(page)).toBe('# Imported\n\nSeparate content.')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list')).toContainText('No revisions yet.')
  await page.keyboard.press('Escape')
  await openDocument(page, 'Before import')
  await expect.poll(() => source(page)).toBe(original)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list')).toContainText('Pre-open backup')
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText(original)
})

test('migration preserves the old Markdown draft, versions, attachments, and independent HTML draft', async ({ page }) => {
  await page.route('**/seed-storage', (route) => route.fulfill({ contentType: 'text/html', body: '<body>Prepare isolated storage</body>' }))
  await page.goto('/seed-storage')
  const png = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64'))
  await page.evaluate((bytes) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('markword', 2)
    open.onupgradeneeded = () => {
      const database = open.result
      database.createObjectStore('drafts', { keyPath: 'id' })
      database.createObjectStore('revisions', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
      const assets = database.createObjectStore('assets', { keyPath: 'id' })
      assets.createIndex('path', 'path', { unique: true }); assets.createIndex('createdAt', 'createdAt')
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction(['drafts', 'revisions', 'assets'], 'readwrite')
      transaction.objectStore('drafts').put({ id: 'current', version: 7, content: '# Legacy note\n\n![Kept](./assets/legacy.png)', metadata: { mode: 'markdown', theme: 'Light', retainedSetting: true }, createdAt: 10, updatedAt: 20 })
      transaction.objectStore('drafts').put({ id: 'html', version: 4, content: '<h1>Separate HTML</h1>', metadata: { filename: 'legacy.html' }, createdAt: 11, updatedAt: 21 })
      transaction.objectStore('revisions').put({ id: 'legacy-revision', content: '# Earlier legacy note', metadata: { mode: 'markdown' }, reason: 'manual', createdAt: 15 })
      transaction.objectStore('assets').put({ id: 'legacy-asset', path: 'assets/legacy.png', name: 'legacy.png', type: 'image/png', kind: 'image', size: bytes.length, blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), createdAt: 12, updatedAt: 12 })
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  }), png)
  await page.goto('/')
  await expect.poll(() => source(page)).toBe('# Legacy note\n\n![Kept](./assets/legacy.png)')
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  await showDocuments(page)
  await expect(library(page).locator('.document-list__open')).toHaveCount(1)
  await library(page).getByRole('button', { name: 'Close documents', exact: true }).click()
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText('# Earlier legacy note')
  await page.keyboard.press('Escape')
  const retained = await page.evaluate(async () => {
    const module = '/src/storage.ts'
    const storage = await import(/* @vite-ignore */ module)
    return { draft: await storage.getCurrentDraft(), html: await storage.getCurrentDraft('html'), revisions: await storage.listRevisions(), assets: (await storage.listAssets()).map((asset: { id: string; blob: Blob }) => ({ id: asset.id, size: asset.blob.size })) }
  })
  expect(retained.draft.metadata.retainedSetting).toBe(true)
  expect(retained.html).toMatchObject({ version: 4, content: '<h1>Separate HTML</h1>', metadata: { filename: 'legacy.html' } })
  expect(retained.revisions[0]).toMatchObject({ id: 'legacy-revision', documentId: 'current', content: '# Earlier legacy note' })
  expect(retained.assets).toEqual([{ id: 'legacy-asset', size: png.length }])
  await createDocument(page)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list')).toContainText('No revisions yet.')
})

test('a save conflict stops switching without discarding either tab’s content', async ({ page, context }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared note\n\nStarting content.')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  const other = await context.newPage()
  await other.goto('/')
  await expect.poll(() => source(other)).toBe('# Shared note\n\nStarting content.')
  await expect(other.locator('.save-status')).toHaveText('Saved in this browser')
  await page.locator('.cm-content').fill('# Shared note\n\nFirst tab saved.')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await other.locator('.cm-content').fill('# Shared note\n\nSecond tab still has this copy.')
  await expect(other.locator('.save-status')).toContainText('Changed in another tab')
  await showDocuments(other)
  await library(other).getByRole('button', { name: 'New document', exact: true }).click()
  await expect(library(other).getByRole('alert')).toContainText('Download a backup before switching')
  await expect.poll(() => source(other)).toBe('# Shared note\n\nSecond tab still has this copy.')
  await expect.poll(() => source(page)).toBe('# Shared note\n\nFirst tab saved.')
  await expect(library(other).locator('.document-list__open')).toHaveCount(1)
})

test('revision limits apply per document and a revision from another document cannot be restored', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  const result = await page.evaluate(async () => {
    const module = '/src/storage.ts'
    const storage = await import(/* @vite-ignore */ module)
    const other = await storage.createWorkspaceDocument('# Other document', { mode: 'markdown' })
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('markword', 3); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('revisions', 'readwrite')
      const store = transaction.objectStore('revisions')
      for (let i = 0; i < 125; i++) store.put({ id: `current-${i}`, documentId: 'current', content: `Original ${i}`, metadata: {}, createdAt: i, reason: 'manual' })
      for (let i = 0; i < 3; i++) store.put({ id: `other-${i}`, documentId: other.id, content: `Other ${i}`, metadata: {}, createdAt: i, reason: 'manual' })
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    await storage.createSnapshot('Latest current revision')
    const session = new storage.DraftPersistenceSession()
    await session.initialize()
    let refused = false
    try { await session.restore('other-0') } catch { refused = true }
    return { current: (await storage.listRevisions()).length, other: (await storage.listRevisions(other.id)).length, refused }
  })
  expect(result).toEqual({ current: 120, other: 3, refused: true })
})

test('mobile document navigation keeps long names readable, traps focus, and returns to the trigger', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await page.locator('.cm-content').fill('# 很長的中文文件名稱，用來確認手機上的文件導覽仍然清楚並且可操作\n\n保留原文。')
  await expect(page.locator('.save-status')).toHaveText('已儲存在此瀏覽器')
  await page.locator('.header-actions').getByRole('button', { name: '文件', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '文件', exact: true })
  await expect(dialog.getByRole('searchbox', { name: '搜尋文件', exact: true })).toBeFocused()
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('documents-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.header-actions').getByRole('button', { name: '文件', exact: true })).toBeFocused()
})

test('trashing the last document opens an empty document and keeps the trashed version recoverable', async ({ page }) => {
  await page.goto('/')
  const original = '# Last document\n\nRecover this later.'
  await page.locator('.cm-content').fill(original)
  await snapshot(page)
  await showDocuments(page)
  await documentRow(page, 'Last document').locator('summary').click()
  await documentRow(page, 'Last document').getByRole('button', { name: 'Move to trash', exact: true }).click()
  await expect.poll(() => source(page)).toBe('')
  await showDocuments(page)
  await expect(library(page).locator('.document-list__open')).toHaveCount(1)
  await library(page).getByRole('button', { name: 'Trash', exact: true }).click()
  await library(page).getByRole('button', { name: 'Restore Last document', exact: true }).click()
  await library(page).getByRole('button', { name: 'Documents', exact: true }).click()
  await documentRow(page, 'Last document').locator('.document-list__open').click()
  await expect.poll(() => source(page)).toBe(original)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list button')).toHaveCount(1)
})

test('asset deletion warns about other documents and about revisions after all current references are removed', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared image')
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64') })
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  await snapshot(page)
  await showDocuments(page)
  await documentRow(page, 'Shared image').locator('summary').click()
  await documentRow(page, 'Shared image').getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.document-heading')).toContainText('Copy of Shared image')
  await createDocument(page)
  await checkWarning()
  await openDocument(page, 'Shared image')
  await page.locator('.cm-content').fill('# Original without image')
  await openDocument(page, 'Copy of Shared image')
  await page.locator('.cm-content').fill('# Copy without image')
  await openDocument(page, 'Untitled document')
  await checkWarning()

  async function checkWarning() {
    await page.getByRole('button', { name: 'Manage local assets', exact: true }).click()
    let message = ''
    page.once('dialog', async (dialog) => { message = dialog.message(); await dialog.dismiss() })
    await page.getByRole('button', { name: 'Delete image.png', exact: true }).click()
    await expect.poll(() => message).toContain('Another document or saved revision uses this asset')
    await expect(page.locator('.asset-item')).toHaveCount(1)
    await page.getByRole('button', { name: 'Close local assets', exact: true }).click()
  }
})
