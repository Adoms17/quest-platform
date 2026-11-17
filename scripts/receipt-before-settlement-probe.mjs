import { inspectReceiptProbe, PAYMENT_ID } from './inspect-settlement-probe.mjs'
import { sealProbe, openProbe } from './receipt-settlement-payment-probe.mjs'
export { sealProbe, openProbe }
export const REFUND_KEY = '00fda7a3-46ba-4e17-969f-8b4a5de6ef2e'
export const REFUND_JOURNAL = `receipt-probe-${REFUND_KEY}-refund-before-settlement-request`
const START = Date.parse('2026-09-28T08:30:00Z'), END = Date.parse('2026-09-29T07:30:00Z')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw new Error(code) }
function checkWindow(now) {
  if (!Number.isFinite(now) || now < START || now >= END) fail('refund_probe_window_closed')
}
export function prepareRefundBeforeSettlement(config, now = Date.now()) {
  checkWindow(now)
  if (config.shopId !== '1467641' || typeof config.secretKey !== 'string' || !/^[!-~]{16,}$/.test(config.secretKey)
    || typeof config.email !== 'string' || config.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) fail('refund_probe_configuration_invalid')
  return { version: 1, operation: 'refund-before-settlement', key: REFUND_KEY, preparedAt: new Date(now).toISOString(), body: {
    payment_id: PAYMENT_ID, amount: {value:'317.43',currency:'RUB'},
    receipt: { customer: {email:config.email}, items: [{description:'Тест возврата до и после зачёта услуги',
      quantity:'0.320636',amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}] },
  } }
}
export async function sendRefundBeforeSettlement(plan, config, {persisted=false,fetchImpl=fetch,now=Date.now}={}) {
  checkWindow(now())
  const prepared=Date.parse(plan?.preparedAt)
  if (!persisted || !Number.isFinite(prepared) || prepared > now()
    || JSON.stringify(plan)!==JSON.stringify(prepareRefundBeforeSettlement(config,prepared))) fail('refund_probe_journal_mismatch')
  // Always read current provider state, never trust a previously downloaded inspection.
  const inspection=await inspectReceiptProbe(config,{fetchImpl})
  if (inspection.initialRefundPreconditionsMet !== true) fail('refund_probe_preconditions_failed')
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
    if (!uuid.test(raw?.id) || raw.payment_id!==PAYMENT_ID || raw.amount?.value!=='317.43' || raw.amount?.currency!=='RUB'
      || !['pending','succeeded','canceled'].includes(raw.status)) throw new Error()
    return {outcome:'identified',key:REFUND_KEY,paymentId:PAYMENT_ID,refundId:raw.id,status:raw.status,amount:'317.43',
      receiptRegistration:['pending','succeeded','canceled'].includes(raw.receipt_registration)?raw.receipt_registration:'unknown'}
  } catch {return {outcome:'unknown',key:REFUND_KEY}}
}
