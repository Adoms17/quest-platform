import { expect, test } from '@playwright/test'

test('isolated candidate: keyboard, no persistence/network writes, reflow, revision and return focus', async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort()
    if (url.pathname.startsWith('/assets/public-covers/')) return route.fulfill({ status: 404, body: '' })
    return route.continue()
  })
  await page.goto('/tests/foundation-browser/harness.html')
  await expect(page.getByText('Обложка не опубликована')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть тестовый пример' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.evaluate(() => {
    window.__writes = []
    Storage.prototype.setItem = () => { window.__writes.push('storage') }
    indexedDB.open = () => { window.__writes.push('indexedDB'); throw new Error('No persistence allowed') }
  })
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Треугольник' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: 'Квадрат' })).toBeChecked()
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('четыре стороны')
  await page.getByRole('radio', { name: 'Треугольник' }).check()
  await page.getByRole('button', { name: 'Проверить', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Верно!')
  await page.getByRole('button', { name: 'Начать заново' }).click()
  await expect(page.getByRole('radio', { name: 'Треугольник' })).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Треугольник' })).not.toBeChecked()
  await page.getByRole('radio', { name: 'Квадрат' }).check()
  await page.getByRole('button', { name: 'Другая ревизия' }).click()
  await expect(page.getByRole('radio', { name: 'Квадрат' })).not.toBeChecked()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(requests).toEqual([])
  expect(await page.evaluate(() => window.__writes)).toEqual([])
  await page.getByRole('button', { name: 'Вернуться к описанию' }).click()
  await expect(page.getByRole('button', { name: 'Открыть тестовый пример' })).toBeFocused()
  await page.getByRole('button', { name: 'Открыть тестовый пример' }).click()
  await expect(page.getByRole('radio', { name: 'Квадрат' })).not.toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'qa/foundation-browser/demo-390.png', fullPage: true })
  await page.getByRole('radio', { name: 'Квадрат' }).check()
  await page.reload()
  await page.getByRole('button', { name: 'Открыть тестовый пример' }).click()
  await expect(page.getByRole('radio', { name: 'Квадрат' })).not.toBeChecked()
})
