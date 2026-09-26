import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { tableAtPosition, tableMarkdown } from '../src/tableEditing'

const original = '# 工作表\n\n| 項目 | 負責人 | 狀態 |\n| --- | --- | --- |\n| 設計稿 | 怡君 | 完成 |\n| 表格 | 柏翰 | 進行中 |\n\n保留這一段。'
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))

async function pasteCells(input: Locator, text: string, html = '') {
  await input.evaluate((element, values) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', values.text)
    if (values.html) clipboardData.setData('text/html', values.html)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, { text, html })
}

test('table parsing preserves empty cells, escaped pipes, alignments, and nested containers', () => {
  for (const prefix of ['', '> ', '- ']) {
    const continuation = prefix === '- ' ? '  ' : prefix
    const table = `${prefix}| 名稱 |  | 備註 |\n${continuation}| :--- | ---: | :---: |\n${continuation}| A\\|B |  | **保留** |`
    const document = '# Heading\n\n' + table + '\n\nAfter'
    const state = EditorState.create({ doc: document, extensions: [markdown({ base: markdownLanguage })] })
    const parsed = tableAtPosition(state, state.doc.line(3).from)!
    expect(parsed.data.rows).toEqual([['名稱', '', '備註'], ['A\\|B', '', '**保留**']])
    expect(parsed.data.alignments).toEqual(['left', 'right', 'center'])
    expect(tableMarkdown(parsed.data, parsed.prefix, parsed.continuation)).toBe(table)
    expect(document.slice(0, parsed.from) + table + document.slice(parsed.to)).toBe(document)
  }
  const state = EditorState.create({ doc: '```md\n| A | B |\n| - | - |\n```', extensions: [markdown({ base: markdownLanguage })] })
  expect(tableAtPosition(state, state.doc.line(2).from)).toBeNull()
})

