import { expect, test, type Page } from '@playwright/test'

const editor = (page: Page) => page.locator('.editor-host .cm-content')
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))

async function snapshot(page: Page, content: string) {
  await editor(page).fill(content)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Create current revision', exact: true }).click()
  await expect(page.locator('.revision-panel__message')).toHaveText('Current revision created')
  await page.keyboard.press('Escape')
}

test('comparison marks old and current text, stays read-only, and restore keeps a backup', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const before = '# Original title\n\nAn old sentence.\n\nUnchanged paragraph.'
  const current = '# New title\n\nA new sentence.\n\nUnchanged paragraph.\n\nExtra paragraph.'
  await snapshot(page, before)
  await editor(page).fill(current)
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-list button[aria-current=true]')).toHaveCount(1)
  await expect(page.locator('.revision-diff .cm-deletedLine')).toContainText(['Original title', 'old sentence'])
  await expect(page.locator('.revision-diff .cm-insertedLine')).toContainText(['New title', 'new sentence', 'Extra paragraph'])
  const comparison = page.getByRole('region', { name: 'Changes from the selected revision to the current document' })
  await expect(comparison).toHaveAttribute('contenteditable', 'false')
  await comparison.focus()
  await page.keyboard.type('do not insert')
  await expect.poll(() => source(page)).toBe(current)
  await expect(page.locator('.revision-diff')).not.toContainText('do not insert')
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText(before)
  await page.getByRole('button', { name: 'Restore this revision', exact: true }).click()
  await expect(page.locator('.revision-panel__message')).toContainText('backed up first')
  await expect.poll(() => source(page)).toBe(before)
  await expect(page.locator('.revision-list button')).toHaveCount(2)
  await page.locator('.revision-list button').filter({ hasText: 'Pre-restore backup' }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText(current)
  expect(errors).toEqual([])
})

test('matching text, deleted documents, added documents and format changes are explicit', async ({ page }) => {
  await page.goto('/')
  await snapshot(page, 'Original content')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-preview')).toContainText('The text matches the current document.')
  await page.keyboard.press('Escape')
  await editor(page).fill('')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.cm-deletedChunk')).toHaveText('Original content')
  await page.getByRole('button', { name: 'Create current revision', exact: true }).click()
  await expect(page.locator('.revision-list button')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await editor(page).fill('New content')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.locator('.revision-list button').filter({ hasText: '0 characters' }).click()
  await expect(page.locator('.cm-insertedLine')).toHaveText('New content')
  await expect(page.locator('.revision-preview__format')).toHaveText('Format: Markdown → Plain text')
})

test('comparison failure preserves saved content and restore controls', async ({ page }) => {
  await page.goto('/')
  await snapshot(page, 'A saved revision')
  await editor(page).fill('Changed content')
  await page.route('**/components/RevisionDiff.tsx*', (route) => route.abort())
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not load the comparison')
  await page.getByRole('button', { name: 'Saved content', exact: true }).click()
  await expect(page.locator('.revision-preview pre')).toHaveText('A saved revision')
  await expect(page.getByRole('button', { name: 'Restore this revision', exact: true })).toBeEnabled()
})

test('mobile revision controls fit the screen and remain reachable with long text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  await snapshot(page, Array.from({ length: 100 }, (_, i) => `Original line ${i}`).join('\n'))
  await editor(page).fill('Replacement text')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await expect(page.locator('.revision-diff .cm-editor')).toBeVisible()
  const panel = await page.locator('.revision-panel').boundingBox()
  expect(panel!.x).toBeGreaterThanOrEqual(0)
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(320)
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(700)
  for (const name of ['Restore this revision', 'Close revision history', 'Next change']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeInViewport()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('button', { name: 'Close revision history', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Revision history', exact: true })).toBeFocused()
})
