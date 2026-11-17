import { ReceiptDataError } from './subscriptionReceipt.js'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const receiptId = /^r[at]-[a-zA-Z0-9-]{1,100}$/
const fail = () => { throw new ReceiptDataError('settlement_provider_mismatch') }
// Uses the authenticated sandbox transport. No arbitrary URLs or retries.
export function settlementHttpMethods({ request, verifyShop, shopId, now }) {
  function snapshot(value) {
    const saved = structuredClone(value), b = saved?.body
    if (saved?.shopId !== shopId || !uuid.test(b?.payment_id) || b.type !== 'payment'
      || b.send !== true || !Array.isArray(b.items) || b.items.length !== 1
      || b.items[0].payment_mode !== 'full_payment' || Number(b.items[0].quantity) !== 1
      || !Array.isArray(b.settlements) || b.settlements.length !== 1
      || b.settlements[0].type !== 'prepayment'
      || b.items[0].amount?.currency !== 'RUB'
      || !/^\d+\.\d{2}$/.test(b.items[0].amount?.value)
      || b.settlements[0].amount?.value !== b.items[0].amount.value
      || b.settlements[0].amount?.currency !== 'RUB') fail()
    return saved
  }
  async function verifyPayment(saved) {
    await verifyShop()
    const p = await request(`payments/${saved.body.payment_id}`)
    const amount = saved.body.items[0].amount
    if (p?.id !== saved.body.payment_id || p.test !== true || p.status !== 'succeeded'
      || p.paid !== true || p.recipient?.account_id !== shopId
      || p.amount?.value !== amount.value || p.amount?.currency !== amount.currency
      || p.refunded_amount?.value !== '0.00' || p.refunded_amount?.currency !== 'RUB') fail()
  }
  function result(raw, saved) {
    if (!receiptId.test(raw?.id) || (saved.receiptId && raw.id !== saved.receiptId)
      || raw.type !== 'payment' || raw.payment_id !== saved.body.payment_id
      || !['pending','succeeded','canceled'].includes(raw.status)
      || !Array.isArray(raw.items) || raw.items.length !== 1) fail()
    const actual = raw.items[0], expected = saved.body.items[0]
    for (const key of ['description','vat_code','payment_subject','payment_mode']) {
      if (actual[key] !== expected[key]) fail()
    }
    if (Number(actual.quantity) !== 1 || actual.amount?.value !== expected.amount.value
      || actual.amount?.currency !== expected.amount.currency) fail()
    return { id: raw.id, status: raw.status }
  }
  return {
    async createSettlement(value) {
      const saved = snapshot(value)
      if (!uuid.test(saved.key) || saved.receiptId) fail()
      await verifyPayment(saved)
      const age = now() - Date.parse(saved.firstSentAt)
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600000) throw new ReceiptDataError('settlement_reconciliation_required')
      return result(await request('receipts','POST',saved.body,{'Idempotence-Key':saved.key,'Content-Type':'application/json'}),saved)
    },
    async findSettlement(value) {
      const saved = snapshot(value)
      await verifyPayment(saved)
      const params = new URLSearchParams({ payment_id: saved.body.payment_id, limit: '100' })
      const cursors = new Set()
      let match = null
      for (let page = 0; page < 10; page++) {
        const data = await request(`receipts?${params}`)
        if (!Array.isArray(data?.items) || data.items.length > 100) fail()
        for (const receipt of data.items) {
          if (receipt?.payment_id !== saved.body.payment_id) fail()
          // Original prepayment and refund receipts are not settlement candidates.
          if (receipt.type === 'refund') continue
          if (receipt.type !== 'payment' || !Array.isArray(receipt.items) || !receipt.items.length) fail()
          if (receipt.items.every(item => item?.payment_mode === 'full_prepayment')) continue
          const verified = result(receipt, saved)
          if (match && match.id !== verified.id) throw new ReceiptDataError('settlement_reconciliation_required')
          match = verified
        }
        if (data.next_cursor == null || data.next_cursor === '') return match
        if (typeof data.next_cursor !== 'string' || data.next_cursor.length > 200 || cursors.has(data.next_cursor)) fail()
        cursors.add(data.next_cursor)
        params.set('cursor', data.next_cursor)
      }
      // Never bind a partial scan: a later page may contain another settlement.
      throw new ReceiptDataError('settlement_reconciliation_required')
    },
    async readSettlement(value) {
      const saved = snapshot(value)
      if (!receiptId.test(saved.receiptId)) fail()
      await verifyPayment(saved)
      return result(await request(`receipts/${saved.receiptId}`),saved)
    },
  }
}
