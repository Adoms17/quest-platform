import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { snapshotPreviewPlugin } from './snapshot-preview-plugin.mjs'

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), ...(command === 'serve' && mode === 'snapshot-preview' ? [snapshotPreviewPlugin()] : [])],
  define: { __LOCAL_SNAPSHOT_PREVIEW__: JSON.stringify(command === 'serve' && mode === 'snapshot-preview') },
  // No env files, API client, service worker or PWA storage in this local slice.
  envDir: false,
  server: { host: '127.0.0.1', port: 4186, strictPort: true, watch: { ignored: ['**/qa/**', '**/tests/**'] } },
  build: { outDir: 'dist' },
}))
