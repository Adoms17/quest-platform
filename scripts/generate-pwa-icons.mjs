import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage()

for (const [size, filename] of [[180, 'apple-touch-icon.png'], [192, 'pwa-192x192.png'], [512, 'pwa-512x512.png']]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.icon{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#fff}.icon svg{width:78%;height:78%}</style><div class="icon">${svg}</div>`)
  await page.locator('.icon').screenshot({
    path: new URL(`../public/${filename}`, import.meta.url).pathname.slice(1),
  })
}

await browser.close()
