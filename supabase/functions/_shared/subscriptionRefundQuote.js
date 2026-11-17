// Pure server-side calculation. Inputs must come from locked, verified DB records,
// not a browser payload. This module neither reserves funds nor changes access.
export const SUBSCRIPTION_REFUND_POLICY = 'subscription-prorata-v1'

export function quoteSubscriptionRefund({ paidMinor, refundedMinor = 0, reservedMinor = 0,
  periodStartMs, periodEndMs, requestedAtMs }) {
  for (const value of [paidMinor, refundedMinor, reservedMinor]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_refund_money')
  }
  for (const value of [periodStartMs, periodEndMs, requestedAtMs]) {
    if (!Number.isSafeInteger(value)) throw new Error('invalid_refund_time')
  }
  if (periodEndMs <= periodStartMs) throw new Error('invalid_refund_period')
  const paid = BigInt(paidMinor)
  const refunded = BigInt(refundedMinor)
  const reserved = BigInt(reservedMinor)
  if (refunded + reserved > paid) throw new Error('invalid_refund_balance')
  const start = BigInt(periodStartMs), end = BigInt(periodEndMs)
  const at = BigInt(requestedAtMs)
  const remaining = at <= start ? end - start : at >= end ? 0n : end - at
  const duration = end - start
  // Nearest kopeck, halves upwards; no floating point money multiplication.
  const entitlement = (paid * remaining * 2n + duration) / (duration * 2n)
  const available = paid - refunded - reserved
  const amount = entitlement < available ? entitlement : available
  // An in-flight refund must settle first, not silently reduce a new quote.
  const reason = reserved > 0n ? 'refund_pending' : paid === 0n ? 'no_payment'
    : available === 0n ? 'fully_refunded' : amount === 0n ? 'no_refundable_time' : null
  return { policy: SUBSCRIPTION_REFUND_POLICY, requestedAtMs,
    entitlementMinor: Number(entitlement), availableMinor: Number(available),
    amountMinor: reason ? 0 : Number(amount), reason }
}
