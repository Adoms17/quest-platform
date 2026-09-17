import { expect, test } from '@playwright/test'

test('sandbox checkout: catalog, lost reservation, reload, payment retry and safe redirect', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000090', email: 'sandbox@example.test', aud: 'authenticated', role: 'authenticated' }
  const org = '00000000-0000-4000-8000-000000000091'
  const id = '00000000-0000-4000-8000-000000000092'
  const offerId = '00000000-0000-4000-8000-000000000093'
  const offer = { offer_id: offerId, organization_id: org, plan_version_id: id, plan_name: 'Тестовый Pro', environment: 'sandbox', amount_minor: 100, currency: 'RUB', period_start: '2026-09-16T00:00:00Z', period_end: '2026-10-16T00:00:00Z', valid_until: '2099-01-01T00:00:00Z' }
  let reserved = false, loseReserve = true, losePayment = true, paid = false
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
    if (path.endsWith('/find_pending_sandbox_order')) data = reserved ? id : null
    if (path.endsWith('/list_sandbox_checkout_offers')) data = [offer]
    if (path.endsWith('/get_sandbox_order_offer')) data = { ...offer, order_id: id, state: paid ? 'finished' : 'reserved', fulfillment_state: paid ? 'applied' : 'none' }
    if (path.endsWith('/accept_sandbox_checkout_offer')) {
      commands.push(route.request().postDataJSON()); reserved = true
      if (loseReserve) { loseReserve = false; return route.abort('failed') }
      data = id
    }
    if (path.endsWith('/sandbox-checkout')) {
      payments.push(route.request().postDataJSON())
      if (losePayment) { losePayment = false; return route.abort('failed') }
      data = { orderId: id, paymentId: offerId, status: paid ? 'succeeded' : 'pending', requiresReview: false, confirmationUrl: paid ? null : 'https://yoomoney.ru/checkout/test' }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/billing')
  await page.getByLabel('Тестовое предложение').selectOption(offerId)
  expect(payments).toHaveLength(0)
  await page.getByRole('button', { name: 'Подготовить тестовый заказ' }).click()
  await expect(page.getByText(/Создание заказа не подтверждено/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' })).toBeVisible()
  expect(commands.length).toBeGreaterThanOrEqual(2)
  expect(commands.every(command => JSON.stringify(command) === JSON.stringify(commands[0]))).toBe(true)
  expect(payments).toHaveLength(0)
  await page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' }).check()
  await page.getByRole('button', { name: 'Подтвердить тестовую оплату' }).click()
  await expect(page.getByText(/Не удалось подтвердить состояние платежа/)).toBeVisible()
  await page.getByRole('button', { name: 'Проверить платёж' }).click()
  await expect(page.getByRole('link', { name: 'Перейти к тестовой оплате' })).toHaveAttribute('href', 'https://yoomoney.ru/checkout/test')
  expect(payments).toEqual([{ orderId: id }, { orderId: id }])
  await page.screenshot({ path: testInfo.outputPath('sandbox-checkout.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  paid = true
  await page.reload()
  await expect(page.getByText('Оплаченный тестовый период применён.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть завершённый заказ' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Перейти к тестовой оплате' })).toHaveCount(0)
  expect(errors).toEqual([])
})
