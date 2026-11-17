import { ReceiptDataError } from './subscriptionReceipt.js'
// Reconciliation only: deliberately has no claim/create path.
export async function reconcilePrepaymentSettlements({ rpc, provider, shopId, limit = 25 }) {
  const { data, error } = await rpc('list_pending_prepayment_settlements', { p_shop_id: shopId, p_limit: limit })
  if (error || !Array.isArray(data) || data.length > limit) throw new ReceiptDataError('settlement_storage_unavailable')
  // Reject an invalid batch before any provider calls or poll updates.
  if (typeof shopId !== 'string' || !shopId.trim() || data.some(operation =>
    !operation || operation.shopId !== shopId
    || typeof operation.orderId !== 'string' || !operation.orderId.trim())) {
    throw new ReceiptDataError('settlement_provider_mismatch')
  }
  let checked = 0, failed = 0, unresolved = 0
  for (const operation of data) {
    let resolved = false
    try {
      const result = operation.receiptId
        ? await provider.readSettlement(operation)
        : await provider.findSettlement(operation)
      if (!result) { unresolved++ } else {
      if (!/^r[at]-[a-zA-Z0-9-]{1,100}$/.test(result.id)
        || !['pending','succeeded','canceled'].includes(result.status)
        || (operation.receiptId && result.id !== operation.receiptId)) throw new ReceiptDataError('invalid_settlement_result')
      const saved = await rpc('record_prepayment_settlement', { p_order_id: operation.orderId, p_receipt_id: result.id, p_status: result.status })
      if (saved.error) throw new ReceiptDataError('settlement_storage_unavailable')
      checked++
      resolved = true
      }
    } catch { failed++ }
    const recorded = await rpc('record_settlement_poll', { p_order_id: operation?.orderId, p_resolved: resolved })
    if (recorded.error) throw new ReceiptDataError('settlement_storage_unavailable')
  }
  return { checked, failed, unresolved }
}
