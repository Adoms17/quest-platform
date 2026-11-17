import { expect, test } from '@playwright/test'

test('запросы подписки: подтверждение, reload после потери ответа, снятие и downgrade', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000030', email: 'intent@example.test', aud: 'authenticated', role: 'authenticated' }
  const org = 'controls-org'
  let state = { organization_id: org, revision: 1, can_manage: true, can_request: true, cancel_at_period_end: false, cancel_intent_state: 'none', scheduled_plan_version_id: null, scheduled_intent_state: 'none', downgrade_targets: [{ id: 'free-id', name: 'Free', version: 1, active_quests: 1, team_members: 1 }] }
  const receipts = new Map()
  const requests = []
  let loseResponse = true
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Тест' }
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: org, name: 'Организация', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', role_permissions: ['billing.read','billing.manage'].map(key => ({ permissions: { key } })) } }] }]
    if (path.endsWith('/get_organization_billing_overview')) data = { organization_id: org, status: 'active', configured_plan: { name: 'Pro' }, can_manage: true, usage: { active_quests: 3, team_members: 2 }, enforcement: { active_quests: false, team_members: false }, effective_entitlements: { active_quests: 5, team_members: 3 }, measured_at: '2026-09-15T00:00:00Z' }
    if (path.endsWith('/get_monthly_participant_usage')) data = { organization_id: org, participants: 0, period_start: '2026-08-31T21:00:00Z', period_end: '2026-09-30T21:00:00Z', timezone: 'Europe/Moscow', coverage_started_at: '2026-09-15T00:00:00Z', is_partial: true, enforcement_enabled: false, measured_at: '2026-09-15T01:00:00Z' }
    if (path.endsWith('/get_organization_billing_controls')) data = state
    if (path.endsWith('/request_organization_billing_intent')) {
      const command = route.request().postDataJSON()
      requests.push(command)
      if (!receipts.has(command.p_command_id)) {
        expect(command.p_expected_revision).toBe(state.revision)
        state = { ...state, revision: state.revision + 1 }
        if (command.p_action === 'cancel_renewal') state = { ...state, cancel_at_period_end: true, cancel_intent_state: 'scheduled' }
        if (command.p_action === 'resume_renewal') state = { ...state, cancel_at_period_end: false, cancel_intent_state: 'none' }
        if (command.p_action === 'schedule_downgrade') state = { ...state, scheduled_plan_version_id: command.p_target_plan_version_id, scheduled_intent_state: 'scheduled' }
        if (command.p_action === 'clear_downgrade') state = { ...state, scheduled_plan_version_id: null, scheduled_intent_state: 'none' }
        receipts.set(command.p_command_id, { organization_id: org, revision: state.revision })
      }
      if (loseResponse) { loseResponse = false; return route.abort('failed') }
      data = receipts.get(command.p_command_id)
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/billing')
  const panel = page.getByRole('region', { name: 'Изменение подписки' })
  await panel.getByRole('button', { name: 'Запросить отмену продления' }).click()
  expect(requests).toHaveLength(0)
  await panel.getByRole('button', { name: 'Подтвердить запрос' }).click()
  await expect(panel.getByText('Проверить и повторить запрос')).toBeVisible()
  await page.reload()
  await panel.getByText('Проверить и повторить запрос').click()
  await expect(panel.getByText('Снять запрос отмены', { exact: true })).toBeVisible()
  expect(requests[1]).toEqual(requests[0])
  await panel.getByText('Снять запрос отмены', { exact: true }).click()
  await panel.getByText('Подтвердить запрос').click()
  await expect(panel.getByText('Нет запланированных изменений.')).toBeVisible()
  await panel.getByLabel('Тариф со следующего периода').selectOption('free-id')
  await panel.getByText('Запросить смену тарифа', { exact: true }).click()
  await panel.getByText('Подтвердить запрос').click()
  await expect(panel.getByText(/Смена тарифа: Free/)).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('billing-intents.png'), fullPage: true })
  await panel.getByText('Снять запрос смены тарифа', { exact: true }).click()
  await panel.getByText('Подтвердить запрос').click()
  await expect(panel.getByText('Нет запланированных изменений.')).toBeVisible()
  expect(receipts.size).toBe(4)
})
