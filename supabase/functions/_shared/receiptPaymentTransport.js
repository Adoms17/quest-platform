import { receiptFromSnapshot } from './receiptSnapshot.js'
import { ReceiptDataError } from './subscriptionReceipt.js'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
// Server service-role RPC only. Required mode fails closed, including on retries.
export function createReceiptPaymentTransport(rpc, { recurring = false } = {}) {
  async function command(name, args) {
    const { data, error } = await rpc(name, args)
    if (error) throw new ReceiptDataError('receipt_storage_unavailable')
    return data
  }
  return {
    async prepare(order, prepared) {
      const snapshot = await command(recurring ? 'read_recurring_receipt_snapshot_internal' : 'read_sandbox_receipt_snapshot_internal', { p_order_id: order.id })
      const body = { ...prepared.body, receipt: receiptFromSnapshot(snapshot, order) }
      const saved = await command(recurring ? 'save_recurring_receipt_request' : 'save_sandbox_receipt_request', {
        p_order_id: order.id, p_key: prepared.headers['Idempotence-Key'], p_body: body,
      })
      if (!saved || saved.key !== prepared.headers['Idempotence-Key']
        || !/^[a-f0-9]{64}$/.test(saved.sha256) || canonical(saved.body) !== canonical(body)) {
        throw new ReceiptDataError('receipt_request_mismatch')
      }
      return { ...prepared, body: saved.body }
    },
    async record(order, payment, raw) {
      const status = ['pending', 'succeeded', 'canceled'].includes(raw?.receipt_registration) ? raw.receipt_registration : 'unknown'
      await command(recurring ? 'record_recurring_receipt_status' : 'record_sandbox_receipt_status', { p_order_id: order.id, p_payment_id: payment.paymentId, p_status: status })
    },
  }
}
