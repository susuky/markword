import { expect, test } from './shared-workspace-fixture'
import { type Page } from '@playwright/test'

const body = (page: Page) => page.locator('.markdown-body')

async function single(page: Page, markdown: string) {
  await page.goto('/')
  await page.locator('.cm-content').fill(markdown)
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
}

async function source(page: Page) {
  const split = page.getByRole('button', { name: 'Split editing', exact: true })
  if (await split.isVisible()) await split.click()
  return (await page.locator('.cm-content .cm-line').allTextContents()).join('\n')
}

test('Notion-style headings, lists, quote and collapsible block render together', async ({ page }) => {
  await single(page, [
    '# Heading 1', '## Heading 2', '### Heading 3', '#### Heading 4', '',
    '- Bullet', '', '1. Numbered', '', '- [ ] To do', '- [x] Finished', '',
    '> Quote', '', '<details open>', '<summary>Toggle list</summary>', '',
    '- [ ] Child task', '', '</details>', '',
  ].join('\n'))
  for (const level of [1, 2, 3, 4]) {
    await expect(body(page).locator('h' + level)).toHaveText('Heading ' + level)
  }
  await expect(body(page).locator('ul li').filter({ hasText: 'Bullet' })).toHaveCount(1)
  await expect(body(page).locator('ol > li')).toHaveText('Numbered')
  await expect(body(page).locator('blockquote')).toHaveText('Quote')
  await expect(body(page).locator('.task-list-checkbox')).toHaveCount(3)
  await expect(body(page).locator('.task-list-checkbox').nth(1)).toBeChecked()
  const details = body(page).locator('details')
  await expect(details.locator('summary')).toHaveText('Toggle list')
  await details.locator('summary').click({ position: { x: 2, y: 12 } })
  await expect(details).not.toHaveAttribute('open')
  await expect(details.locator('.markdown-toggle-content')).toBeHidden()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(body(page).locator('h4')).toHaveText('Heading 4')
  await expect(body(page).locator('details')).not.toHaveAttribute('open')
})

test('checkbox toggles edit only the original Markdown marker in nested, ordered and quoted tasks', async ({ page }) => {
  const original = [
    '# Tasks', '',
    '- [ ] First **important** [link][ref]',
    '  - [x] Nested item',
    '',
    '3. [ ] Numbered task',
    '',
    '> - [ ] Quoted task',
    '',
    '<details open>',
    '<summary>Details</summary>',
    '',
    '- [ ] Inside toggle',
    '',
    '</details>',
    '',
    'Untouched  **spacing**.',
    '',
    '[ref]: https://example.invalid/same',
    '',
  ].join('\n')
  await single(page, original)
  const boxes = body(page).locator('input.task-list-checkbox')
  await expect(boxes).toHaveCount(5)
  await boxes.nth(0).check()
  await expect.poll(() => source(page)).toBe(original.replace('- [ ] First', '- [x] First'))
  await boxes.nth(1).uncheck()
  await expect.poll(() => source(page)).toBe(original.replace('- [ ] First', '- [x] First').replace('- [x] Nested', '- [ ] Nested'))
  await boxes.nth(2).check()
  await expect.poll(() => source(page)).toBe(original.replace('- [ ] First', '- [x] First').replace('- [x] Nested', '- [ ] Nested').replace('3. [ ] Numbered', '3. [x] Numbered'))
  await boxes.nth(3).check()
  await boxes.nth(4).check()
  const expected = original
    .replace('- [ ] First', '- [x] First')
    .replace('- [x] Nested', '- [ ] Nested')
    .replace('3. [ ] Numbered', '3. [x] Numbered')
    .replace('> - [ ] Quoted', '> - [x] Quoted')
    .replace('- [ ] Inside toggle', '- [x] Inside toggle')
  await expect.poll(() => source(page)).toBe(expected)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(body(page).locator('input.task-list-checkbox').nth(0)).toBeChecked()
  await expect(body(page).locator('input.task-list-checkbox').nth(1)).not.toBeChecked()
  await expect(body(page).locator('input.task-list-checkbox').nth(2)).toBeChecked()
  await expect(body(page).locator('input.task-list-checkbox').nth(3)).toBeChecked()
  await expect(body(page).locator('input.task-list-checkbox').nth(4)).toBeChecked()
})

test('Heading 4 is available from slash insertion and block conversion', async ({ page }) => {
  await single(page, '')
  await body(page).locator('[contenteditable]').first().focus()
  await page.keyboard.press('/')
  await page.getByRole('dialog', { name: 'Add content' }).getByRole('button', { name: 'Heading 4', exact: true }).click()
  await body(page).locator('h4 [contenteditable]').fill('Fourth-level heading')
  await expect(body(page).locator('h4')).toHaveText('Fourth-level heading')
  await expect.poll(() => source(page)).toContain('#### Fourth-level heading')

  await page.locator('.cm-content').fill('Convert **me**.\n\nKeep this.\n')
  const paragraph = body(page).locator(':scope > p').first()
  const line = await paragraph.getAttribute('data-document-block')
  await page.locator('[data-block-handle="' + line + '"]').click()
  await page.getByRole('toolbar', { name: 'Block actions' }).getByLabel('Convert blocks to').selectOption('h4')
  await expect(body(page).locator('h4')).toHaveText('Convert me.')
  await expect(body(page).locator('h4 strong')).toHaveText('me')
  expect(await source(page)).toContain('#### Convert **me**.')
  expect(await source(page)).toContain('Keep this.')
})

test('checkbox changes participate in shared undo and redo history', async ({ page }) => {
  const original = '# Undo checklist\n\n- [ ] First\n- [x] Second\n\nKeep  exact formatting.\n'
  await single(page, original)
  const checkbox = body(page).locator('input.task-list-checkbox').first()
  await checkbox.check()
  await expect.poll(() => source(page)).toBe(original.replace('- [ ] First', '- [x] First'))
  await page.getByRole('button', { name: 'Preview editing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => source(page)).toBe(original)
  await expect(checkbox).not.toBeChecked()
  await page.getByRole('button', { name: 'Preview editing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => source(page)).toBe(original.replace('- [ ] First', '- [x] First'))
  await expect(checkbox).toBeChecked()
})
