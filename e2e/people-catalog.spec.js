import { expect, test } from '@playwright/test'

test('UX05: server lists, retry and management on demand', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let failMore = true
  let denyMembers = false
  let historyProfile = null
  const profiles = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, display_name: i ? `Участник ${String(i).padStart(2, '0')}` : 'Саша', relationship: i ? 'group_manager' : 'self', can_participate: true }))
  await page.addInitScript(user => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
  }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles') || path.endsWith('/search_my_participant_groups')) {
      const args = route.request().postDataJSON()
      if (args.p_after && failMore) { failMore = false; await route.fulfill({ status: 503, json: { message: 'Temporary failure' } }); return }
      const items = path.endsWith('_profiles') ? profiles : [{ id: 'g1', group_name: 'Семья', can_manage: false }]
      const matches = items.filter(item => (item.display_name || item.group_name).toLowerCase().includes((args.p_search || '').toLowerCase()))
      const start = args.p_after?.offset || 0
      const end = start + (args.p_limit || 25)
      data = { items: matches.slice(start, end), has_more: end < matches.length, next_cursor: end < matches.length ? { offset: end } : null }
    }
    if (path.endsWith('/search_participant_group_members')) {
      if (denyMembers) { await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }); return }
      const args = route.request().postDataJSON()
      const matches = profiles.filter(item => item.display_name.toLowerCase().includes((args.p_search || '').toLowerCase()))
      const start = args.p_after?.offset || 0
      const end = start + (args.p_limit || 25)
      data = { group: { id: 'g1', name: 'Семья', can_manage: false }, items: matches.slice(start, end).map(p => ({ ...p, member_role: 'member' })), has_more: end < matches.length, next_cursor: end < matches.length ? { offset: end } : null }
    }
    if (path.endsWith('/get_participant_profile_card')) {
      const profile = profiles.find(p => p.id === route.request().postDataJSON().p_participant_profile_id)
      data = { ...profile, age_group: 'unknown', can_rename: true, is_self: false, supervision_status: 'active' }
    }
    if (path.endsWith('/update_my_participant_profile_name')) {
      const args = route.request().postDataJSON()
      profiles.find(p => p.id === args.p_participant_profile_id).display_name = args.p_display_name
      data = null
    }
    if (path.endsWith('/search_participant_quest_history')) { historyProfile = route.request().postDataJSON().p_participant_profile_id; data = {items:[],has_more:false,next_cursor:null} }
    if (path.endsWith('/search_participant_quests')) data = { items: [], has_more: false, next_cursor: null }
    if (path.endsWith('/get_my_participant_profiles')) data = profiles.map(p => ({ ...p, participant_profile_id: p.id, age_group: 'unknown' }))
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group')
  await expect(page.locator('article')).toHaveCount(25)
  expect(requests.some(path => /get_my_participant_(profiles|groups)/.test(path))).toBe(false)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(25)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(40)
  await page.getByLabel('Найти профиль по имени').fill('39')
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Участник 39' })).toBeVisible()
  await page.getByRole('button', { name: 'Группы', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Семья' })).toBeVisible()
  await page.getByRole('link', { name: 'Состав группы: Семья' }).click()
  await expect(page).toHaveURL(/participants\/group\/g1/)
  await expect(page.locator('article')).toHaveCount(25)
  await expect(page.getByRole('link', { name: 'Управление группой', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.locator('article')).toHaveCount(40)
  await page.getByLabel('Найти участника по имени').fill('39')
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Участник 39' })).toBeVisible()
  expect(requests.some(path => /get_my_participant_(profiles|groups)/.test(path))).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('group-members.png'), fullPage: true, scale: 'css' })
  denyMembers = true
  await page.getByRole('button', { name: 'Обновить состав' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  denyMembers = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Семья', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'К списку групп' }).click()
  await page.getByRole('button', { name: 'Профили', exact: true }).click()
  await page.getByLabel('Найти профиль по имени').fill('39')
  await expect(page.locator('article')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('people-catalog.png'), fullPage: true, scale: 'css' })
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.getByRole('link', { name: 'Открыть профиль: Участник 39' }).click()
  await expect(page).toHaveURL(/group\/profiles\/p39/)
  await expect(page.getByRole('heading', { name: 'Доступ к профилю', exact: true })).toBeVisible()
  expect(requests.some(path => path.endsWith('/get_my_participant_profiles'))).toBe(false)
  await expect(page.getByRole('link', { name: 'Квесты участника' })).toHaveAttribute('href', '/my-quests?participant=p39')
  await page.getByRole('button', { name: 'Изменить имя' }).click()
  await page.getByLabel('Имя для отображения').fill('Отмена имени')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(requests.some(path => path.endsWith('/update_my_participant_profile_name'))).toBe(false)
  await page.getByRole('button', { name: 'Изменить имя' }).click()
  await page.getByLabel('Имя для отображения').fill('Новое имя')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Новое имя', exact: true })).toBeVisible()
  await page.locator('html').evaluate(element => { element.style.fontSize = '' })
  await expect(page.getByText('Имя профиля сохранено', { exact: true })).toBeHidden({ timeout: 10000 })
  await expect(page.getByRole('link', { name: 'Контролирующие взрослые', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Обновить профиль', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Новое имя', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'К списку людей', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('profile-card.png'), scale: 'css' })
  await page.getByRole('link', { name: 'История прохождений' }).click()
  await expect(page.getByRole('heading', { name: 'История прохождений', exact: true })).toBeVisible()
  await expect.poll(() => historyProfile).toBe('p39')
  await page.goBack()
  await page.getByRole('link', { name: 'Квесты участника' }).click()
  await expect(page).toHaveURL(/my-quests\?participant=p39/)
  await expect(page.locator('summary').filter({ hasText: 'Новое имя' })).toBeVisible()
})
