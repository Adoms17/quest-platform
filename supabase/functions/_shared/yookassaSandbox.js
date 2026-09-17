// Только серверный контракт sandbox. Вызывающий слой обязан загрузить неизменяемый
// заказ из БД, проверить billing.manage и сохранить firstSentAt ДО первого POST.
// Этот модуль не выполняет HTTP, не принимает секреты и не активирует подписку.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
export class SandboxPaymentError extends Error {
  constructor(code) { super(code); this.name = 'SandboxPaymentError'; this.code = code }
}
function fail(code) { throw new SandboxPaymentError(code) }
export function validateOrder(order) {
  if (!order || order.environment !== 'sandbox' || !uuid.test(order.id) || !uuid.test(order.organizationId)
    || !uuid.test(order.planVersionId) || !uuid.test(order.idempotencyKey)
    || !Number.isSafeInteger(order.amountMinor) || order.amountMinor <= 0
    || order.currency !== 'RUB' || !/^\d+$/.test(order.shopId)
    || !validDate(order.firstSentAt)) fail('invalid_sandbox_order')
}
function amount(order) { return `${Math.floor(order.amountMinor / 100)}.${String(order.amountMinor % 100).padStart(2, '0')}` }
function secureUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('invalid_payment_url') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) fail('invalid_payment_url')
  return url
}
export function buildSandboxPaymentRequest(order, now = Date.now()) {
  validateOrder(order)
  const age = now - Date.parse(order.firstSentAt)
  // Час запаса к 24-часовой гарантии провайдера; позже только сверка, не новый POST.
  if (!Number.isFinite(now) || age < 0 || age >= 23 * 3600000) fail('payment_reconciliation_required')
  secureUrl(order.returnUrl)
  return {
    method: 'POST', url: 'https://api.yookassa.ru/v3/payments',
    headers: { 'Content-Type': 'application/json', 'Idempotence-Key': order.idempotencyKey },
    body: {
      amount: { value: amount(order), currency: order.currency }, capture: true,
      confirmation: { type: 'redirect', return_url: order.returnUrl },
      description: `Квеста: тестовый заказ ${order.id}`,
      metadata: { order_id: order.id, organization_id: order.organizationId, plan_version_id: order.planVersionId, environment: 'sandbox' },
    },
  }
}
// Передавать только объект из аутентифицированного ответа API ЮKassa, не redirect
// и не непроверенный webhook. Отсутствие test=true никогда не считается sandbox.
export function validateSandboxPayment(payment, order) {
  validateOrder(order)
  if (!payment || payment.test !== true) fail('non_test_payment')
  if (!uuid.test(payment.id) || (order.providerPaymentId && payment.id !== order.providerPaymentId)
    || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(payment.status)
    || typeof payment.paid !== 'boolean' || (payment.status === 'succeeded' && !payment.paid)
    || payment.recipient?.account_id !== order.shopId
    || payment.amount?.value !== amount(order) || payment.amount?.currency !== order.currency
    || payment.metadata?.order_id !== order.id || payment.metadata?.organization_id !== order.organizationId
    || payment.metadata?.plan_version_id !== order.planVersionId || payment.metadata?.environment !== 'sandbox') fail('payment_order_mismatch')
  let confirmationUrl = null
  if (payment.confirmation) {
    if (payment.confirmation.type !== 'redirect') fail('invalid_payment_url')
    const url = secureUrl(payment.confirmation.confirmation_url)
    if (!['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)) fail('invalid_payment_url')
    confirmationUrl = url.href
  }
  // Возвращаем только необходимое, без сырых платёжных реквизитов и контактов.
  return { paymentId: payment.id, status: payment.status, paid: payment.paid, test: true, confirmationUrl }
}
