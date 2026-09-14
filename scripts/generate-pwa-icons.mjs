import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const symbol = await readFile(new URL('../public/brand/kvesta-symbol.png', import.meta.url))
const imageUrl = `data:image/png;base64,${symbol.toString('base64')}`
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage()

for (const [size, filename] of [[180, 'apple-touch-icon.png'], [192, 'pwa-192x192.png'], [512, 'pwa-512x512.png']]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.icon{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:#fff}.icon img{width:100%;height:100%;object-fit:contain}</style><div class="icon"><img src="${imageUrl}" alt=""></div>`)
  await page.locator('.icon').screenshot({
    path: new URL(`../public/${filename}`, import.meta.url).pathname.slice(1),
  })
}

await browser.close()
