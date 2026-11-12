import { type FrameLocator, type Page } from '@playwright/test'
import { expect, test } from './shared-workspace-fixture'

const reportName = 'Regional report.html'
const reportData = { regions: [{ name: 'North', count: 2 }, { name: 'South', count: 3 }] }
const reportScript = `
function renderReport() {
  const data = JSON.parse(document.getElementById('report-data').textContent);
  const total = data.regions.reduce((sum, region) => sum + region.count, 0);
  document.getElementById('total').textContent = String(total);
  document.getElementById('bars').replaceChildren(...data.regions.map((region, index) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = document.createElement('span');
    label.textContent = region.name;
    const track = document.createElement('div');
    track.className = 'bar-track';
    const bar = document.createElement('div');
    bar.id = 'bar-' + index;
    bar.className = 'bar';
    bar.style.width = (region.count / total * 100) + '%';
    bar.textContent = String(region.count);
    track.append(bar);
    row.append(label, track);
    return row;
  }));
  document.getElementById('rows').replaceChildren(...data.regions.map(region => {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = region.name;
    const count = document.createElement('td');
    count.textContent = String(region.count);
    row.append(name, count);
    return row;
  }));
}
document.getElementById('redraw').addEventListener('click', renderReport);
document.getElementById('read-note').addEventListener('click', () => {
  document.getElementById('note-result').textContent = document.getElementById('notes').value;
});
renderReport();`
const report = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Regional report</title>
<style>body{margin:24px;font:16px/1.5 sans-serif;color:#16392d}main{max-width:700px;margin:auto}section{margin:24px 0;padding:16px;background:#eef5f2}h1,h2{margin-top:0}.bar-row{display:grid;grid-template-columns:80px 1fr;gap:12px;margin:10px 0}.bar-track{background:#d8e7df}.bar{box-sizing:border-box;background:#24845c;color:white;padding:4px;min-height:28px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #b5cbbf;text-align:left}textarea{display:block;box-sizing:border-box;width:100%;min-height:90px}button{margin:12px 8px 0 0}output{white-space:pre-wrap}</style></head><body><main>
<h1>Regional report</h1><section id="summary"><h2>Case totals</h2><p>Total: <strong id="total"></strong></p><div id="bars"></div><button id="redraw" type="button">Redraw report</button></section>
<section id="details"><h2>Regional breakdown</h2><table><thead><tr><th>Region</th><th>Cases</th></tr></thead><tbody id="rows"></tbody></table></section>
<section id="annotations"><h2>Report notes</h2><label for="notes">Readonly notes</label><textarea id="notes" readonly>Original note\nSecond line</textarea><button id="read-note" type="button">Read note</button><output id="note-result" aria-live="polite"></output></section>
<script type="application/json" id="report-data">${JSON.stringify(reportData)}</script><script>${reportScript}</script>
</main></body></html>`

const preview = (page: Page) => page.frameLocator('iframe[title="HTML page preview"]')
const interactivePreview = (page: Page) => page.frameLocator('iframe[title="Interactive HTML preview"]')
  .frameLocator('iframe[title="HTML runtime document"]')

async function openReport(page: Page, content = report, name = reportName) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'text/html', buffer: Buffer.from(content) })
  await expect(page.locator('.document-heading')).toContainText(name.replace(/\.html?$/i, ''))
  await expect(preview(page).locator('h1')).toHaveText('Regional report')
}

async function expectReport(frame: FrameLocator, north = 2, south = 3) {
  await expect(frame.locator('#total')).toHaveText(String(north + south))
  await expect(frame.locator('#rows tr')).toHaveCount(2)
  await expect(frame.locator('#rows td')).toHaveText(['North', String(north), 'South', String(south)])
  await expect(frame.locator('#bars .bar')).toHaveText([String(north), String(south)])
  const ratios = await frame.locator('.bar-track').evaluateAll(tracks => tracks.map(track => (
    track.firstElementChild!.getBoundingClientRect().width / track.getBoundingClientRect().width
  )))
  expect(ratios[0]).toBeCloseTo(north / (north + south), 2)
  expect(ratios[1]).toBeCloseTo(south / (north + south), 2)
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

async function updateCount(page: Page, count: number) {
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  const dataPanel = page.getByRole('complementary', { name: 'Page data', exact: true })
  await expect(dataPanel).toBeVisible()
  const field = dataPanel.getByLabel('report-data · regions[0].count', { exact: true })
  await field.fill(String(count))
  await field.blur()
  await expectReport(preview(page), count)
}

async function openSavedReport(page: Page, name: string) {
  const documents = page.getByRole('complementary', { name: 'Documents', exact: true })
  if (!await documents.isVisible()) {
    await page.locator('.activity-rail').getByRole('button', { name: 'Documents', exact: true }).click()
  }
  await documents.locator('.document-list__open').filter({ has: page.getByText(name, { exact: true }) }).click()
}

test('inline scripts render chart, totals and table in the editable page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page).toHaveTitle('Markword')
  await openReport(page)
  await expectReport(preview(page))
  await expect(preview(page).getByLabel('Readonly notes')).toHaveValue('Original note\nSecond line')
  await page.screenshot({ path: testInfo.outputPath('html-dynamic-rendered.png') })
})

test('editing embedded data recomputes the chart, total and table through redraw, download and reopening', async ({ page }) => {
  await page.goto('/')
  await openReport(page)
  await updateCount(page, 6)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  await expectReport(interactivePreview(page), 6)
  await interactivePreview(page).getByRole('button', { name: 'Redraw report', exact: true }).click()
  await expectReport(interactivePreview(page), 6)

  const result = await downloaded(page)
  expect(result.name).toBe(reportName)
  const embedded = await page.evaluate(content => {
    const document = new DOMParser().parseFromString(content, 'text/html')
    return JSON.parse(document.getElementById('report-data')!.textContent!)
  }, result.content)
  expect(embedded).toEqual({ regions: [{ name: 'North', count: 6 }, { name: 'South', count: 3 }] })
  expect(result.content).toContain(reportScript)
  expect(result.content).not.toMatch(/data-markword-edit-|contenteditable|Content-Security-Policy/)

  await openReport(page, result.content, 'Reopened regional report.html')
  await expectReport(preview(page), 6)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.reload()
  await expectReport(preview(page), 6)
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  await interactivePreview(page).getByRole('button', { name: 'Redraw report', exact: true }).click()
  await expectReport(interactivePreview(page), 6)
})

test('readonly textarea accepts multiline edits and interactive controls read the saved value', async ({ page }) => {
  const note = 'Reviewed North: 6 cases\nReviewed South: 3 cases\nReady for publication.'
  await page.goto('/')
  await openReport(page)
  await expectReport(preview(page))
  await preview(page).getByLabel('Readonly notes').fill(note)
  await preview(page).getByLabel('Readonly notes').blur()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  await expect(interactivePreview(page).getByLabel('Readonly notes')).toHaveValue(note)
  await interactivePreview(page).getByRole('button', { name: 'Read note', exact: true }).click()
  await expect(interactivePreview(page).locator('#note-result')).toHaveText(note)
  await interactivePreview(page).getByRole('button', { name: 'Redraw report', exact: true }).click()
  await expect(interactivePreview(page).getByLabel('Readonly notes')).toHaveValue(note)

  const result = await downloaded(page)
  const saved = await page.evaluate(content => {
    const document = new DOMParser().parseFromString(content, 'text/html')
    const textarea = document.getElementById('notes') as HTMLTextAreaElement
    return { value: textarea.value, readonly: textarea.readOnly }
  }, result.content)
  expect(saved).toEqual({ value: note, readonly: true })
  await openReport(page, result.content, 'Saved notes.html')
  await expect(preview(page).getByLabel('Readonly notes')).toHaveValue(note)
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  await interactivePreview(page).getByRole('button', { name: 'Read note', exact: true }).click()
  await expect(interactivePreview(page).locator('#note-result')).toHaveText(note)
})

test('Enter inserts a saved newline in a readonly textarea', async ({ page }) => {
  const note = 'Original note\nSecond line\nAdded by keyboard.'
  await page.goto('/')
  await openReport(page)
  const notes = preview(page).getByLabel('Readonly notes')
  await notes.focus()
  await notes.press('Control+End')
  await notes.press('Enter')
  await notes.pressSequentially('Added by keyboard.')
  await notes.blur()
  await expect(notes).toHaveValue(note)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')

  const result = await downloaded(page)
  const saved = await page.evaluate(content => {
    const document = new DOMParser().parseFromString(content, 'text/html')
    const textarea = document.getElementById('notes') as HTMLTextAreaElement
    return { value: textarea.value, readonly: textarea.readOnly }
  }, result.content)
  expect(saved).toEqual({ value: note, readonly: true })
  await openReport(page, result.content, 'Keyboard notes.html')
  await expect(preview(page).getByLabel('Readonly notes')).toHaveValue(note)
})

test('radio selection survives choosing another option and returning before download and reopening', async ({ page }) => {
  const choices = '<form id="region-choice"><fieldset><legend>Region choice</legend><label><input id="north-choice" type="radio" name="region" value="north" checked>North choice</label><label><input id="south-choice" type="radio" name="region" value="south">South choice</label></fieldset></form><form><label><input id="reference-choice" type="radio" name="region" value="reference" checked>Reference choice</label></form>'
  await page.goto('/')
  await openReport(page, report.replace('<section id="annotations">', `${choices}<section id="annotations">`))
  const north = preview(page).getByLabel('North choice', { exact: true })
  const south = preview(page).getByLabel('South choice', { exact: true })
  await expect(north).toBeChecked()
  await south.check()
  await expect(north).not.toBeChecked()
  await north.check()
  await expect(north).toBeChecked()
  await expect(south).not.toBeChecked()
  await expect(preview(page).getByLabel('Reference choice', { exact: true })).toBeChecked()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')

  const result = await downloaded(page)
  const saved = await page.evaluate(content => {
    const document = new DOMParser().parseFromString(content, 'text/html')
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'), input => ({
      id: input.id, checked: input.checked, saved: input.hasAttribute('checked'),
    }))
  }, result.content)
  expect(saved).toEqual([
    { id: 'north-choice', checked: true, saved: true },
    { id: 'south-choice', checked: false, saved: false },
    { id: 'reference-choice', checked: true, saved: true },
  ])
  await openReport(page, result.content, 'Saved region choice.html')
  await expect(preview(page).getByLabel('North choice', { exact: true })).toBeChecked()
  await expect(preview(page).getByLabel('South choice', { exact: true })).not.toBeChecked()
  await expect(preview(page).getByLabel('Reference choice', { exact: true })).toBeChecked()
})

test('a static copy keeps the rendered report, permits literal edits and leaves the interactive original in Documents', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await openReport(page)
  await updateCount(page, 6)
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const original = await downloaded(page)
  await page.getByRole('button', { name: 'Create static copy', exact: true }).click()
  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toContainText('The original document stays unchanged.')
  await confirmation.getByRole('button', { name: 'Create static copy', exact: true }).click()
  await expectReport(preview(page), 6)
  await expect(preview(page).locator('script')).toHaveCount(0)
  await preview(page).locator('#rows tr').first().locator('td').nth(1).locator('[contenteditable]').fill('12')
  await preview(page).locator('#rows tr').first().locator('td').nth(1).locator('[contenteditable]').blur()
  await expect(preview(page).locator('#rows td')).toHaveText(['North', '12', 'South', '3'])
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  const copy = await downloaded(page)
  expect(copy.name).not.toBe(original.name)
  expect(copy.content).not.toMatch(/<script\b|\son[a-z]+\s*=/i)
  expect(copy.content).toContain('North')
  expect(copy.content).not.toMatch(/data-markword-edit-|contenteditable|Content-Security-Policy/)
  await page.reload()
  await expect(preview(page).locator('#rows td')).toHaveText(['North', '12', 'South', '3'])
  await expect(preview(page).locator('#total')).toHaveText('9')
  await expect(preview(page).locator('#bars .bar')).toHaveText(['6', '3'])
  await page.screenshot({ path: testInfo.outputPath('html-static-copy.png') })

  await openSavedReport(page, 'Regional report')
  await expectReport(preview(page), 6)
  expect((await downloaded(page)).content).toBe(original.content)
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  await interactivePreview(page).getByRole('button', { name: 'Redraw report', exact: true }).click()
  await expectReport(interactivePreview(page), 6)
  await page.getByRole('button', { name: 'Edit page', exact: true }).click()
  await expectReport(preview(page), 6)
})

test('executing document scripts cannot access the parent, storage, network or navigate the preview', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://dynamic-escape.invalid/**', async route => {
    requests.push(route.request().url())
    await route.abort()
  })
  const probes = `<section><h2>Isolation probes</h2><output id="probe-results"></output><button type="button" id="navigate-self">Navigate this preview</button><button type="button" id="navigate-parent">Navigate parent</button></section>
<script src="https://dynamic-escape.invalid/third-party.js"></script>
<script>
const results = {};
try { top.document.body.dataset.dynamicEscaped = 'yes'; results.parentDOM = 'escaped'; } catch { results.parentDOM = 'blocked'; }
try { top.localStorage.setItem('dynamic-storage', 'escaped'); results.parentStorage = 'escaped'; } catch { results.parentStorage = 'blocked'; }
try { localStorage.setItem('dynamic-storage', 'escaped'); results.ownStorage = 'escaped'; } catch { results.ownStorage = 'blocked'; }
fetch('https://dynamic-escape.invalid/fetch').then(() => { results.network = 'escaped'; showResults(); }).catch(() => { results.network = 'blocked'; showResults(); });
function showResults() { document.getElementById('probe-results').textContent = JSON.stringify(results); }
showResults();
document.getElementById('navigate-self').addEventListener('click', () => { location.assign('https://dynamic-escape.invalid/self'); });
document.getElementById('navigate-parent').addEventListener('click', () => { try { top.location.href = 'https://dynamic-escape.invalid/parent'; } catch { results.parentNavigation = 'blocked'; showResults(); } });
</script>`
  const source = report.replace('</main>', `${probes}</main>`)
  await page.goto('/')
  const parentURL = page.url()
  await page.evaluate(() => localStorage.setItem('dynamic-storage', 'original'))
  await openReport(page, source)
  await expectReport(preview(page))
  await expect(page.locator('body')).not.toHaveAttribute('data-dynamic-escaped')
  expect(await page.evaluate(() => localStorage.getItem('dynamic-storage'))).toBe('original')
  await page.getByRole('button', { name: 'Interactive preview', exact: true }).click()
  const frame = interactivePreview(page)
  await expectReport(frame)
  await expect.poll(async () => JSON.parse(await frame.locator('#probe-results').innerText())).toEqual({
    parentDOM: 'blocked', parentStorage: 'blocked', ownStorage: 'blocked', network: 'blocked',
  })
  await frame.getByRole('button', { name: 'Navigate parent', exact: true }).click()
  await expect(page).toHaveURL(parentURL)
  await frame.getByRole('button', { name: 'Navigate this preview', exact: true }).click()
  await frame.getByRole('button', { name: 'Redraw report', exact: true }).click()
  await expectReport(frame)
  await expect(page).toHaveURL(parentURL)
  await expect(page.locator('body')).not.toHaveAttribute('data-dynamic-escaped')
  expect(await page.evaluate(() => localStorage.getItem('dynamic-storage'))).toBe('original')
  expect(requests).toEqual([])
})


test('page data keeps Chinese composition active until the value is committed', async ({ page }) => {
  await page.goto('/')
  await openReport(page)
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  const field = page.getByRole('complementary', { name: 'Page data', exact: true })
    .getByLabel('report-data · regions[0].name', { exact: true })
  await field.focus()
  await field.dispatchEvent('compositionstart')
  await field.fill('北部')
  await field.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(field).toHaveValue('北部')
  await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await expect(field).toBeFocused()
  await expect(preview(page).locator('#rows td').first()).toHaveText('North')
  await field.dispatchEvent('compositionend', { data: '北部' })
  await field.press('Enter')
  await expect(preview(page).locator('#rows td').first()).toHaveText('北部')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
})
