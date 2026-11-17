// Synthetic data only; matches the proposed DB projection, not live DB evidence.
export const recoveryContextId = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
export function recoveryContextFixture() {
  const id = recoveryContextId
  const context = {
    environmentPin: { environment: 'sandbox', verified: true },
    commandId: id(1), evidenceId: id(2), dispatchId: id(3), internalRefundId: id(3),
    organizationId: id(4), orderId: id(5), paymentId: id(6), shopId: '123',
    kind: 'refund_before', amountMinor: 2000, paymentAmountMinor: 99000, currency: 'RUB',
    bodySha256: 'a'.repeat(64), keyDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64),
    firstSentAt: '2026-10-08T22:00:00.123456Z',
  }
  context.evidence = { id: context.evidenceId, providerRefundId: id(7), state: 'succeeded', source: 'synthetic_owner_fixture' }
  for (const key of ['commandId', 'dispatchId', 'shopId', 'paymentId', 'amountMinor', 'paymentAmountMinor', 'currency', 'bodySha256', 'keyDigest', 'firstSentAt']) context.evidence[key] = context[key]
  return context
}
