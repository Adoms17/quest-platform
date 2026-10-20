import { expect, test } from '@playwright/test'

const monthlyUsage = organizationId => ({
  organization_id: organizationId, participants: 12,
  period_start: '2026-08-31T21:00:00Z', period_end: '2026-09-30T21:00:00Z',
  timezone: 'Europe/Moscow', coverage_started_at: '2026-09-15T00:00:00Z',
  is_partial: true, enforcement_enabled: false, measured_at: '2026-09-15T01:00:00Z',
})

for (const canRead of [true, false]) {
  test(`навигация billing.read=${canRead}: ссылка и прямой маршрут`, async ({ page }) => {
    const user = { id: '00000000-0000-4000-8000-000000000020', email: 'reader@example.test', aud: 'authenticated', role: 'authenticated' }
    let calls = 0
    await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
    await page.route('http://127.0.0.1:54321/**', async route => {
      const path = new URL(route.request().url()).pathname
      let data = []
      if (path.endsWith('/auth/v1/user')) data = user
      if (path.endsWith('/profiles')) data = { username: 'Читатель' }
      if (path.endsWith('/get_monthly_participant_usage')) data = monthlyUsage('reader-org')
      if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: 'reader-org', name: 'Организация читателя' }, membership_roles: [{ roles: { key: canRead ? 'sales_manager' : 'admin', role_permissions: (canRead ? ['billing.read'] : ['quests.read']).map(key => ({ permissions: { key } })) } }] }]
      if (path.endsWith('/get_organization_billing_overview')) {
        calls++
        data = { organization_id: 'reader-org', status: 'unconfigured', configured_plan: null, effective_entitlements: null, can_manage: false, usage: { active_quests: 0, team_members: 1 }, enforcement: { active_quests: false, team_members: false }, measured_at: '2026-09-15T00:00:00Z' }
      }
      await route.fulfill({ json: data })
    })
    await page.goto('/quests')
    await page.getByRole('button', { name: 'Открыть меню профиля: Организация читателя' }).click()
    const link = page.getByRole('link', { name: 'Тариф и лимиты', exact: true })
    if (canRead) {
      await link.click()
      await expect(page.getByText('Вам доступен просмотр тарифа. Управляет подпиской владелец организации.')).toBeVisible()
      expect(calls).toBe(1)
    } else {
      await expect(link).toHaveCount(0)
      await page.goto('/organization/billing')
      await expect(page.getByRole('alert')).toHaveText('Нет доступа к тарифу организации.')
      expect(calls).toBe(0)
    }
  })
}

test('кабинет из меню: лимит, истечение, переходный режим и повтор после отказа', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'billing@example.test', aud: 'authenticated', role: 'authenticated' }
  let status = 'free'
  let monthlyFailure = false
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Тест' }
    if (path.endsWith('/get_monthly_participant_usage')) {
      expect(route.request().postDataJSON()).toEqual({ p_organization_id: 'org1' })
      if (monthlyFailure) return route.fulfill({ status: 503, json: { message: 'private server details' } })
      data = monthlyUsage('org1')
    }
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: 'org1', name: 'Образовательные программы Севастополя', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', name: 'Владелец', role_permissions: ['billing.read','billing.manage','quests.read'].map(key => ({ permissions: { key } })) } }] }]
    if (path.endsWith('/get_organization_billing_overview')) {
      expect(route.request().postDataJSON()).toEqual({ p_organization_id: 'org1' })
      if (status === 'denied') return route.fulfill({ status: 403, json: { code: '42501', message: 'private server details' } })
      data = { organization_id: 'org1', status, can_manage: true, configured_plan: status === 'transition' ? null : { name: 'Free' }, usage: { active_quests: 1, team_members: 2 }, enforcement: { active_quests: status !== 'transition', team_members: false }, effective_entitlements: status === 'free' ? { active_quests: 1, team_members: 1 } : null, measured_at: '2026-09-15T00:00:00Z' }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/quests')
  await page.getByRole('button', { name: /Открыть меню профиля: Образовательные/ }).click()
  await page.getByRole('link', { name: 'Тариф и лимиты', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тариф и лимиты' })).toBeVisible()
  await expect(page.getByText('Лимит достигнут. Для открытия квеста закройте другой.')).toBeVisible()
  await expect(page.getByText('Ограничение пока не применяется.')).toBeVisible()
  const monthly = page.getByRole('region', { name: 'Участники за месяц' })
  await expect(monthly.getByText('12', { exact: true })).toBeVisible()
  await expect(monthly.getByText('Данные за месяц неполные: учёт охватывает только часть периода.')).toBeVisible()
  await expect(monthly.getByText('Без ограничения количества участников и доплат.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('billing-free.png'), fullPage: true })
  await monthly.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('billing-monthly-viewport.png') })
  status = 'expired'
  monthlyFailure = true
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(page.getByText('Срок подписки истёк.')).toBeVisible()
  await expect(page.getByText('Увеличение использования недоступно: нет действующего тарифа.')).toBeVisible()
  await expect(monthly.getByRole('alert')).toHaveText('Не удалось загрузить учёт участников.')
  await expect(page.getByText('private server details')).toHaveCount(0)
  monthlyFailure = false
  await monthly.getByRole('button', { name: 'Повторить загрузку участников' }).click()
  await expect(monthly.getByText('12', { exact: true })).toBeVisible()
  status = 'denied'
  await page.getByRole('button', { name: 'Обновить', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Нет доступа к тарифу организации.')
  await expect(page.getByRole('region', { name: 'Использование ресурсов' })).toHaveCount(0)
  status = 'transition'
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByText('Переходный режим. Тарифные ограничения не применяются.')).toBeVisible()
  await expect(page.getByText('Ограничение пока не применяется.')).toHaveCount(2)
})
