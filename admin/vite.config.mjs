import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { adminHeadersPlugin } from './securityHeaders.mjs'
import { validateAdminBuildEnvironment } from './buildEnvironment.mjs'

export default defineConfig(({ command, mode, isPreview }) => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, root, 'VITE_ADMIN_')
  if (command === 'build' && !isPreview) validateAdminBuildEnvironment(env, mode)
  return {
  root,
  envPrefix: 'VITE_ADMIN_',
  plugins: [react(), adminHeadersPlugin(env.VITE_ADMIN_SUPABASE_URL)],
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  }
})
