import { PROBE_ID } from './receipt-settlement-payment-probe.mjs'
export const PAYMENT_ID = '324c3700-000f-5001-a000-1b600132eb9a'
export const ORIGINAL_RECEIPT_ID = 'ra-324c3758-0001-0050-8266-1fce95ff6d12'
const SHOP = '1467641'
const description = 'Тест возврата до и после зачёта услуги'
const status = value => ['pending','succeeded','canceled'].includes(value) ? value : 'unknown'
const amount = value => value?.currency === 'RUB' && /^\d{1,12}\.\d{2}$/.test(value?.value) ? value.value : null
const fail = () => { throw new Error('receipt_probe_inspection_failed') }
function quantity(value) {
  // JSON may encode quantity as a decimal string or a number. Preserve its type.
  const numeric = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
  const text = typeof value === 'string' ? value : numeric ? String(value) : ''
  return /^\d{1,12}(\.\d{1,12})?$/.test(text) ? text : null
}
function line(item) {
  return {
    descriptionMatches: item?.description === description,
    quantity: quantity(item?.quantity),
    quantityEncoding: typeof item?.quantity === 'number' ? 'number' : typeof item?.quantity === 'string' ? 'string' : 'unsupported',
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
        const refundId = receipt.type === 'refund' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.refund_id) ? receipt.refund_id : null
        const safe = { id: receipt.id, type: receipt.type, refundId, status: status(receipt.status), items: receipt.items.map(line),
          settlements: Array.isArray(receipt.settlements) && receipt.settlements.length <= 100
            ? receipt.settlements.map(s => ({type:['cashless','prepayment','postpayment','credit','consideration'].includes(s?.type) ? s.type : 'unknown',amount:amount(s?.amount)})) : null }
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
