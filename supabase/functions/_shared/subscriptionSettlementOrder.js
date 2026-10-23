import { runPrepaymentSettlement } from './prepaymentSettlementFlow.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// No batch discovery: the existing SQL claim locks this exact order and rechecks
// the period boundary, payment receipt and refund exclusions before first send.
export async function runSubscriptionSettlementOrder({ enabled = false, orderId, shopId, rpc, provider }) {
  if (enabled !== true) return { state: 'disabled' }
  if (typeof orderId !== 'string' || !uuid.test(orderId)
    || typeof shopId !== 'string' || !/^[0-9]+$/.test(shopId)) throw Error('invalid_settlement_target')
  const scopedRpc = (name, args) => {
    if (!['claim_prepayment_settlement', 'record_prepayment_settlement'].includes(name)
      || args?.p_order_id !== orderId) throw Error('invalid_settlement_rpc')
    return rpc(name, args)
  }
  const scopedProvider = Object.fromEntries(['createSettlement', 'readSettlement', 'findSettlement'].map(method => [method, operation => {
    if (operation.shopId !== shopId || (operation.orderId !== undefined && operation.orderId !== orderId)) {
      throw Error('settlement_target_mismatch')
    }
    return provider[method](operation)
  }]))
  return runPrepaymentSettlement({ orderId, rpc: scopedRpc, provider: scopedProvider })
}
