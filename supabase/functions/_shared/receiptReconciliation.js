import { ReceiptDataError } from './subscriptionReceipt.js'
// provider is configured with createReceiptPaymentTransport. GET only: receipt
// uncertainty never warrants creating a second payment or changing access.
export async function reconcileReceiptPayments({ rpc, provider, limit = 25, shopId = null, recurring = false, refund = false }) {
  const { data, error } = await rpc(refund ? 'list_pending_refund_receipts' : recurring ? 'list_pending_recurring_receipts' : 'list_pending_sandbox_receipts', { p_limit: limit, p_shop_id: shopId })
  if (error || !Array.isArray(data) || data.length > limit) throw new ReceiptDataError('receipt_storage_unavailable')
  let checked = 0, failed = 0
  for (const order of data) {
    let succeeded = false
    try { if (refund) await provider.readRefund(order); else await provider.readPayment(order); succeeded = true }
    catch { /* Persist only the outcome, never provider error text or contacts. */ }
    const recorded = await rpc('record_receipt_poll', { p_kind: refund ? 'refund' : recurring ? 'renewal' : 'payment',
      p_operation_id: refund ? order.refund.id : order.id, p_succeeded: succeeded })
    if (recorded.error) throw new ReceiptDataError('receipt_storage_unavailable')
    if (succeeded) checked++; else failed++
  }
  return { checked, failed }
}
