import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const localIntegration = Boolean(process.env.RUN_LOCAL_SUPABASE_E2E || process.env.RUN_LOCAL_EDGE_E2E)
if (localIntegration && !process.env.PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY) {
  throw new Error('Для локальной интеграции требуется PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY в окружении.')
}
const chromiumLaunchOptions = executablePath
  ? { launchOptions: { executablePath } }
  : {}

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumLaunchOptions,
      },
    },
    {
      name: 'android-chrome-layout',
      use: {
        ...devices['Pixel 7'],
        ...chromiumLaunchOptions,
      },
    },
    {
      name: 'ios-safari-layout',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        ...chromiumLaunchOptions,
      },
    },
  ],
  webServer: {
    command: 'npm run build && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !isCI && !localIntegration,
    timeout: 120000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: localIntegration ? process.env.PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY : 'test-anon-key',
    },
  },
})
