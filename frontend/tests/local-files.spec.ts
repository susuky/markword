import { expect, test } from './shared-workspace-fixture'
import { type Page } from '@playwright/test'

// Use real browser file handles in isolated origin storage; replace only the OS picker.
interface FileHarness {
  root: Promise<FileSystemDirectoryHandle>
  ready: Promise<void>
  cancelOpen: boolean
  cancelSave: boolean
  denyWrite: boolean
  failClose: boolean
  holdClose: boolean
  release: (() => void) | null
  saveName: string
  saveCalls: string[]
  writes: number
  aborts: number
  read: (name: string) => Promise<string>
  write: (name: string, content: string) => Promise<void>
}

declare global { interface Window { fileHarness: FileHarness } }

async function filePickers(page: Page) {
  await page.addInitScript(() => {
    const root = navigator.storage.getDirectory()
    const read = async (name: string) => (await (await (await root).getFileHandle(name)).getFile()).text()
    const write = async (name: string, content: string) => {
      const writable = await (await (await root).getFileHandle(name, { create: true })).createWritable()
      await writable.write(content)
      await writable.close()
    }
    const harness: FileHarness = {
      root, read, write, ready: write('original.md', '# Original\n\nSaved on disk.'),
      cancelOpen: false, cancelSave: false, denyWrite: false, failClose: false,
      holdClose: false, release: null, saveName: 'copy.md', saveCalls: [], writes: 0, aborts: 0,
    }
    window.fileHarness = harness
    const handle = async (name: string) => {
      await harness.ready
      const real = await (await root).getFileHandle(name, { create: true })
      return {
        name,
        getFile: () => real.getFile(),
        requestPermission: async () => harness.denyWrite ? 'denied' : 'granted',
        createWritable: async () => {
          const stream = await real.createWritable()
          return {
            write: async (content: string) => { harness.writes++; await stream.write(content) },
            close: async () => {
              if (harness.holdClose) await new Promise<void>((resolve) => { harness.release = resolve })
              if (harness.failClose) throw new DOMException('Disk full', 'QuotaExceededError')
              await stream.close()
            },
            abort: async () => { harness.aborts++; await stream.abort() },
          }
        },
      }
    }
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: async () => {
      if (harness.cancelOpen) throw new DOMException('Cancelled', 'AbortError')
      return [await handle('original.md')]
    } })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async (options: { suggestedName: string }) => {
      harness.saveCalls.push(options.suggestedName)
      if (harness.cancelSave) throw new DOMException('Cancelled', 'AbortError')
      return handle(harness.saveName)
    } })
  })
}

const editor = (page: Page) => page.locator('.editor-host .cm-content')
const source = (page: Page) => page.locator('.editor-host .cm-line').allTextContents().then((lines) => lines.join('\n'))
const readFile = (page: Page, name = 'original.md') => page.evaluate((filename) => window.fileHarness.read(filename), name)
const openFile = (page: Page) => page.getByRole('button', { name: 'Open document or project', exact: true }).click()
const saveAs = async (page: Page) => {
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: 'Search commands', exact: true }).fill('Save as')
  await page.locator('.command-palette__list').getByRole('option', { name: /^Save as/ }).click()
}
const storedSource = (page: Page) => page.evaluate(async () => {
  const module = '/src/storage.ts'
  const storage = await import(/* @vite-ignore */ module)
  return (await storage.getCurrentDraft(storage.loadPreference('active-document', 'current')))?.content
})

async function expectSavedFile(page: Page, content: string, name = 'original.md') {
  // Wait for close() before reading: a concurrent write can invalidate the File snapshot.
  await expect(page.locator('.file-save-status')).toContainText(name)
  await expect(page.locator('.file-save-status')).toContainText('Saved to file')
  expect(await readFile(page, name)).toBe(content)
}

test('Ctrl+S saves locally and explicit save as writes a file', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect.poll(() => source(page)).toBe('# Original\n\nSaved on disk.')
  await editor(page).fill('# Edited\n\nFirst edit.')
  await expect(page.locator('.file-save-status')).toContainText('File has unsaved changes')
  await expect(page.locator('.save-status')).toHaveText('Saved locally')
  await page.keyboard.press('Control+s')
  await expect.poll(() => storedSource(page)).toBe('# Edited\n\nFirst edit.')
  expect(await readFile(page)).toBe('# Original\n\nSaved on disk.')
  expect(await page.evaluate(() => window.fileHarness.saveCalls)).toEqual([])
  await page.evaluate(() => { window.fileHarness.saveName = 'original.md' })
  await saveAs(page)
  await expectSavedFile(page, '# Edited\n\nFirst edit.')
  await editor(page).fill('Second edit')
  await saveAs(page)
  await expectSavedFile(page, 'Second edit')
  expect(await page.evaluate(() => window.fileHarness.saveCalls.length)).toBe(2)
})

