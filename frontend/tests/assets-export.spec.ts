import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

test('asset references follow Markdown links, reference definitions, and media while excluding examples', async ({ page }) => {
  await page.goto('/')
  const markdown = [
    '![直接](assets/巢狀/圖片.png)',
    '![括號](./assets/photo(one).png "keep title")',
    '![空白](<./assets/目錄/圖 片(二).png>)',
    '![編碼](/assets/%E5%9C%96%E7%89%87%20%281%29.png)',
    '[檔案](./assets/report\\(final\\).pdf)',
    '![reference][my  IMAGE] [attachment][my image] ![collapsed][] ![shortcut]',
    '[my image]: <assets/nested/reference.png> "Reference title"',
    '[collapsed]: ./assets/collapsed.png',
    '[shortcut]: ./assets/shortcut.png',
    '[unused]: ./assets/not-used.png',
    '![first][duplicate]',
    '[duplicate]: https://example.com/remote.png',
    '[duplicate]: ./assets/ignored-duplicate.png',
    '@[video](./assets/media/movie.mp4)',
    '@[audio](<./assets/錄音 音軌.mp3>)',
    '[outer ![nested](./assets/nested.png)](./assets/linked.pdf)',
    '![outer ![alt text image](./assets/not-rendered.png)](./assets/outer.png)',
    '`![code](./assets/inline-code.png)`',
    '```md\n![code](./assets/fenced.png)\n```',
    '    ![code](./assets/indented.png)',
    '> ```md\n> ![code](./assets/quoted-code.png)\n> ```',
    'Just mention ./assets/literal.png and https://example.com/assets/remote.png',
    '![remote](https://example.com/assets/remote.png)',
    'A footnote[^picture].',
    '[^picture]: ![footnote](./assets/footnote.png)',
    '![escaped][a\\]b]',
    '[a\\]b]: ./assets/escaped.png (Parenthesis title)',
    '<https://example.com/assets/remote-autolink.png>',
  ].join('\n\n')
  const paths = await page.evaluate(async (source) => {
    const module = '/src/assets.ts'
    const { referencedAssetPaths } = await import(/* @vite-ignore */ module)
    return [...referencedAssetPaths(source)].sort()
  }, markdown)
  expect(paths).toEqual([
    'assets/巢狀/圖片.png', 'assets/photo(one).png', 'assets/目錄/圖 片(二).png', 'assets/圖片 (1).png',
    'assets/report(final).pdf', 'assets/nested/reference.png', 'assets/collapsed.png', 'assets/shortcut.png',
    'assets/media/movie.mp4', 'assets/錄音 音軌.mp3', 'assets/nested.png', 'assets/linked.pdf', 'assets/outer.png', 'assets/footnote.png', 'assets/escaped.png',
  ].sort())
  const proseAndEncodedPaths = await page.evaluate(async () => {
    const module = '/src/assets.ts'
    const { referencedAssetPaths } = await import(/* @vite-ignore */ module)
    return [
      '這是一份沒有本機資產的文件。'.repeat(1_000) + '\n\n![外部圖片](https://example.com/photo.png)',
      '![encoded directory](./%61ssets/percent.png)',
      '![entity directory](&#97;ssets/entity.png)',
    ].map((source) => [...referencedAssetPaths(source)])
  })
  expect(proseAndEncodedPaths).toEqual([[], ['assets/percent.png'], ['assets/entity.png']])
})

test('document ZIP includes only referenced assets and remains importable; all-library ZIP stays compatible', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const module = '/src/assets.ts'
    const storageModule = '/src/storage.ts'
    const { createProjectArchive, importProjectArchive, importLocalAssets } = await import(/* @vite-ignore */ module)
    const { listAssets } = await import(/* @vite-ignore */ storageModule)
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    const assets = await importLocalAssets([
      new File(['used'], '使用中.png', { type: 'image/png' }),
      new File(['private'], 'unrelated.pdf', { type: 'application/pdf' }),
    ])
    const source = '![使用中][picture]\n\n[picture]: ./assets/使用中.png\n\n`[example](./assets/missing.txt)`'
    const document = await createProjectArchive(source, '分享文件', assets, 'markdown', 'document')
    const all = await createProjectArchive(source, '備份', assets)
    const plain = await createProjectArchive(source, '原文', assets, 'text', 'document')
    const damagedSource = '![Missing](./assets/missing.png)\n\n' + source
    const rescue = await createProjectArchive(damagedSource, '救援', assets, 'markdown', 'all')
    const storedAfterRescue = (await listAssets()).map((asset: { path: string }) => asset.path).sort()
    const imported = await importProjectArchive(new File([document], 'project.zip'))
    let error = ''
    try { await createProjectArchive('![missing](./assets/missing.png)', 'Missing', assets, 'markdown', 'document') }
    catch (failure) { error = (failure as Error).message }
    return {
      document: Array.from(new Uint8Array(await document.arrayBuffer())),
      all: Array.from(new Uint8Array(await all.arrayBuffer())),
      plain: Array.from(new Uint8Array(await plain.arrayBuffer())),
      rescue: Array.from(new Uint8Array(await rescue.arrayBuffer())),
      storedAfterRescue,
      imported: { markdown: imported.markdown, paths: imported.assets.map((asset: { path: string }) => asset.path) },
      error,
    }
  })
  const entries = unzipSync(new Uint8Array(result.document))
  expect(Object.keys(entries).sort()).toEqual(['assets/使用中.png', 'markword.json', '分享文件.md'].sort())
  expect(strFromU8(entries['assets/使用中.png'])).toBe('used')
  expect(JSON.parse(strFromU8(entries['markword.json'])).assets).toHaveLength(1)
  expect(Object.keys(unzipSync(new Uint8Array(result.all)))).toContain('assets/unrelated.pdf')
  expect(Object.keys(unzipSync(new Uint8Array(result.plain))).sort()).toEqual(['markword.json', '原文.txt'].sort())
  const rescue = unzipSync(new Uint8Array(result.rescue))
  expect(JSON.parse(strFromU8(rescue['markword.json'])).missingAssets).toEqual(['assets/missing.png'])
  expect(JSON.parse(strFromU8(entries['markword.json'])).missingAssets).toBeUndefined()
  expect(strFromU8(rescue['救援.md'])).toContain('![Missing](./assets/missing.png)')
  expect(strFromU8(rescue['assets/使用中.png'])).toBe('used')
  expect(strFromU8(rescue['assets/unrelated.pdf'])).toBe('private')
  expect(result.storedAfterRescue).toEqual(['assets/unrelated.pdf', 'assets/使用中.png'].sort())
  expect(result.imported.paths).toEqual(['assets/使用中-2.png'])
  expect(result.imported.markdown).toContain('[picture]: ./assets/%E4%BD%BF%E7%94%A8%E4%B8%AD-2.png')
  expect(result.error).toContain('Local asset is missing: assets/missing.png')
})

