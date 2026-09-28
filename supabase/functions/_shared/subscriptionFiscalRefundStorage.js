// Only the trusted server may construct this adapter after authenticateRefundOwner.
// The HTTP request body supplies neither identity, shop nor provider results.
export function createSubscriptionFiscalRefundStorage({ rpc, identity, shopId, commandId }) {
 const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
 if (typeof rpc !== 'function' || !uuid.test(commandId) || !uuid.test(identity?.actorId)
  || identity.aal !== 'aal2' || !Number.isSafeInteger(identity.mfaAt) || !Number.isSafeInteger(identity.expiresAt)
  || typeof shopId !== 'string' || !/^\d{1,32}$/.test(shopId)) throw new Error('invalid_fiscal_storage_context')
 const context = Object.freeze({ p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt,
  p_expires_at: identity.expiresAt, p_shop_id: shopId, p_command_id: commandId })
 let lastResult = null
 const call = async (action, result = null) => {
  const { data, error } = await rpc('subscription_fiscal_refund_from_gateway', {
   ...context, p_action: action, p_result: result,
  })
  if (error || !data) throw new Error('fiscal_storage_unavailable')
  return data
 }
 const checkCommand = id => { if (id !== commandId) throw new Error('invalid_fiscal_storage_command') }
 return {
  async status() { return call('status') },
  async authorizeSend(operation) {
   checkCommand(operation?.commandId)
   const saved = await call('before_send', { key: operation.key, sha256: operation.sha256, firstSentAt: operation.firstSentAt })
   if (saved.authorized !== true || saved.commandId !== commandId || saved.key !== operation.key || saved.sha256 !== operation.sha256) throw new Error('fiscal_send_denied')
  },
  async claim(id) { checkCommand(id); return call('claim') },
  async record(result) {
   checkCommand(result?.commandId)
   if (result.shopId !== shopId) throw new Error('invalid_fiscal_storage_shop')
   const saved = await call('record', Object.fromEntries([
    'commandId','paymentId','shopId','bodySha256','amountMinor','state','refundId','receiptId','receiptStatus',
   ].map(key => [key, result[key]])))
   if (!['pending','succeeded','canceled','review'].includes(saved.state)
    || !['applied','not_applied','review_required','applied_review_required'].includes(saved.accessState)) {
    throw new Error('fiscal_storage_unconfirmed')
   }
   lastResult = { state: saved.state, receiptStatus: saved.receiptStatus, accessState: saved.accessState }
   return saved.state
  },
  async markReview(id, reason) {
   checkCommand(id)
   if (!['provider_mismatch','unidentified_refund'].includes(reason)) throw new Error('invalid_fiscal_review_reason')
   if ((await call('review', { reason })).state !== 'review') throw new Error('fiscal_storage_unconfirmed')
  },
  result() { return lastResult && { ...lastResult } },
 }
}
