import { inspectReceiptProbe, PAYMENT_ID, ORIGINAL_RECEIPT_ID } from './inspect-receipt-probe.mjs'
import { sealProbe, openProbe } from './receipt-payment-probe.mjs'
export { sealProbe, openProbe }
export const REFUND_KEY = 'd59fbe93-04cd-4b58-beb8-b52c8c310afa'
export const REFUND_JOURNAL = `receipt-probe-${REFUND_KEY}-refund-b-request`
export const REFUND_A_ID = '324c2110-0015-5001-a000-1404c9f12465'
export const REFUND_A_RECEIPT_ID = 'ra-324c2110-0001-0050-602d-359cd7062f78'
const START = Date.parse('2026-09-28T06:00:00Z'), END = Date.parse('2026-09-29T05:00:00Z')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw new Error(code) }
function checkWindow(now) {
  if (!Number.isFinite(now) || now < START || now >= END) fail('refund_probe_window_closed')
}
export function prepareRefundB(config, now = Date.now()) {
  checkWindow(now)
  if (config.shopId !== '1467641' || typeof config.secretKey !== 'string' || !/^[!-~]{16,}$/.test(config.secretKey)
    || typeof config.email !== 'string' || config.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) fail('refund_probe_configuration_invalid')
  return { version: 1, operation: 'refund-b', key: REFUND_KEY, preparedAt: new Date(now).toISOString(), body: {
    payment_id: PAYMENT_ID, amount: {value:'672.57',currency:'RUB'},
    receipt: { customer: {email:config.email}, items: [{description:'Тест точности частичного возврата услуги',
      quantity:'0.679364',amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}] },
  } }
}
export async function sendRefundB(plan, config, {persisted=false,fetchImpl=fetch,now=Date.now}={}) {
  checkWindow(now())
  const prepared=Date.parse(plan?.preparedAt)
  if (!persisted || !Number.isFinite(prepared) || prepared > now()
    || JSON.stringify(plan)!==JSON.stringify(prepareRefundB(config,prepared))) fail('refund_probe_journal_mismatch')
  // Always read current provider state, never trust a previously downloaded inspection.
  const inspection=await inspectReceiptProbe(config,{fetchImpl})
  const matches = (receipt, type, quantity) => receipt?.type === type && receipt.status === 'succeeded'
    && receipt.items.length === 1 && receipt.items[0].descriptionMatches
    && receipt.items[0].quantity === quantity && receipt.items[0].amount === '990.00'
    && receipt.items[0].vatCode === 1 && receipt.items[0].paymentSubject === 'service'
    && receipt.items[0].paymentMode === 'full_prepayment'
  const original = inspection.receipts.find(r => r.id === ORIGINAL_RECEIPT_ID)
  const first = inspection.receipts.find(r => r.id === REFUND_A_RECEIPT_ID)
  if (inspection.scanComplete !== true || inspection.test !== true || inspection.paymentId !== PAYMENT_ID
    || inspection.paymentStatus !== 'succeeded' || inspection.paid !== true || inspection.refundable !== true
    || inspection.refundedAmount !== '317.43' || inspection.receiptRegistration !== 'succeeded'
    || inspection.receipts.length !== 2 || !matches(original, 'payment', '1')
    || !matches(first, 'refund', '0.320636') || first.refundId !== REFUND_A_ID) fail('refund_probe_preconditions_failed')
  // Verify the first refund itself, not only the aggregate amount or its receipt.
  try {
    const response = await fetchImpl(`https://api.yookassa.ru/v3/refunds/${REFUND_A_ID}`, {
      method: 'GET', headers: {Authorization:`Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`},
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error()
    const firstRefund = await response.json()
    if (firstRefund.id !== REFUND_A_ID || firstRefund.payment_id !== PAYMENT_ID || firstRefund.status !== 'succeeded'
      || firstRefund.amount?.value !== '317.43' || firstRefund.amount?.currency !== 'RUB') throw new Error()
  } catch { fail('refund_probe_first_refund_unconfirmed') }
  checkWindow(now())
  try {
    const response=await fetchImpl('https://api.yookassa.ru/v3/refunds',{
      method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`,
        'Content-Type':'application/json','Idempotence-Key':REFUND_KEY},
      body:JSON.stringify(plan.body),redirect:'error',signal:AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      const error=await response.json().catch(()=>null)
      const rejected=response.status===400 && error?.code==='invalid_request'
      const parameter=['amount','amount.value','payment_id','receipt','receipt.items','receipt.items.quantity','receipt.items.amount'].includes(error?.parameter) ? error.parameter : 'other'
      return {outcome:rejected?'rejected':'unknown',key:REFUND_KEY,httpStatus:response.status,parameter}
    }
    const raw=await response.json()
    if (!uuid.test(raw?.id) || raw.payment_id!==PAYMENT_ID || raw.amount?.value!=='672.57' || raw.amount?.currency!=='RUB'
      || !['pending','succeeded','canceled'].includes(raw.status)) throw new Error()
    return {outcome:'identified',key:REFUND_KEY,paymentId:PAYMENT_ID,refundId:raw.id,status:raw.status,amount:'672.57',
      receiptRegistration:['pending','succeeded','canceled'].includes(raw.receipt_registration)?raw.receipt_registration:'unknown'}
  } catch {return {outcome:'unknown',key:REFUND_KEY}}
}
