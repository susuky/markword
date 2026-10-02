import { expect, test, type Download } from '@playwright/test'
import { strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from 'fflate'

async function downloadText(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

test('footnote examples remain literal in fenced and indented code', async ({ page }) => {
  await page.goto('/')
  const markdown = '# Footnotes\n\nReal reference[^real].\n\n```md\n[^fenced]: Keep this example\n  And this continuation\n```\n\n~~~~md\n```\n[^tilde]: Keep this too\n```\n~~~~\n\n    [^indented]: Indented example\n\n> ```md\n> [^quoted]: Quoted example\n> ```\n\n[^real]: Real footnote\n  Second line'
  await page.locator('.cm-content').fill(markdown)
  await expect(page.locator('.markdown-body pre code')).toHaveText([
    '[^fenced]: Keep this example\n  And this continuation\n',
    '```\n[^tilde]: Keep this too\n```\n',
    '[^indented]: Indented example\n',
    '[^quoted]: Quoted example\n',
  ])
  await expect(page.locator('.footnotes li')).toHaveCount(1)
  await expect(page.locator('.footnotes')).toContainText('Real footnote Second line')
  await page.locator('.cm-content').fill('```md\n[^unclosed]: Still code\n  Keep this line')
  await expect(page.locator('.markdown-body pre code')).toHaveCount(1)
  await expect(page.locator('.markdown-body pre code')).toContainText('[^unclosed]: Still code')
  await expect(page.locator('.footnotes')).toHaveCount(0)
})

test('HTML export freezes the clicked document and embeds offline math and diagrams', async ({ page, browser }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page).toHaveTitle('Markword')
  const document = '# 匯出內容驗證\n\n行內公式 $x_i^2$ 與分數 $\\frac{a}{b}$。\n\n$$\n\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}\n$$\n\n```mermaid\nflowchart LR\n A[確認內容] --> B[下載文件]\n```\n\n範例：\n\n```md\n[^example]: 保留範例原文\n```'
  await page.locator('.cm-content').fill(document)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Portable HTML/ }).click()
  // A later edit must not leak into an export that is still drawing its diagram.
  await page.locator('.cm-content').fill('# Later edit\n\nNot part of the downloaded snapshot.')
  const html = await downloadText(await downloadPromise)
  expect(html).toContain('匯出內容驗證')
  expect(html).not.toContain('Later edit')
  expect(html).not.toContain('url(fonts/')
  expect(html).toContain('data:font/woff2;base64,')

  const offline = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } })
  try {
    const result = await offline.newPage()
    result.on('pageerror', (error) => errors.push(error.message))
    const requests: string[] = []
    result.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    await result.setContent(html)
    await result.evaluate(() => document.fonts.ready)
    await expect(result.locator('h1')).toHaveText('匯出內容驗證')
    await expect(result.locator('.mermaid-block svg')).toHaveCount(1)
    await expect(result.locator('.mermaid-block')).toContainText('下載文件')
    await expect(result.locator('.katex')).toHaveCount(3)
    await expect(result.locator('.katex-mathml').first()).toHaveCSS('position', 'absolute')
    await expect(result.locator('.katex-mathml').first()).toHaveCSS('width', '1px')
    await expect(result.locator('.frac-line').first()).not.toHaveCSS('border-bottom-width', '0px')
    expect(await result.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true)
    await expect(result.locator('pre code')).toHaveText('[^example]: 保留範例原文\n')
    await expect(result.locator('button')).toHaveCount(0)
    expect(requests).toEqual([])
    expect(errors).toEqual([])
    await result.screenshot({ path: testInfo.outputPath('portable-html-desktop.png'), fullPage: true })
    await result.setViewportSize({ width: 390, height: 844 })
    expect(await result.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await result.screenshot({ path: testInfo.outputPath('portable-html-mobile.png'), fullPage: true })
  } finally {
    await offline.close()
  }
})

