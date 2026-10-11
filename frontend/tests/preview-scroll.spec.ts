import { expect, test, type Page } from '@playwright/test'

const intro = '歡迎使用 **文字工具箱**，這是一個專為 Markdown 寫作而生的線上工具。它能即時預覽、統計字數，並支援程式碼、清單與圖表。'
const source = '\n\n\n![圖示](./assets/diagram.svg)\n\n# 文字工具箱使用指南\n\n\n\n' + intro
  + '\n'.repeat(8) + '## 主要功能\n\n- 即時預覽 Markdown 內容\n- 字數與行數統計\n\n'
  + Array.from({ length: 20 }, (_, index) => `## 其他段落 ${index + 1}\n\n內容 ${index + 1}。`).join('\n\n')
  + '\n\nUntouched  **spacing**.\n\n[ref]: https://example.com\n'
const active = (page: Page) => page.locator('.markdown-body [contenteditable]:focus')

async function expectStableCaret(page: Page, top: number) {
  // Observe successive frames so a delayed layout/scroll callback cannot pass early.
  const samples = await page.evaluate(() => new Promise<{ top: number; visible: boolean }[]>(resolve => {
    const readings: { top: number; visible: boolean }[] = []
    const sample = () => {
      const scroll = document.querySelector<HTMLElement>('.preview-scroll')!
      const field = document.activeElement as HTMLElement
      const viewport = scroll.getBoundingClientRect(), caret = field.getBoundingClientRect()
      readings.push({ top: scroll.scrollTop, visible: field.isContentEditable && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1 })
      if (readings.length < 15) requestAnimationFrame(sample)
      else resolve(readings)
    }
    requestAnimationFrame(sample)
  }))
  for (const sample of samples) {
    expect(Math.abs(sample.top - top)).toBeLessThan(2)
    expect(sample.visible).toBe(true)
  }
}

for (const mode of ['split', 'unsynchronized', 'single', 'mobile', 'bottom', 'typewriter', 'table'] as const) {
  test(`${mode}: Enter and blank-line keys keep the preview caret stable below a local image`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize(mode === 'mobile' ? { width: 375, height: 812 } : { width: 1600, height: 1000 })
    await page.goto('/')
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: 'diagram.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#dcebe6"/></svg>'),
    })
    await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
    const original = mode === 'table' ? source.replace('![圖示]', '| A | B |\n| --- | --- |\n| One | Two |\n\n![圖示]') : source
    await page.locator('.cm-content').fill(original)
    await expect.poll(() => page.locator('.markdown-body img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(900)
    if (mode === 'single') await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
    if (mode === 'mobile') await page.getByRole('tab', { name: 'Preview', exact: true }).click()
    if (mode === 'unsynchronized') await page.getByRole('button', { name: 'Toggle synchronized scrolling', exact: true }).click()
    if (mode === 'typewriter') await page.getByRole('button', { name: 'Typewriter mode', exact: true }).click()
    await page.waitForTimeout(200)
    await page.locator('.preview-scroll').evaluate((scroll, bottom) => {
      const paragraph = Array.from(document.querySelectorAll<HTMLElement>('.markdown-body > p')).find(element => element.textContent?.startsWith('歡迎使用'))!
      const offset = bottom ? scroll.clientHeight - paragraph.getBoundingClientRect().height - 2 : Math.min(200, scroll.clientHeight / 3)
      scroll.scrollTop += paragraph.getBoundingClientRect().top - scroll.getBoundingClientRect().top - offset
    }, mode === 'bottom')
    await page.waitForTimeout(200)
    const paragraph = page.locator('.markdown-body > p').filter({ hasText: '歡迎使用' })
    await paragraph.locator('[contenteditable]').last().evaluate(field => {
      (field as HTMLElement).focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNodeContents(field); range.collapse(false)
      const selection = window.getSelection()!
      selection.removeAllRanges(); selection.addRange(range)
    })
    let top = await page.locator('.preview-scroll').evaluate(scroll => scroll.scrollTop)
    for (const key of ['Enter', 'Enter', 'Backspace', 'Enter', 'Backspace']) {
      await page.keyboard.press(key)
      await expect(active(page)).toHaveText('')
      if (mode === 'bottom') {
        const next = await page.locator('.preview-scroll').evaluate(scroll => scroll.scrollTop)
        expect(next - top).toBeGreaterThanOrEqual(0)
        expect(next - top).toBeLessThan(100)
        top = next
      }
      await expectStableCaret(page, top)
    }
    await active(page).fill('新增段落。')
    await expectStableCaret(page, top)
    await expect(paragraph).toHaveText(intro.replaceAll('**', ''))
    await expect(page.locator('.markdown-body h2').first()).toHaveText('主要功能')
    await expect.poll(() => page.locator('.markdown-body img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(900)
    expect(errors).toEqual([])
    if (mode === 'single' || mode === 'mobile') await expect(page.locator('.pane--editor')).toBeHidden()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Markdown Keep the editable source', exact: true }).click()
    const chunks: Buffer[] = []
    for await (const chunk of (await (await download).createReadStream())!) chunks.push(Buffer.from(chunk))
    const saved = Buffer.concat(chunks).toString()
    expect(saved.startsWith(original.slice(0, original.indexOf(intro)) + intro)).toBe(true)
    expect(saved).toContain('新增段落。')
    expect(saved.endsWith(original.slice(original.indexOf('## 主要功能')))).toBe(true)
  })
}
