import { createReceiptPaymentTransport } from './receiptPaymentTransport.js'
import { SandboxPaymentError } from './yookassaSandbox.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { runSandboxRecurring } from './sandboxRecurring.js'

// rpc принадлежит только серверному service_role-клиенту.
export function createSandboxRecurringWorker({ rpc, config, transport = {}, receiptsRequired = false }) {
  async function command(id, action, extra = {}) {
    const { data, error } = await rpc('sandbox_recurring_worker_command', { p_order_id: id, p_action: action, ...extra })
    if (error || data == null) throw new SandboxPaymentError('recurring_database_unavailable')
    return data
  }
  const repository = {
    applyPeriod: id => command(id, 'apply'),
    beginAttempt: id => command(id, 'begin'),
    readAttempt: id => command(id, 'read'),
    recordResult: (id, payment) => command(id, 'record', { p_payment: {
      paymentId: payment.paymentId, status: payment.status, paid: payment.paid, test: payment.test,
    } }),
  }
  const providerFor = receipts => createSandboxHttpClient(config, { ...transport, receipts,
    // Не допускаем подмены guard настройками транспорта. Отказ/потеря ответа
    // RPC запрещает POST, даже если транзакция фактически успела завершиться.
    beforeRecurringSend: async order => (await command(order.id, 'claim', { p_key: order.idempotencyKey })).authorized === true,
  })
  return { run: async id => {
    // Prepare before begin: a missing contact must not consume a dispatch attempt.
    let { data, error } = await rpc('read_recurring_receipt_snapshot_internal', { p_order_id: id })
    if (!error && data == null && receiptsRequired) {
      const existing = await rpc('sandbox_recurring_worker_command', { p_order_id: id, p_action: 'read' })
      if (existing.error) throw new SandboxPaymentError('receipt_storage_unavailable')
      if (!existing.data) {
        ({ data, error } = await rpc('prepare_recurring_receipt', { p_order_id: id }))
        if (data == null) throw new SandboxPaymentError('receipt_snapshot_unavailable')
      }
    }
    if (error || (data != null && data.state !== 'zero_amount' && data.order_id !== id)) throw new SandboxPaymentError('receipt_storage_unavailable')
    const receipts = data?.order_id === id ? createReceiptPaymentTransport(rpc, { recurring: true }) : undefined
    return runSandboxRecurring(id, { repository, provider: providerFor(receipts) })
  } }
}
