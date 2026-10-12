import { defineConfig } from '@playwright/test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
export default defineConfig({
  testDir: './tests/public-browser', workers: 1, retries: 0,
  outputDir: './qa/public-design/browser-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4194', channel: 'chrome', viewport: { width: 1440, height: 1024 }, screenshot: 'only-on-failure' },
  webServer: {
    command: `node "${vite}" --host 127.0.0.1 --port 4194 --strictPort`, url: 'http://127.0.0.1:4194', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:4194', VITE_SUPABASE_ANON_KEY: 'synthetic-ui-test-only', VITE_APP_ORIGIN: 'https://stage.qvesta.ru', VITE_MARKET_SALES_ENABLED: 'false' },
  },
})