test('edit a preview table, change its shape and alignment, then undo it as one change', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.locator('.cm-content').fill(original)
  await page.getByRole('button', { name: 'Edit table 1', exact: true }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Edit table', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Row 2, column 3', exact: true }).fill('已完成')
  await dialog.getByRole('combobox', { name: 'Alignment for column 3', exact: true }).selectOption('center')
  await dialog.getByRole('button', { name: 'Add row', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Row 3, column 1', exact: true }).fill('交付')
  await dialog.getByRole('button', { name: 'Add column', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Header, column 4', exact: true }).fill('日期')
  await dialog.getByRole('button', { name: 'Delete column 2', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete row 1', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('.markdown-body th')).toHaveText(['項目', '狀態', '日期'])
  await expect(page.locator('.markdown-body tbody tr')).toHaveCount(2)
  await expect(page.locator('.markdown-body tbody tr').first()).toContainText('已完成')
  await expect(page.locator('.markdown-body tbody tr').first().locator('td').nth(1)).toHaveCSS('text-align', 'center')
  await expect.poll(() => source(page)).toContain('\n\n保留這一段。')
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe(original)
  await page.keyboard.press('Control+y')
  await expect(page.locator('.markdown-body table')).toContainText('已完成')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(page.locator('.markdown-body table')).toContainText('已完成')
  expect(errors).toEqual([])
})

test('spreadsheet paste preserves quoted tabs, multiline text, pipes and surrounding content', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# 新表格\n\n')
  await page.keyboard.press('Control+End')
  await page.getByRole('button', { name: 'Insert or edit table', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert table', exact: true })
  await pasteCells(dialog.getByRole('textbox', { name: 'Header, column 1', exact: true }), '名稱\t備註\r\n甲\t"第一行\r\n第二行"\r\n乙\t"A|B 與 ""引號""\tTab"\r\n')
  await expect(dialog.locator('textarea')).toHaveCount(6)
  await expect(dialog.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('第一行\n第二行')
  await expect(dialog.getByRole('textbox', { name: 'Row 2, column 2', exact: true })).toHaveValue('A|B 與 "引號"\tTab')
  await dialog.getByRole('button', { name: 'Insert table', exact: true }).click()
  await expect(page.locator('.markdown-body table')).toContainText('A|B 與 “引號”')
  await expect(page.locator('.markdown-body td br')).toHaveCount(1)
  await expect.poll(() => source(page)).toContain('第一行<br>第二行')
  await expect.poll(() => source(page)).toContain('A\\|B')
  await page.locator('.markdown-body table').dblclick()
  await expect(page.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('第一行\n第二行')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown Keep the editable source', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toContain('第一行<br>第二行')
  expect(Buffer.concat(chunks).toString()).toContain('A\\|B 與 "引號"\tTab')
})

test('HTML table paste is safe and merged cells do not overwrite the draft', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('')
  await page.getByRole('button', { name: 'Insert or edit table', exact: true }).click()
  const first = page.getByRole('textbox', { name: 'Header, column 1', exact: true })
  await pasteCells(first, '', '<table><tr><th>姓名</th><th>說明</th></tr><tr><td>小林</td><td>第一行<br>第二行<img src="x" onerror="window.tablePasteUnsafe=true"><script>window.tablePasteUnsafe=true</script></td></tr></table>')
  await expect(page.getByRole('textbox', { name: 'Row 1, column 2', exact: true })).toHaveValue('第一行\n第二行')
  await pasteCells(first, '', '<table><tr><td colspan="2">合併內容</td></tr></table>')
  await expect(page.getByRole('alert')).toHaveText('Unmerge the spreadsheet cells before pasting them here.')
  await expect(first).toHaveValue('姓名')
  await expect.poll(() => page.evaluate(() => 'tablePasteUnsafe' in window)).toBe(false)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => source(page)).toBe('')
})

test('preview buttons select the right table and do not appear in exported HTML', async ({ page }) => {
  await page.goto('/')
  await page.locator('.editor-host .cm-content').fill('| First |\n| --- |\n| A |\n\nBetween\n\n| Second |\n| --- |\n| B |')
  await page.getByRole('button', { name: 'Edit table 2', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Header, column 1', exact: true })).toHaveValue('Second')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: /Portable HTML Embeds/ }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const html = Buffer.concat(chunks).toString()
  expect(html.match(/<table\b/g)).toHaveLength(2)
  expect(html).not.toContain('preview-table')
  expect(html).not.toContain('Edit table')
})

test('table line breaks keep escaped HTML and inline code literal', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('| Kind | Text |\n| --- | --- |\n| Break | A<br>B |\n| Code | `<br>` |\n| Entity | &lt;br&gt; |\n| Escape | \\<br> |\n| HTML | <img src=x onerror=alert(1)> |\n\nOutside <br> text')
  await expect(page.locator('.markdown-body table br')).toHaveCount(1)
  await expect(page.locator('.markdown-body code')).toHaveText('<br>')
  await expect(page.locator('.markdown-body tbody tr').nth(2)).toContainText('<br>')
  await expect(page.locator('.markdown-body tbody tr').nth(3)).toContainText('<br>')
  await expect(page.locator('.markdown-body img')).toHaveCount(0)
  await expect(page.locator('.markdown-body > p')).toHaveText('Outside <br> text')
})

test('keyboard navigation, composition, cancellation, and document modes remain usable', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill(original)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.getByRole('button', { name: 'Insert or edit table', exact: true }).click()
  const first = page.getByRole('textbox', { name: 'Header, column 1', exact: true })
  await expect(first).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Header, column 2', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(first).toBeFocused()
  await first.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
  })
  await expect(first).toBeFocused()
  await first.fill('中文表頭')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Row 1, column 1', exact: true })).toBeFocused()
  const last = page.getByRole('textbox', { name: 'Row 2, column 3', exact: true })
  await last.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Row 3, column 3', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Delete row 3', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => source(page)).toBe(original)
  for (const mode of ['text', 'mermaid']) {
    await page.getByRole('combobox', { name: 'Document mode', exact: true }).selectOption(mode)
    await expect(page.getByRole('button', { name: 'Insert or edit table', exact: true })).toHaveCount(0)
  }
  await page.getByRole('combobox', { name: 'Document mode', exact: true }).selectOption('markdown')
  await expect(page.getByRole('button', { name: 'Insert or edit table', exact: true })).toBeVisible()
})

test('table editor fits a phone and keeps its actions visible in Traditional Chinese', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('markword.preference.locale', 'zh-TW'))
  await page.goto('/')
  await page.locator('.cm-content').fill(original)
  await page.getByRole('button', { name: '插入或編輯表格', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '插入表格', exact: true })
  await expect(dialog.getByRole('button', { name: '新增列', exact: true })).toBeInViewport()
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport()
  await expect(dialog.getByRole('button', { name: '插入表格', exact: true })).toBeInViewport()
  expect(await page.locator('.table-editor').evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('textbox', { name: '表頭，第 1 欄', exact: true }).fill('中文輸入')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: '表頭，第 2 欄', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => source(page)).toBe(original)
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.locator('.pane--editor .pane-header').evaluate((element) =>
    Math.max(...Array.from(element.querySelectorAll('button, select'), (control) => control.getBoundingClientRect().right)),
  )).toBeLessThanOrEqual(320)
  await page.getByRole('tab', { name: '預覽', exact: true }).click()
  await page.locator('.markdown-body table').dblclick()
  await expect(page.getByRole('dialog', { name: '編輯表格', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '套用變更', exact: true })).toBeInViewport()
})
