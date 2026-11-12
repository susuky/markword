import { expect, test } from './shared-workspace-fixture'
import { type Page } from '@playwright/test'

const preview = (page: Page) => page.locator('.markdown-body')
const source = (page: Page) => page.locator('.cm-content .cm-line').allTextContents().then((lines) => lines.join('\n'))

async function start(page: Page, text: string) {
  await page.goto('/')
  await page.locator('.cm-content').fill(text)
}

test('typing [] plus space in source creates an editable checkbox', async ({ page }) => {
  await start(page, '')
  await page.locator('.cm-content').focus()
  await page.keyboard.type('[] ')
  await expect.poll(() => source(page)).toBe('- [ ] ')
  await page.keyboard.type('123')
  await expect(preview(page).locator('.task-list-checkbox')).toHaveCount(1)
  await expect(preview(page).locator('li')).toContainText('123')
  await preview(page).locator('.task-list-checkbox').check()
  await expect.poll(() => source(page)).toBe('- [x] 123')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(preview(page).locator('.task-list-checkbox')).toBeChecked()
})

test('shorthand [] and [ ] render as tasks in loaded Markdown, without affecting code', async ({ page }) => {
  await start(page, [
    '[] First task',
    '[ ] Second **task**',
    '[x] Complete',
    '',
    '> [] Quoted',
    '',
    '- [] Nested convention',
    '',
    '~~~text',
    '[] Code literal',
    '[ ] Code literal',
    '~~~',
  ].join('\n'))
  await expect(preview(page).locator('input.task-list-checkbox')).toHaveCount(5)
  await preview(page).locator('.task-list-checkbox').first().check()
  await expect.poll(() => source(page)).toContain('[x] First task')
  await expect(preview(page).locator('pre')).toContainText('[] Code literal')
  await expect(preview(page).locator('pre')).toContainText('[ ] Code literal')
})

test('Enter splits at cursor and Shift+Enter writes a visible line break in same block', async ({ page }) => {
  await start(page, 'AlphaBeta')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  const edit = preview(page).locator('p [contenteditable]').first()
  await edit.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(preview(page).locator(':scope > p')).toHaveText(['Alpha', 'Beta'])

  const after = preview(page).locator(':scope > p').last().locator('[contenteditable]')
  await after.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+Enter')
  await expect(preview(page).locator(':scope > p')).toHaveCount(2)
  await expect(preview(page).locator(':scope > p').last().locator('br')).toHaveCount(1)
  await expect.poll(() => source(page)).toMatch(/Alpha\n\nBe {2}\nta/)
})

test('Notion > creates a toggle and " creates a quote from the source editor', async ({ page }) => {
  await start(page, '')
  const editor = page.locator('.cm-content')
  await editor.focus()
  await page.keyboard.type('> ')
  await expect.poll(() => source(page)).toContain('<details open>')
  await expect(preview(page).locator('details > summary')).toBeVisible()
  await page.keyboard.type('My toggle')
  await expect(preview(page).locator('details > summary')).toHaveText('My toggle')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Child text')
  await expect(preview(page).locator('details .markdown-toggle-content')).toContainText('Child text')
  await expect.poll(() => source(page)).toContain('<summary>My toggle</summary>')
  await expect.poll(() => source(page)).toContain('\nChild text')
  await page.locator('.cm-content').fill('')
  await page.keyboard.type('" ')
  await page.keyboard.type('Quote text')
  await expect.poll(() => source(page)).toBe('> Quote text')
  await expect(preview(page).locator('blockquote')).toHaveText('Quote text')
})

test('shortcuts leave fenced code and inline phrases untouched', async ({ page }) => {
  await start(page, '~~~text\n')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('[] ')
  await page.keyboard.type('> ')
  await page.keyboard.type('" ')
  await expect.poll(() => source(page)).toBe('~~~text\n[] > " "')
  await expect(preview(page).locator('pre')).toContainText('[] > "')
  await page.locator('.cm-content').fill('Some [] phrase')
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' ')
  await expect.poll(() => source(page)).toBe('Some [] phrase ')
  await expect(preview(page).locator('.task-list-checkbox')).toHaveCount(0)
})

test('typing [ ] plus space also creates a checkbox without losing the caret', async ({ page }) => {
  await start(page, '')
  await page.locator('.cm-content').focus()
  await page.keyboard.type('[ ] ')
  await expect.poll(() => source(page)).toBe('- [ ] ')
  await page.keyboard.type('Buy groceries')
  await expect.poll(() => source(page)).toBe('- [ ] Buy groceries')
  await expect(preview(page).locator('.task-list-checkbox')).toHaveCount(1)
})

test('typing after Shift+Enter continues on the next visible line in the same block', async ({ page }) => {
  await start(page, 'BeforeAfter')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  const edit = preview(page).locator('p [contenteditable]').first()
  await edit.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Inserted ')
  await expect(preview(page).locator(':scope > p')).toHaveCount(1)
  await expect(preview(page).locator(':scope > p > br')).toHaveCount(0)
  await expect(preview(page).locator(':scope > p br')).toHaveCount(1)
  await expect.poll(() => source(page)).toBe('Before  \nInserted After')
})
