import { type Page } from '@playwright/test'
import { expect, test } from './shared-workspace-fixture'

const originalImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" fill="#cce3da"/></svg>')}`
const replacementImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
const pageStyle = 'body{margin:16px;color:rgb(24,72,56);font:16px/1.5 sans-serif}main{max-width:960px;margin:auto}section{padding:12px;margin:0 0 16px;background:#f0f6f3}h2{margin:0 0 12px}figure{margin:0;padding:8px}figure img{display:block;width:180px;max-width:100%;height:100px;object-fit:cover}figcaption{padding:4px}table{border-collapse:collapse}th,td{padding:4px 12px;border:1px solid #abc7ba}'
const pageScript = "window.layoutScriptRan = true; parent.document.body.dataset.layoutEscaped = 'yes'"
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Layout report</title><style>${pageStyle}</style></head><body>
<main><section id="intro" aria-labelledby="intro-heading"><h2 id="intro-heading">Opening section</h2>
<figure id="feature"><img id="feature-image" src="${originalImage}" alt="Original illustration" aria-describedby="feature-caption"><figcaption id="feature-caption">Keep the <strong>important detail</strong> with its picture.</figcaption></figure>
<p><a href="#feature-caption">Read the caption</a></p></section>
<section id="details" aria-labelledby="details-heading"><h2 id="details-heading">Details section</h2><table><thead><tr><th>Item</th><th>Status</th></tr></thead><tbody><tr><td>Layout review</td><td>Ready</td></tr></tbody></table></section></main>
<script>${pageScript}</script></body></html>`

const preview = (page: Page) => page.frameLocator('iframe[title="HTML page preview"]')
const settings = (page: Page) => page.getByRole('complementary', { name: 'Block settings', exact: true })
const sectionOrder = (page: Page) => preview(page).locator('main > section').evaluateAll(sections => sections.map(section => section.id))

async function openHtml(page: Page, content = html, name = 'Layout report.html') {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/html', buffer: Buffer.from(content) })
  await expect(page.locator('.document-heading')).toContainText(name.replace(/\.html?$/i, ''))
  await expect(preview(page).locator('#intro-heading')).toHaveText('Opening section')
}

async function selectBlock(page: Page, selector: string) {
  await preview(page).locator(selector).click({ position: { x: 3, y: 3 } })
  await expect(settings(page)).toBeVisible()
}

async function downloaded(page: Page) {
  await page.getByRole('button', { name: 'Command palette', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search commands', exact: true }).fill('Download source')
  const pending = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), content: Buffer.concat(chunks).toString() }
}

async function assertOriginalContent(page: Page) {
  await expect(preview(page).locator('#feature strong')).toHaveText('important detail')
  await expect(preview(page).locator('#details td')).toHaveText(['Layout review', 'Ready'])
  await expect(preview(page).locator('body')).toHaveCSS('color', 'rgb(24, 72, 56)')
  await expect(preview(page).locator('script')).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('data-layout-escaped')
}

test('whole sections move with their contents and share undo and redo history', async ({ page }) => {
  await page.goto('/')
  await openHtml(page)
  await expect(page.locator('.pane--editor')).toBeHidden()
  await selectBlock(page, '#intro')
  await settings(page).getByRole('button', { name: 'Move block down', exact: true }).click()
  await expect.poll(() => sectionOrder(page)).toEqual(['details', 'intro'])
  await assertOriginalContent(page)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => sectionOrder(page)).toEqual(['intro', 'details'])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => sectionOrder(page)).toEqual(['details', 'intro'])
  await selectBlock(page, '#intro')
  await settings(page).getByRole('button', { name: 'Move block up', exact: true }).click()
  await expect.poll(() => sectionOrder(page)).toEqual(['intro', 'details'])
  await assertOriginalContent(page)
})

test('picture layout, spacing and replacement survive download, reopening and reload', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await openHtml(page)
  await selectBlock(page, '#feature')
  const layout = settings(page).getByLabel('Layout', { exact: true })
  await layout.selectOption('image-left')
  const positions = () => preview(page).locator('#feature').evaluate(figure => {
    const image = figure.querySelector('img')!.getBoundingClientRect()
    const caption = figure.querySelector('figcaption')!.getBoundingClientRect()
    return { imageX: image.x, captionX: caption.x, imageY: image.y, captionY: caption.y }
  })
  await expect.poll(async () => { const box = await positions(); return box.imageX < box.captionX && Math.abs(box.imageY - box.captionY) < 10 }).toBe(true)
  await layout.selectOption('image-right')
  await expect.poll(async () => { const box = await positions(); return box.imageX > box.captionX && Math.abs(box.imageY - box.captionY) < 10 }).toBe(true)
  const spacing = settings(page).getByLabel('Spacing (px)', { exact: true })
  await spacing.fill('28')
  await spacing.blur()
  await expect(preview(page).locator('#feature')).toHaveCSS('gap', '28px')
  const imageChooser = page.waitForEvent('filechooser')
  await settings(page).getByRole('button', { name: 'Replace image', exact: true }).click()
  await (await imageChooser).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: replacementImage })
  await expect.poll(() => preview(page).locator('#feature img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await settings(page).getByLabel('Image description', { exact: true }).fill('Replacement illustration')
  await settings(page).getByLabel('Image description', { exact: true }).blur()
  await expect(preview(page).locator('#feature img')).toHaveAttribute('alt', 'Replacement illustration')
  await expect.poll(() => preview(page).locator('#feature img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('html-layout-desktop.png') })

  const result = await downloaded(page)
  expect(result.name).toBe('Layout report.html')
  expect(result.content).toContain(`<style>${pageStyle}</style>`)
  expect(result.content).toContain(`<script>${pageScript}</script>`)
  expect(result.content).not.toMatch(/data-markword-edit-|contenteditable|Content-Security-Policy/)
  await openHtml(page, result.content, 'Reopened layout.html')
  await expect(preview(page).locator('#feature')).toHaveCSS('gap', '28px')
  await expect(preview(page).locator('#feature img')).toHaveAttribute('alt', 'Replacement illustration')
  await expect.poll(async () => { const box = await positions(); return box.imageX > box.captionX }).toBe(true)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expect(preview(page).locator('#feature')).toHaveCSS('gap', '28px')
  await expect(preview(page).locator('#feature img')).toHaveAttribute('alt', 'Replacement illustration')
  await expect.poll(() => preview(page).locator('#feature img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await assertOriginalContent(page)
  expect((await downloaded(page)).content).toBe(result.content)
  expect(errors).toEqual([])
})

test('duplicating a section preserves local links with unique IDs and deletion can be undone', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await openHtml(page, html.replace('</head>', '<style>#intro{background:rgb(1,2,3);padding:23px}#intro #intro-heading{color:rgb(7,8,9)}@media(min-width:900px){#intro{border:5px solid blue}}</style></head>'))
  await selectBlock(page, '#intro')
  await settings(page).getByRole('button', { name: 'Duplicate block', exact: true }).click()
  await expect(preview(page).locator('main > section')).toHaveCount(3)
  const sectionStyle = { background: 'rgb(1, 2, 3)', padding: '23px', borderWidth: '5px', borderColor: 'rgb(0, 0, 255)', headingColor: 'rgb(7, 8, 9)' }
  await expect.poll(() => preview(page).locator('main > section').evaluateAll(sections => sections.slice(0, 2).map(section => {
    const style = getComputedStyle(section)
    return {
      background: style.backgroundColor, padding: style.padding,
      borderWidth: style.borderTopWidth, borderColor: style.borderTopColor,
      headingColor: getComputedStyle(section.querySelector('h2')!).color,
    }
  }))).toEqual([sectionStyle, sectionStyle])
  const checkReferences = () => preview(page).locator('main').evaluate(main => {
    const ids = Array.from(main.querySelectorAll('[id]'), element => element.id)
    const copies = Array.from(main.querySelectorAll(':scope > section')).filter(section => section.querySelector('figure'))
    return {
      unique: new Set(ids).size === ids.length,
      count: copies.length,
      referencesStayInsideSection: copies.every(section => {
        const heading = section.querySelector('h2')!
        const caption = section.querySelector('figcaption')!
        return section.getAttribute('aria-labelledby') === heading.id
          && section.querySelector('img')!.getAttribute('aria-describedby') === caption.id
          && section.querySelector('a')!.getAttribute('href') === `#${caption.id}`
      }),
    }
  })
  await expect.poll(checkReferences).toEqual({ unique: true, count: 2, referencesStayInsideSection: true })
  await settings(page).getByRole('button', { name: 'Delete block', exact: true }).click()
  await expect.poll(() => sectionOrder(page)).toEqual(['intro', 'details'])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(checkReferences).toEqual({ unique: true, count: 2, referencesStayInsideSection: true })
  await expect(preview(page).locator('#intro #feature-caption strong')).toHaveText('important detail')
})

