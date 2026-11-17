import { createSandboxReconciler } from './sandboxReconciliation.js'
import { createReceiptPaymentTransport } from './receiptPaymentTransport.js'

// One explicitly selected order; receipt persistence remains disabled by default.
export function reconcileSandboxOrder({ rpc, createProvider, shopId, orderId, receiptsEnabled = false }) {
  const options = receiptsEnabled === true ? { receipts: createReceiptPaymentTransport(rpc) } : {}
  return createSandboxReconciler({ rpc, provider: createProvider(options), shopId }).order(orderId)
}
