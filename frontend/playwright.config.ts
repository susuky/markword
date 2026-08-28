import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/markword-playwright',
  use: { baseURL: 'http://127.0.0.1:5173', locale: 'en', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
