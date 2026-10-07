import { expect, test, type Download, type Page } from '@playwright/test'
import { strToU8, unzipSync, zipSync } from 'fflate'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
const document = '# Sharing\n\n![Keep](./assets/keep.png)\n\nAn editable document.'

async function openProject(page: Page) {
  await page.goto('/')
  await expect(page.locator('.cm-content')).toBeEditable()
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'Sharing.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({
      'Sharing.md': strToU8(document),
      'assets/keep.png': png,
      'assets/other.txt': strToU8('Unrelated private notes'),
    })),
  })
  await expect(page.locator('.markdown-body h1')).toHaveText('Sharing')
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
}

async function downloadedBytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('sharing includes only document assets, library export keeps others, and the shared ZIP reopens', async ({ page, browser }) => {
  await openProject(page)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const sharing = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  const sharedBytes = await downloadedBytes(await sharing)
  const shared = unzipSync(sharedBytes)
  expect(Object.keys(shared).sort()).toEqual(['Sharing.md', 'assets/keep.png', 'markword.json'])
  expect(Buffer.from(shared['Sharing.md']).toString()).toBe(document)
  expect(Buffer.from(shared['assets/keep.png'])).toEqual(png)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const library = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Document \+ asset library ZIP/ }).click()
  const all = unzipSync(await downloadedBytes(await library))
  expect(Buffer.from(all['assets/other.txt']).toString()).toBe('Unrelated private notes')

  const clean = await browser.newContext()
  try {
    const restored = await clean.newPage()
    await restored.goto(page.url())
    await expect(restored.locator('.cm-content')).toBeEditable()
    await restored.locator('input[type=file]').first().setInputFiles({ name: 'Sharing.zip', mimeType: 'application/zip', buffer: sharedBytes })
    await expect(restored.locator('.markdown-body h1')).toHaveText('Sharing')
    await expect(restored.locator('.markdown-body img')).toHaveClass(/is-resolved/)
    await expect.poll(() => restored.locator('.markdown-body img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1)
  } finally {
    await clean.close()
  }

  await page.getByRole('button', { name: 'Manage local assets', exact: true }).click()
  let warning = ''
  page.once('dialog', async (dialog) => { warning = dialog.message(); await dialog.dismiss() })
  await page.getByRole('button', { name: 'Delete keep.png', exact: true }).click()
  expect(warning).toBe('This asset is referenced by the document. Delete it anyway?')
  await expect(page.locator('.asset-item')).toHaveCount(2)
})

test('PDF and Word requests contain the selected local image and preserve the editor source', async ({ page }) => {
  const requests: Record<string, string>[] = []
  await page.route('**/api/export/*', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ body: 'Export response fixture', headers: { 'Content-Disposition': 'attachment; filename="exported-document"' } })
  })
  await openProject(page)
  for (const format of ['PDF', 'Word']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: new RegExp(`^${format} Supports PNG`) }).click()
    await download
  }
  expect(requests).toHaveLength(2)
  for (const request of requests) {
    expect(request.markdown).toContain(`data:image/png;base64,${png.toString('base64')}`)
    expect(request.markdown).not.toContain('other.txt')
    expect(request.markdown).toContain('# Sharing')
  }
  expect(requests[0].style).toBe('Classic')
  expect(requests[1].style).toBeUndefined()
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toBe(document)
})

test('missing assets prevent a download and explain how to recover', async ({ page }) => {
  let requests = 0
  let downloads = 0
  await page.route('**/api/export/*', async (route) => { requests++; await route.abort() })
  page.on('download', () => downloads++)
  await page.goto('/')
  const source = '# Missing\n\n![Lost](./assets/lost.png)'
  await page.locator('.cm-content').fill(source)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: /^PDF Supports PNG/ }).click()
  await expect(page.locator('.toast')).toContainText('Local asset is missing')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'Project ZIP Document and referenced local assets', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('Restore it before exporting')
  expect(requests).toBe(0)
  expect(downloads).toBe(0)
  expect((await page.locator('.cm-line').allTextContents()).join('\n')).toBe(source)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const rescue = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Document \+ asset library ZIP/ }).click()
  const rescued = unzipSync(await downloadedBytes(await rescue))
  expect(Buffer.from(rescued['Missing.md']).toString()).toBe(source)
  expect(JSON.parse(Buffer.from(rescued['markword.json']).toString()).missingAssets).toEqual(['assets/lost.png'])
  await expect(page.locator('.toast')).toHaveText('ZIP downloaded with 1 missing assets listed in the archive.')
})

test('IME commit keys do not open editor commands', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('')
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    await page.locator('.cm-content').evaluate((element, eventFlags) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true, ...eventFlags }))
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true, ...eventFlags }))
    }, flags)
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
  }
  await page.keyboard.type('/')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
})
