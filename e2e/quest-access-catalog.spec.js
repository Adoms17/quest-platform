import { expect, test } from '@playwright/test'
test('UX06: серверные списки доступа', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let denied = false
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/quests')) data = { id: 'q1', title: 'Квест', organization_id: 'org1' }
    if (path.endsWith('/search_quest_access_catalog')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501' } }); return }
      const args = route.request().postDataJSON()
      const items = Array.from({ length: 40 }, (_, n) => ({ id: `i${n}`, kind: 'invitation', email: `person${n}@example.test`, username: 'Взрослый', participant_display_name: `Участник ${n}`, status: 'active', display_status: n === 0 ? 'expired' : 'active', max_redemptions: 1, redemption_count: 0, created_at: '2026-09-01T00:00:00Z', expires_at: null }))
      const found = items.filter(i => `${i.email} ${args.p_kind === 'grants' ? i.participant_display_name : ''}`.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { quest_id: 'q1', kind: args.p_kind, items: found.slice(start, end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/quests/q1/access')
  const list = page.getByRole('region', { name: 'Списки доступа' })
  await expect(list.locator('article')).toHaveCount(25)
  await expect(list.getByText('Истёк', { exact: true })).toBeVisible()
  await list.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(list.locator('article')).toHaveCount(40)
  await list.getByLabel('Найти приглашение по email').fill('person39')
  await expect(list.locator('article')).toHaveCount(1)
  await list.getByRole('button', { name: 'Выданные права' }).click()
  await expect(list.locator('article')).toHaveCount(25)
  await list.getByLabel('Найти по имени участника или аккаунту').fill('Участник 39')
  await expect(list.locator('article')).toHaveCount(1)
  await expect(list.getByRole('heading', { name: 'Участник 39', exact: true })).toBeVisible()
  await expect(list.locator('article')).toContainText('Аккаунт: Взрослый')
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await list.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('quest-access-catalog.png'), scale: 'css' })
  await list.getByLabel('Найти по имени участника или аккаунту').fill('')
  await expect(list.locator('article')).toHaveCount(25)
  denied = true
  await list.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(list.getByRole('alert')).toBeVisible()
  await expect(list.locator('article')).toHaveCount(0)
  expect(requests.some(path => /\/(quest_access_credentials|get_quest_access_grants)$/.test(path))).toBe(false)
})
