import { expect, test } from '@playwright/test'

test('промодоступ: предпросмотр, потеря ответа, восстановление без кода', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000031', email: 'free-access@example.test', aud: 'authenticated', role: 'authenticated' }
  const org = 'free-access-org'
  let receipt = null
  let activations = 0
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Тест' }
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: org, name: 'Организация', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', role_permissions: ['billing.read','billing.manage'].map(key => ({ permissions: { key } })) } }] }]
    if (path.endsWith('/get_organization_billing_overview')) data = { organization_id: org, status: receipt ? 'trial' : 'free', configured_plan: { name: receipt ? 'Business' : 'Free' }, can_manage: true, usage: { active_quests: 1, team_members: 1 }, enforcement: { active_quests: false, team_members: false }, effective_entitlements: { active_quests: 20, team_members: 10 }, measured_at: '2026-09-16T00:00:00Z' }
    if (path.endsWith('/get_organization_free_access_controls')) data = { organization_id: org, revision: receipt ? 1 : 0, available: !receipt, targets: [{ id: 'pro', name: 'Pro', days: 14, eligible: !receipt, active_quests: 5, team_members: 3 }], current_access: receipt ? { id: receipt.access_id, name: 'Business', kind: 'promotion', state: 'active', starts_at: receipt.starts_at, ends_at: receipt.ends_at, can_reconfirm: false } : null }
    if (path.endsWith('/preview_organization_promotion')) data = { ok: true, organization_id: org, revision: 0, id: 'promotion', name: 'Business', days: 21, active_quests: 20, team_members: 10, activate_before: '2026-10-01T00:00:00Z' }
    if (path.endsWith('/get_free_access_command_result')) data = { organization_id: org, found: !!receipt, receipt }
    if (path.endsWith('/redeem_organization_promotion')) {
      activations++
      receipt = { ok: true, organization_id: org, access_id: 'access', state: 'active', starts_at: '2026-09-16T00:00:00Z', ends_at: '2026-10-07T00:00:00Z' }
      return route.abort('failed')
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/billing')
  // Смена тарифа и перезапуск кабинета не затрагивают очередь прохождения.
  await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    await db.saveQuestAttempt('billing-offline-attempt', 'offline-quest', 'offline-actor', null, false, false, 'offline-profile')
    await db.enqueuePendingEvent('offline-quest', 'offline-task', 'billing-offline-attempt', { eventType: 'open' })
  })
  const pendingBefore = await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    return db.getPendingResults()
  })
  const panel = page.getByRole('region', { name: 'Бесплатный доступ', exact: true })
  await panel.getByLabel('Промокод', { exact: true }).fill('TEST-PROMO')
  await panel.getByRole('button', { name: 'Проверить промокод', exact: true }).click()
  await expect(panel.getByText('Подтверждение: Business, 21 суток бесплатно')).toBeVisible()
  expect(activations).toBe(0)
  await panel.getByRole('button', { name: 'Подтвердить бесплатный доступ' }).click()
  await expect(panel.getByText('Проверить и повторить запрос')).toBeEnabled()
  await page.reload()
  await expect(panel.getByLabel('Прежний промокод (если потребуется повтор)')).toHaveValue('')
  await panel.getByText('Проверить и повторить запрос').click()
  await expect(panel.getByText('Промодоступ · Business: Действует')).toBeVisible()
  await expect(panel.getByText('Проверить и повторить запрос')).toHaveCount(0)
  expect(activations).toBe(1)
  expect(await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    return db.getPendingResults()
  })).toEqual(pendingBefore)
  expect(pendingBefore).toHaveLength(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await panel.screenshot({ path: testInfo.outputPath('free-access.png') })
})
