// @vitest-environment node
import { expect, it } from 'vitest'
import { buildSubscriptionReceipt, ReceiptDataError } from './subscriptionReceipt.js'
const input = () => ({ amountMinor: 12345, currency: 'RUB', email: 'buyer@example.com',
  description: 'Квеста: Pro, один месяц', vatCode: 1, paymentSubject: 'service', paymentMode: 'full_prepayment' })
it.each([[1, '0.01'], [99, '0.99'], [100, '1.00'], [12345, '123.45'], [Number.MAX_SAFE_INTEGER, '90071992547409.91']])('preserves exact kopecks %s', (amountMinor, value) => {
  expect(buildSubscriptionReceipt({ ...input(), amountMinor }).items[0].amount).toEqual({ value, currency: 'RUB' })
})
it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null])('rejects invalid or zero amount %s', amountMinor => {
  expect(() => buildSubscriptionReceipt({ ...input(), amountMinor })).toThrow('invalid_receipt_amount')
})
it.each(['email', 'currency', 'description', 'vatCode', 'paymentSubject', 'paymentMode'])('requires explicit %s', field => {
  const data = input(); delete data[field]
  expect(() => buildSubscriptionReceipt(data)).toThrow(ReceiptDataError)
})
it.each(['', 'a', 'a@b', 'a@@example.com', ' a@example.com', 'a@example.com\n', 'a b@example.com', `${'a'.repeat(250)}@example.com`])('rejects malformed email', email => {
  expect(() => buildSubscriptionReceipt({ ...input(), email })).toThrow('invalid_receipt_email')
})
it.each([null, undefined, []])('rejects absent snapshot', data => {
  expect(() => buildSubscriptionReceipt(data)).toThrow('invalid_receipt_data')
})
it.each([0, 13, 1.5, '1', null])('rejects unsupported VAT %s', vatCode => {
  expect(() => buildSubscriptionReceipt({ ...input(), vatCode })).toThrow('invalid_receipt_vat')
})
it('keeps no VAT distinct from zero VAT without inferring either', () => {
  expect(buildSubscriptionReceipt(input()).items[0].vat_code).toBe(1)
  expect(buildSubscriptionReceipt({ ...input(), vatCode: 2 }).items[0].vat_code).toBe(2)
})
it.each([{ currency: 'USD' }, { paymentSubject: 'commodity' }, { paymentMode: 'advance' },
  { description: ' ' }, { description: 'x'.repeat(129) }, { description: 'line\nline' }])('rejects out-of-scope fields %j', change => {
  expect(() => buildSubscriptionReceipt({ ...input(), ...change })).toThrow(ReceiptDataError)
})
it('returns only receipt fields and does not mutate snapshot or share output objects', () => {
  const data = Object.freeze({ ...input(), secret: 'synthetic-ignore', taxSystemCode: 2 })
  const first = buildSubscriptionReceipt(data)
  expect(first).toEqual({ customer: { email: data.email }, items: [{ description: data.description,
    quantity: '1.000', amount: { value: '123.45', currency: 'RUB' }, vat_code: 1,
    payment_subject: 'service', payment_mode: 'full_prepayment' }] })
  first.items[0].amount.value = '0.00'
  expect(buildSubscriptionReceipt(data).items[0].amount.value).toBe('123.45')
})
it('errors never echo input contact', () => {
  try { buildSubscriptionReceipt({ ...input(), email: 'private-invalid-contact' }) }
  catch (error) { expect(error.message).toBe('invalid_receipt_email'); expect(JSON.stringify(error)).not.toContain('private-invalid-contact') }
})
