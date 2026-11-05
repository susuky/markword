import { type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from './shared-workspace-fixture'

const body = (page: Page) => page.locator('.markdown-body')
const actions = (page: Page) => page.getByRole('toolbar', { name: 'Block actions' })
const source = (page: Page) => page.locator('.cm-content .cm-line').allTextContents().then((lines) => lines.join('\n'))

async function single(page: Page, value: string) {
  await page.goto('/')
  await page.locator('.cm-content').fill(value)
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
}

async function handle(page: Page, block: Locator) {
  const line = await block.getAttribute('data-document-block')
  expect(line).not.toBeNull()
  return page.locator(`[data-block-handle="${line}"]`)
}

async function convert(page: Page, block: Locator, type: string) {
  await (await handle(page, block)).click()
  await actions(page).getByLabel('Convert blocks to').selectOption(type)
}

for (const level of [1, 2, 3, 4]) {
  test(`heading ${level} becomes a toggle at its own level and converts back without losing formatting`, async ({ page }) => {
    await single(page, `${'#'.repeat(level)} Project **plan** [link][ref]\n\nFollowing paragraph.\n\n[ref]: https://example.com\n`)
    await convert(page, body(page).locator(`:scope > h${level}`), 'toggle')
    const title = body(page).locator(`details > summary > h${level}`)
    await expect(title).toHaveText('Project plan link')
    await expect(title.locator('strong')).toHaveText('plan')
    await expect(title.locator('a')).toHaveAttribute('href', 'https://example.com')
    await expect(body(page).locator(':scope > p')).toHaveText('Following paragraph.')
    await convert(page, body(page).locator('details'), `h${level}`)
    await expect(body(page).locator(`:scope > h${level}`)).toHaveText('Project plan link')
    await expect(body(page).locator('details')).toHaveCount(0)
    expect(await source(page)).toContain('[ref]: https://example.com')
  })
}

test('setext headings retain their title and level when converted to toggles', async ({ page }) => {
  await single(page, 'First **heading**\n===\n\nSecond [heading](https://example.com)\n---\n')
  await convert(page, body(page).locator(':scope > h1'), 'toggle')
  await expect(body(page).locator('summary h1')).toHaveText('First heading')
  await convert(page, body(page).locator(':scope > h2'), 'toggle')
  await expect(body(page).locator('summary h2')).toHaveText('Second heading')
  await expect(body(page).locator('summary h2 a')).toHaveAttribute('href', 'https://example.com')
})

test('a heading converted to a toggle retains its document and downloaded Markdown name', async ({ page }) => {
  await single(page, '# Project plan\n\nDocument content.\n')
  await convert(page, body(page).locator(':scope > h1'), 'toggle')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.locator('.header-actions').getByRole('button', { name: 'Documents', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Documents', exact: true })
  await expect(library.locator('.document-list__open').filter({ has: page.getByText('Project plan', { exact: true }) })).toBeVisible()
  await library.getByRole('button', { name: 'Close documents', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown Keep the editable source', exact: true }).click()
  expect((await downloading).suggestedFilename()).toBe('Project plan.md')
})

test('insert an empty toggle heading, write its title and body, retain its level and closed state after reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await single(page, '')
  await body(page).locator('[contenteditable]').press('/')
  await page.getByRole('dialog', { name: 'Add content' }).getByRole('button', { name: 'Toggle heading 2', exact: true }).click()
  await expect(body(page).locator('summary [contenteditable]')).toHaveCount(1)
  const title = body(page).locator('summary h2 [contenteditable]')
  await expect(title).toBeFocused()
  await page.keyboard.type('Project heading')
  await title.press('Enter')
  const child = body(page).locator('.markdown-toggle-content [contenteditable]:focus')
  await child.fill('內文保留 $ 與 ~ 符號')
  await convert(page, body(page).locator('details'), 'toggle-h4')
  await expect(body(page).locator('summary h4')).toHaveText('Project heading')
  await expect(body(page).locator('.markdown-toggle-content')).toContainText('內文保留 $ 與 ~ 符號')
  await body(page).locator('summary').press('Enter')
  await expect(body(page).locator('details')).not.toHaveAttribute('open')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(body(page).locator('details')).not.toHaveAttribute('open')
  await expect(body(page).locator('summary h4')).toHaveText('Project heading')
  await expect(body(page).locator('.markdown-toggle-content')).toBeHidden()
  await body(page).locator('summary').press('Enter')
  await expect(body(page).locator('.markdown-toggle-content')).toContainText('內文保留 $ 與 ~ 符號')
  await convert(page, body(page).locator('details'), 'h4')
  await expect(body(page).locator(':scope > h4')).toHaveText('Project heading')
  await expect(body(page).locator(':scope > p')).toHaveText('內文保留 $ 與 ~ 符號')
  expect(errors).toEqual([])
})

test('a paragraph can become a toggle, accept a dragged child, and return to text intact', async ({ page }) => {
  await single(page, 'Final **plan** #\n\nChild **details**.\n\nKeep this.\n')
  await convert(page, body(page).locator(':scope > p').first(), 'toggle')
  await expect(body(page).locator('summary')).toHaveText('Final plan #')
  const grip = await handle(page, body(page).locator(':scope > p').first())
  await grip.dragTo(body(page).locator('summary'), { targetPosition: { x: 90, y: 16 } })
  await expect(body(page).locator('.markdown-toggle-content > p')).toHaveText('Child details.')
  await convert(page, body(page).locator('details'), 'text')
  await expect(body(page).locator(':scope > p')).toHaveText(['Final plan #', 'Child details.', 'Keep this.'])
  await expect(body(page).locator(':scope > p strong')).toHaveText(['plan', 'details'])
})

test('changing a closed nested toggle heading preserves its children and Markdown sources', async ({ page }) => {
  const children = '<details>\n<summary>Inner **title**</summary>\n\nInner paragraph.\n\n</details>\n\n```text\n</details>\n<summary>literal</summary>\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
  await single(page, `<details>\n<summary><h2>Outer **heading**</h2></summary>\n\n${children}\n\n</details>\n\nUntouched  spacing.\n`)
  await convert(page, body(page).locator(':scope > details'), 'toggle-h3')
  await expect(body(page).locator(':scope > details')).not.toHaveAttribute('open')
  await expect(body(page).locator('summary h3')).toHaveText('Outer heading')
  await expect(body(page).locator('.markdown-toggle-content').first()).toBeHidden()
  expect(await source(page)).toContain(children)
  await convert(page, body(page).locator(':scope > details'), 'h3')
  await expect(body(page).locator(':scope > h3')).toHaveText('Outer heading')
  await expect(body(page).locator(':scope > details')).not.toHaveAttribute('open')
  await expect(body(page).locator(':scope > pre')).toContainText('</details>')
  await expect(body(page).locator(':scope > .preview-table table')).toHaveCount(1)
  expect(await source(page)).toContain(children)
  expect(await source(page)).toContain('Untouched  spacing.')
})

test('source Enter within a toggle heading carries the remaining title into the child without moving closing tags', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  await editor.fill('<details open>\n<summary><h2>BeforeAfter</h2></summary>\n\n</details>')
  await editor.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Home')
  for (let index = 0; index < '<summary><h2>Before'.length; index++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toContain('<summary><h2>Before</h2></summary>\nAfter')
  await expect(body(page).locator('summary h2')).toHaveText('Before')
  await expect(body(page).locator('.markdown-toggle-content')).toHaveText('After')
})

test('the > space shortcut creates editable toggles in source and single-page editing', async ({ page }) => {
  await single(page, '')
  await body(page).locator('[contenteditable]').focus()
  await page.keyboard.type('> ')
  await expect(body(page).locator('details > summary [contenteditable]')).toBeFocused()
  await page.keyboard.type('Visual toggle')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Visual child')
  await expect(body(page).locator('summary')).toHaveText('Visual toggle')
  await expect(body(page).locator('.markdown-toggle-content')).toHaveText('Visual child')
  await page.getByRole('button', { name: 'Split editing', exact: true }).click()
  await page.locator('.cm-content').fill('')
  await page.keyboard.type('> ')
  await page.keyboard.type('Source toggle')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Source child')
  await expect(body(page).locator('summary')).toHaveText('Source toggle')
  await expect(body(page).locator('.markdown-toggle-content')).toHaveText('Source child')
})

for (const placement of ['before', 'selected', 'quoted']) {
  test(`> space leaves the ${placement} paragraph intact`, async ({ page }) => {
    await single(page, placement === 'quoted' ? '> \\>' : '\\>')
    const field = body(page).locator('p [contenteditable]')
    await field.focus()
    await field.press(placement === 'before' ? 'Home' : placement === 'selected' ? 'Control+A' : 'End')
    await field.press('Space')
    await expect(body(page).locator('details')).toHaveCount(0)
    if (placement === 'quoted') await expect(body(page).locator('blockquote')).toContainText('>')
  })
}

test('portable HTML keeps toggle headings inline, closed, printable and editable on import', async ({ page, context }) => {
  const original = '<details>\n<summary><h1>Portable **heading**</h1></summary>\n\nHidden **child** content.\n\n</details>\n'
  await single(page, original)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Portable HTML/ }).click()
  const download = await downloading
  const html = await readFile((await download.path())!, 'utf8')
  const reader = await context.newPage()
  await reader.setContent(html)
  await expect(reader.locator('summary h1')).toHaveText('Portable heading')
  await expect(reader.locator('summary h1')).toHaveCSS('display', 'inline')
  await expect(reader.locator('.markdown-toggle-content')).toBeHidden()
  await reader.emulateMedia({ media: 'print' })
  await expect(reader.getByText('Hidden child content.')).toBeVisible()
  await reader.close()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'toggle-heading.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await expect(page.locator('.toast')).toHaveText('Restored editable content from toggle-heading.html')
  await expect(body(page).locator('summary h1')).toHaveText('Portable heading')
  await expect(body(page).locator('details')).not.toHaveAttribute('open')
  expect(await source(page)).toBe(original)
})

test('desktop and mobile retain readable toggle headings and ordinary toggles without overflow', async ({ page }) => {
  await single(page, '<details open>\n<summary><h1>專案筆記</h1></summary>\n\n已完成內容\n\n</details>\n\n<details open>\n<summary>一般文字區塊</summary>\n\n子內容也能直接編輯。\n\n</details>')
  await body(page).locator('summary h1 [contenteditable]').fill('專案筆記與待辦')
  await body(page).locator('summary').first().press('Enter')
  await expect(body(page).locator('summary h1')).toHaveText('專案筆記與待辦')
  await expect(body(page).locator('.markdown-toggle-content').first()).toBeHidden()
  await expect(body(page).locator('details').last().locator('.markdown-toggle-content')).toBeVisible()
  await page.locator('.pane--preview .pane-title').click()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.screenshot({ path: '/tmp/markword-toggle-headings-desktop.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(body(page).locator('summary h1')).toBeVisible()
  await expect(body(page).locator('.markdown-toggle-content').first()).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.screenshot({ path: '/tmp/markword-toggle-headings-mobile.png', fullPage: false })
})
