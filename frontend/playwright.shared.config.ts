import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.MARKWORD_TEST_PORT) || 5187
const apiPort = Number(process.env.MARKWORD_SHARED_API_PORT) || 27861
const apiURL = `http://127.0.0.1:${apiPort}`
const baseURL = `http://127.0.0.1:${port}`
process.env.MARKWORD_TEST_DATABASE ??= join(tmpdir(), `markword-shared-${randomUUID()}.sqlite3`)
process.env.MARKWORD_TEST_PYTHON ??= existsSync('../.venv/bin/python') ? '../.venv/bin/python' : 'python'

export default defineConfig({
  testDir: './tests',
  testMatch: ['quick-capture.spec.ts', 'shared-workspace.spec.ts'],
  workers: 1,
  outputDir: '/tmp/markword-shared-playwright',
  use: {
    baseURL, locale: 'en', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: [
    {
      command: `${process.env.MARKWORD_TEST_PYTHON} -m uvicorn backend.main:app --app-dir .. --host 127.0.0.1 --port ${apiPort}`,
      url: `${apiURL}/api/health`,
      env: { MARKWORD_DATABASE_PATH: process.env.MARKWORD_TEST_DATABASE },
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      env: { MARKWORD_API_TARGET: apiURL },
      reuseExistingServer: false,
    },
  ],
})
