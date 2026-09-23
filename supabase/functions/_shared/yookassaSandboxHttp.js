import { buildSandboxPaymentRequest, buildSandboxRecurringRequest, validateSandboxPayment, validateOrder, SandboxPaymentError } from './yookassaSandbox.js'

// Только для серверного вызывающего слоя с заказом, загруженным из БД.
// Ответ нужно сохранить до передачи confirmationUrl клиенту. Здесь нет выдачи прав.
export function createSandboxHttpClient({ enabled = false, shopId, secretKey }, { fetchImpl = fetch, now = Date.now, timeoutMs = 15000, beforeRefundSend, beforeRecurringSend } = {}) {
  if (enabled !== true || typeof shopId !== 'string' || !/^\d+$/.test(shopId)
    || typeof secretKey !== 'string' || !/^[\x21-\x7e]+$/.test(secretKey)
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new SandboxPaymentError('sandbox_configuration_unavailable')
  const authorization = `Basic ${btoa(`${shopId}:${secretKey}`)}`
  async function request(path, method = 'GET', body, headers = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`https://api.yookassa.ru/v3/${path}`, {
        method, headers: { ...headers, Authorization: authorization },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: controller.signal,
      })
      if (!response.ok) {
        console.error('sandbox_provider_http', response.status)
        if (path === 'refunds') {
          const error = await response.json().catch(() => null)
          const code = ['invalid_request', 'forbidden', 'not_found', 'too_many_requests', 'internal_server_error'].includes(error?.code) ? error.code : 'unknown'
          const parameter = ['amount', 'amount.value', 'payment_id', 'receipt'].includes(error?.parameter) ? error.parameter : 'other'
          console.error('sandbox_refund_rejected', code, parameter)
          if (response.status === 400 && code === 'invalid_request') throw new SandboxPaymentError('refund_request_rejected')
        }
        throw new SandboxPaymentError(method === 'POST' ? 'payment_outcome_unknown' : 'provider_read_failed')
      }
      return await response.json()
    } catch (error) {
      if (error?.code === 'refund_request_rejected') throw error
      if (!(error instanceof SandboxPaymentError)) {
        const detail = String(error?.message ?? '')
        const category = /UnknownIssuer|unknown issuer/i.test(detail) ? 'tls_unknown_issuer' : /expired/i.test(detail) ? 'tls_expired' : /cert|tls/i.test(detail) ? 'tls' : /dns|resolve/i.test(detail) ? 'dns' : /connect/i.test(detail) ? 'connection' : /abort|timeout/i.test(detail) ? 'timeout' : 'network_error'
        console.error('sandbox_provider_transport', category)
      }
      // Не пробрасываем тело ответа, заголовки, URL или исходную ошибку fetch.
      throw new SandboxPaymentError(method === 'POST' ? 'payment_outcome_unknown' : 'provider_read_failed')
    } finally { clearTimeout(timer) }
  }
  async function verifyShop() {
    const info = await request('me')
    if (info?.account_id !== shopId || info.test !== true || info.status !== 'enabled') throw new SandboxPaymentError('sandbox_shop_unverified')
  }
  function snapshot(order) {
    const saved = structuredClone(order)
    validateOrder(saved)
    if (saved.shopId !== shopId) throw new SandboxPaymentError('payment_order_mismatch')
    return saved
  }
  function refundSnapshot(value) {
    const saved = structuredClone(value), r = saved?.refund
    snapshot(saved?.order)
    if (!r || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id) || r.order_id !== saved.order.id || r.payment_id !== saved.order.providerPaymentId
      || !Number.isSafeInteger(r.amount_minor) || r.amount_minor <= 0 || r.amount_minor > saved.order.amountMinor) throw new SandboxPaymentError('invalid_refund')
    return saved
  }
  function validateRefund(data, saved) {
    const r = saved.refund
    const amount = `${Math.floor(r.amount_minor / 100)}.${String(r.amount_minor % 100).padStart(2, '0')}`
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data?.id)
      || (r.provider_refund_id && data.id !== r.provider_refund_id) || data.payment_id !== r.payment_id
      || data.amount?.value !== amount || data.amount?.currency !== 'RUB'
      || !['pending', 'succeeded', 'canceled'].includes(data.status)) throw new SandboxPaymentError('refund_mismatch')
    return { refundId: data.id, status: data.status }
  }
  return {
    verifyShop,
    async createRefund(value) {
      const saved = refundSnapshot(value), r = saved.refund
      if (r.provider_refund_id) throw new SandboxPaymentError('refund_already_identified')
      const payment = await this.readPayment(saved.order)
      if (payment.status !== 'succeeded' || !payment.paid) throw new SandboxPaymentError('payment_not_refundable')
      if (beforeRefundSend) await beforeRefundSend(structuredClone(saved))
      const age = now() - Date.parse(r.first_sent_at)
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600000) throw new SandboxPaymentError('refund_reconciliation_required')
      const body = { payment_id: r.payment_id, amount: { value: `${Math.floor(r.amount_minor / 100)}.${String(r.amount_minor % 100).padStart(2, '0')}`, currency: 'RUB' } }
      return validateRefund(await request('refunds', 'POST', body, { 'Idempotence-Key': r.id, 'Content-Type': 'application/json' }), saved)
    },
    async readRefund(value) {
      const saved = refundSnapshot(value), r = saved.refund
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.provider_refund_id)) throw new SandboxPaymentError('invalid_refund')
      const payment = await this.readPayment(saved.order)
      if (payment.status !== 'succeeded' || !payment.paid) throw new SandboxPaymentError('payment_not_refundable')
      return validateRefund(await request(`refunds/${r.provider_refund_id}`), saved)
    },
    async findPayment(order) {
      const saved = snapshot(order)
      if (saved.providerPaymentId) return this.readPayment(saved)
      await verifyShop()
      const start = Date.parse(saved.firstSentAt)
      const params = new URLSearchParams({ limit: '100', 'created_at.gte': new Date(start - 60000).toISOString(), 'created_at.lte': new Date(start + 24 * 3600000).toISOString() })
      let match = null
      const cursors = new Set()
      for (let page = 0; page < 10; page++) {
        const data = await request(`payments?${params}`)
        if (!Array.isArray(data?.items)) throw new SandboxPaymentError('provider_read_failed')
        for (const payment of data.items) {
          if (payment.metadata?.order_id !== saved.id) continue
          const verified = validateSandboxPayment(payment, saved)
          if (match && match.paymentId !== verified.paymentId) throw new SandboxPaymentError('payment_order_mismatch')
          match = verified
        }
        if (!data.next_cursor) return match
        if (typeof data.next_cursor !== 'string' || data.next_cursor.length > 200 || cursors.has(data.next_cursor)) throw new SandboxPaymentError('provider_read_failed')
        cursors.add(data.next_cursor); params.set('cursor', data.next_cursor)
      }
      // Не применяем частичный результат: на следующей странице может быть конфликт.
      throw new SandboxPaymentError('payment_reconciliation_required')
    },
    async createRecurringPayment(order) {
      const saved = snapshot(order)
      if (saved.providerPaymentId) throw new SandboxPaymentError('payment_already_identified')
      if (typeof beforeRecurringSend !== 'function') throw new SandboxPaymentError('recurring_send_not_authorized')
      buildSandboxRecurringRequest(saved, now())
      await verifyShop()
      // Серверный guard обязан проверить согласие и зафиксировать решение отправки.
      if (await beforeRecurringSend(structuredClone(saved)) !== true) throw new SandboxPaymentError('recurring_send_not_authorized')
      const prepared = buildSandboxRecurringRequest(saved, now())
      const payment = await request('payments', 'POST', prepared.body, prepared.headers)
      return validateSandboxPayment(payment, saved)
    },
    async createPayment(order) {
      const saved = snapshot(order)
      if (saved.providerPaymentId) throw new SandboxPaymentError('payment_already_identified')
      buildSandboxPaymentRequest(saved, now())
      await verifyShop()
      // Проверка окна повторяется после сетевого ожидания /me.
      const prepared = buildSandboxPaymentRequest(saved, now())
      const payment = await request('payments', 'POST', prepared.body, prepared.headers)
      return validateSandboxPayment(payment, saved)
    },
    async readPayment(order) {
      const saved = snapshot(order)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.providerPaymentId)) throw new SandboxPaymentError('invalid_payment_id')
      await verifyShop()
      return validateSandboxPayment(await request(`payments/${saved.providerPaymentId}`), saved)
    },
  }
}
