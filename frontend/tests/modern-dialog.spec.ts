import { expect, test } from './shared-workspace-fixture'

test('native dialog keeps the workspace inert and restores the invoker on dismissal', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Command palette', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true })
  const search = page.getByRole('textbox', { name: 'Search commands', exact: true })
  await expect(search).toBeFocused()
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true)
  await trigger.focus()
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.getByRole('button', { name: 'Close command palette', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('backdrop dismissal requires both press and release outside the dialog content', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Command palette', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true })
  const input = page.getByRole('textbox', { name: 'Search commands', exact: true })
  const bounds = (await input.boundingBox())!
  const inside = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }

  await page.mouse.move(5, 5)
  await page.mouse.down()
  await expect(dialog).toBeVisible()
  await page.mouse.move(inside.x, inside.y)
  await page.mouse.up()
  await expect(dialog).toBeVisible()

  await page.mouse.move(inside.x, inside.y)
  await page.mouse.down()
  await page.mouse.move(5, 5)
  await page.mouse.up()
  await expect(dialog).toBeVisible()

  await page.mouse.click(5, 5)
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('table edits stay open when the backdrop is clicked', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert or edit table', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert table', exact: true })
  await expect(dialog).toBeVisible()
  const cell = dialog.locator('textarea').first()
  await cell.fill('Keep this draft')
  await page.mouse.click(5, 5)
  await expect(dialog).toBeVisible()
  await expect(cell).toHaveValue('Keep this draft')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Escape keeps a pending update dialog open so a save failure remains visible', async ({ page }) => {
  let blockWrites = false
  let releaseWrite!: () => void
  const pendingWrite = new Promise<void>((resolve) => { releaseWrite = resolve })
  await page.route('**/api/workspace/drafts/**', async (route) => {
    if (blockWrites && route.request().method() === 'POST') {
      await pendingWrite
      await route.fulfill({ status: 507, json: { detail: 'Workspace storage is full' } })
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  blockWrites = true
  await page.locator('.cm-content').fill('# Keep this pending update')
  await page.evaluate(() => window.dispatchEvent(new Event('markword:update-available')))
  const dialog = page.getByRole('dialog', { name: 'Update available', exact: true })
  await dialog.getByRole('button', { name: 'Save and update', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  try {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible({ timeout: 500 })
  } finally {
    releaseWrite()
  }
  await expect(dialog.getByRole('alert')).toContainText('could not be saved')
  await expect(page.locator('.cm-content')).toHaveText('# Keep this pending update')
  await dialog.getByRole('button', { name: 'Later', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
