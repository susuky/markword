import { expect, test, type Locator, type Page } from '@playwright/test'

async function start(page: Page, source: string) {
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  await page.locator('.cm-content').fill(source)
  await expect(page.locator('.markdown-body')).toContainText(source.match(/^# (.*)/)?.[1] ?? '')
}

async function select(leaf: Locator, from: number, to: number) {
  await leaf.evaluate((element, { from, to }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let offset = 0
    let started = false
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      const end = offset + text.length
      if (!started && from <= end) { range.setStart(text, from - offset); started = true }
      if (to <= end) { range.setEnd(text, to - offset); break }
      offset = end
    }
    const parent = range.startContainer.parentElement
    parent?.closest<HTMLElement>('[contenteditable]')?.focus()
    const selection = window.getSelection()
    selection?.removeAllRanges(); selection?.addRange(range)
  }, { from, to })
}

test('partial formatting preserves both unselected sides and shares undo with the source', async ({ page }) => {
  await start(page, '# Formatting\n\n**Before middle after**\n\nUntouched  spacing.\n')
  const paragraph = page.locator('.markdown-body > p').first()
  await select(paragraph, 7, 13)
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
  await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(paragraph.locator('strong')).toHaveText(['Before', 'after'])
  await expect(paragraph).toHaveText('Before middle after')
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toContain('Untouched  spacing.\n')
  await page.keyboard.press('Control+z')
  await expect(paragraph.locator('strong')).toHaveText('Before middle after')
  await page.keyboard.press('Control+Shift+z')
  await expect(paragraph.locator('strong')).toHaveText(['Before', 'after'])
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(paragraph.locator('strong')).toHaveText(['Before', 'after'])
})

test('formatting across inline nodes preserves links, reference definitions, and nested list structure', async ({ page }) => {
  const definitions = '[ref]: https://example.com/old "Keep title"\n'
  await start(page, `# Mixed\n\n- Visit [our **site**][ref] today.\n  - Child stays.\n\n${definitions}`)
  const item = page.locator('.markdown-body > ul > li').first()
  await select(item, 6, 14)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Italic', exact: true }).click()
  await expect(item.locator('a')).toHaveAttribute('href', 'https://example.com/old')
  await expect(item.locator('a strong')).toHaveText('site')
  await expect(item.locator('em')).toContainText('our site')
  await expect(item.locator('ul li')).toHaveText('Child stays.')
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toContain(definitions)
})

test('links validate addresses, cancel without edits, and can be removed from selected text', async ({ page }) => {
  await start(page, '# Links\n\nLink this text.\n')
  const paragraph = page.locator('.markdown-body > p')
  await select(paragraph, 0, 4)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link address', { exact: true }).fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a valid address')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(paragraph.locator('a')).toHaveCount(0)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link address', { exact: true }).fill('https://example.com/new?q=1&x=2')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(paragraph.locator('a')).toHaveAttribute('href', 'https://example.com/new?q=1&x=2')
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Link', exact: true }).click()
  await expect(paragraph.locator('a')).toHaveCount(0)
  await expect(paragraph).toHaveText('Link this text.')
})

test('inline code keeps backticks literal and toggles back into editable text', async ({ page }) => {
  await start(page, '# Code\n\nUse `ticks` safely.\n')
  const paragraph = page.locator('.markdown-body > p')
  await select(paragraph, 4, 9)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Inline code', exact: true }).click()
  await expect(paragraph.locator('code')).toHaveCount(0)
  await expect(paragraph.locator('[data-markdown-edit-text]')).toContainText('Use ticks safely.')
  await page.locator('.cm-content').fill('# Code\n\nUse \\`ticks\\` safely.\n')
  await expect(paragraph).toHaveText('Use `ticks` safely.')
  await select(paragraph, 4, 11)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Inline code', exact: true }).click()
  await expect(paragraph.locator('code')).toHaveText('`ticks`')
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toContain('`` `ticks` ``')
})

test('switching documents cannot discard an unfinished link address', async ({ page }) => {
  await start(page, '# Keep link\n\nLink this text.')
  await select(page.locator('.markdown-body > p'), 0, 4)
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link address', { exact: true }).fill('https://example.com/unfinished')
  await page.getByRole('button', { name: 'Documents', exact: true }).first().click()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Apply or cancel the link edit')
  await page.getByRole('button', { name: 'Close documents', exact: true }).click()
  await expect(page.getByLabel('Link address', { exact: true })).toHaveValue('https://example.com/unfinished')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Documents', exact: true }).first().click()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.locator('.cm-content')).toBeEmpty()
})

test('preview formatting shortcuts preserve selected text and undo in a single step', async ({ page }) => {
  await start(page, '# Keys\n\nWord')
  await select(page.locator('.markdown-body > p'), 0, 4)
  await page.keyboard.press('Control+b')
  await expect(page.locator('.markdown-body strong')).toHaveText('Word')
  await page.keyboard.press('Control+i')
  await expect(page.locator('.markdown-body strong em, .markdown-body em strong')).toHaveText('Word')
  await page.keyboard.press('Control+i')
  await expect(page.locator('.markdown-body em')).toHaveCount(0)
  await expect(page.locator('.markdown-body strong')).toHaveText('Word')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.markdown-body em')).toHaveText('Word')
})

test('typing can undo and redo without losing the preview caret', async ({ page }) => {
  await start(page, '# History\n\nOriginal')
  const paragraph = page.locator('.markdown-body > p')
  await paragraph.locator('[data-markdown-edit-text]').fill('Changed')
  await page.keyboard.press('Control+z')
  await expect(paragraph).toHaveText('Original')
  await page.keyboard.press('Control+Shift+z')
  await expect(paragraph).toHaveText('Changed')
})

test('clicking inline code edits its text, preserves literal backticks, and saves with shared undo', async ({ page }) => {
  const definition = '[ref]: https://example.com "Keep reference"\n'
  await start(page, '# 程式碼點選\n\n- 區分 `on_tick` / `on_bar_update` / `on_bar_close`\n  - 子項目保留。\n\n其他內容保留。\n\n' + definition)
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
  const codes = page.locator('.markdown-body li code')
  for (const index of [0, 1, 2]) {
    await codes.nth(index).click()
    await expect(codes.nth(index).locator('[data-markdown-edit-text]')).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.insertText(index === 2 ? '_新增`值' : '_修改')
  }
  await expect(codes).toHaveText(['on_tick_修改', 'on_bar_update_修改', 'on_bar_close_新增`值'])
  await page.keyboard.press('Control+z')
  await expect(codes).toHaveText(['on_tick_修改', 'on_bar_update_修改', 'on_bar_close'])
  await page.keyboard.press('Control+Shift+z')
  await expect(codes.nth(2)).toHaveText('on_bar_close_新增`值')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(codes).toHaveText(['on_tick_修改', 'on_bar_update_修改', 'on_bar_close_新增`值'])
  await expect(page.locator('.markdown-body li li')).toHaveText('子項目保留。')
  await page.getByRole('button', { name: 'Split editing', exact: true }).click()
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toContain(definition)
})

test('mobile selection tools stay in the viewport and composition does not format text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page, '# 中文\n\n選取中文，調整格式。\n')
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  const paragraph = page.locator('.markdown-body > p')
  await select(paragraph, 0, 4)
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
  await expect(toolbar).toBeVisible()
  const box = (await toolbar.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await paragraph.locator('[data-markdown-edit-text]').evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, isComposing: true, bubbles: true }))
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  })
  await expect(paragraph.locator('strong')).toHaveCount(0)
  await select(paragraph, 0, 4)
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(paragraph.locator('strong')).toHaveText('選取中文')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
