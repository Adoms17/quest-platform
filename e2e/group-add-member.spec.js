import { expect, test } from '@playwright/test'

test('UX05: поиск и добавление участника в состав', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = [], mutations = []
  let added = false
  const profiles = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, display_name: `Участник ${String(i).padStart(2, '0')}`, can_participate: i !== 0, relationship: 'supervisor' }))
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) {
      const args = route.request().postDataJSON()
      const found = profiles.filter(p => p.display_name.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { items: found.slice(start, end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    if (path.endsWith('/search_participant_group_members')) data = { group: { id: 'g1', name: 'Семья', can_manage: true }, items: added ? [{ ...profiles[39], member_role: 'member' }] : [], has_more: false, next_cursor: null }
    if (path.endsWith('/add_participant_group_member')) { mutations.push(route.request().postDataJSON()); added = true; data = null }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/g1')
  await page.getByRole('button', { name: 'Добавить в группу', exact: true }).click()
  const form = page.getByRole('region', { name: 'Добавление в группу' })
  await expect(form.locator('li')).toHaveCount(25)
  await expect(form.getByRole('button', { name: 'Участник 00 Контроль приостановлен' })).toBeDisabled()
  await form.getByRole('button', { name: 'Показать ещё профили' }).click()
  await expect(form.locator('li')).toHaveCount(40)
  await form.getByLabel('Найти доступный профиль').fill('39')
  await expect(form.locator('li')).toHaveCount(1)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await form.getByRole('button', { name: 'Участник 39 Доступный профиль' }).click()
  expect(mutations).toHaveLength(0)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await form.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('add-member.png'), scale: 'css' })
  await form.getByRole('button', { name: 'Добавить выбранного' }).click()
  await expect(page.getByRole('heading', { name: 'Участник 39' })).toBeVisible()
  expect(mutations).toEqual([{ p_group_id: 'g1', p_participant_profile_id: 'p39' }])
  expect(requests.some(path => /get_my_participant_(profiles|groups|audit_feed)|get_managed_participant_supervisors|set_participant_group_member/.test(path))).toBe(false)
})
