import { buildSettlementScenarioDrafts } from './receipt-settlement-scenario.mjs'
import { inspectReceiptProbe, PAYMENT_ID, ORIGINAL_RECEIPT_ID } from './inspect-settlement-probe.mjs'
import { sealProbe, openProbe } from './receipt-settlement-payment-probe.mjs'
export { sealProbe, openProbe }
export const SETTLEMENT_KEY = '17c5969e-1be1-4594-a468-61c015886cb4'
export const SETTLEMENT_JOURNAL = `receipt-probe-${SETTLEMENT_KEY}-settle-remainder-request`
export const REFUND_A_ID = '324c4368-0015-5001-a000-19e5eb9c3bbd'
export const REFUND_A_RECEIPT_ID = 'ra-324c4368-0001-0050-e12b-5046afdeb527'
const START = Date.parse('2026-09-28T09:00:00Z'), END = Date.parse('2026-09-29T08:00:00Z')
const receiptId = /^r[at]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw new Error(code) }
function checkWindow(now) {
  if (!Number.isFinite(now) || now < START || now >= END) fail('settlement_probe_window_closed')
}
export function prepareSettlement(config, now = Date.now()) {
  checkWindow(now)
  if (config.shopId !== '1467641' || typeof config.secretKey !== 'string' || !/^[!-~]{16,}$/.test(config.secretKey)
    || typeof config.email !== 'string' || config.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) fail('settlement_probe_configuration_invalid')
  return { version: 1, operation: 'settle-remainder', key: SETTLEMENT_KEY, preparedAt: new Date(now).toISOString(), body: buildSettlementScenarioDrafts(PAYMENT_ID, config.email).settlement }
}
export async function sendSettlement(plan, config, {persisted=false,fetchImpl=fetch,now=Date.now}={}) {
  checkWindow(now())
  const prepared=Date.parse(plan?.preparedAt)
  if (!persisted || !Number.isFinite(prepared) || prepared > now()
    || JSON.stringify(plan)!==JSON.stringify(prepareSettlement(config,prepared))) fail('settlement_probe_journal_mismatch')
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
    || !matches(first, 'refund', '0.320636') || first.refundId !== REFUND_A_ID) fail('settlement_probe_preconditions_failed')
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
  } catch { fail('settlement_probe_first_refund_unconfirmed') }
  checkWindow(now())
  try {
    const response=await fetchImpl('https://api.yookassa.ru/v3/receipts',{
      method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`,
        'Content-Type':'application/json','Idempotence-Key':SETTLEMENT_KEY},
      body:JSON.stringify(plan.body),redirect:'error',signal:AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      const error=await response.json().catch(()=>null)
      const rejected=response.status===400 && error?.code==='invalid_request'
      const parameter=['payment_id','type','send','items','items.quantity','items.amount','settlements','settlements.amount'].includes(error?.parameter) ? error.parameter : 'other'
      return {outcome:rejected?'rejected':'unknown',key:SETTLEMENT_KEY,httpStatus:response.status,parameter}
    }
    const raw=await response.json()
    if (!receiptId.test(raw?.id) || [ORIGINAL_RECEIPT_ID, REFUND_A_RECEIPT_ID].includes(raw.id)
      || raw.payment_id !== PAYMENT_ID || raw.type !== 'payment'
      || !['pending','succeeded','canceled'].includes(raw.status)) throw new Error()
    const item = raw.items?.[0], expected = plan.body.items[0]
    const lineMatches = Array.isArray(raw.items) && raw.items.length === 1 && item
      && ['description','vat_code','payment_subject','payment_mode'].every(k => item[k] === expected[k])
      && (typeof item.quantity === 'number' || typeof item.quantity === 'string') && String(item.quantity) === '0.679364'
      && item.amount?.value === '990.00' && item.amount?.currency === 'RUB'
    const settlementMatches = Array.isArray(raw.settlements) && raw.settlements.length === 1
      && raw.settlements[0]?.type === 'prepayment' && raw.settlements[0].amount?.value === '672.57'
      && raw.settlements[0].amount?.currency === 'RUB'
    // Preserve an identified receipt even if its content differs. Never re-POST to fix it.
    return {outcome:'identified',key:SETTLEMENT_KEY,paymentId:PAYMENT_ID,receiptId:raw.id,status:raw.status,
      lineMatches:Boolean(lineMatches),settlementMatches,receiptMatches:Boolean(lineMatches && settlementMatches)}
  } catch {return {outcome:'unknown',key:SETTLEMENT_KEY}}
}
