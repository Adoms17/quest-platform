import { expect, test } from '@playwright/test'
test('UX06: переходы между разделами рабочего квеста', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  const permissions = ['quests.read', 'quests.update', 'access_grants.manage', 'quest_stats.read']
  const quest = { id: 'q1', title: 'Городская прогулка', organization_id: 'org1', verification_options: ['gps'], location_options: ['gps'], is_open: true, verification_mode: 'online' }
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (['PATCH', 'DELETE', 'PUT'].includes(route.request().method()) || /\/(create_|update_|revoke_)/.test(path)) mutations.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/quests')) data = quest
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: 'org1', name: 'Городские маршруты', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', name: 'Владелец', role_permissions: permissions.map(key => ({ permissions: { key } })) } }] }]
    await route.fulfill({ json: data })
  })
  await page.goto('/quests/q1/tasks')
  const nav = page.getByRole('navigation', { name: 'Разделы квеста' })
  await expect(nav.getByRole('link', { name: 'Задания' })).toHaveAttribute('aria-current', 'page')
  for (const [label, suffix] of [['Доступ', 'access'], ['Результаты', 'stats'], ['Квест', 'edit']]) {
    await nav.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/quests/q1/${suffix}$`))
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
  }
  await expect(page.getByRole('link', { name: 'Перейти к заданиям', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить офлайн-пакет' })).toBeHidden()
  await page.getByRole('button', { name: 'Изменить квест', exact: true }).click()
  const limit = page.getByLabel('Лимит прохождений квеста участником', { exact: true })
  await expect(limit).toBeVisible()
  const limitBox = await limit.boundingBox()
  const timeBox = await page.getByLabel('Время прохождения, минут (0 — без ограничения)', { exact: true }).boundingBox()
  expect(limitBox.y + limitBox.height).toBeLessThan(timeBox.y)
  await page.getByRole('textbox', { name: 'Название квеста', exact: true }).fill('Не сохранять')
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Городская прогулка', exact: true })).toBeVisible()
  await page.locator('summary').filter({ hasText: /^Правила прохождения$/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Изменения в этом разделе сохраняются сразу.', { exact: false })).toBeVisible()
  await page.locator('summary').filter({ hasText: /^Правила прохождения$/ }).click()
  await page.locator('summary').filter({ hasText: /^Проверка офлайн-материалов$/ }).click()
  await expect(page.getByRole('button', { name: 'Проверить офлайн-пакет' })).toBeVisible()
  await page.locator('summary').filter({ hasText: /^Проверка офлайн-материалов$/ }).click()
  expect(mutations).toEqual([])
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('region', { name: 'Рабочий квест' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('quest-workspace.png'), scale: 'css' })
  await page.getByRole('link', { name: 'К списку квестов', exact: true }).click()
  await expect(page).toHaveURL(/\/quests$/)
})
