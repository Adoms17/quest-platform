import { buildSubscriptionReceipt, ReceiptDataError } from './subscriptionReceipt.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Both arguments must be loaded server-side. This is not authorization or HTTP.
export function receiptFromSnapshot(snapshot, order) {
  if (!snapshot || !order || order.environment !== 'sandbox'
    || !uuid.test(order.id) || snapshot.order_id !== order.id || !uuid.test(snapshot.policy_id)
    || !Number.isSafeInteger(order.amountMinor) || snapshot.amount_minor !== order.amountMinor
    || snapshot.currency !== order.currency || order.currency !== 'RUB'
    || typeof snapshot.prepared_at !== 'string' || !Number.isFinite(Date.parse(snapshot.prepared_at))) {
    throw new ReceiptDataError('receipt_snapshot_mismatch')
  }
  return buildSubscriptionReceipt({ amountMinor: snapshot.amount_minor, currency: snapshot.currency,
    email: snapshot.email, description: snapshot.description, vatCode: snapshot.vat_code,
    paymentSubject: snapshot.payment_subject, paymentMode: snapshot.payment_mode })
}
