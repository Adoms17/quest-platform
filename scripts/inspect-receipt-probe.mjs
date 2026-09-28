import { PROBE_ID } from './receipt-payment-probe.mjs'
export const PAYMENT_ID = '324bffbc-000f-5001-a000-16b18fa2cc44'
export const ORIGINAL_RECEIPT_ID = 'ra-324c0018-0001-0050-7972-5da070857c1a'
const SHOP = '1467641'
const description = 'Тест точности частичного возврата услуги'
const status = value => ['pending','succeeded','canceled'].includes(value) ? value : 'unknown'
const amount = value => value?.currency === 'RUB' && /^\d{1,12}\.\d{2}$/.test(value?.value) ? value.value : null
const fail = () => { throw new Error('receipt_probe_inspection_failed') }
function line(item) {
  return {
    descriptionMatches: item?.description === description,
    quantity: typeof item?.quantity === 'string' && /^\d{1,12}(\.\d{1,12})?$/.test(item.quantity) ? item.quantity : null,
    amount: amount(item?.amount),
    vatCode: Number.isInteger(item?.vat_code) && item.vat_code >= 1 && item.vat_code <= 12 ? item.vat_code : null,
    paymentSubject: item?.payment_subject === 'service' ? 'service' : 'other',
    paymentMode: ['full_prepayment','partial_prepayment','advance','full_payment','partial_payment','credit','credit_payment'].includes(item?.payment_mode) ? item.payment_mode : 'unknown',
  }
}
// Read-only and pinned to one existing experiment. No contact or raw response is returned.
export async function inspectReceiptProbe(config, { fetchImpl = fetch } = {}) {
  try {
    if (config.shopId !== SHOP || typeof config.secretKey !== 'string' || !/^[!-~]{16,}$/.test(config.secretKey)) fail()
    const headers = { Authorization: `Basic ${Buffer.from(`${SHOP}:${config.secretKey}`).toString('base64')}` }
    async function get(path) {
      const response = await fetchImpl(`https://api.yookassa.ru/v3/${path}`, {
        method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) fail()
      return response.json()
    }
    const shop = await get('me')
    if (shop?.account_id !== SHOP || shop.test !== true || shop.status !== 'enabled') fail()
    const payment = await get(`payments/${PAYMENT_ID}`)
    if (payment?.id !== PAYMENT_ID || payment.test !== true || payment.recipient?.account_id !== SHOP
      || amount(payment.amount) !== '990.00' || payment.metadata?.receipt_probe_id !== PROBE_ID
      || payment.metadata?.environment !== 'sandbox' || !['pending','waiting_for_capture','succeeded','canceled'].includes(payment.status)
      || typeof payment.paid !== 'boolean' || (payment.status === 'succeeded' && payment.paid !== true)) fail()
    const params = new URLSearchParams({ payment_id: PAYMENT_ID, limit: '100' })
    const seenCursors = new Set(), receipts = new Map()
    let complete = false
    for (let page = 0; page < 10; page++) {
      const data = await get(`receipts?${params}`)
      if (!Array.isArray(data?.items) || data.items.length > 100) fail()
      for (const receipt of data.items) {
        if (receipt?.payment_id !== PAYMENT_ID || !/^r[at]-[0-9a-f-]{36}$/i.test(receipt.id)
          || !['payment','refund'].includes(receipt.type) || !Array.isArray(receipt.items) || receipt.items.length > 100) fail()
        const safe = { id: receipt.id, type: receipt.type, status: status(receipt.status), items: receipt.items.map(line) }
        if (receipts.has(safe.id) && JSON.stringify(receipts.get(safe.id)) !== JSON.stringify(safe)) fail()
        receipts.set(safe.id, safe)
      }
      if (data.next_cursor == null || data.next_cursor === '') { complete = true; break }
      if (typeof data.next_cursor !== 'string' || data.next_cursor.length > 500 || seenCursors.has(data.next_cursor)) fail()
      seenCursors.add(data.next_cursor)
      params.set('cursor', data.next_cursor)
    }
    if (!complete) fail()
    const list = [...receipts.values()], original = receipts.get(ORIGINAL_RECEIPT_ID), item = original?.items[0]
    const originalMatches = original?.type === 'payment' && original.status === 'succeeded' && original.items.length === 1
      && item.descriptionMatches && item.quantity !== null && Number(item.quantity) === 1 && item.amount === '990.00'
      && item.vatCode === 1 && item.paymentSubject === 'service' && item.paymentMode === 'full_prepayment'
    return { paymentId: PAYMENT_ID, test: true, paymentStatus: payment.status, paid: payment.paid,
      receiptRegistration: status(payment.receipt_registration), refundedAmount: amount(payment.refunded_amount),
      refundable: payment.refundable === true, receipts: list, scanComplete: true,
      initialRefundPreconditionsMet: Boolean(payment.status === 'succeeded' && payment.paid && payment.refundable === true
        && amount(payment.refunded_amount) === '0.00' && payment.receipt_registration === 'succeeded'
        && list.length === 1 && originalMatches) }
  } catch { fail() }
}
