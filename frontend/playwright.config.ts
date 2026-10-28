import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const python = process.env.MARKWORD_TEST_PYTHON ?? (existsSync('../.venv/bin/python') ? '../.venv/bin/python' : 'python3')
process.env.MARKWORD_TEST_PYTHON = python
const port = Number(process.env.MARKWORD_TEST_PORT) || 5188
const apiPort = Number(process.env.MARKWORD_TEST_API_PORT) || 27862
const apiURL = `http://127.0.0.1:${apiPort}`
const baseURL = `http://127.0.0.1:${port}`
process.env.MARKWORD_TEST_DATABASE ??= join(tmpdir(), `markword-shared-${randomUUID()}.sqlite3`)

export default defineConfig({
  testDir: './tests',
  testIgnore: ['quick-capture.spec.ts', 'shared-workspace.spec.ts'],
  workers: 1,
  outputDir: '/tmp/markword-playwright',
  use: {
    baseURL, locale: 'en', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: [
    {
      command: `${python} -m uvicorn backend.main:app --app-dir .. --host 127.0.0.1 --port ${apiPort}`,
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
