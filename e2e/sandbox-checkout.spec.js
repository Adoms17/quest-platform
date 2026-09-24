import { expect, test } from '@playwright/test'

test('sandbox checkout: catalog, lost reservation, reload, payment retry and safe redirect', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000090', email: 'sandbox@example.test', aud: 'authenticated', role: 'authenticated' }
  const org = '00000000-0000-4000-8000-000000000091'
  const id = '00000000-0000-4000-8000-000000000092'
  const offerId = '00000000-0000-4000-8000-000000000093'
  const offer = { offer_id: offerId, organization_id: org, plan_version_id: id, plan_name: 'Тестовый Pro', environment: 'sandbox', amount_minor: 100, currency: 'RUB', period_start: '2026-09-16T00:00:00Z', period_end: '2026-10-16T00:00:00Z', valid_until: '2099-01-01T00:00:00Z' }
  let executing = false, reserved = false, loseReserve = true, losePayment = true, paid = false
  const commands = [], payments = [], errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Тест' }
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: org, name: 'Тестовая организация', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', role_permissions: ['billing.read','billing.manage'].map(key => ({ permissions: { key } })) } }] }]
    if (path.endsWith('/get_organization_billing_overview')) data = { organization_id: org, status: 'unconfigured', configured_plan: null, can_manage: true, usage: { active_quests: 0, team_members: 1 }, enforcement: { active_quests: false, team_members: false }, effective_entitlements: null, measured_at: '2026-09-16T00:00:00Z' }
    if (path.endsWith('/read_recurring_failure_notice')) data = paid ? null : { status: 'payment_failed', period_start: offer.period_start, failed_at: '2026-09-16T00:01:00Z' }
    if (path.endsWith('/find_pending_sandbox_order')) data = executing ? id : null
    if (path.endsWith('/list_sandbox_checkout_offers')) data = [offer]
    if (path.endsWith('/get_sandbox_order_offer')) data = { ...offer, discount: { base_amount_minor: 100, discount_amount_minor: 0, discount_bps: 0 }, order_id: id, state: paid ? 'finished' : 'reserved', fulfillment_state: paid ? 'applied' : 'none' }
        if (path.endsWith('/preview_sandbox_discount_offer')) data = { ...offer, ok: true, discount_id: null, base_amount_minor: 100, discount_amount_minor: 0, discount_bps: 0, remaining_periods: 0, period_months: 1, requires_payment: true, reserved: false }
    if (path.endsWith('/execute_sandbox_discount_checkout')) { executing = true; data = { ok: true } }
    if (path.endsWith('/recover_sandbox_discount_checkout')) data = reserved ? { ...offer, order_id: id, state: executing ? 'executing' : 'ready', reservation_state: 'reserved', payment_requires_review: false, payment_order_id: executing ? id : null, payment_status: null, base_amount_minor: 100, discount_amount_minor: 0, requires_payment: true } : null
    if (path.endsWith('/accept_sandbox_discount_checkout')) {
      commands.push(route.request().postDataJSON()); reserved = true
      if (loseReserve) { loseReserve = false; return route.abort('failed') }
      data = { ok: true, order_id: id }
    }
    if (path.endsWith('/sandbox-checkout')) {
      payments.push(route.request().postDataJSON())
      if (losePayment) { losePayment = false; return route.abort('failed') }
      data = { orderId: id, paymentId: offerId, status: paid ? 'succeeded' : 'pending', requiresReview: false, confirmationUrl: paid ? null : 'https://yoomoney.ru/checkout/test' }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/billing')
  const failureNotice = page.getByRole('heading', { name: 'Тестовое автопродление не оплачено' })
  await expect(failureNotice).toBeVisible()
  await page.getByRole('link', { name: 'Перейти к ручной оплате' }).click()
  await expect(page).toHaveURL(/#sandbox-manual-checkout$/)
  await page.getByLabel('Тестовое предложение').selectOption(offerId)
  expect(payments).toHaveLength(0)
  await page.getByRole('button', { name: 'Рассчитать стоимость' }).click()
  await page.getByRole('button', { name: 'Подтвердить расчёт и создать заказ' }).click()
  await expect(page.getByText(/Не удалось подтвердить состояние заказа/)).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Подготовить тестовый платёж' }).click()
  await page.getByRole('button', { name: 'Перейти к тестовой оплате' }).click()
  await expect(page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' })).toBeVisible()
  expect(commands).toHaveLength(1)
  expect(commands[0].p_code).toBe('')
  expect(payments).toHaveLength(0)
  await page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' }).check()
  await page.getByRole('button', { name: 'Подтвердить тестовую оплату' }).click()
  await expect(page.getByText(/Не удалось подтвердить состояние платежа/)).toBeVisible()
  await page.getByRole('button', { name: 'Проверить платёж' }).click()
  await expect(page.getByRole('link', { name: 'Перейти к тестовой оплате' })).toHaveAttribute('href', 'https://yoomoney.ru/checkout/test')
  expect(payments).toEqual([{ orderId: id }, { orderId: id }])
  await page.screenshot({ path: testInfo.outputPath('sandbox-checkout.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await expect(failureNotice).toBeVisible()
  paid = true
  await page.reload()
  await expect(page.getByText('Оплаченный тестовый период применён.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть завершённый заказ' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Перейти к тестовой оплате' })).toHaveCount(0)
  await expect(failureNotice).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Перейти к ручной оплате' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('manual-payment-notice-cleared.png'), fullPage: true })
  expect(errors).toEqual([])
})
