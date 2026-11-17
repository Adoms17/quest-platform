import { expect, test } from '@playwright/test'

test('browser hook ignores stale success and failure after rapid retries', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('/tests/browser/retry-harness.html')
  await expect.poll(() => page.evaluate(() => window.catalogHarness?.count())).toBe(1)
  await page.getByRole('button', { name: 'Retry twice', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.catalogHarness.count())).toBe(2)
  expect(await page.evaluate(() => window.catalogHarness.aborted(0))).toBe(true)
  await page.getByRole('button', { name: 'Retry source', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.catalogHarness.count())).toBe(3)
  expect(await page.evaluate(() => window.catalogHarness.aborted(1))).toBe(true)
  await page.evaluate(() => window.catalogHarness.resolve(2, 'latest-public-fixture'))
  await expect(page.locator('output')).toHaveText('latest-public-fixture')
  await page.evaluate(async () => {
    window.catalogHarness.resolve(0, 'stale-public-fixture')
    window.catalogHarness.reject(1)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect(page.locator('p[role=status]')).toHaveText('ready')
  await expect(page.locator('output')).toHaveText('latest-public-fixture')
})