test('image export embeds only actual local images and preserves shared reference links, titles, and code', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const module = '/src/assets.ts'
    const { inlineLocalImagesForExport, importLocalAssets } = await import(/* @vite-ignore */ module)
    await importLocalAssets([new File(['PNG bytes'], '圖片 (1).png', { type: 'application/octet-stream' })])
    const source = [
      '![*inline*](<./assets/圖片 (1).png> "Inline title")',
      '![outer ![inner](./assets/missing-alt.png)](<./assets/圖片 (1).png>)',
      '![reference][shared] [download][shared]',
      '[shared]: <./assets/圖片 (1).png> "Shared title"',
      '![collapsed][] ![shortcut]',
      '[collapsed]: <./assets/圖片 (1).png>',
      '[shortcut]: <./assets/圖片 (1).png>',
      '[^image]: ![footnote](<./assets/圖片 (1).png>)',
      '![escaped][a\\]b]',
      '[a\\]b]: <./assets/圖片 (1).png> (Parenthesis title)',
      '[attachment](./assets/not-loaded.pdf)',
      '@[video](./assets/not-loaded.mp4)',
      '![remote](https://example.com/picture.png)',
      '`![literal](./assets/missing.png)`',
      '```md\n![literal](./assets/missing.png)\n```',
    ].join('\n\n')
    return { source, result: await inlineLocalImagesForExport(source) }
  })
  const url = `data:image/png;base64,${Buffer.from('PNG bytes').toString('base64')}`
  expect(result.result).toBe(result.source
    .replace('![*inline*](<./assets/圖片 (1).png>', `![*inline*](${url}`)
    .replace('![outer ![inner](./assets/missing-alt.png)](<./assets/圖片 (1).png>)', `![outer ![inner](./assets/missing-alt.png)](${url})`)
    .replace('![reference][shared]', `![reference](${url} "Shared title")`)
    .replace('![footnote](<./assets/圖片 (1).png>)', `![footnote](${url})`)
    .replace('![escaped][a\\]b]', `![escaped](${url} (Parenthesis title))`)
    .replace('![collapsed][]', `![collapsed](${url})`)
    .replace('![shortcut]', `![shortcut](${url})`))
})

test('missing, unsupported, and oversized images fail before an incomplete or oversized export', async ({ page }) => {
  await page.goto('/')
  const errors = await page.evaluate(async () => {
    const module = '/src/assets.ts'
    const { inlineLocalImagesForExport, inlineAssetsInHtml, importLocalAssets, MAX_EXPORT_IMAGE_BYTES } = await import(/* @vite-ignore */ module)
    await importLocalAssets([
      new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' }),
      new File(['not a picture'], 'text.png', { type: 'text/plain' }),
      new File([new Uint8Array(MAX_EXPORT_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' }),
      new File([new Uint8Array(2_000_000)], 'repeated.png', { type: 'image/png' }),
    ])
    const failures: string[] = []
    for (const source of [
      '![missing](./assets/missing.png)',
      '![vector](./assets/vector.svg)',
      '![not a picture](./assets/text.png)',
      '![big](./assets/big.png)',
      '![one](./assets/repeated.png)\n\n![two](./assets/repeated.png)',
      'x'.repeat(5_000_001),
    ]) {
      try { await inlineLocalImagesForExport(source); failures.push('unexpected success') }
      catch (failure) { failures.push((failure as Error).message) }
    }
    try { await inlineAssetsInHtml('<img data-asset-path="assets/missing.png">'); failures.push('unexpected success') }
    catch (failure) { failures.push((failure as Error).message) }
    return failures
  })
  expect(errors).toEqual([
    'Local asset is missing: assets/missing.png. Restore it before exporting.',
    'Cannot export vector.svg. Use a PNG, JPEG, GIF, WebP, or BMP image.',
    'Cannot export text.png. Use a PNG, JPEG, GIF, WebP, or BMP image.',
    'Image big.png is larger than 3 MB. Use a smaller image or download portable HTML.',
    'Images make this document too large to export. Use smaller images or download portable HTML.',
    'This document exceeds the export limits. Try a smaller document.',
    'Local asset is missing: assets/missing.png. Restore it before exporting.',
  ])
})
