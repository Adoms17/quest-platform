import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Explicit local allowlist; never load project credentials or integration suites.
export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    maxWorkers: 1,
    include: [
      'scripts/account-activity.browser.test.js',
      'scripts/participant-avatar-browser.test.js',
      'src/components/RecurringConsent.test.jsx',
      'src/components/OrganizationRecurringConsent.test.jsx',
      'src/components/RecurringFailureNotice.test.jsx',
      'src/services/recurringConsentApi.test.js',
      'src/services/sandboxCheckoutVisibility.test.js',
      'src/pages/OrganizationBilling.test.jsx',
    ],
  },
})
