import { ReceiptDataError } from './subscriptionReceipt.js'
import { runPrepaymentSettlement } from './prepaymentSettlementFlow.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Explicit opt-in only. The Edge handler supplies an explicit, default-off rollout flag.
// Discovery is advisory: the existing claim serializes with refunds and consumes
// the first dispatch before HTTP. Retries use reconciliation, never another POST.
export async function processDueSubscriptionSettlements({ enabled = false, rpc, provider, shopId, limit = 25 }) {
  if (enabled !== true) return { state: 'disabled', processed: 0, failed: 0, reviewRequired: 0 }
  if (typeof shopId !== 'string' || !/^[0-9]+$/.test(shopId)
    || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ReceiptDataError('invalid_settlement_batch')
  }
  const { data, error } = await rpc('list_due_subscription_settlements', { p_shop_id: shopId, p_limit: limit })
  if (error || !Array.isArray(data) || data.length > limit) throw new ReceiptDataError('settlement_storage_unavailable')
  const seen = new Set()
  for (const item of data) {
    if (!item || item.shopId !== shopId || typeof item.orderId !== 'string' || !uuid.test(item.orderId)
      || typeof item.dueAt !== 'string' || !Number.isFinite(Date.parse(item.dueAt)) || seen.has(item.orderId.toLowerCase())) {
      throw new ReceiptDataError('settlement_provider_mismatch')
    }
    seen.add(item.orderId.toLowerCase())
  }
  // Check the persisted claim's shop too, not only the discovery response.
  const scopedProvider = Object.fromEntries(['createSettlement', 'readSettlement', 'findSettlement'].map(method => [method,
    operation => {
      if (operation.shopId !== shopId) throw new ReceiptDataError('settlement_provider_mismatch')
      return provider[method](operation)
    },
  ]))
  let processed = 0, failed = 0, reviewRequired = 0
  for (const item of data) {
    try {
      const result = await runPrepaymentSettlement({ orderId: item.orderId, rpc, provider: scopedProvider })
      if (result.state === 'review_required') reviewRequired++
      else processed++ // Includes pending/canceled, not a claim of fiscal success.
    } catch {
      // Do not log provider payloads or contacts. A consumed claim remains in
      // persistent unknown state and is discovered by the reconciliation worker.
      failed++
    }
  }
  return { state: 'processed', processed, failed, reviewRequired }
}
