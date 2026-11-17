import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.setViewportSize({ width: 390, height: 600 })
})

async function settledY(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => scrollY)
}

async function expectY(page, y) {
  await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThanOrEqual(3)
}

test('demo returns to actual details position, then All quests restores catalog position', async ({ page }) => {
  await page.goto('/?venue=home')
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  const card = page.locator('#quest-observatory-example')
  await card.scrollIntoViewIfNeeded()
  await card.focus()
  const catalogY = await settledY(page)
  expect(catalogY).toBeGreaterThan(300)
  await page.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('Секрет забытой обсерватории')
  const demo = page.locator('#try-demo')
  await demo.scrollIntoViewIfNeeded()
  await demo.focus()
  const detailsY = await settledY(page)
  expect(detailsY).toBeGreaterThan(300)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Количество звёзд' })).toBeVisible()
  await page.getByRole('link', { name: 'К описанию квеста', exact: false }).click()
  await expect(demo).toBeFocused()
  await expectY(page, detailsY)
  await page.getByRole('link', { name: 'Все квесты', exact: false }).click()
  await expect(card).toBeFocused()
  await expect(page).toHaveURL('http://127.0.0.1:4186/?venue=home')
  await expectY(page, catalogY)
})

test('query Back and Forward restore distinct nonzero measured scroll positions', async ({ page }) => {
  await page.goto('/?q=тайна')
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('searchbox').fill('звезды')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(page.getByRole('article')).toContainText('Секрет забытой обсерватории')
  await expect(page).toHaveURL(`http://127.0.0.1:4186/?${new URLSearchParams({ q: 'звезды' })}`)
  await page.evaluate(() => scrollTo(0, 900))
  const starsY = await settledY(page)
  expect(starsY).toBeGreaterThan(800)
  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('тайна')
  await page.evaluate(() => scrollTo(0, 450))
  const atticY = await settledY(page)
  expect(atticY).toBeGreaterThan(400)
  expect(starsY - atticY).toBeGreaterThan(300)
  await page.goForward()
  await expect(page.getByRole('searchbox')).toHaveValue('звезды')
  await expectY(page, starsY)
  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('тайна')
  await expectY(page, atticY)
})
