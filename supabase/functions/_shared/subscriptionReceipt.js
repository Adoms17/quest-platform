// Server-only pure builder for one subscription line. No HTTP, storage, or tax
// policy selection. Call only with a trusted, persisted server snapshot.
// Sources: WEB-PAY-03-receipts-contract.md. Not a complete fiscal integration.
export class ReceiptDataError extends Error {
  constructor(code) { super(code); this.name = 'ReceiptDataError'; this.code = code }
}
const fail = code => { throw new ReceiptDataError(code) }
const subjects = new Set(['service', 'intellectual_activity', 'property_right'])
const modes = new Set(['full_payment', 'full_prepayment'])
// Reject control characters deliberately in receipt text and contact fields.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f]/u

export function buildSubscriptionReceipt(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalid_receipt_data')
  const { amountMinor, currency, email, description, vatCode, paymentSubject, paymentMode } = data
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) fail('invalid_receipt_amount')
  if (currency !== 'RUB') fail('invalid_receipt_currency')
  // Conservative syntax validation only; it does not verify mailbox ownership.
  if (typeof email !== 'string' || email.length > 254 || email !== email.trim()
    || controls.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail('invalid_receipt_email')
  if (typeof description !== 'string' || !description.trim()
    || [...description].length > 128 || controls.test(description)) fail('invalid_receipt_description')
  if (!Number.isInteger(vatCode) || vatCode < 1 || vatCode > 12) fail('invalid_receipt_vat')
  if (!subjects.has(paymentSubject)) fail('invalid_receipt_subject')
  if (!modes.has(paymentMode)) fail('invalid_receipt_mode')
  // Integer arithmetic preserves kopecks even near Number.MAX_SAFE_INTEGER.
  const minor = BigInt(amountMinor)
  const value = `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`
  return {
    customer: { email },
    items: [{ description, quantity: '1.000', amount: { value, currency },
      vat_code: vatCode, payment_subject: paymentSubject, payment_mode: paymentMode }],
  }
}
