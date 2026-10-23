import { defineConfig } from '@playwright/test'

// Fully synthetic fixture: no application env files or backend connections.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'offline-content-access.spec.js',
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium', channel: 'chrome', headless: true },
})
