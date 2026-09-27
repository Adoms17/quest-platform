import { ReceiptDataError } from './subscriptionReceipt.js'

// Provider methods must validate shop, payment binding and exact receipt lines.
// A claim is consumed before HTTP; an uncertain result never creates again.
export async function runPrepaymentSettlement({ orderId, rpc, provider }) {
  const claimed = await rpc('claim_prepayment_settlement', { p_order_id: orderId })
  if (claimed.error || !claimed.data) throw new ReceiptDataError('settlement_storage_unavailable')
  const operation = claimed.data
  let result
  if (operation.action === 'send') {
    if (!operation.body || !operation.key || !operation.firstSentAt) throw new ReceiptDataError('invalid_settlement_claim')
    result = await provider.createSettlement(operation)
  } else if (operation.action === 'reconcile') {
    if (operation.requiresReview) return { state: 'review_required' }
    result = operation.receiptId
      ? await provider.readSettlement({ ...operation, orderId })
      : await provider.findSettlement({ ...operation, orderId })
    if (!result) return { state: 'review_required' }
  } else throw new ReceiptDataError('invalid_settlement_claim')
  if (!result || typeof result.id !== 'string' || !/^rt-[a-zA-Z0-9-]{1,100}$/.test(result.id)
    || !['pending', 'succeeded', 'canceled'].includes(result.status)
    || (operation.receiptId && result.id !== operation.receiptId)) throw new ReceiptDataError('invalid_settlement_result')
  const saved = await rpc('record_prepayment_settlement', {
    p_order_id: orderId, p_receipt_id: result.id, p_status: result.status,
  })
  if (saved.error) throw new ReceiptDataError('settlement_storage_unavailable')
  return { state: result.status }
}
