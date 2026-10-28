import { execFileSync } from 'node:child_process'
import { test as base, expect } from '@playwright/test'

export { expect }
export const test = base.extend<{ resetWorkspace: void }>({
  // Playwright requires destructuring even when an automatic fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  resetWorkspace: [async ({}, use) => {
    const database = process.env.MARKWORD_TEST_DATABASE
    if (!database?.startsWith('/tmp/markword-shared-')) throw new Error('A dedicated test database is required')
    execFileSync(process.env.MARKWORD_TEST_PYTHON || 'python', ['-c', [
      'import sqlite3, sys',
      'connection = sqlite3.connect(sys.argv[1])',
      "tables = connection.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()",
      'for (table,) in tables:',
      '    connection.execute(\'DELETE FROM "\' + table.replace(\'"\', \'""\') + \'"\')',
      'connection.commit()',
      'connection.close()',
    ].join('\n'), database])
    await use()
  }, { auto: true }],
})
