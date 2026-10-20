import { buildSubscriptionReceipt, ReceiptDataError } from './subscriptionReceipt.js'

// Server-only preparation of a full prepayment settlement. The caller must load
// both arguments from trusted storage/provider verification, never browser input.
// This does not select the fiscal settlement date or send a provider request.
export function buildPrepaymentSettlement(snapshot, payment) {
  const receipt = buildSubscriptionReceipt(snapshot)
  const fail = () => { throw new ReceiptDataError('prepayment_settlement_unavailable') }
  if (snapshot.paymentMode !== 'full_prepayment' || !payment
    || typeof payment.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payment.id)
    || payment.status !== 'succeeded' || payment.receiptRegistration !== 'succeeded'
    || payment.amountMinor !== snapshot.amountMinor || payment.currency !== snapshot.currency
    || payment.refundedAmountMinor !== 0 || payment.reservedRefundAmountMinor !== 0) fail()
  const amount = { ...receipt.items[0].amount }
  return {
    type: 'payment', payment_id: payment.id, send: true,
    customer: receipt.customer,
    items: receipt.items.map(item => ({ ...item, payment_mode: 'full_payment' })),
    settlements: [{ type: 'prepayment', amount }],
  }
}
