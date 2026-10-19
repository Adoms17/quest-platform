import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Isolated mock suite. Never load project .env files or run other suites.
export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/diagnostics/shopOffDiagnostic.test.js', 'src/diagnostics/ShopOffDiagnostic.test.jsx'],
    maxWorkers: 1,
  },
})
