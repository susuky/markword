import { expect, test } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'

const wordMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

function wordFile(body: string, name = 'Meeting.docx') {
  const entries = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`),
    'word/styles.xml': strToU8('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="Unmapped Style"/></w:style></w:styles>'),
    'word/numbering.xml': strToU8('<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/><Relationship Id="link1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/><Relationship Id="unsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>'),
    'word/media/image.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64'),
  }
  return { name, mimeType: wordMime, buffer: Buffer.from(zipSync(entries)) }
}

const formattedWord = wordFile(`
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Word meeting notes</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>重要事項</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Review draft</w:t></w:r><w:r><w:rPr><w:strike/></w:rPr><w:t>Old text</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Next action</w:t></w:r></w:p>
  <w:p><w:hyperlink r:id="link1"><w:r><w:t>Reference</w:t></w:r></w:hyperlink><w:hyperlink r:id="unsafe"><w:r><w:t>Unsafe link</w:t></w:r></w:hyperlink></w:p>
  <w:tbl><w:tr><w:tc>${paragraph('Task')}</w:tc><w:tc>${paragraph('Owner')}</w:tc></w:tr><w:tr><w:tc>${paragraph('Review | approve')}${paragraph('Then publish')}</w:tc><w:tc>${paragraph('王小明')}</w:tc></w:tr></w:tbl>
  <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Image" descr="Meeting image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="image1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
`)

test('Word import preserves editable content, tables, images, and downloads', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page).toHaveTitle('Markword')
  await page.locator('input[type=file]').first().setInputFiles(formattedWord)
  await expect(page.locator('.markdown-body h1')).toHaveText('Word meeting notes')
  await expect(page.locator('.markdown-body strong')).toHaveText('重要事項')
  await expect(page.locator('.markdown-body em')).toHaveText('Review draft')
  await expect(page.locator('.markdown-body s')).toHaveText('Old text')
  await expect(page.locator('.markdown-body ul li')).toHaveText('Next action')
  await expect(page.locator('.markdown-body a[href="https://example.com/"]')).toHaveText('Reference')
  await expect(page.locator('.markdown-body a[href^="javascript:"]')).toHaveCount(0)
  await expect(page.locator('.markdown-body th')).toHaveText(['Task', 'Owner'])
  await expect(page.locator('.markdown-body td')).toHaveText(['Review | approve Then publish', '王小明'])
  await expect(page.locator('.markdown-body img')).toHaveAttribute('data-asset-path', 'assets/Meeting-image-1.png')
  await expect.poll(() => page.locator('.markdown-body img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.cm-content')).toContainText('# Word meeting notes')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(page.locator('.markdown-body h1')).toHaveText('Word meeting notes')
  await expect(page.locator('.markdown-body img')).toHaveAttribute('src', /^blob:/)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown Keep the editable source', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Word meeting notes.md')
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const markdown = Buffer.concat(chunks).toString()
  expect(markdown).toContain('**重要事項**')
  expect(markdown).toContain('| Review \\| approve Then publish | 王小明 |')
  expect(markdown).toContain('![Meeting image](./assets/Meeting-image-1.png)')
  expect(markdown).not.toContain('javascript:')
  expect(errors).toEqual([])
})

test('Word files at the 15 MiB limit still import successfully', async ({ page }) => {
  const file = wordFile(paragraph('A document at the file size limit'))
  const entries = unzipSync(file.buffer)
  const emptyArchive = zipSync({ ...entries, 'word/padding.bin': [new Uint8Array(), { level: 0 }] })
  const buffer = Buffer.from(zipSync({
    ...entries,
    'word/padding.bin': [new Uint8Array(15 * 1024 * 1024 - emptyArchive.length), { level: 0 }],
  }))
  expect(buffer.length).toBe(15_728_640)
  await page.goto('./')
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles({ ...file, buffer })
  await expect(page.locator('.markdown-body')).toHaveText('A document at the file size limit')
  await expect(page.locator('.toast')).toHaveText('Converted Meeting.docx to Markdown')
})

test('dropping Word converts it, and invalid imports preserve the current draft', async ({ page }) => {
  // Keep the preceding error visible while the next invalid Word is processing.
  await page.addInitScript(() => {
    const arrayBuffer = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'Meeting.docx') await new Promise((resolve) => setTimeout(resolve, 400))
      return arrayBuffer.call(this)
    }
  })
  await page.goto('./')
  await expect(page.locator('.cm-content')).toBeVisible()
  // LAN deployments over HTTP may not provide crypto.randomUUID.
  await page.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }))
  const file = wordFile(paragraph('Drop conversion works'), 'Drop.DOCX')
  const transfer = await page.evaluateHandle(({ name, mimeType, bytes }) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }))
    return data
  }, { ...file, bytes: [...file.buffer] })
  await page.locator('.workspace').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(page.locator('.markdown-body')).toHaveText('Drop conversion works')
  await expect(page.locator('.asset-trigger small')).toHaveCount(0)

  const input = page.locator('input[type="file"]').first()
  for (const invalid of [
    { name: 'Broken.docx', mimeType: wordMime, buffer: Buffer.from('not a zip') },
    wordFile(''),
    { name: 'Large.docx', mimeType: wordMime, buffer: Buffer.alloc(15 * 1024 * 1024 + 1) },
    { name: 'Expanded.docx', mimeType: wordMime, buffer: Buffer.from(zipSync({ 'large.xml': new Uint8Array(50_000_001) })) },
    { name: 'Legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('legacy') },
    { name: 'Wrong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') },
  ]) {
    await expect(page.getByRole('button', { name: 'Open document or project', exact: true })).toBeEnabled()
    await input.setInputFiles(invalid)
    // Identical errors from consecutive files must not satisfy this check early.
    await expect(page.getByRole('button', { name: 'Open document or project', exact: true })).toBeEnabled()
    await expect(page.locator('.toast')).toContainText(invalid.name === 'Large.docx' ? 'larger than 15 MiB'
      : invalid.name === 'Legacy.doc' ? 'Save this Word file as .docx'
      : invalid.name === 'Wrong.pdf' ? 'Please choose a Markdown, text, Mermaid, Word (.docx)'
      : 'Could not convert this Word file')
    await expect(page.locator('.cm-content')).toHaveText('Drop conversion works')
  }
  await input.setInputFiles({ name: 'Original.md', mimeType: 'text/markdown', buffer: Buffer.from('# Markdown still works') })
  await expect(page.locator('.markdown-body h1')).toHaveText('Markdown still works')
})

test('oversized Markdown and Word files are rejected before reading or replacing the draft', async ({ page }) => {
  await page.addInitScript(() => {
    File.prototype.text = File.prototype.arrayBuffer = async () => { throw new Error('Oversized files must not be read') }
  })
  await page.goto('./')
  await page.locator('.cm-content').fill('# Preserve the current draft')
  for (const name of ['Oversized.md', 'Oversized.docx']) {
    await page.locator('input[type="file"]').first().setInputFiles({
      name, mimeType: name.endsWith('.docx') ? wordMime : 'text/markdown', buffer: Buffer.alloc(15_728_641),
    })
    await expect(openButton()).toBeEnabled()
    await expect(page.locator('.toast')).toHaveText('This file is larger than 15 MiB. Please choose a smaller file.')
    await expect(page.locator('.cm-content')).toHaveText('# Preserve the current draft')
  }

  function openButton() { return page.getByRole('button', { name: 'Open document or project', exact: true }) }
})

test('Word import and review notices work on mobile in Traditional Chinese', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await expect(page.getByRole('button', { name: '開啟文件或專案', exact: true })).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(wordFile('<w:p><w:pPr><w:pStyle w:val="Custom"/></w:pPr><w:r><w:t>待檢查的 Word 內容</w:t></w:r></w:p>'))
  await expect(page.locator('.toast')).toContainText('部分內容或格式無法保留')
  await expect(page.locator('.cm-content')).toHaveText('待檢查的 Word 內容')
  await page.getByRole('tab', { name: '預覽', exact: true }).click()
  await expect(page.locator('.markdown-body')).toHaveText('待檢查的 Word 內容')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
