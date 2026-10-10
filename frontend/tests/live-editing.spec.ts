import { expect, test } from '@playwright/test'

test('single-page editing shares preview, undo and persisted source visibility', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('# Same document\n\nA **bold** word.\n\n## Details\n\nKeep this.')
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
  await expect(page.locator('.pane--editor')).toBeHidden()
  await expect(page.locator('.pane--preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Live editing', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview editing tools', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hide source', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const heading = page.locator('.markdown-body h1 [contenteditable]')
  await heading.fill('Changed in one page')
  await heading.press('Control+z')
  await expect(heading).toHaveText('Same document')
  await heading.fill('Changed again')
  await page.getByRole('button', { name: 'Split editing', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('# Changed again')
  await page.getByRole('button', { name: 'Single-page editing', exact: true }).click()
  await page.locator('.outline-panel nav button').last().click()
  await expect(page.locator('.pane--editor')).toBeHidden()
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.reload()
  await expect(page.locator('.pane--editor')).toBeHidden()
  await expect(heading).toHaveText('Changed again')
  await heading.press('Control+f')
  await expect(page.locator('.pane--editor')).toBeVisible()
  await expect(page.locator('.cm-search input[name=search]')).toBeFocused()
})

test('the previous single-pane preference migrates to the shared editable preview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('markword.preference.live-editing', 'true'))
  await page.goto('/')
  await expect(page.locator('.pane--editor')).toBeHidden()
  await expect(page.locator('.markdown-body h1 [contenteditable]')).toBeVisible()
  await page.getByRole('button', { name: 'Split editing', exact: true }).click()
  await page.reload()
  await expect(page.locator('.pane--editor')).toBeVisible()
})

test('toolbar collapse reclaims equal space in both panes and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  const before = (await page.locator('.preview-scroll').boundingBox())!
  await page.getByRole('button', { name: 'Hide toolbar', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Workspace tools' })).toBeHidden()
  const left = (await page.locator('.editor-host').boundingBox())!
  const right = (await page.locator('.preview-scroll').boundingBox())!
  expect(right.y).toBe(before.y - 56)
  expect(right.height).toBe(before.height + 56)
  expect(left.y).toBe(right.y)
  expect(left.height).toBe(right.height)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show toolbar', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Show toolbar', exact: true }).click()
  await expect(page.locator('.preview-scroll')).toHaveJSProperty('clientHeight', before.height)
})

test('mobile toolbar and preview menus stay reachable when collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Hide toolbar', exact: true }).click()
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await page.locator('.markdown-body h1 [contenteditable]').fill('Edited on mobile')
  await page.getByRole('button', { name: 'Preview editing tools', exact: true }).click()
  const menu = (await page.locator('.markdown-edit-menu').boundingBox())!
  const header = (await page.locator('.preview-header').boundingBox())!
  expect(menu.y).toBeGreaterThanOrEqual(header.y + header.height)
  expect(menu.x).toBeGreaterThanOrEqual(0)
  expect(menu.x + menu.width).toBeLessThanOrEqual(375)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Show toolbar', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Workspace tools' })).toBeVisible()
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('Edited on mobile')
  for (const width of [320, 375, 812]) {
    await page.setViewportSize({ width, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
