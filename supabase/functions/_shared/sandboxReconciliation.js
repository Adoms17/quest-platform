const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createSandboxReconciler({ rpc, provider, shopId }) {
  async function call(name, args) {
    const { data, error } = await rpc(name, args)
    if (error) {
      // Только машинный код: без тела запроса, ответов провайдера и персональных данных.
      console.error('sandbox_rpc_failed', name, /^[A-Z0-9]{5,12}$/.test(error.code ?? '') ? error.code : 'unknown')
      throw new Error('sandbox_storage_unavailable')
    }
    return data
  }
  async function apply(order, payment, eventType) {
    const eventId = await call('enqueue_sandbox_payment_event', { p_shop_id: shopId, p_order_id: order.id, p_payment_id: payment.paymentId, p_event_type: eventType })
    return call('apply_sandbox_payment_event', { p_event_id: eventId, p_payment: payment })
  }
  return {
    async webhook(notification) {
      const paymentId = notification.object.id
      const hint = notification.object.metadata?.order_id
      const order = await call('read_sandbox_reconciliation_order', { p_shop_id: shopId, p_order_id: uuid.test(hint) ? hint : null, p_payment_id: paymentId })
      if (!order) return // Не раскрывать наличие заказов и не обращаться к API по случайным ID.
      const payment = await provider.readPayment({ ...order, providerPaymentId: paymentId })
      // Никакие status/paid/amount из тела уведомления не передаются в БД.
      await apply(order, payment, notification.event)
    },
    async order(orderId) {
      if (!uuid.test(orderId ?? '')) throw new Error('invalid_order_id')
      const order = await call('read_sandbox_reconciliation_order', { p_shop_id: shopId, p_order_id: orderId, p_payment_id: null })
      if (!order || order.id !== orderId) throw new Error('order_unavailable')
      const payment = await provider.findPayment(order)
      if (!payment) throw new Error('payment_not_found')
      const result = await apply(order, payment, 'reconciliation')
      if (!['applied', 'review', 'deferred', 'not_paid'].includes(result.fulfillmentState)) throw new Error('invalid_fulfillment_state')
      return { checked: 1, state: result.fulfillmentState }
    },
    async batch() {
      const ids = await call('claim_sandbox_reconciliation', { p_shop_id: shopId, p_limit: 5 })
      const summary = { checked: 0, applied: 0, review: 0, deferred: 0, failed: 0 }
      for (const { orderId: id, leaseToken } of ids) {
        let reason = null
        let phase = 'storage'
        try {
          const order = await call('read_sandbox_reconciliation_order', { p_shop_id: shopId, p_order_id: id, p_payment_id: null })
          if (!order) throw new Error('missing_order')
          phase = 'provider'
          const payment = await provider.findPayment(order)
          if (!payment) { reason = 'payment_not_found'; summary.failed++ }
          else {
            phase = 'storage'
            const result = await apply(order, payment, 'reconciliation')
            if (['applied', 'review', 'deferred'].includes(result.fulfillmentState)) summary[result.fulfillmentState]++
          }
        } catch (failure) {
          const verificationErrors = ['payment_order_mismatch', 'sandbox_shop_mismatch', 'verification_failed']
          const category = phase === 'storage' ? 'storage_failure' : verificationErrors.includes(failure?.message) ? 'payment_verification_failed' : 'provider_unavailable'
          // Fixed machine codes only; never log provider payloads or raw exceptions.
          console.error('sandbox_reconciliation_failed', category)
          reason = category === 'provider_unavailable' ? 'provider_unavailable' : 'verification_failed'
          summary.failed++
        }
        await call('finish_sandbox_reconciliation', { p_order_id: id, p_lease_token: leaseToken, p_error: reason })
        summary.checked++
      }
      return summary
    },
  }
}

export function createSandboxWebhookHandler({ enabled = false, reconcile }) {
  return async request => {
    if (!enabled) return new Response(null, { status: 503 })
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    let body
    try {
      const reader = request.body?.getReader()
      if (!reader) return new Response(null, { status: 400 })
      const parts = []; let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 32768) { await reader.cancel(); return new Response(null, { status: 413 }) }
        parts.push(value)
      }
      const data = new Uint8Array(size); let offset = 0
      for (const part of parts) { data.set(part, offset); offset += part.byteLength }
      body = JSON.parse(new TextDecoder().decode(data))
    } catch { return new Response(null, { status: 400 }) }
    if (body?.type !== 'notification' || !['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture', 'refund.succeeded'].includes(body.event) || !uuid.test(body.object?.id)) return new Response(null, { status: 400 })
    try { await reconcile(body); return new Response(null, { status: 200 }) }
    catch (error) {
      const safeCodes = ['sandbox_storage_unavailable', 'provider_read_failed', 'provider_unavailable', 'payment_order_mismatch', 'sandbox_shop_mismatch', 'sandbox_disabled']
      console.error('sandbox_webhook_failed', safeCodes.includes(error?.message) ? error.message : 'verification_failed')
      return new Response(null, { status: 503 })
    }
  }
}
