import { createSandboxRefundHandler } from './sandboxRefundHandler.js'
import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'

export function subscriptionRefundRpc(service, identity) {
 return async (action, refundId, result = null) => {
  if (!['read', 'claim', 'recover', 'record', 'reject'].includes(action)) throw new Error('invalid_refund_action')
  const { data, error } = await service.rpc('subscription_refund_from_gateway', {
   p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt, p_expires_at: identity.expiresAt,
   p_action: action, p_refund_id: refundId, p_result: result,
  })
  if (error || !data) throw new Error('refund_storage_unavailable')
  return data
 }
}

export function createSubscriptionRefundEndpoint({ enabled = false, allowedOrigins, auth, service, providerConfig, transport = {} }) {
 return createSandboxRefundHandler({
  enabled, allowedOrigins,
  authenticate: token => authenticateRefundOwner(auth, token),
  authorize: async (identity, id) => (await subscriptionRefundRpc(service, identity)('read', id))?.refund?.id === id,
  formatResult: result => ({ refundId: result.id, state: result.state, environment: 'sandbox', accessEffect: result.accessState }),
  execute: async (identity, id) => {
   const rpc = subscriptionRefundRpc(service, identity)
   let saved = await rpc('read', id)
   if (saved.refund?.id !== id) throw new Error('invalid_refund')
   if (saved.refund.state === 'review') throw new Error('refund_review_required')
   if (saved.refund.state === 'rejected') return { ...saved.refund, accessState: 'not_applied' }
   if (saved.refund.state === 'reserved') {
    await rpc('claim', id)
    saved = await rpc('read', id)
   }
   const recovery = await rpc('recover', id)
   if (!['read_provider', 'retry_same_request'].includes(recovery.action)) throw new Error('refund_review_required')
   const provider = createSandboxHttpClient(providerConfig, {
    ...transport,
    beforeRefundSend: async snapshot => {
     // Runs after the provider GET and before POST; identity/MFA and window are checked again.
     const fresh = await rpc('recover', id)
     if (fresh.action !== 'retry_same_request' || fresh.refund_id !== id || fresh.idempotency_key !== id
      || fresh.payment_id !== snapshot.refund.payment_id || fresh.amount_minor !== snapshot.refund.amount_minor
      || fresh.currency !== 'RUB' || fresh.shop_id !== snapshot.order.shopId
      || !Number.isFinite(Date.parse(fresh.valid_until)) || Date.now() >= Date.parse(fresh.valid_until)) throw new Error('refund_send_denied')
    },
   })
   let verified
   try {
    verified = recovery.action === 'read_provider' ? await provider.readRefund(saved) : await provider.createRefund(saved)
   } catch (error) {
    if (recovery.action !== 'retry_same_request' || error?.code !== 'refund_request_rejected') throw error
    const rejected = await rpc('reject', id)
    if (rejected.state !== 'rejected') throw new Error('refund_rejection_conflict')
    return { ...rejected, accessState: 'not_applied' }
   }
   const recorded = await rpc('record', id, { ...verified, shopId: saved.order.shopId,
    paymentId: saved.refund.payment_id, amountMinor: saved.refund.amount_minor, currency: 'RUB' })
   if (!['applied', 'not_applied', 'review_required', 'applied_review_required'].includes(recorded.access_state)) throw new Error('invalid_refund_result')
   return { ...recorded.refund, accessState: recorded.access_state }
  },
 })
}
