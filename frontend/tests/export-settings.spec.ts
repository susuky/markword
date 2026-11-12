import { expect, test } from './shared-workspace-fixture'
import { type Download, type Page } from '@playwright/test'

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

test('mobile settings in Traditional Chinese fit, keep workspace inert and return to the export trigger', async ({ page }) => {
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
  const close = dialog.getByRole('button', { name: '關閉', exact: true })
  const trigger = page.getByRole('button', { name: '匯出', exact: true })
  await expect(close).toBeFocused()
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true)
  await trigger.focus()
  await expect(close).toBeFocused()

  const focusOrder = [
    page.getByLabel('紙張尺寸', { exact: true }),
    page.getByLabel('頁面邊界（mm）', { exact: true }),
    page.getByLabel('內文字級（px）', { exact: true }),
    page.getByLabel('成品版型', { exact: true }),
    dialog.getByRole('button', { name: '重設匯出設定', exact: true }),
    dialog.getByRole('button', { name: '完成', exact: true }),
  ]
  for (const [key, targets] of [
    ['Tab', [...focusOrder, close]],
    ['Shift+Tab', [...focusOrder].reverse().concat(close)],
  ] as const) {
    for (const target of targets) {
      await page.keyboard.press(key)
      // Native modal dialogs allow browser chrome; background page controls stay inert.
      if (!(await page.evaluate(() => document.hasFocus()))) {
        expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
        await page.keyboard.press(key)
      }
      expect(await dialog.evaluate((element) => document.hasFocus() && element.contains(document.activeElement))).toBe(true)
      await expect(target).toBeFocused()
    }
  }
  await page.frameLocator('iframe[title="匯出外觀"]').locator('h1').click()
  await expect(dialog.locator('iframe')).toBeFocused()
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('export preview retains selection and scrolling while sandboxing scripts and navigation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://export-preview.invalid/navigated', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<h1>Navigated preview</h1>',
  }))
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  const payload = '<script>parent.document.documentElement.dataset.exportScript = "source"</script><iframe srcdoc="<script>alert(1)</script>"></iframe>'
  await page.locator('.cm-content').fill('# Sandbox preview\n\n[Frame navigation](https://export-preview.invalid/navigated)\n\n' + payload + '\n\n' + 'A paragraph for scrolling.\n\n'.repeat(50))
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Export settings and preview' })
  const frameElement = dialog.locator('iframe')
  const preview = page.frameLocator('iframe[title="Export appearance"]')
  await expect(preview.locator('h1')).toHaveText('Sandbox preview')
  await expect(preview.locator('iframe, object, embed, script:not([type="application/json"])')).toHaveCount(0)
  await expect(preview.locator('#markword-source')).toHaveAttribute('type', 'application/json')
  expect(await page.locator('html').getAttribute('data-export-script')).toBeNull()

  const blockedScript = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'error' && message.text().includes('Blocked script execution'),
  })
  await preview.locator('body').evaluate((body) => {
    const script = body.ownerDocument.createElement('script')
    script.textContent = 'parent.document.documentElement.dataset.exportScript = "executed"'
    body.append(script)
  })
  await blockedScript
  expect(await page.locator('html').getAttribute('data-export-script')).toBeNull()

  await preview.locator('h1').dblclick()
  expect(await preview.locator('body').evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0)
  await page.mouse.wheel(0, 500)
  await expect.poll(() => preview.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await preview.locator('h1').click()
  await preview.locator('body').dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(dialog).toBeVisible()
  await preview.locator('body').dispatchEvent('keydown', { key: 'Escape', keyCode: 229 })
  await expect(dialog).toBeVisible()

  await preview.getByRole('link', { name: 'Frame navigation', exact: true }).click()
  await expect(preview.locator('h1')).toHaveText('Navigated preview')
  expect(await frameElement.evaluate((frame) => (frame as HTMLIFrameElement).contentDocument)).toBeNull()
  expect(errors).toEqual([])
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused()
})
