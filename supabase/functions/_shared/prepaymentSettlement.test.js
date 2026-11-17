// @vitest-environment node
import { expect, it } from 'vitest'
import { buildPrepaymentSettlement } from './prepaymentSettlement.js'
const snapshot = { amountMinor: 12345, currency: 'RUB', email: 'buyer@example.com',
  description: 'Subscription', vatCode: 1, paymentSubject: 'service', paymentMode: 'full_prepayment' }
const payment = { id: '11111111-1111-4111-8111-111111111111', status: 'succeeded',
  receiptRegistration: 'succeeded', amountMinor: 12345, currency: 'RUB',
  refundedAmountMinor: 0, reservedRefundAmountMinor: 0 }
it('settles the exact original prepayment without payment creation fields', () => {
  const result = buildPrepaymentSettlement(Object.freeze(snapshot), Object.freeze(payment))
  expect(result).toEqual({ type: 'payment', payment_id: payment.id, send: true,
    customer: { email: snapshot.email },
    items: [{ description: snapshot.description, quantity: '1.000',
      amount: { value: '123.45', currency: 'RUB' }, vat_code: 1,
      payment_subject: 'service', payment_mode: 'full_payment' }],
    settlements: [{ type: 'prepayment', amount: { value: '123.45', currency: 'RUB' } }] })
  result.items[0].amount.value = '0.00'
  expect(result.settlements[0].amount.value).toBe('123.45')
})
it.each([{ status: 'pending' }, { receiptRegistration: 'pending' },
  { receiptRegistration: 'canceled' }, { receiptRegistration: undefined },
  { amountMinor: 12344 }, { currency: 'USD' }, { refundedAmountMinor: 1 },
  { reservedRefundAmountMinor: 1 }, { refundedAmountMinor: undefined },
  { reservedRefundAmountMinor: undefined }, { id: 'invalid' }])('rejects unsafe settlement %j', change => {
  expect(() => buildPrepaymentSettlement(snapshot, { ...payment, ...change }))
    .toThrow('prepayment_settlement_unavailable')
})
it('does not settle an already full-payment receipt', () => {
  expect(() => buildPrepaymentSettlement({ ...snapshot, paymentMode: 'full_payment' }, payment))
    .toThrow('prepayment_settlement_unavailable')
})
it('preserves kopecks at the safe integer limit', () => {
  const result = buildPrepaymentSettlement({ ...snapshot, amountMinor: Number.MAX_SAFE_INTEGER },
    { ...payment, amountMinor: Number.MAX_SAFE_INTEGER })
  expect(result.settlements[0].amount.value).toBe('90071992547409.91')
})
it('requires explicit fiscal data instead of inferring tax from payment', () => {
  expect(() => buildPrepaymentSettlement({ ...snapshot, vatCode: undefined }, payment))
    .toThrow('invalid_receipt_vat')
})
