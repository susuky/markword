import { expect, test } from '@playwright/test'

test('code highlighting stays current across prose, language, code, and locale changes', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.cm-content')
  const code = 'const example = "<script>alert(1)</script>";'
  const source = (language: string, value: string, prefix = '') => `${prefix}\`\`\`${language}\n${value}\n\`\`\``
  const rendered = page.locator('.markdown-body pre code')

  await editor.fill(source('javascript', code))
  await expect(rendered).toHaveCount(1)
  await expect(rendered).toHaveText(code + '\n')
  await expect(rendered.locator('.hljs-keyword')).toHaveText('const')

  await editor.fill(source('javascript', code, '# A new heading\n\n'))
  await expect(page.locator('.markdown-body pre')).toHaveAttribute('data-source-start', '3')
  await expect(rendered).toHaveText(code + '\n')
  await expect(page.locator('.markdown-body script')).toHaveCount(0)

  await editor.fill(source('plaintext', code))
  await expect(page.locator('.markdown-body pre')).toHaveAttribute('data-source-start', '1')
  await expect(rendered.locator('.hljs-keyword')).toHaveCount(0)
  await expect(rendered).toHaveText(code + '\n')

  const edited = 'let changed = 2;'
  await editor.fill(source('javascript', edited))
  await expect(rendered).toHaveText(edited + '\n')
  await expect(rendered.locator('.hljs-keyword')).toHaveText('let')
  await page.getByRole('button', { name: 'Switch to Traditional Chinese', exact: true }).click()
  await expect(page.getByRole('button', { name: '複製程式碼', exact: true })).toBeVisible()
  await expect(rendered).toHaveText(edited + '\n')
})
