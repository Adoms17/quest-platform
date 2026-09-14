import { expect, test } from '@playwright/test'

test('UX05: создание профиля с серверным выбором группы', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  const creates = []
  const groups = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, group_name: `Группа ${String(i).padStart(2, '0')}`, can_manage: i !== 0 }))
  await page.addInitScript(user => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
  }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/search_my_participant_groups')) {
      const args = route.request().postDataJSON()
      const found = groups.filter(group => group.group_name.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0
      const end = start + args.p_limit
      data = { items: found.slice(start, end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    if (path.endsWith('/create_dependent_participant_profile')) { creates.push(route.request().postDataJSON()); data = 'new-profile' }
    if (path.endsWith('/get_participant_profile_card')) data = { id: 'new-profile', display_name: 'Новый участник', age_group: 'unknown', can_rename: true, can_participate: true, supervision_status: 'active', is_self: false }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group')
  await page.getByRole('link', { name: 'Добавить участника', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить участника' })).toBeVisible()
  expect(requests.some(path => path.endsWith('/search_my_participant_groups'))).toBe(false)
  await page.getByLabel('Имя участника', { exact: true }).fill('Новый участник')
  await page.getByRole('button', { name: 'Выбрать группу', exact: true }).click()
  const picker = page.getByRole('region', { name: 'Группа участника' })
  await expect(picker.locator('li')).toHaveCount(25)
  await expect(picker.getByRole('button', { name: 'Группа 00 Только просмотр' })).toBeDisabled()
  await page.getByRole('button', { name: 'Показать ещё группы' }).click()
  await expect(picker.locator('li')).toHaveCount(40)
  await page.getByLabel('Найти группу', { exact: true }).fill('39')
  await expect(picker.locator('li')).toHaveCount(1)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Группа 39', exact: true }).click()
  await expect(picker.getByText('Выбрана: Группа 39')).toBeVisible()
  await page.locator('html').evaluate(element => { element.style.fontSize = '' })
  await page.getByRole('link', { name: 'К списку людей', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('create-profile.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click()
  await expect(page).toHaveURL(/profiles\/new-profile/)
  await expect(page.getByRole('heading', { name: 'Новый участник' })).toBeVisible()
  expect(creates).toEqual([{ p_display_name: 'Новый участник', p_age_group: 'unknown', p_group_id: 'g39' }])
  expect(requests.some(path => /get_my_participant_(profiles|groups|audit_feed)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
