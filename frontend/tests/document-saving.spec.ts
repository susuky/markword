import { expect, test } from './shared-workspace-fixture'
import { type Page } from '@playwright/test'

const library = (page: Page) => page.locator('#workspace-documents')
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))

test('two tabs saving identical edits synchronize versions and can keep writing', async ({ page, context }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared note')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.locator('.save-status')).toHaveText('Saved locally')
  const identical = '# Shared note\n\nThe same edit in both tabs.'
  await page.locator('.cm-content').fill(identical)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await other.locator('.cm-content').fill(identical)
  await expect(other.locator('.save-status')).toHaveText('Saved locally')
  await other.locator('.cm-content').fill(identical + '\n\nA later edit.')
  await expect(other.locator('.save-status')).toHaveText('Saved locally')
  await other.reload()
  await expect.poll(() => source(other)).toBe(identical + '\n\nA later edit.')
})

test('retrying a failed new-document action saves the latest edits before switching', async ({ page }) => {
  let failWrites = false
  await page.route('**/api/workspace/drafts/**', async (route) => {
    if (failWrites && route.request().method() === 'POST') {
      await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  failWrites = true
  await page.locator('.cm-content').fill('# Pending note\n\nKeep this edit.')
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  await page.locator('.header-actions').getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('Could not save your current document')
  await page.locator('.cm-content').fill('# Pending note\n\nThe latest edit after failure.')
  failWrites = false
  await page.locator('.header-actions').getByRole('button', { name: 'New document', exact: true }).click()
  await expect(library(page)).toBeVisible()
  await expect.poll(() => source(page)).toBe('')
  await library(page).locator('.document-list__open').filter({ hasText: 'Pending note' }).click()
  await expect.poll(() => source(page)).toBe('# Pending note\n\nThe latest edit after failure.')
})

test('canceling a failed rename clears the pending retry', async ({ page }) => {
  let failWrites = false
  await page.route('**/api/workspace/drafts/**', async (route) => {
    if (failWrites && route.request().method() === 'POST') {
      await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.evaluate(async () => {
    const module = '/src/storage.ts'
    const storage = await import(/* @vite-ignore */ module)
    await storage.createWorkspaceDocument('# Rename target', { mode: 'markdown' })
  })
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  const row = library(page).locator('.document-list > li').filter({ hasText: 'Rename target' })
  await row.locator('summary').click()
  await row.getByRole('button', { name: 'Rename', exact: true }).click()
  await row.getByRole('textbox', { name: 'Document name', exact: true }).fill('Canceled name')
  failWrites = true
  await row.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(library(page).getByRole('alert')).toBeVisible()
  await row.getByRole('button', { name: 'Cancel', exact: true }).click()
  failWrites = false
  await expect(library(page).getByRole('alert')).toHaveCount(0)
  await expect(library(page).getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  await expect(row.locator('.document-list__open')).toContainText('Rename target')
})

test('retrying a document list conflict uses the refreshed document version', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const id = await page.evaluate(async () => {
    const module = '/src/storage.ts'
    const storage = await import(/* @vite-ignore */ module)
    return (await storage.createWorkspaceDocument('# Rename target', { mode: 'markdown' })).id as string
  })
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  const row = library(page).locator('.document-list > li').filter({ hasText: 'Rename target' })
  await row.locator('summary').click()
  await row.getByRole('button', { name: 'Rename', exact: true }).click()
  const form = library(page).locator('.document-list__rename')
  await form.getByRole('textbox', { name: 'Document name', exact: true }).fill('My renamed target')
  await page.evaluate(async (documentId) => {
    const module = '/src/storage.ts'
    const storage = await import(/* @vite-ignore */ module)
    const draft = await storage.getCurrentDraft(documentId)
    // Change the document after the rename form captured its original version.
    await storage.saveCurrentDraft(draft.content, { ...draft.metadata, name: 'Updated target' }, draft.version, documentId)
  }, id)
  await form.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(library(page).getByRole('alert')).toContainText('changed in another tab')
  await expect(library(page).locator('.document-list__open').filter({ hasText: 'Updated target' })).toBeVisible()
  await library(page).getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(library(page).getByRole('alert')).toHaveCount(0)
  await expect(library(page).locator('.document-list__open').filter({ hasText: 'My renamed target' })).toBeVisible()
  await expect(form).toHaveCount(0)
})

for (const mobile of [false, true]) {
  test(`a conflicting draft can be saved as a separate copy on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(() => localStorage.setItem('markword.preference.locale', 'zh-TW'))
    }
    await page.goto('/')
    await page.locator('.cm-content').fill('# Shared original')
    await expect(page.locator('.save-status')).toHaveText(mobile ? '已儲存在本機' : 'Saved locally')
    await page.evaluate(async () => {
      const module = '/src/storage.ts'
      const storage = await import(/* @vite-ignore */ module)
      const draft = await storage.getCurrentDraft()
      await storage.saveCurrentDraft(draft.content, { ...draft.metadata, retainedSetting: true }, draft.version)
    })
    await page.reload()
    await expect(page.locator('.save-status')).toHaveText(mobile ? '已儲存在本機' : 'Saved locally')
    const other = await context.newPage()
    await other.goto('/')
    await expect(other.locator('.save-status')).toHaveText(mobile ? '已儲存在本機' : 'Saved locally')
    await other.locator('.cm-content').fill('# Other tab saved this')
    await expect(other.locator('.save-status')).toHaveText(mobile ? '已儲存在本機' : 'Saved locally')
    const local = '# My current edits\n\nKeep this separate copy.'
    await page.locator('.cm-content').fill(local)
    await expect(page.locator('.save-status')).toContainText(mobile ? '其他分頁已更新' : 'Changed elsewhere')
    await page.locator('.header-actions').getByRole('button', { name: mobile ? '文件' : 'Documents', exact: true }).click()
    await expect(library(page).getByRole('alert')).toContainText(mobile ? '其他分頁' : 'Another tab')
    await page.screenshot({ path: `/tmp/markword-save-conflict-${mobile ? 'mobile' : 'desktop'}.png` })
    await library(page).getByRole('button', { name: mobile ? '另存副本' : 'Save a copy', exact: true }).click()
    await expect(library(page)).toBeVisible()
    await library(page).getByRole('button', { name: mobile ? '關閉文件清單' : 'Close documents', exact: true }).click()
    await expect(page.locator('.document-heading')).toContainText(mobile ? 'My current edits 的複本' : 'Copy of My current edits')
    await expect(page.locator('.save-status')).toHaveText(mobile ? '已儲存在本機' : 'Saved locally')
    await page.reload()
    await expect.poll(() => source(page)).toBe(local)
    const stored = await page.evaluate(async () => {
      const module = '/src/storage.ts'
      const storage = await import(/* @vite-ignore */ module)
      const drafts = await storage.listWorkspaceDrafts()
      return drafts.map((draft: { content: string; metadata: Record<string, unknown> }) => ({ content: draft.content, retainedSetting: draft.metadata.retainedSetting }))
    })
    expect(stored).toEqual(expect.arrayContaining([
      { content: local, retainedSetting: true },
      { content: '# Other tab saved this', retainedSetting: true },
    ]))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: `/tmp/markword-saved-copy-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