test('preview preserves title IDs, their CSS and anchors while blocking scripts and image handlers', async ({ page }) => {
  const source = html.replaceAll('intro-heading', 'title')
    .replace('</head>', '<style>#title{color:rgb(7,8,9)}</style></head>')
    .replace('href="#feature-caption"', 'href="#title"')
    .replace(`src="${originalImage}"`, 'src="data:image/png;base64,bm90IGFuIGltYWdl" onerror="parent.document.body.dataset.layoutEscaped=\'image\'"')
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Styled title.html', mimeType: 'text/html', buffer: Buffer.from(source) })
  await expect(preview(page).locator('#title')).toHaveText('Opening section')
  await expect(preview(page).locator('#title')).toHaveCSS('color', 'rgb(7, 8, 9)')
  await expect(preview(page).getByRole('link', { name: 'Read the caption' })).toHaveAttribute('href', '#title')
  await preview(page).getByRole('link', { name: 'Read the caption' }).click()
  await expect(page.getByLabel('Link address', { exact: true })).toHaveValue('#title')
  await expect.poll(() => preview(page).locator('#feature img').evaluate(image => (image as HTMLImageElement).complete)).toBe(true)
  await expect(preview(page).locator('script, [onerror]')).toHaveCount(0)
  expect(await preview(page).locator('body').evaluate(body => Reflect.get(body.ownerDocument.defaultView!, 'layoutScriptRan'))).toBeUndefined()
  await expect(page.locator('body')).not.toHaveAttribute('data-layout-escaped')
  expect((await downloaded(page)).content).toBe(source)
})

