import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './shared-workspace-fixture'

const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const sidebar = (page: Page) => page.locator('#workspace-documents')
const legacyContent = '# Legacy capture\n\nKeep the browser original.\n\n![Existing image](assets/legacy-0.png)'
const secondContent = '# Legacy second\n\nAn independent browser capture.'
const serverContent = '# Server capture\n\nKeep the shared original.'
const legacyAssets = Array.from({ length: 18 }, (_, index) => ({
  id: `legacy-asset-${index}`,
  path: `assets/legacy-${index}.${index === 0 ? 'png' : 'txt'}`,
  name: `legacy-${index}.${index === 0 ? 'png' : 'txt'}`,
  type: index === 0 ? 'image/png' : 'text/plain',
  kind: index === 0 ? 'image' : 'file',
  bytes: Array.from(index === 0
    ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64')
    : Buffer.from(`附件 ${index}\nKeep every original byte.\n`)),
}))

async function seedServer(request: APIRequestContext, content = serverContent) {
  const response = await request.post('/api/workspace/drafts/current', {
    data: { content, metadata: { mode: 'markdown', theme: 'Light' }, expectedVersion: null },
  })
  expect(response.ok()).toBe(true)
}

async function seedLegacyBrowser(page: Page, request: APIRequestContext) {
  await seedServer(request)
  await page.route('**/seed-storage', (route) => route.fulfill({ contentType: 'text/html', body: '<body>Prepare storage</body>' }))
  await page.goto('/seed-storage')
  await page.evaluate(({ assets, first, second }) => new Promise<void>((resolve, reject) => {
    localStorage.setItem('markword.preference.active-document', JSON.stringify('current'))
    localStorage.setItem('markword.preference.documents-open', 'true')
    const open = indexedDB.open('markword', 2)
    open.onupgradeneeded = () => {
      const database = open.result
      database.createObjectStore('drafts', { keyPath: 'id' })
      database.createObjectStore('revisions', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
      const store = database.createObjectStore('assets', { keyPath: 'id' })
      store.createIndex('path', 'path', { unique: true })
      store.createIndex('createdAt', 'createdAt')
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction(['drafts', 'revisions', 'assets'], 'readwrite')
      const drafts = transaction.objectStore('drafts')
      drafts.put({ id: 'current', version: 7, content: first, metadata: { mode: 'markdown', theme: 'Light', retainedSetting: true }, createdAt: 100, updatedAt: 200 })
      drafts.put({ id: 'doc-legacy-second', version: 3, content: second, metadata: { mode: 'markdown', theme: 'Light' }, createdAt: 110, updatedAt: 210 })
      transaction.objectStore('revisions').put({ id: 'legacy-revision', content: '# Earlier browser capture', metadata: { mode: 'markdown' }, createdAt: 150, reason: 'manual' })
      for (const { bytes, ...asset } of assets) {
        transaction.objectStore('assets').put({ ...asset, size: bytes.length, blob: new Blob([new Uint8Array(bytes)], { type: asset.type }), createdAt: 120, updatedAt: 120 })
      }
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  }), { assets: legacyAssets, first: legacyContent, second: secondContent })
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect.poll(() => source(page)).toBe(legacyContent)
  return page.evaluate(() => JSON.parse(localStorage.getItem('markword.preference.active-document')!)) as Promise<string>
}

async function startAt(page: Page, documentId = 'current') {
  await page.addInitScript((id) => {
    localStorage.setItem('markword.preference.active-document', JSON.stringify(id))
    localStorage.setItem('markword.preference.documents-open', 'true')
  }, documentId)
  await page.goto('/')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
}

test('v2 browser migration preserves three captures, revision ownership, and all 18 attachment blobs', async ({ page, request }, testInfo) => {
  const migratedId = await seedLegacyBrowser(page, request)
  expect(migratedId).not.toBe('current')
  await expect(sidebar(page).locator('.document-list__open')).toHaveCount(3)
  for (const name of ['Legacy capture', 'Legacy second', 'Server capture']) {
    await expect(sidebar(page).getByText(name, { exact: true })).toBeVisible()
  }
  await expect(page.locator('.markdown-body img')).toHaveClass(/is-resolved/)
  const workspace = await (await request.get('/api/workspace')).json()
  expect(workspace.drafts).toHaveLength(3)
  expect(workspace.drafts.map((draft: { content: string }) => draft.content).sort()).toEqual([legacyContent, secondContent, serverContent].sort())
  expect(workspace.drafts.find((draft: { id: string }) => draft.id === migratedId).metadata.retainedSetting).toBe(true)
  expect(workspace.revisions).toEqual([expect.objectContaining({ id: 'legacy-revision', documentId: migratedId, content: '# Earlier browser capture' })])
  expect(workspace.assets).toHaveLength(18)
  for (const original of legacyAssets) {
    const stored = workspace.assets.find((asset: { id: string }) => asset.id === original.id)
    expect(stored).toMatchObject({ id: original.id, path: original.path, type: original.type, size: original.bytes.length })
    const response = await request.get(`/api/workspace/assets/${original.id}`)
    expect(response.ok()).toBe(true)
    expect(await response.body()).toEqual(Buffer.from(original.bytes))
  }
  await page.screenshot({ path: testInfo.outputPath('migrated-three-captures.png') })
})

test('reloading browser migration neither duplicates captures nor overwrites later shared edits', async ({ page, request }) => {
  const migratedId = await seedLegacyBrowser(page, request)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.reload()
    await expect(page.locator('.save-status')).toHaveText('Saved locally')
    await expect(sidebar(page).locator('.document-list__open')).toHaveCount(3)
  }
  const draft = await (await request.get(`/api/workspace/drafts/${migratedId}`)).json()
  const latest = '# Shared update\n\nA later edit must survive the old browser import.'
  const updated = await request.post(`/api/workspace/drafts/${migratedId}`, {
    data: { content: latest, metadata: draft.metadata, expectedVersion: draft.version },
  })
  expect(updated.ok()).toBe(true)
  await page.reload()
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await expect.poll(() => source(page)).toBe(latest)
  await expect(sidebar(page).locator('.document-list__open')).toHaveCount(3)
  const workspace = await (await request.get('/api/workspace')).json()
  expect(workspace.drafts).toHaveLength(3)
  expect(workspace.revisions).toHaveLength(1)
  expect(workspace.assets).toHaveLength(18)
  expect(workspace.drafts.find((item: { id: string }) => item.id === migratedId).content).toBe(latest)
})

test('an already open sidebar polls captures created and renamed in an independent browser', async ({ page, request, browser }) => {
  await seedServer(request)
  await startAt(page)
  await expect(sidebar(page).locator('.document-list__open')).toHaveCount(1)
  const independent = await browser.newContext({ locale: 'en' })
  try {
    const other = await independent.newPage()
    await startAt(other)
    await page.bringToFront()
    const created = await other.evaluate(async () => {
      const module = '/src/storage.ts'
      const storage = await import(/* @vite-ignore */ module)
      return storage.createWorkspaceDocument('# Other browser capture\n\nNew shared content.', { mode: 'markdown', theme: 'Light' })
    })
    await expect(sidebar(page).getByText('Other browser capture', { exact: true })).toBeVisible({ timeout: 7000 })
    await expect(sidebar(page).locator('.document-list__open')).toHaveCount(2)
    await other.evaluate(async ({ id, version }) => {
      const module = '/src/storage.ts'
      const storage = await import(/* @vite-ignore */ module)
      await storage.renameWorkspaceDocument(id, 'Renamed by another browser', version)
    }, created)
    const renamed = sidebar(page).locator('.document-list__open').filter({ has: page.getByText('Renamed by another browser', { exact: true }) })
    await expect(renamed).toBeVisible({ timeout: 7000 })
    await expect(sidebar(page).getByText('Other browser capture', { exact: true })).toHaveCount(0)
    await renamed.click()
    await expect.poll(() => source(page)).toBe('# Other browser capture\n\nNew shared content.')
    await expect(sidebar(page)).toBeVisible()
  } finally { await independent.close() }
})

test('an API save failure keeps unsaved text and Ctrl+S retries into the shared database', async ({ page, request, browser }) => {
  await seedServer(request)
  await startAt(page)
  await page.route('**/api/workspace/drafts/current', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Storage temporarily unavailable' }) })
    } else await route.continue()
  })
  const latest = '# Capture during outage\n\nKeep this until the database accepts it.'
  await page.locator('.cm-content').fill(latest)
  await page.keyboard.press('Control+s')
  await expect(page.locator('.save-status')).toHaveText('Could not save. Try again.')
  await expect.poll(() => source(page)).toBe(latest)
  expect((await (await request.get('/api/workspace/drafts/current')).json()).content).toBe(serverContent)

  await page.unroute('**/api/workspace/drafts/current')
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/workspace/drafts/current') && response.ok()),
    page.keyboard.press('Control+s'),
  ])
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  expect((await (await request.get('/api/workspace/drafts/current')).json()).content).toBe(latest)
  const independent = await browser.newContext({ locale: 'en' })
  try {
    const other = await independent.newPage()
    await startAt(other)
    await expect.poll(() => source(other)).toBe(latest)
  } finally { await independent.close() }
})
