import { expect, test } from './shared-workspace-fixture'

for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
  const composition = 'isComposing' in flags ? 'composition flag' : 'legacy IME key'
  test(`command palette preserves input during ${composition}`, async ({ page }) => {
    await page.goto('/')
    await page.locator('.cm-content').fill('# Keep this document')
    await page.getByRole('button', { name: 'Command palette', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Search commands', exact: true })
    await input.fill('New document')
    for (const key of ['Enter', 'Escape']) {
      await input.dispatchEvent('keydown', { key, ...flags })
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('New document')
      await expect(page.locator('.cm-content')).toContainText('Keep this document')
    }
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveText('')
  })

  test(`document renaming preserves input during ${composition}`, async ({ page }) => {
    await page.goto('/')
    await page.locator('.cm-content').fill('# Rename target')
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    const panel = page.getByRole('complementary', { name: 'Documents', exact: true })
    if (!await panel.isVisible()) await page.locator('.activity-rail').getByRole('button', { name: 'Documents', exact: true }).click()
    const row = panel.locator('.document-list > li').filter({ hasText: 'Rename target' })
    await row.locator('summary').click()
    await row.getByRole('button', { name: 'Rename', exact: true }).click()
    const input = panel.getByRole('textbox', { name: 'Document name', exact: true })
    await input.fill('中文文件')
    for (const key of ['Escape', 'Enter']) {
      const prevented = await input.evaluate((element, eventFlags) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...eventFlags })
        element.dispatchEvent(event)
        return event.defaultPrevented
      }, { key, ...flags })
      expect(prevented).toBe(true)
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('中文文件')
    }
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(panel.locator('.document-list__open')).toContainText('中文文件')
  })
}
