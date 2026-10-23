import { test, expect } from '@playwright/test'
import { loadValidatedPreview } from '../../snapshot-preview-plugin.mjs'
import { previewEndpoint, previewSlug, previewVersionId } from '../../src/snapshotPreviewPin.js'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('pinned snapshot → catalog → details → nonplayable demo; fields, back, focus, scroll and refresh', async ({ page }) => {
  const snapshot = JSON.parse(await loadValidatedPreview())
  const requests = []; page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.locator('[data-claim="playMinutes"]')).toHaveText('35–50 — Предложено / не проверено')
  await expect(page.locator('[data-claim="preparationMinutes"]')).toHaveText('20–30 — Предложено / не проверено')
  await page.getByRole('link', { name: 'Открыть локальный снимок' }).focus()
  await page.evaluate(() => window.scrollTo(0, 200))
  const catalogY = await page.evaluate(() => scrollY)
  await page.getByRole('link', { name: 'Открыть локальный снимок' }).press('Enter')
  await expect(page.locator('h1')).toBeFocused()
  await expect(page.getByText(previewVersionId)).toBeVisible()
  await expect(page.getByText(snapshot.manifest.source.contentId)).toBeVisible()
  for (const key of ['connection', 'gps', 'connectionFallback', 'homeVenue', 'outdoorVenue']) {
    await expect(page.locator(`[data-claim="${key}"]`)).toHaveAttribute('data-status', 'proposed')
    await expect(page.locator(`[data-claim="${key}"]`)).toContainText(snapshot.payload.compatibility[key].value)
  }
  const demoLink = page.locator('#try-demo')
  await demoLink.focus(); await page.evaluate(() => window.scrollTo(0, 250))
  const detailY = await page.evaluate(() => scrollY)
  await demoLink.press('Enter')
  await expect(page.locator('h1')).toBeFocused()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('[data-claim="demo.question"]')).toContainText(snapshot.payload.demo.publicDemo.value.question)
  await expect(page.locator('[data-claim="demo.hint"]')).toContainText(snapshot.payload.demo.publicDemo.value.hint)
  await expect(page.getByText(/Демо неигровое/)).toBeVisible()
  await page.getByRole('link', { name: 'К описанию снимка' }).click()
  await expect(demoLink).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(detailY, 0)
  await page.getByRole('link', { name: /Все квесты/ }).click()
  await expect(page.locator(`#quest-${previewSlug}`)).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(catalogY, 0)
  for (const suffix of ['', '/demo']) {
    await page.goto(`/quests/${previewSlug}${suffix}`); await page.reload()
    await expect(page.getByText(previewVersionId)).toBeVisible()
  }
  expect(requests.some(url => /passport\.json|private\/|quest-public-export|supabase/.test(url))).toBe(false)
})

test('search, filter URL, mobile draft and no guessed outdoor venue', async ({ page }) => {
  await page.goto('/?venue=park')
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('searchbox').fill('нет такого квеста'); await page.locator('#catalog-search-submit').click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.locator('#catalog-reset').click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.locator('#catalog-filter-trigger').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('В парке')).toHaveCount(0)
  await dialog.locator('input[type=checkbox]').first().check()
  await dialog.locator('button[type=submit]').click()
  await expect(page).toHaveURL(/age=8-11/)
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.reload(); await expect(page.getByRole('article')).toHaveCount(1)
  await page.goBack(); await expect(page.getByRole('article')).toHaveCount(1)
})

for (const kind of ['missing', 'unsupported', 'invalid']) test(`${kind} snapshot gives explicit error and retry without fixture fallback`, async ({ page }) => {
  const snapshot = JSON.parse(await loadValidatedPreview())
  if (kind === 'unsupported') snapshot.manifest.projection = 'unknown'
  if (kind === 'invalid') snapshot.payload.compatibility.age.value = null
  await page.route(`**${previewEndpoint}`, route => route.fulfill({ status: kind === 'missing' ? 404 : 200, contentType: 'application/json', body: JSON.stringify(snapshot) }))
  await page.goto(`/quests/${previewSlug}/demo`)
  await expect(page.getByRole('alert')).toContainText('Fixtures не подставлены')
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await page.unroute(`**${previewEndpoint}`)
  await page.locator('#catalog-retry').click()
  await expect(page.getByText(/Демо неигровое/)).toBeVisible()
  await expect(page.locator('h1')).toBeFocused()
})

test('320–430px layouts fit and unknown local route is 404', async ({ page }) => {
  for (const width of [320, 390, 430]) for (const path of ['/', `/quests/${previewSlug}`, `/quests/${previewSlug}/demo`]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(path)
    await expect(page.locator('[data-claim]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: 'qa/snapshot-preview/demo-430.png', fullPage: true })
  await page.goto('/quests/attic-example'); await expect(page.getByText('404', { exact: true })).toBeVisible()
})
