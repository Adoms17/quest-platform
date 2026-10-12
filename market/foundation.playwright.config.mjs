import { defineConfig } from '@playwright/test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
export default defineConfig({
  testDir: './tests/foundation-browser', workers: 1, retries: 0,
  outputDir: './qa/foundation-browser', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4197', channel: 'chrome' },
  webServer: { command: `node "${vite}" --host 127.0.0.1 --port 4197 --strictPort`, url: 'http://127.0.0.1:4197', reuseExistingServer: false },
})