test('outline dragging reorders siblings and refuses a move into a different parent', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await openHtml(page)
  const outline = page.getByRole('complementary', { name: 'Page structure', exact: true })
  if (!await outline.isVisible()) await page.getByRole('button', { name: 'Page structure', exact: true }).click()
  const rowFor = async (selector: string) => {
    await selectBlock(page, selector)
    const id = await outline.getByRole('button', { pressed: true }).getAttribute('data-html-block-id')
    expect(id).toBeTruthy()
    return outline.locator(`button[data-html-block-id="${id}"]`)
  }
  const intro = await rowFor('#intro')
  const details = await rowFor('#details')
  const target = (await details.boundingBox())!
  await intro.dragTo(details, { targetPosition: { x: 20, y: target.height - 2 } })
  await expect.poll(() => sectionOrder(page)).toEqual(['details', 'intro'])
  const before = (await downloaded(page)).content
  const figure = await rowFor('#feature')
  const otherSection = await rowFor('#details')
  await figure.dragTo(otherSection, { targetPosition: { x: 20, y: 2 } })
  expect((await downloaded(page)).content).toBe(before)
  await expect(preview(page).locator('#intro > #feature')).toHaveCount(1)
  await assertOriginalContent(page)
})

test('layout controls remain usable on a narrow screen and picture columns stack', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await openHtml(page)
  await selectBlock(page, '#feature')
  await settings(page).getByLabel('Layout', { exact: true }).selectOption('image-left')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('tab', { name: 'Preview', exact: true }).click()
  await selectBlock(page, '#feature')
  await settings(page).getByLabel('Spacing (px)', { exact: true }).fill('20')
  await settings(page).getByLabel('Spacing (px)', { exact: true }).blur()
  await expect(preview(page).locator('#feature')).toHaveCSS('gap', '20px')
  await expect.poll(() => preview(page).locator('#feature').evaluate(figure => {
    const image = figure.querySelector('img')!.getBoundingClientRect()
    const caption = figure.querySelector('figcaption')!.getBoundingClientRect()
    return caption.top >= image.bottom && Math.abs(caption.left - image.left) < 2
  })).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await preview(page).locator('html').evaluate(root => root.scrollWidth <= root.clientWidth)).toBe(true)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('html-layout-mobile.png') })
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('important detail')
})
