import { expect, test, type Page } from '@playwright/test'

const source = (page: Page) => page.locator('.cm-line').allTextContents().then((lines) => lines.join('\n'))

test('line numbers align with wrapped text and remain aligned after scrolling', async ({ page }) => {
  await page.goto('/')
  const lines = Array.from({ length: 60 }, (_, index) => `${index + 1} 這是一段用來確認自動折行與行號位置的文字。`.repeat(index % 3 + 1))
  await page.locator('.cm-content').fill(lines.join('\n'))
  for (const offset of [0, 350, 700]) {
    await page.locator('.cm-scroller').evaluate((element, top) => { element.scrollTop = top }, offset)
    await expect.poll(() => page.evaluate(() => {
      const numbers = [...document.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')].filter((element) => element.style.visibility !== 'hidden')
      const lines = [...document.querySelectorAll('.cm-line')]
      return Math.max(...numbers.map((number, index) => Math.abs(number.getBoundingClientRect().top - lines[index].getBoundingClientRect().top)))
    })).toBeLessThan(1)
  }
})

test('Enter consistently inserts one line and empty list markers can be removed', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  for (const [before, after] of [
    ['第一段文字', '第一段文字\n'],
    ['1. 第一項\n2. 第二項', '1. 第一項\n2. 第二項\n3. '],
    ['1. 第一項\n\n2. 第二項', '1. 第一項\n\n2. 第二項\n3. '],
    ['- 第一項\n\n- 第二項', '- 第一項\n\n- 第二項\n- '],
    ['- [x] 已完成', '- [x] 已完成\n- [ ] '],
    ['> 1. 第一項\n>\n> 2. 第二項', '> 1. 第一項\n>\n> 2. 第二項\n> 3. '],
    ['1. 項目\n   - 子項目', '1. 項目\n   - 子項目\n   - '],
    ['```text\n1. 程式碼', '```text\n1. 程式碼\n'],
  ]) {
    await editor.fill(before)
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await expect.poll(() => source(page)).toBe(after)
  }
  await editor.fill('1. 第一項')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('1. 第一項\n')
  await editor.fill('1. 第一項\n\n2. 第二項')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Backspace')
  await expect.poll(() => source(page)).toBe('1. 第一項\n\n2. 第二項\n')
  await page.keyboard.press('Backspace')
  await expect.poll(() => source(page)).toBe('1. 第一項\n\n2. 第二項')
})

test('automatic numbering is undoable and Shift+Enter skips the marker', async ({ page }) => {
  await page.goto('/')
  const original = '1. First\n2. Second\n3. Third'
  await page.locator('.cm-content').fill(original)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('1. First\n2. \n3. Second\n4. Third')
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe(original)
  await page.keyboard.press('Control+y')
  await expect.poll(() => source(page)).toBe('1. First\n2. \n3. Second\n4. Third')
  await page.keyboard.press('Backspace')
  await expect.poll(() => source(page)).toBe('1. First\n\n2. Second\n3. Third')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Shift+Enter')
  await expect.poll(() => source(page)).toBe('1. First\n\n2. Second\n3. Third')
})

test('Tab nests a bullet item, Shift+Tab restores it, and Escape then Tab leaves the editor', async ({ page }) => {
  await page.goto('/')
  const original = '- First\n- Second'
  await page.locator('.cm-content').fill(original)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Tab')
  await expect.poll(() => source(page)).toBe('- First\n    - Second')
  await expect(page.locator('.markdown-body ul ul li')).toHaveText('Second')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => source(page)).toBe(original)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(page.locator('.cm-content')).not.toBeFocused()
})

test('project archives and revisions restore the document mode with the source', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  const original = '# Plain document\n1. Literal item'
  await page.locator('.cm-content').fill(original)
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Create current revision', exact: true }).click()
  await expect(page.locator('.revision-panel__message')).toHaveText('Current revision created')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and all local assets', exact: true }).click()
  const archive = await pending
  const archivePath = (await archive.path())!
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('markdown')
  await page.locator('.cm-content').fill('# Changed')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Restore this revision', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
  await expect.poll(() => source(page)).toBe(original)
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('mermaid')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: await (await import('node:fs/promises')).readFile(archivePath) })
  await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
  await expect.poll(() => source(page)).toBe(original)
})

test('plain text preserves literal content, undo history, mode, and downloads', async ({ page }) => {
  await page.goto('/')
  const text = '# Literal title\n1. Literal number\n\n<script>alert(1)</script>'
  await page.locator('.cm-content').fill(text)
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await expect.poll(() => source(page)).toBe(text)
  await expect(page.locator('.markdown-body h1, .markdown-body script, .markdown-body ol')).toHaveCount(0)
  await expect(page.locator('.markdown-body')).toContainText('<script>alert(1)</script>')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('markdown')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe(text)
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('text')
  await expect.poll(() => source(page)).toBe(text)
  const pending = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const download = await pending
  expect(download.suggestedFilename()).toMatch(/\.txt$/)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe(text)
})

test('raw Mermaid renders, reports syntax errors, and recovers', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('mermaid')
  const diagram = 'flowchart TD\n  A[開始] --> B[完成]'
  await page.locator('.cm-content').fill(diagram)
  await expect(page.locator('.mermaid-block.is-rendered svg')).toBeVisible()
  await expect.poll(() => source(page)).toBe(diagram)
  await page.locator('.cm-content').fill('flowchart TD\n  A[')
  await expect(page.locator('.mermaid-error')).toHaveText('Could not draw this diagram. Check the Mermaid syntax.')
  await page.locator('.cm-content').fill(diagram)
  await expect(page.locator('.mermaid-block.is-rendered svg')).toBeVisible()
  await expect(page.locator('.mermaid-error')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open diagram preview', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Image preview' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue('mermaid')
  await expect(page.locator('.mermaid-block.is-rendered svg')).toBeVisible()
  expect(errors).toEqual([])
})

test('text and Mermaid files select their mode and mobile controls fit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  for (const [name, content, mode] of [
    ['note.txt', '1. 只是文字', 'text'],
    ['diagram.mmd', 'flowchart LR\nA --> B', 'mermaid'],
    ['readme.md', '# Markdown', 'markdown'],
  ]) {
    await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
    await expect(page.getByRole('combobox', { name: 'Document mode' })).toHaveValue(mode)
    await expect.poll(() => source(page)).toBe(content)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
