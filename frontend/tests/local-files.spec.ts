import { expect, test, type Page } from '@playwright/test'

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

test('open and save update the same file and distinguish file state from browser drafts', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect.poll(() => source(page)).toBe('# Original\n\nSaved on disk.')
  await editor(page).fill('# Edited\n\nFirst edit.')
  await expect(page.locator('.file-save-status')).toContainText('File has unsaved changes')
  await expect(page.locator('.save-status')).toHaveText('Saved in this browser')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page)).toBe('# Edited\n\nFirst edit.')
  await expect(page.locator('.file-save-status')).toContainText('Saved to file')
  await editor(page).fill('Second edit')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await expect.poll(() => readFile(page)).toBe('Second edit')
  expect(await page.evaluate(() => window.fileHarness.saveCalls)).toEqual([])
})

test('cancel, first save, save as, format changes and empty-file saves preserve the correct targets', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await editor(page).fill('# New document\n\n文字內容')
  await page.evaluate(() => { window.fileHarness.cancelSave = true })
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await expect.poll(() => source(page)).toBe('# New document\n\n文字內容')
  await page.evaluate(() => { window.fileHarness.cancelSave = false })
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page, 'copy.md')).toBe('# New document\n\n文字內容')
  expect(await page.evaluate(() => window.fileHarness.saveCalls)).toEqual(['New document.md', 'New document.md'])
  await editor(page).fill('Another copy')
  await page.evaluate(() => { window.fileHarness.saveName = 'another.md' })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('button', { name: 'Save as… Choose a file name and location', exact: true }).click()
  await expect.poll(() => readFile(page, 'another.md')).toBe('Another copy')
  expect(await readFile(page, 'copy.md')).toBe('# New document\n\n文字內容')
  await page.getByRole('combobox', { name: 'Document mode' }).selectOption('text')
  await page.evaluate(() => { window.fileHarness.saveName = 'plain.txt' })
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page, 'plain.txt')).toBe('Another copy')
  expect((await page.evaluate(() => window.fileHarness.saveCalls)).at(-1)).toBe('markword-document.txt')
  await editor(page).fill('')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page, 'plain.txt')).toBe('')
  expect(await readFile(page, 'another.md')).toBe('Another copy')
})

test('external edits are not overwritten and save as provides a recovery path', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await editor(page).fill('My unsaved edit')
  await page.evaluate(() => window.fileHarness.write('original.md', 'Changed by another editor'))
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('dialog', { name: 'File not saved' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  expect(await readFile(page)).toBe('Changed by another editor')
  await expect.poll(() => source(page)).toBe('My unsaved edit')
  await page.getByRole('button', { name: 'Save as…', exact: true }).click()
  await expect.poll(() => readFile(page, 'copy.md')).toBe('My unsaved edit')
  expect(await readFile(page)).toBe('Changed by another editor')
  await expect(page.locator('.file-save-status')).toContainText('copy.md')
})

test('permission and close failures keep the old file and allow downloading the unsaved content', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await editor(page).fill('Keep this edit')
  await page.evaluate(() => { window.fileHarness.denyWrite = true })
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('dialog', { name: 'File not saved' })).toBeVisible()
  expect(await readFile(page)).toContain('Saved on disk.')
  expect(await page.evaluate(() => window.fileHarness.writes)).toBe(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => { window.fileHarness.denyWrite = false; window.fileHarness.failClose = true })
  await page.keyboard.press('Control+s')
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
  await page.evaluate(() => { window.fileHarness.holdClose = true })
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => Boolean(window.fileHarness.release))).toBe(true)
  await expect(page.locator('.file-save-status')).toContainText('Saving file…')
  await editor(page).fill('Newer edit while saving')
  await page.keyboard.press('Control+s')
  expect(await page.evaluate(() => window.fileHarness.writes)).toBe(1)
  await page.evaluate(() => { window.fileHarness.holdClose = false; window.fileHarness.release?.() })
  await expect.poll(() => readFile(page)).toBe('First edit')
  await expect(page.locator('.file-save-status')).toContainText('File has unsaved changes')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page)).toBe('Newer edit while saving')
  await expect(page.locator('.file-save-status')).toContainText('Saved to file')
})

test('cancelled opening retains the file link and importing another document detaches it', async ({ page }) => {
  await filePickers(page)
  await page.goto('/')
  await openFile(page)
  await expect(page.locator('.file-save-status')).toBeVisible()
  await page.evaluate(() => { window.fileHarness.cancelOpen = true })
  await openFile(page)
  await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled()
  await expect(page.locator('.file-save-status')).toContainText('original.md')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'imported.md', mimeType: 'text/markdown', buffer: Buffer.from('Imported document') })
  await expect.poll(() => source(page)).toBe('Imported document')
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFile(page, 'copy.md')).toBe('Imported document')
  expect(await readFile(page)).toContain('Saved on disk.')
})

test('browsers without file pickers can still open files and download with the save shortcut', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await openFile(page)
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Plain text') })
  await expect.poll(() => source(page)).toBe('Plain text')
  const downloadPromise = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.txt$/)
  await expect(page.locator('.file-save-status')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
