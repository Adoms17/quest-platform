// @vitest-environment node
import { expect, it } from 'vitest'
import { buildSandboxPaymentRequest, validateSandboxPayment } from './yookassaSandbox.js'
const order = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', planVersionId: '33333333-3333-4333-8333-333333333333', idempotencyKey: '44444444-4444-4444-8444-444444444444', amountMinor: 12345, currency: 'RUB', shopId: '123456', environment: 'sandbox', returnUrl: 'https://stage.qvesta.ru/organization/billing', firstSentAt: '2026-09-16T10:00:00Z' }
const now = Date.parse(order.firstSentAt)
const payment = () => ({ id: '55555555-5555-4555-8555-555555555555', test: true, status: 'pending', paid: false, amount: { value: '123.45', currency: 'RUB' }, recipient: { account_id: order.shopId }, metadata: { order_id: order.id, organization_id: order.organizationId, plan_version_id: order.planVersionId, environment: 'sandbox' }, confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/test' } })
it('повтор сохраняет ключ и тело, не включает автоматическое сохранение карты', () => {
  const first = buildSandboxPaymentRequest(order, now)
  expect(buildSandboxPaymentRequest(order, now + 1000)).toEqual(first)
  expect(first.body.amount.value).toBe('123.45')
  expect(first.body).not.toHaveProperty('save_payment_method')
  expect(first.headers).not.toHaveProperty('Authorization')
})
it.each([23 * 3600000, 24 * 3600000, -1])('вне безопасного окна %i не создаёт платёж заново', age => {
  expect(() => buildSandboxPaymentRequest(order, now + age)).toThrow('payment_reconciliation_required')
})
it.each([{ environment: 'production' }, { amountMinor: 1.1 }, { amountMinor: 0 }, { currency: 'USD' }])('отклоняет недопустимый заказ %j', change => {
  expect(() => buildSandboxPaymentRequest({ ...order, ...change }, now)).toThrow('invalid_sandbox_order')
})
it.each([false, undefined])('отклоняет ответ без test=true: %s', test => {
  expect(() => validateSandboxPayment({ ...payment(), test }, order)).toThrow('non_test_payment')
})
it.each([{ recipient: { account_id: 'another' } }, { amount: { value: '1.00', currency: 'RUB' } }, { metadata: {} }, { status: 'succeeded', paid: false }])('сверяет магазин, сумму, область и статус %j', change => {
  expect(() => validateSandboxPayment({ ...payment(), ...change }, order)).toThrow('payment_order_mismatch')
})
it('не принимает другой платёж вместо сохранённого', () => {
  expect(() => validateSandboxPayment(payment(), { ...order, providerPaymentId: order.id })).toThrow('payment_order_mismatch')
})
it('не пропускает посторонний redirect и не возвращает персональные данные', () => {
  expect(() => validateSandboxPayment({ ...payment(), confirmation: { type: 'redirect', confirmation_url: 'https://evil.example/' } }, order)).toThrow('invalid_payment_url')
  const result = validateSandboxPayment({ ...payment(), payment_method: { card: { last4: '0000' } } }, order)
  expect(result).not.toHaveProperty('payment_method')
  expect(result.test).toBe(true)
})
it('сохраняет только идентификатор подтверждённого способа оплаты для сервера', () => {
  const result = validateSandboxPayment({ ...payment(), status: 'succeeded', paid: true, payment_method: { id: 'test-method-1', saved: true, card: { last4: '0000' }, title: 'Private details' } }, order)
  expect(result.savedMethodId).toBe('test-method-1')
  expect(result).not.toHaveProperty('payment_method')
  expect(JSON.stringify(result)).not.toContain('Private details')
  expect(JSON.stringify(result)).not.toContain('last4')
})
it.each([
  { saved: false, id: 'method' }, { saved: 'true', id: 'method' },
  { saved: true, id: '' }, { saved: true, id: '../method' }, { saved: true, id: 'x'.repeat(257) },
])('не привязывает непроверенный способ оплаты %j', method => {
  expect(validateSandboxPayment({ ...payment(), status: 'succeeded', paid: true, payment_method: method }, order)).not.toHaveProperty('savedMethodId')
})
it('ожидающий платёж не подтверждает сохранение метода', () => {
  expect(validateSandboxPayment({ ...payment(), payment_method: { saved: true, id: 'method' } }, order)).not.toHaveProperty('savedMethodId')
})
it('явное серверное разрешение включает сохранение; строка вместо boolean не принимается', () => {
  expect(buildSandboxPaymentRequest({ ...order, savePaymentMethod: true }, now).body.save_payment_method).toBe(true)
  expect(buildSandboxPaymentRequest({ ...order, savePaymentMethod: 'true' }, now).body).not.toHaveProperty('save_payment_method')
})
