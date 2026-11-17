import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

async function settledY(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => scrollY)
}

test('removed direct URLs and refresh remain distinct from unknown and load error at mobile widths', async ({ page }) => {
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 700 })
    for (const suffix of ['', '/demo']) {
      await page.goto(`/quests/withdrawn-example${suffix}`)
      await expect(page.locator('h1')).toHaveText('Этот пример снят с витрины')
      await page.reload()
      await expect(page.locator('h1')).toBeFocused()
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const back = page.getByRole('link', { name: 'Все квесты', exact: true })
      await back.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('article')).toHaveCount(3)
      await expect(page.getByText('Учебная история из архива')).toHaveCount(0)
    }
  }
  await page.goto('/quests/missing/demo')
  await expect(page.locator('h1')).toHaveText('Квест не найден')
  await page.goto('/quests/attic-example?__qa=error')
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить описание')
  await expect(page.locator('h1')).toBeFocused()
  await page.getByRole('button', { name: 'Повторить загрузку' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('Тайна старого чердака')
  await expect(page.locator('h1')).toBeFocused()
})

test('demo error retry restores keyboard input and preserves details/catalog return positions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto('/?venue=home&__qa=demo-error')
  const card = page.locator('#quest-observatory-example')
  await expect(card).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await card.scrollIntoViewIfNeeded()
  await card.focus()
  const catalogY = await settledY(page)
  expect(catalogY).toBeGreaterThan(300)
  await page.keyboard.press('Enter')
  const demo = page.locator('#try-demo')
  await demo.scrollIntoViewIfNeeded()
  await demo.focus()
  const detailsY = await settledY(page)
  expect(detailsY).toBeGreaterThan(300)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Это ошибка загрузки, а не неверный ответ')
  await expect(page.locator('h1')).toBeFocused()
  await page.getByRole('button', { name: 'Повторить загрузку' }).focus()
  await page.keyboard.press('Enter')
  const input = page.locator('#demo-answer')
  await expect(input).toBeFocused()
  await page.keyboard.type('999')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Попробуйте ещё раз')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await input.fill('12')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Верно!')
  await page.getByRole('link', { name: 'К описанию квеста', exact: false }).click()
  await expect(demo).toBeFocused()
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - detailsY)).toBeLessThanOrEqual(3)
  await page.getByRole('link', { name: 'Все квесты', exact: false }).click()
  await expect(card).toBeFocused()
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - catalogY)).toBeLessThanOrEqual(3)
})

test('product/demo local network is read-only and creates no browser attempt storage', async ({ page }) => {
  const requests = []
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }))
  await page.goto('/quests/attic-example/demo?__qa=demo-error')
  await page.getByRole('button', { name: 'Повторить загрузку' }).click()
  await page.locator('#demo-answer').fill('книга')
  await page.getByRole('button', { name: 'Проверить ответ' }).click()
  await expect(page.getByRole('status')).toContainText('Верно!')
  await page.getByRole('button', { name: 'Начать заново' }).click()
  await expect(page.locator('#demo-answer')).toBeFocused()
  expect(requests.length).toBeGreaterThan(0)
  // This Windows host can inject an antivirus script. The route above aborts it;
  // report only host/method (never query values) separately from application traffic.
  const environmentRequests = requests.filter(r => new URL(r.url).hostname === 'gc.kis.v2.scr.kaspersky-labs.com')
  await test.info().attach('blocked-environment-requests', { body: JSON.stringify(environmentRequests.map(r => ({ method: r.method, host: new URL(r.url).hostname }))), contentType: 'application/json' })
  expect(environmentRequests.every(r => r.method === 'GET')).toBe(true)
  const unexpected = requests.filter(r => !environmentRequests.includes(r) && !(r.method === 'GET' && new URL(r.url).hostname === '127.0.0.1' && new URL(r.url).port === '4186')).map(r => ({ method: r.method, host: new URL(r.url).hostname }))
  expect(unexpected).toEqual([])
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, databases: (await indexedDB.databases()).length, workers: (await navigator.serviceWorker.getRegistrations()).length }))).toEqual({ local: 0, session: 0, databases: 0, workers: 0 })
})
