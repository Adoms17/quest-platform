import { expect, test } from '@playwright/test'
test('UX05: поиск отозванной связи и восстановление', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = [], mutations = []
  let denied = false, restored = false
  const items = Array.from({ length: 40 }, (_, n) => ({ id: `p${n}`, display_name: `Участник ${n}`, supervision_status: 'revoked', profile_status: 'active' }))
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [], has_more: false, next_cursor: null }
    if (path.endsWith('/search_my_participant_supervision_profiles')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }); return }
      const args = route.request().postDataJSON()
      const found = items.filter(i => i.display_name.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { items: found.slice(start,end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    if (path.endsWith('/search_participant_supervisors')) data = { profile_id: 'p39', can_manage: true, items: [{ id: 'self', username: 'Вы', is_self: true, status: restored ? 'active' : 'revoked', can_restore: !restored, can_revoke: restored }], has_more: false, next_cursor: null }
    if (path.endsWith('/restore_orphaned_participant_supervision')) { mutations.push(route.request().postDataJSON()); restored = true; data = null }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group')
  await page.getByRole('link', { name: 'Мои связи контроля' }).click()
  await expect(page.locator('article')).toHaveCount(25)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.locator('article')).toHaveCount(40)
  await page.getByLabel('Найти профиль по имени').fill('Участник 39')
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.locator('article')).toContainText('Доступ отозван')
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.screenshot({ path: testInfo.outputPath('supervision-profiles.png'), scale: 'css' })
  await page.getByRole('link', { name: 'Открыть связь: Участник 39' }).click()
  await page.getByRole('button', { name: 'Восстановить мой доступ', exact: true }).click()
  await page.getByRole('button', { name: 'Подтвердить действие' }).click()
  await expect(page.locator('article')).toContainText('Контроль активен')
  expect(mutations).toEqual([{ p_participant_profile_id: 'p39' }])
  await page.getByRole('link', { name: 'Мои связи контроля' }).click()
  await expect(page.locator('article')).toHaveCount(25)
  denied = true
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  expect(requests.some(path => /get_my_participant_(profiles|groups)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
