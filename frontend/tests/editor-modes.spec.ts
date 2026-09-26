import { expect, test, type Page } from '@playwright/test'

const source = (page: Page) => page.locator('.cm-line').allTextContents().then((lines) => lines.join('\n'))

const multilineList = [
  '我剛剛再整理了一下，有幾個東西想先確認清楚，因為會直接影響後面系統怎麼設計。',
  '',
  '1. 現在其實已經有 XQ、MultiCharts 之類可以做即時行情、策略跟自動下單，所以我想先知道，現成產品是哪裡不符合你的需求？你找我重做主要想解決什麼？',
  '   ',
  '2. 剛剛說沒有要代操，我想確認實際會有哪些情況：',
  '你的資金 → 你的策略 → 自動下單',
  '客戶資金 → 客戶自己的策略 → 自動下單',
  '客戶資金 → 你的策略 → 自動下單',
  '這三種會有哪些？',
  '',
  '3. 如果客戶會使用你的策略，你之後修改策略或參數時，是會直接影響客戶帳戶，還是客戶要重新確認／啟用新版策略？',
].join('\n')

test('deleting the new empty number before unindented body lines restores the original following number', async ({ page }) => {
  await page.goto('/')
  const position = multilineList.split('\n').slice(0, 5).join('\n').length
  const inserted = multilineList.replace('\n你的資金', '\n3. \n你的資金').replace('3. 如果', '4. 如果')
  const markerRemoved = multilineList.replace('\n你的資金', '\n\n你的資金')
  for (const method of ['Backspace', 'selection', 'Delete', 'cut', 'Enter']) {
    await page.locator('.cm-content').fill(multilineList)
    await page.keyboard.press('Control+Home')
    for (let offset = 0; offset < position; offset++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => source(page)).toBe(inserted)
    if (method === 'selection' || method === 'cut') await page.keyboard.press('Shift+Home')
    if (method === 'Delete') {
      await page.keyboard.press('Home')
      for (let offset = 0; offset < 3; offset++) await page.keyboard.press('Delete')
    } else {
      await page.keyboard.press(method === 'cut' ? 'Control+x' : method === 'selection' ? 'Backspace' : method)
    }
    await expect.poll(() => source(page)).toBe(markerRemoved)
    await page.keyboard.press('Backspace')
    await expect.poll(() => source(page)).toBe(multilineList)
    await expect(page.locator('.markdown-body ol')).toHaveCount(1)
    await expect(page.locator('.markdown-body ol > li')).toHaveCount(3)
    if (method !== 'Delete') {
      await page.keyboard.press('Control+z')
      await expect.poll(() => source(page)).toBe(markerRemoved)
      await page.keyboard.press('Control+z')
      await expect.poll(() => source(page)).toBe(inserted)
      await page.keyboard.press('Control+y')
      await page.keyboard.press('Control+y')
      await expect.poll(() => source(page)).toBe(multilineList)
    }
  }
})

test('empty-list deletion crosses its body text but respects list and section boundaries', async ({ page }) => {
  await page.goto('/')
  for (const [tail, expected] of [
    ['3. Next\n4. Last', '2. Next\n3. Last'],
    ['1. Restart\n2. Keep', '1. Restart\n2. Keep'],
    ['4. Intentional gap', '4. Intentional gap'],
    ['3) Different style', '3) Different style'],
    ['## Separate section\n\n3. Keep', '## Separate section\n\n3. Keep'],
    ['```text\nexample\n```\n\n3. Keep', '```text\nexample\n```\n\n3. Keep'],
  ]) {
    const before = '1. First\n2. \nBody without indentation\n\n' + tail
    await page.locator('.cm-content').fill(before)
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await expect.poll(() => source(page)).toBe('1. First\n\nBody without indentation\n\n' + expected)
  }
})

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