test('cancel, first save, save as, format changes and empty-file saves preserve the correct targets', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await editor(page).fill('# New document\n\n文字內容')
  await page.evaluate(() => { window.fileHarness.cancelSave = true })
  await saveAs(page)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await expect.poll(() => source(page)).toBe('# New document\n\n文字內容')
  await page.evaluate(() => { window.fileHarness.cancelSave = false })
  await saveAs(page)
  await expectSavedFile(page, '# New document\n\n文字內容', 'copy.md')
  expect(await page.evaluate(() => window.fileHarness.saveCalls)).toEqual(['New document.md', 'New document.md'])
  await editor(page).fill('Another copy')
  await page.evaluate(() => { window.fileHarness.saveName = 'another.md' })
  await saveAs(page)
  await expectSavedFile(page, 'Another copy', 'another.md')
  expect(await readFile(page, 'copy.md')).toBe('# New document\n\n文字內容')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await page.evaluate(() => { window.fileHarness.saveName = 'plain.txt' })
  await saveAs(page)
  await expectSavedFile(page, 'Another copy', 'plain.txt')
  expect((await page.evaluate(() => window.fileHarness.saveCalls)).at(-1)).toBe('markword-document.txt')
  await editor(page).fill('')
  await saveAs(page)
  await expectSavedFile(page, '', 'plain.txt')
  expect(await readFile(page, 'another.md')).toBe('Another copy')
})

test('external edits are not overwritten and save as provides a recovery path', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await editor(page).fill('My unsaved edit')
  await page.evaluate(() => window.fileHarness.write('original.md', 'Changed by another editor'))
  const refused = await page.evaluate(async () => {
    const module = '/src/localFiles.ts'
    const files = await import(/* @vite-ignore */ module)
    const original = '# Original\n\nSaved on disk.'
    const handle = await (await window.fileHarness.root).getFileHandle('original.md')
    try {
      await files.writeLocalFile('My unsaved edit', 'markdown', 'original.md', { handle, content: original, byteLength: new Blob([original]).size, mode: 'markdown' })
      return false
    } catch (error) { return error instanceof files.FileChangedError }
  })
  expect(refused).toBe(true)
  expect(await readFile(page)).toBe('Changed by another editor')
  await expect.poll(() => source(page)).toBe('My unsaved edit')
  await saveAs(page)
  await expectSavedFile(page, 'My unsaved edit', 'copy.md')
  expect(await readFile(page)).toBe('Changed by another editor')
  await expect(page.locator('.file-save-status')).toContainText('copy.md')
})

test('permission and close failures keep the old file and allow downloading the unsaved content', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await editor(page).fill('Keep this edit')
  await page.evaluate(() => { window.fileHarness.saveName = 'original.md' })
  await page.evaluate(() => { window.fileHarness.denyWrite = true })
  await saveAs(page)
  await expect(page.getByRole('dialog', { name: 'File not saved' })).toBeVisible()
  expect(await readFile(page)).toContain('Saved on disk.')
  expect(await page.evaluate(() => window.fileHarness.writes)).toBe(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => { window.fileHarness.denyWrite = false; window.fileHarness.failClose = true })
  await saveAs(page)
  await expect(page.getByRole('dialog', { name: 'File not saved' })).toBeVisible()
  expect(await readFile(page)).toContain('Saved on disk.')
  expect(await page.evaluate(() => window.fileHarness.aborts)).toBe(1)
  await expect(page.locator('.file-save-status')).toContainText('File has unsaved changes')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download source', exact: true }).click()
  const stream = await (await downloadPromise).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe('Keep this edit')
})

test('edits during a pending write stay dirty and repeated saves do not race', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await editor(page).fill('First edit')
  await page.evaluate(() => { window.fileHarness.saveName = 'original.md' })
  await page.evaluate(() => { window.fileHarness.holdClose = true })
  await saveAs(page)
  await expect.poll(() => page.evaluate(() => Boolean(window.fileHarness.release))).toBe(true)
  await expect(page.locator('.file-save-status')).toContainText('Saving file…')
  await editor(page).fill('Newer edit while saving')
  await saveAs(page)
  expect(await page.evaluate(() => window.fileHarness.writes)).toBe(1)
  await page.evaluate(() => { window.fileHarness.holdClose = false; window.fileHarness.release?.() })
  await expect(page.locator('.file-save-status')).toContainText('File has unsaved changes')
  expect(await readFile(page)).toBe('First edit')
  await saveAs(page)
  await expectSavedFile(page, 'Newer edit while saving')
})

test('cancelled opening retains the file link and importing another document detaches it', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await page.evaluate(() => { window.fileHarness.cancelOpen = true })
  await openFile(page)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await expect(page.locator('.file-save-status')).toContainText('original.md')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'imported.md', mimeType: 'text/markdown', buffer: Buffer.from('Imported document') })
  await expect.poll(() => source(page)).toBe('Imported document')
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await saveAs(page)
  await expectSavedFile(page, 'Imported document', 'copy.md')
  expect(await readFile(page)).toContain('Saved on disk.')
})

test('browsers without file pickers can open files, save locally, and export source', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await openFile(page)
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Plain text') })
  await expect.poll(() => source(page)).toBe('Plain text')
  await page.keyboard.press('Control+s')
  await expect.poll(() => storedSource(page)).toBe('Plain text')
  await page.reload()
  await expect.poll(() => source(page)).toBe('Plain text')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Plain text Keep the editable source', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.txt$/)
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
