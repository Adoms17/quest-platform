import { defineConfig } from '@playwright/test'

const baseURL = process.env.OFFLINE_ACCEPTANCE_URL
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL || '')) throw new Error('Start with the isolated offline acceptance harness')
export default defineConfig({
  testDir: './e2e', workers: 1, reporter: 'list', outputDir: './.review.local/real-backend-results',
  use: {baseURL, browserName: 'chromium', channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off'},
  projects: [{name: 'chromium', testMatch: ['app.spec.js', 'offline-real-backend.spec.js'],
    grep: /restores and synchronizes a complete authorized offline attempt|completes an authorized quest through|real backend:/}],
})