test('continuation lines keep their numbers while Enter on the item creates a new number', async ({ page }) => {
  await page.goto('/')
  const lines = [
    '5. 商業模式打算怎麼做？',
    '是收軟體費、月費、策略訂閱費、交易分潤、獲利分潤，還是其他方式？',
    '',
    '6. 資金來源會有哪些？',
    '你自己的資金、客戶自己的資金，還是有人把資金交給你操作？',
    '',
    '7. 賺錢的話怎麼分？如果交易本身賠錢怎麼算？',
    '另外如果是程式 bug、API 斷線、漏單、重複下單之類造成損失，這部分責任怎麼處理？',
  ]
  const original = lines.join('\n')
  for (const lineIndex of [4, 5]) {
    await page.locator('.cm-content').fill(original)
    await page.keyboard.press('Control+Home')
    // Use source offsets so wrapped visual lines cannot change the test position.
    for (let offset = 0; offset < lines.slice(0, lineIndex + 1).join('\n').length; offset++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    const expected = [...lines]
    expected.splice(lineIndex + 1, 0, '')
    await expect.poll(() => source(page)).toBe(expected.join('\n'))
    await page.keyboard.press('Backspace')
    await expect.poll(() => source(page)).toBe(original)
  }
  // An indented continuation also stays in the same item, without changing later numbers.
  await page.locator('.cm-content').fill('6. Item\n   Details\n\n7. Next')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('6. Item\n   Details\n   \n\n7. Next')
  await page.keyboard.press('Control+z')
  await expect.poll(() => source(page)).toBe('6. Item\n   Details\n\n7. Next')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect.poll(() => source(page)).toBe('6. Item\n7. \n   Details\n\n8. Next')
  await page.keyboard.press('Backspace')
  await expect.poll(() => source(page)).toBe('6. Item\n\n   Details\n\n7. Next')
})

test('removing a numbered marker with text restores following numbers and undo restores both', async ({ page }) => {
  await page.goto('/')
  const first = '4. 客戶的券商帳號、API、憑證會放在哪？是在客戶自己的電腦執行'
  const rest = '，還是會有一台中央 server 管很多帳戶？'
  const following = '\n\n5. 商業模式打算怎麼做？\n是收軟體費、月費，還是其他方式？\n\n6. 資金來源會有哪些？\n你自己的資金、客戶自己的資金？\n\n7. 賺錢的話怎麼分？'
  const split = first + '\n5. ' + rest + following.replace('5.', '6.').replace('6. 資金', '7. 資金').replace('7. 賺錢', '8. 賺錢')
  for (const method of ['Backspace', 'selection', 'Delete', 'cut']) {
    await page.locator('.cm-content').fill(first + rest + following)
    await page.keyboard.press('Control+Home')
    for (let offset = 0; offset < first.length; offset++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => source(page)).toBe(split)
    await expect(page.locator('.markdown-body ol > li')).toHaveCount(5)
    if (method === 'selection' || method === 'cut') {
      for (let offset = 0; offset < 3; offset++) await page.keyboard.press('Shift+ArrowLeft')
    } else if (method === 'Delete') {
      await page.keyboard.press('Home')
    }
    await page.keyboard.press(method === 'cut' ? 'Control+x' : method === 'Delete' ? 'Delete' : 'Backspace')
    const remainingPrefix = method === 'Delete' ? '. ' : ''
    await expect.poll(() => source(page)).toBe(first + '\n' + remainingPrefix + rest + following)
    await expect(page.locator('.markdown-body ol > li')).toHaveCount(4)
    await expect(page.locator('.markdown-body ol > li').first()).toContainText(rest)
    await page.keyboard.press('Control+z')
    await expect.poll(() => source(page)).toBe(split)
    await expect(page.locator('.markdown-body ol > li')).toHaveCount(5)
    await page.keyboard.press('Control+y')
    await expect.poll(() => source(page)).toBe(first + '\n' + remainingPrefix + rest + following)
  }
})

test('deleting items renumbers only their own consecutive list, including nested and quoted lists', async ({ page }) => {
  await page.goto('/')
  for (const [before, remove, after] of [
    ['8. First\n9. Remove\n10. Next\n11. Last', '9. Remove\n', '8. First\n9. Next\n10. Last'],
    ['1. First\n2. Remove\n3. Remove too\n4. Last', '2. Remove\n3. Remove too\n', '1. First\n2. Last'],
    ['1. First\n2. Remove\n3. Next\n9. Intentional\n10. Keep', '2. ', '1. First\nRemove\n2. Next\n9. Intentional\n10. Keep'],
    ['1. Parent\n    1. Child\n    2. Remove\n    3. Next child\n2. Next parent', '2. Remove', '1. Parent\n    1. Child\n    \n    2. Next child\n2. Next parent'],
    ['> 1. First\n> 2. Remove\n> 3. Next\n\n1. Separate\n2. Keep', '2. ', '> 1. First\n> Remove\n> 2. Next\n\n1. Separate\n2. Keep'],
    ['1. First\n2. Remove\n3. Next\n\n```text\n4. Literal\n5. Literal\n```\n\n1. Separate\n2. Keep', '2. ', '1. First\nRemove\n2. Next\n\n```text\n4. Literal\n5. Literal\n```\n\n1. Separate\n2. Keep'],
    ['```text\n1. Literal\n2. Literal\n```\n\n1. First\n2. Keep', '1. ', '```text\nLiteral\n2. Literal\n```\n\n1. First\n2. Keep'],
  ]) {
    await page.locator('.cm-content').fill(before)
    await page.keyboard.press('Control+Home')
    for (let offset = 0; offset < before.indexOf(remove); offset++) await page.keyboard.press('ArrowRight')
    for (let offset = 0; offset < remove.length; offset++) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Backspace')
    await expect.poll(() => source(page)).toBe(after)
  }
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await page.locator('.cm-content').fill('1. Literal\n2. Keep')
  await page.keyboard.press('Control+Home')
  for (let offset = 0; offset < 3; offset++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Backspace')
  await expect.poll(() => source(page)).toBe('Literal\n2. Keep')
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
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }))
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