test('project asset collisions preserve the previous revision image', async ({ page }) => {
  const project = (name: string, color: string) => ({
    name: `${name}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zipSync({
      'document.md': strToU8(`# ${name}\n\n![Logo](./assets/logo.svg)`),
      'assets/logo.svg': strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`),
    })),
  })
  await page.goto('/')
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(project('Original project', 'red'))
  await expect(page.locator('.markdown-body h1')).toHaveText('Original project')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Create current revision', exact: true }).click()
  await expect(page.locator('.revision-panel__message')).toHaveText('Current revision created')
  await page.keyboard.press('Escape')
  await input.setInputFiles(project('New project', 'blue'))
  const image = page.locator('.markdown-body img')
  await expect(image).toHaveAttribute('data-asset-path', 'assets/logo-2.svg')
  await expect.poll(() => image.evaluate(async (node: HTMLImageElement) => fetch(node.src).then((response) => response.text()))).toContain('blue')
  await page.getByRole('button', { name: 'Revision history', exact: true }).click()
  await page.getByRole('button', { name: 'Restore this revision', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.markdown-body h1')).toHaveText('Original project')
  await expect(image).toHaveAttribute('data-asset-path', 'assets/logo.svg')
  await expect.poll(() => image.evaluate(async (node: HTMLImageElement) => fetch(node.src).then((response) => response.text()))).toContain('red')
})

test('stale tabs cannot overwrite a newer saved draft', async ({ page, context }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.locator('.cm-content').fill('# Shared draft')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  const stale = await context.newPage()
  stale.on('pageerror', (error) => errors.push(error.message))
  await stale.goto('/')
  await expect(stale.locator('.cm-content')).toHaveText('# Shared draft')
  await expect(stale.locator('.save-status')).toHaveText('Saved in this browser')
  await page.locator('.cm-content').fill('# Newer saved draft')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await stale.locator('.cm-content').fill('# Keep this separate copy')
  await expect(stale.locator('.save-status')).toContainText('Changed in another tab')
  await stale.reload()
  await expect(stale.locator('.cm-content')).toHaveText('# Newer saved draft')
  expect(errors).toEqual([])
  // Verify the conflict message is readable on a phone too.
  await page.locator('.cm-content').fill('# Latest version')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await stale.setViewportSize({ width: 390, height: 844 })
  await stale.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await stale.locator('.cm-content').fill('# 另一個分頁的內容')
  await expect(stale.locator('.save-status')).toContainText('其他分頁已更新')
  expect(await stale.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await stale.screenshot({ path: testInfo.outputPath('draft-conflict-mobile.png') })
})

test('asset renaming updates URL syntax while keeping code examples literal', async ({ page }) => {
  await page.goto('/')
  const path = 'assets/brand/Logo 名稱(1).svg'
  const markdown = '![Logo](./assets/brand/Logo%20%e5%90%8d%e7%a8%b1%281%29.svg)\n\n[Reference][logo]\n\n[logo]: <assets/brand/Logo 名稱(1).svg> "Logo"\n\n@[video](/assets/brand/Logo%20%E5%90%8D%E7%A8%B1%281%29.svg)\n\n`![Example](./assets/brand/Logo%20%E5%90%8D%E7%A8%B1%281%29.svg)`'
  const zip = zipSync({ 'document.md': strToU8(markdown), [path]: strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>') })
  const result = await page.evaluate(async (bytes) => {
    const module = '/src/assets.ts'
    const { importProjectArchive, assetMarkdownUrl } = await import(/* @vite-ignore */ module)
    const file = new File([new Uint8Array(bytes)], 'project.zip')
    await importProjectArchive(file)
    const imported = await importProjectArchive(file)
    return { markdown: imported.markdown, url: assetMarkdownUrl(imported.assets[0].path) }
  }, Array.from(zip))
  expect(result.markdown).toContain(`![Logo](${result.url})`)
  expect(result.markdown).toContain(`[logo]: ${result.url} "Logo"`)
  expect(result.markdown).toContain(`@[video](${result.url})`)
  expect(result.markdown).toContain('`![Example](./assets/brand/Logo%20%E5%90%8D%E7%A8%B1%281%29.svg)`')
})

test('plain text project imports preserve literal asset paths', async ({ page }) => {
  await page.goto('/')
  const text = '![Example](./assets/logo.svg)'
  const archive = zipSync({
    'document.md': strToU8(text),
    'markword.json': strToU8(JSON.stringify({ version: 1, document: 'document.md', mode: 'text', assets: [] })),
    'assets/logo.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  })
  const imported = await page.evaluate(async (bytes) => {
    const module = '/src/assets.ts'
    const { importProjectArchive } = await import(/* @vite-ignore */ module)
    const file = new File([new Uint8Array(bytes)], 'plain-text.zip')
    await importProjectArchive(file)
    const result = await importProjectArchive(file)
    return { markdown: result.markdown, mode: result.mode, path: result.assets[0].path }
  }, Array.from(archive))
  expect(imported).toEqual({ markdown: text, mode: 'text', path: 'assets/logo-2.svg' })
})

test('ZIP validation bounds actual output and accepts stored and streamed archives', async ({ page }) => {
  await page.goto('/')
  const valid = Buffer.from(zipSync({ '中文.md': strToU8('# Valid') }, { level: 0 }))
  // A small ZIP64 fixture exercises 64-bit directory sizes and local offsets
  // without allocating a multi-gigabyte archive.
  const centralAt = valid.readUInt32LE(valid.length - 6)
  const central = Buffer.from(valid.subarray(centralAt, -22))
  const extra = Buffer.alloc(28)
  extra.writeUInt16LE(1)
  extra.writeUInt16LE(24, 2)
  extra.writeBigUInt64LE(BigInt(central.readUInt32LE(24)), 4)
  extra.writeBigUInt64LE(BigInt(central.readUInt32LE(20)), 12)
  extra.writeBigUInt64LE(0n, 20)
  central.writeUInt32LE(0xffffffff, 20)
  central.writeUInt32LE(0xffffffff, 24)
  central.writeUInt32LE(0xffffffff, 42)
  central.writeUInt16LE(extra.length, 30)
  const zip64End = Buffer.alloc(56)
  zip64End.writeUInt32LE(0x06064b50)
  zip64End.writeBigUInt64LE(44n, 4)
  zip64End.writeUInt16LE(45, 12)
  zip64End.writeUInt16LE(45, 14)
  zip64End.writeBigUInt64LE(1n, 24)
  zip64End.writeBigUInt64LE(1n, 32)
  zip64End.writeBigUInt64LE(BigInt(central.length + extra.length), 40)
  zip64End.writeBigUInt64LE(BigInt(centralAt), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50)
  locator.writeBigUInt64LE(BigInt(centralAt + central.length + extra.length), 8)
  locator.writeUInt32LE(1, 16)
  const end = Buffer.from(valid.subarray(-22))
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)
  const zip64 = Buffer.concat([valid.subarray(0, centralAt), central, extra, zip64End, locator, end])
  const streamedChunks: Uint8Array[] = []
  const stream = new Zip((error, bytes) => { if (error) throw error; streamedChunks.push(bytes) })
  const entry = new ZipDeflate('stream.md')
  stream.add(entry)
  entry.push(strToU8('# Streamed'), true)
  stream.end()
  const streamed = Buffer.concat(streamedChunks)
  const nested = zipSync({ 'inside.md': strToU8('# Attachment') })
  const nestedArchives = [false, true].map((deflate) => {
    const chunks: Uint8Array[] = []
    const outer = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes) })
    const attachment = deflate ? new ZipDeflate('assets/example.zip', { level: 0 }) : new ZipPassThrough('assets/example.zip')
    outer.add(attachment)
    attachment.push(nested, true)
    outer.end()
    return Buffer.concat(chunks)
  })
  const forged = Buffer.from(zipSync({ 'large.md': new Uint8Array(100_000) }))
  forged.writeUInt32LE(1, 22)
  forged.writeUInt32LE(1, forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24)
  const many = zipSync({ a: strToU8('a'), b: strToU8('b'), c: strToU8('c') })
  const duplicate = Buffer.from(zipSync({ one: strToU8('a'), two: strToU8('b') }))
  // Change both local and central names, retaining a structurally valid ZIP.
  for (let offset = duplicate.indexOf('two'); offset >= 0; offset = duplicate.indexOf('two', offset + 3)) duplicate.write('one', offset)
  const totalExceeded = zipSync({ a: new Uint8Array(3000), b: new Uint8Array(3000) })
  const outcomes = await page.evaluate(async (archives) => {
    const module = '/src/zip.ts'
    const { unzipBounded } = await import(/* @vite-ignore */ module)
    const outcomes: string[] = []
    for (const bytes of archives) {
      try {
        const entries = await unzipBounded(new Uint8Array(bytes), { maxTotalBytes: 4096, maxEntryBytes: 4096, maxEntries: 2 })
        outcomes.push(Object.keys(entries).join(','))
      } catch (error) {
        outcomes.push((error as Error).message)
      }
    }
    return outcomes
  }, [valid, zip64, streamed, ...nestedArchives, forged, many, duplicate, totalExceeded].map((bytes) => Array.from(bytes)))
  expect(outcomes).toEqual([
    '中文.md', '中文.md', 'stream.md', 'assets/example.zip', 'assets/example.zip', 'Archive contents exceed the import limits',
    'Archive contents exceed the import limits', 'Archive is damaged or uses an unsupported format',
    'Archive contents exceed the import limits',
  ])
  const before = await page.locator('.cm-line').allTextContents()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Forged.zip', mimeType: 'application/zip', buffer: forged })
  await expect(page.locator('.toast')).toContainText('Archive is damaged')
  await expect(page.locator('.cm-line')).toHaveText(before)
})

test('Word export does not send an HTML or PDF layout', async ({ page }) => {
  let payload: Record<string, string> = {}
  await page.route('**/api/export/docx', async (route) => {
    payload = route.request().postDataJSON()
    await route.fulfill({ body: 'test document', headers: { 'Content-Disposition': 'attachment; filename="test.docx"' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByText('Layouts apply to HTML and PDF', { exact: true })).toBeVisible()
  await page.locator('.export-style-picker summary').click()
  await page.getByRole('button', { name: /^Editorial Generous/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Word Uses the current palette/ }).click()
  await download
  expect(payload.style).toBeUndefined()
  expect(payload.theme).toBe('Light')
})
