import { expect, test } from '@playwright/test'
test('UX05: каталог приглашений группы', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let denied = false
  const items = Array.from({ length: 40 }, (_, n) => ({ id: `i${n}`, email: `person${n}@example.test`, display_status: n === 0 ? 'expired' : 'pending', expires_at: '2026-09-21T12:00:00Z' }))
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/search_participant_group_members')) data = { group: { id: 'g1', name: 'Семья', can_manage: true }, items: [], has_more: false, next_cursor: null }
    if (path.endsWith('/search_my_group_invitations')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }); return }
      const args = route.request().postDataJSON()
      const found = items.filter(i => i.email.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { group: { id: 'g1', name: 'Семья', can_manage: true }, items: found.slice(start,end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/g1')
  await page.evaluate(async scope => {
    const { saveLocalSecretLink } = await import('/src/services/localSecretLinks.js')
    await saveLocalSecretLink(scope, 'i0', 'https://example.test/expired')
    await saveLocalSecretLink(scope, 'i39', 'https://example.test/synthetic-invitation')
  }, 'participant-group-invitations')
  await page.getByRole('link', { name: 'Мои приглашения', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(25)
  await expect(page.getByText('Срок истёк', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Показать QR' })).toHaveCount(0)
  await expect(page.locator('article').nth(1)).toContainText('Ссылка не сохранена на этом устройстве.')
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(40)
  await page.getByLabel('Найти по email').fill('person39')
  await expect(page.locator('article')).toHaveCount(1)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.getByRole('button', { name: 'Показать QR' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').locator('canvas')).toHaveAttribute('width', '240')
  await page.screenshot({ path: testInfo.outputPath('invitation-qr.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('heading', { name: 'Мои приглашения', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('invitations.png'), scale: 'css' })
  denied = true
  await page.getByRole('button', { name: 'Обновить приглашения' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  expect(requests.some(path => /get_my_participant_(profiles|groups|group_invitations)/.test(path))).toBe(false)
})
