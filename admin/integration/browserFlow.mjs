import { fileURLToPath } from 'node:url'

// Только одноразовый локальный стенд. Ни токены, ни пароль/TOTP не пишутся в артефакты.
export async function verifyRealAdminBrowser({ authBase, restBase, credentials, nextCode }) {
  const { createServer } = await import('vite')
  const { chromium, expect } = await import('@playwright/test')
  let server, browser, step = 'подготовка браузера'
  const failures = []
  try {
    for (const value of [authBase, restBase]) {
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) throw new Error('Ожидался loopback')
    }
    server = await createServer({
      configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)),
      logLevel: 'silent',
      define: {
        'import.meta.env.VITE_ADMIN_SUPABASE_URL': 'window.location.origin',
        'import.meta.env.VITE_ADMIN_SUPABASE_ANON_KEY': JSON.stringify('synthetic-browser-placeholder'),
      },
      server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {
        '/auth/v1': { target: authBase, rewrite: path => path.replace(/^\/auth\/v1/, '') },
        '/rest/v1': { target: restBase, rewrite: path => path.replace(/^\/rest\/v1/, '') },
      } },
    })
    await server.listen()
    const address = server.httpServer.address()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_ADMIN_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(15000)
    step = 'вход по паролю'
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.getByLabel('Электронная почта').fill(credentials.email)
    await page.getByLabel('Пароль', { exact: true }).fill(credentials.password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    step = 'подтверждение настоящего TOTP'
    await expect(page.getByRole('heading', { name: 'Подтверждение входа' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Организации' })).toHaveCount(0)
    await page.getByLabel('Код из приложения').fill(await nextCode())
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    step = 'поиск через настоящий RPC'
    await page.getByRole('button', { name: 'Найти' }).click()
    await page.getByRole('button', { name: 'Синтетическая организация' }).click()
    await expect(page.getByRole('article', { name: 'Карточка организации' })).toBeVisible()
    step = 'мобильный размер и перезагрузка'
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Организации' })).toBeVisible()
    step = 'выход и перезагрузка'
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('qvesta-admin-auth') === null)).toBe(true)
  } catch {
    // Playwright может включать вводимые значения в сообщения: не передаём их дальше.
    failures.push(new Error(`Браузерная интеграция не прошла этап: ${step}`))
  } finally {
    if (browser) { try { await browser.close() } catch { failures.push(new Error('Не удалось закрыть тестовый браузер')) } }
    if (server) { try { await server.close() } catch { failures.push(new Error('Не удалось закрыть тестовый Vite')) } }
  }
  if (failures.length) throw new AggregateError(failures, 'Ошибка браузерной интеграции admin')
}
