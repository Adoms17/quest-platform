import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results/admin',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'off', channel: process.env.PLAYWRIGHT_ADMIN_CHANNEL || undefined },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run build -- --config admin/vite.config.mjs --mode test && npm run preview -- --config admin/vite.config.mjs --port 4175 --host 127.0.0.1 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    env: { VITE_ADMIN_SANDBOX_REFUNDS: 'true', VITE_ADMIN_SUPABASE_URL: 'http://127.0.0.1:54499', VITE_ADMIN_SUPABASE_ANON_KEY: 'synthetic-browser-placeholder' },
  },
})
