import { test, expect } from '@playwright/test'
import { previewEndpoint, previewSlug, previewVersionId } from '../../src/snapshotPreviewPin.js'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('default mode uses unchanged fixtures and never loads snapshot modules or endpoint', async ({ page, request }) => {
  const urls = []; page.on('request', req => urls.push(req.url()))
  await page.goto('/?__snapshot=1')
  await expect(page.getByRole('article')).toHaveCount(3)
  await expect(page.locator('#quest-attic-example')).toBeVisible()
  expect(urls.some(url => /snapshotPreview|__local_snapshot|passport\.json/.test(url))).toBe(false)
  await expect(page.getByText(previewVersionId)).toHaveCount(0)
  const response = await request.get(previewEndpoint)
  expect(response.headers()['content-type']).not.toContain('application/json')
  expect(await response.text()).not.toContain(previewVersionId)
  await page.goto(`/quests/${previewSlug}`)
  await expect(page.getByText('404', { exact: true })).toBeVisible()
})

test('existing public fixture demo remains playable in default mode', async ({ page }) => {
  await page.goto('/quests/attic-example/demo')
  await expect(page.locator('#demo-answer')).toBeVisible()
  await expect(page.getByText(/Демо неигровое/)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#demo-answer')).toBeVisible()
})
