import { defineConfig } from '@playwright/test'

const port = Number(process.env.MARKWORD_TEST_PORT) || 5173
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/markword-playwright',
  use: {
    baseURL, locale: 'en', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
