import { expect, test } from './shared-workspace-fixture'

test('HTML and SVG asset links download without becoming same-origin pages; images still render', async ({ page, context }) => {
  await page.goto('/')
  const assets = await page.evaluate(async () => {
    const module = '/src/assets.ts'
    const { importLocalAssets } = await import(/* @vite-ignore */ module)
    return (await importLocalAssets([
      new File(['<!doctype html><body><script>localStorage.setItem("attachment-executed","yes")</script></body>'], 'proof.html', { type: 'text/html' }),
      new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>localStorage.setItem("attachment-executed","yes")</script><rect width="32" height="32" fill="green"/></svg>'], 'proof.svg', { type: 'image/svg+xml' }),
    ])).map((asset: { id: string; path: string; name: string }) => ({ id: asset.id, path: asset.path, name: asset.name }))
  })
  await page.locator('.editor-host .cm-content').fill([
    '[HTML attachment](' + assets[0].path + ')',
    '[SVG attachment](' + assets[1].path + ')',
    '![Picture](' + assets[1].path + ')',
  ].join('\n\n'))
  const image = page.locator('.markdown-body img[alt="Picture"]')
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(32)
  expect(await image.evaluate(async (element: HTMLImageElement) => (await fetch(element.src)).headers.get('content-type'))).toBe('image/svg+xml')
  for (const [index, label] of ['HTML attachment', 'SVG attachment'].entries()) {
    const link = page.locator('.markdown-body').getByRole('link', { name: label, exact: true })
    await expect(link).toHaveAttribute('download', assets[index].name)
    await expect(link).toHaveAttribute('href', /^blob:/)
    const href = await link.getAttribute('href')
    expect(await link.evaluate(async (element: HTMLAnchorElement) => (await fetch(element.href)).headers.get('content-type'))).toBe('application/octet-stream')
    for (const url of [href!, '/api/workspace/assets/' + encodeURIComponent(assets[index].id)]) {
      const opened = await context.newPage()
      const download = opened.waitForEvent('download')
      await opened.goto(url).catch(() => undefined)
      expect(await (await download).failure()).toBeNull()
      await opened.close()
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('attachment-executed'))).toBeNull()
})
