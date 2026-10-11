import { expect, test, type Download, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: /^Export settings and preview/ }).click()
  await expect(page.getByRole('dialog', { name: 'Export settings and preview' })).toBeVisible()
}

async function downloadedText(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

test('settings affect the real HTML, preview, PDF and Word requests and survive reload', async ({ page }) => {
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/export/*', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ body: 'Export fixture' })
  })
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  const source = '# Layout check\n\nReadable **body text**.\n'
  await page.locator('.cm-content').fill(source)
  await openSettings(page)
  await page.getByLabel('Paper size', { exact: true }).selectOption('Letter')
  await page.getByLabel('Page margin (mm)', { exact: true }).press('Home')
  await page.getByLabel('Page margin (mm)', { exact: true }).press('ArrowRight')
  await page.getByLabel('Body font size (px)', { exact: true }).press('End')
  await page.getByLabel('Document layout', { exact: true }).selectOption('Editorial')
  const preview = page.frameLocator('iframe[title="Export appearance"]')
  await expect(preview.locator('h1')).toHaveText('Layout check')
  await expect(preview.locator('.document')).toHaveCSS('font-size', '24px')
  await expect.poll(() => preview.locator('html').evaluate((element) => element.innerHTML)).toContain('@page{size:Letter;margin:11mm}')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Portable HTML/ }).click()
  const html = await downloadedText(await pending)
  expect(html).toContain('@page{size:Letter;margin:11mm}')
  expect(html).toContain('font-size:24px')
  expect(html).toContain('Noto Serif TC')
  expect(JSON.parse(html.match(/<script type="application\/json" id="markword-source">(.*?)<\/script>/s)![1]).markdown).toBe(source)
  for (const format of ['PDF', 'Word']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('dialog', { name: 'Download and export', exact: true }).getByRole('button', { name: new RegExp(`^${format} `) }).click()
    expect((await pending).suggestedFilename()).toBe(`Layout check.${format === 'PDF' ? 'pdf' : 'docx'}`)
  }
  expect(requests[0]).toMatchObject({ page_size: 'Letter', margin_mm: 11, font_size: 24, style: 'Editorial' })
  expect(requests[1]).toMatchObject({ page_size: 'Letter', margin_mm: 11, font_size: 24 })
  expect(requests[1].style).toBeUndefined()
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toBe(source)
  await page.reload()
  await expect(page.locator('.cm-content')).toBeEditable()
  await openSettings(page)
  await expect(page.getByLabel('Paper size', { exact: true })).toHaveValue('Letter')
  await expect(page.getByLabel('Page margin (mm)', { exact: true })).toHaveValue('11')
  await expect(page.getByLabel('Body font size (px)', { exact: true })).toHaveValue('24')
  await page.getByRole('button', { name: 'Reset export settings', exact: true }).click()
  await expect(page.getByLabel('Paper size', { exact: true })).toHaveValue('A4')
  await expect(page.getByLabel('Page margin (mm)', { exact: true })).toHaveValue('18')
  await expect(page.getByLabel('Body font size (px)', { exact: true })).toHaveValue('16')
})

test('a missing attachment shows a recoverable preview error and keeps the original document', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  const source = '# Missing\n\n![Lost](./assets/lost.png)'
  await page.locator('.cm-content').fill(source)
  await openSettings(page)
  await expect(page.getByRole('alert')).toContainText('Local asset is missing')
  await expect(page.locator('iframe[title="Export appearance"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Restore it before exporting')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Export settings and preview' })).toHaveCount(0)
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toBe(source)
})

test('mobile settings in Traditional Chinese fit, trap focus and return to the export trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  await page.locator('.cm-content').fill('# 中文匯出\n\n文件內容。')
  await page.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await page.getByRole('button', { name: '匯出', exact: true }).click()
  await page.getByRole('button', { name: /^匯出設定與預覽/ }).click()
  const dialog = page.getByRole('dialog', { name: '匯出設定與預覽' })
  await expect(dialog).toBeVisible()
  await expect(page.frameLocator('iframe[title="匯出外觀"]').locator('h1')).toHaveText('中文匯出')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '匯出', exact: true })).toBeFocused()
})
