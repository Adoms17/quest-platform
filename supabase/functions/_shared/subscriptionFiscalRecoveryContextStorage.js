// Unwired R-only adapter. Candidate SQL has NOT been applied or DB-validated.
// identity comes from server Auth; no token or client-supplied claims are accepted here.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = /^[0-9a-f]{64}$/
const fields = ['environmentPin', 'commandId', 'evidenceId', 'dispatchId', 'organizationId', 'orderId', 'internalRefundId', 'paymentId', 'shopId', 'kind', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt', 'snapshotDigest', 'evidence']
const evidenceFields = ['id', 'commandId', 'dispatchId', 'providerRefundId', 'shopId', 'paymentId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt', 'state', 'source']
const deny = () => { throw Error('recovery_context_unavailable') }
const id = value => typeof value === 'string' && uuid.test(value)
const exact = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
function fresh(identity, now) {
  const epoch = Math.floor(now() / 1000)
  if (!Number.isSafeInteger(epoch) || !id(identity?.actorId) || identity.aal !== 'aal2'
    || !Number.isSafeInteger(identity.mfaAt) || !Number.isSafeInteger(identity.expiresAt)
    || identity.mfaAt > epoch || identity.mfaAt <= epoch - 300 || identity.expiresAt <= epoch) deny()
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return Object.freeze(value)
}
export function createSubscriptionFiscalRecoveryContextStorage({ rpc, shopId, now = Date.now }) {
  if (typeof rpc !== 'function' || typeof now !== 'function' || typeof shopId !== 'string' || !/^\d{1,32}$/.test(shopId)) deny()
  return async request => {
    try {
      if (!exact(request, ['identity', 'commandId', 'evidenceId'])) deny()
      const { identity, commandId, evidenceId } = structuredClone(request)
      fresh(identity, now)
      if (!id(commandId) || !id(evidenceId)) deny()
      const { data, error } = await rpc('subscription_fiscal_refund_from_gateway', {
        p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt, p_expires_at: identity.expiresAt,
        p_shop_id: shopId, p_action: 'read_recovery_context', p_command_id: commandId,
        p_result: { evidenceId },
      })
      fresh(identity, now) // Also deny expiry during transport/DB lock waits.
      if (error || !exact(data, fields)) deny()
      const c = structuredClone(data), e = c.evidence
      if (c.commandId !== commandId || c.evidenceId !== evidenceId || c.shopId !== shopId
        || !exact(c.environmentPin, ['environment', 'verified']) || c.environmentPin.environment !== 'sandbox' || c.environmentPin.verified !== true
        || c.kind !== 'refund_before' || c.currency !== 'RUB' || !exact(e, evidenceFields)
        || e.id !== evidenceId || e.source !== 'synthetic_owner_fixture' || e.state !== 'succeeded' || !id(e.providerRefundId)) deny()
      for (const field of ['dispatchId', 'organizationId', 'orderId', 'internalRefundId', 'paymentId']) if (!id(c[field])) deny()
      if (c.dispatchId !== c.internalRefundId) deny() // Real dispatch PK is refund_id.
      for (const field of ['bodySha256', 'keyDigest', 'snapshotDigest']) if (typeof c[field] !== 'string' || !hash.test(c[field])) deny()
      if (!Number.isSafeInteger(c.amountMinor) || c.amountMinor <= 0 || !Number.isSafeInteger(c.paymentAmountMinor) || c.paymentAmountMinor < c.amountMinor) deny()
      if (typeof c.firstSentAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.firstSentAt)
        || !Number.isFinite(Date.parse(c.firstSentAt))) deny()
      for (const field of ['commandId', 'dispatchId', 'paymentId', 'shopId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt']) if (e[field] !== c[field]) deny()
      return freeze(c) // Preserve DB timestamp bytes, including microseconds. No Date reserialization.
    } catch { deny() } // No SQLERRM/foreign IDs/raw response details reach the caller.
  }
}
