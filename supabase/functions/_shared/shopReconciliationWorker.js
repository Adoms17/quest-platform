import { reconcileShopPayment } from './shopPaymentAdapter.js'
import { consumeShopOrders } from './shopOrderConsumer.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
class ShopWorkerError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new ShopWorkerError(code) }
function validateOptions(options) {
  const c = options.config
  if (typeof options.rpc !== 'function' || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5
    || !Number.isFinite(options.rpcTimeoutMs) || options.rpcTimeoutMs < 1 || options.rpcTimeoutMs > 15000
    || !Number.isFinite(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 120000
    || !c || c.enabled !== true || c.approved !== true || typeof c.merchant !== 'string' || !/^\d+$/.test(c.merchant)
    || !['sandbox', 'production'].includes(c.environment) || typeof c.secretKey !== 'string' || !/^[\x21-\x7e]+$/.test(c.secretKey)) fail('configuration_unavailable')
  let origin
  try { origin = new URL(c.returnOrigin) } catch { fail('configuration_unavailable') }
  if (origin.protocol !== 'https:' || origin.origin !== c.returnOrigin || origin.username || origin.password
    || (options.testOnlyTransport === true && (typeof options.fetchImpl !== 'function' || options.fetchImpl === globalThis.fetch))) fail('configuration_unavailable')
}
function boundedRpc(rpc, { rpcTimeoutMs, deadline }) {
  return async (name, args) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) fail('run_deadline_exceeded')
    const controller = new AbortController()
    let timer
    try {
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ShopWorkerError('rpc_timeout')) }, Math.min(rpcTimeoutMs, remaining))
      })
      let query = rpc(name, args)
      if (typeof query?.abortSignal === 'function') query = query.abortSignal(controller.signal)
      // An uncertain write may still commit. Database idempotency and fenced
      // finish, rather than cancellation, provide correctness on the next run.
      return await Promise.race([query, timeout])
    } finally { clearTimeout(timer) }
  }
}
function category(error) {
  if (error?.code === 'provider_read_failed') return 'provider_unavailable'
  if (['payment_mismatch', 'contract_unavailable', 'receipt_unavailable', 'request_mismatch', 'invalid_confirmation_url', 'claim_binding_mismatch'].includes(error?.code)) return 'verification_failed'
  return 'storage_failure'
}

// The database owns claim leases, retry timing and attention states. This host
// only GETs a saved payment ID; it never creates or retries checkout POSTs.
export async function runShopReconciliationWorker({ enabled = false, limit = 5, rpcTimeoutMs = 15000, deadlineMs = 120000, ...rest } = {}) {
  const result = { enabled: enabled === true, claimed: 0, reconciled: 0, confirmed: 0, pending: 0,
    missingPaymentId: 0, failed: 0, leaseLost: 0, consumerFailures: 0, fulfillmentFailures: 0, finishFailures: 0, deferred: 0 }
  if (enabled !== true) return result
  const options = { ...rest, limit, rpcTimeoutMs, deadlineMs }
  validateOptions(options)
  const deadline = Date.now() + deadlineMs
  options.rpc = boundedRpc(options.rpc, { rpcTimeoutMs, deadline })
  const consume = async () => {
    try {
      const consumed = await consumeShopOrders(options.rpc, { limit, rounds: 3 })
      if (!Number.isInteger(consumed.facts) || consumed.facts < 0 || !Array.isArray(consumed.stages)
        || consumed.stages.some(stage => !Number.isInteger(stage?.advanced) || stage.advanced < 0
          || !Number.isInteger(stage?.failed) || stage.failed < 0)) fail('consumer_response_invalid')
      const failures = consumed.stages.reduce((sum, stage) => sum + stage.failed, 0)
      result.fulfillmentFailures += failures
      return failures === 0
    }
    catch { result.consumerFailures++; return false }
  }
  await consume()
  try {
  const claimed = await options.rpc('claim_shop_payment_reconciliation', {
    p_merchant: options.config.merchant, p_environment: options.config.environment,
    p_test_only: options.testOnlyTransport === true, p_limit: limit,
  })
  if (claimed?.error || !Array.isArray(claimed?.data) || claimed.data.length > limit) fail('claim_response_invalid')
  const seen = new Set()
  for (const job of claimed.data) {
    if (!job || !UUID.test(job.orderId ?? '') || !UUID.test(job.attemptId ?? '') || !UUID.test(job.leaseToken ?? '')
      || !(job.paymentId === null || UUID.test(job.paymentId ?? '')) || seen.has(job.attemptId)) fail('claim_response_invalid')
    seen.add(job.attemptId)
  }
  result.claimed = claimed.data.length
  for (const job of claimed.data) {
    if (Date.now() >= deadline) { result.deferred++; continue }
    let error = null
    if (job.paymentId === null) { error = 'missing_payment_id'; result.missingPaymentId++ }
    else {
      try {
        // Fence the context used by the adapter to the exact claimed binding.
        const scopedRpc = async (name, args) => {
          const response = await options.rpc(name, args)
          if (name === 'read_shop_payment_context' && !response?.error
            && (response?.data?.attempt?.id !== job.attemptId || response?.data?.attempt?.provider_payment_id !== job.paymentId)) fail('claim_binding_mismatch')
          return response
        }
        const state = await reconcileShopPayment(job.orderId, { ...options, rpc: scopedRpc,
          get timeoutMs() {
            const remaining = deadline - Date.now()
            if (remaining <= 0) fail('run_deadline_exceeded')
            return Math.min(15000, remaining)
          } })
        if (state?.orderId !== job.orderId || !['confirmed', 'pending'].includes(state.status)) fail('storage_response_invalid')
        result.reconciled++; result[state.status]++
      } catch (cause) { error = category(cause) }
    }
    // Facts may have committed before an RPC response was lost. Always attempt
    // delivery, even when verification or provider reading failed this time.
    if (!await consume() && !error) error = 'storage_failure'
    if (error && error !== 'missing_payment_id') result.failed++
    try {
      const finished = await options.rpc('finish_shop_payment_reconciliation', {
        p_attempt_id: job.attemptId, p_lease_token: job.leaseToken, p_error: error,
      })
      if (finished?.error || typeof finished?.data !== 'boolean') result.finishFailures++
      else if (!finished.data) result.leaseLost++
    } catch { result.finishFailures++ }
  }
  return result
  } finally { await consume() }
}
