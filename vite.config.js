import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { localDevWorker } from './scripts/vite-dev-worker.mjs'

export default defineConfig({
  plugins: [
    localDevWorker(),
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/kvesta-symbol.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Квеста — Qvesta',
        short_name: 'Квеста',
        description: 'Создавайте и проходите квесты в реальном мире!',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'brand/kvesta-symbol.png',
            sizes: '1280x1280',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        // Настройки кеширования статики
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ]
})
