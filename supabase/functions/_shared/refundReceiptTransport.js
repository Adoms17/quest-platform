import { ReceiptDataError } from './subscriptionReceipt.js'
export function createRefundReceiptTransport(rpc) {
 async function call(name,args) {
  const {data,error}=await rpc(name,args)
  if(error)throw new ReceiptDataError('refund_receipt_unavailable')
  return data
 }
 return {
  async prepare(saved,body) {
   const stored=await call('prepare_refund_receipt_request',{p_refund_id:saved.refund.id})
   if(stored===null)return body
   if(!stored || Object.keys(stored).sort().join(',')!=='amount,payment_id'
    || stored.payment_id!==body.payment_id || stored.amount?.value!==body.amount.value
    || stored.amount?.currency!==body.amount.currency || Object.keys(stored.amount).sort().join(',')!=='currency,value')throw new ReceiptDataError('refund_receipt_mismatch')
   return stored
  },
  async record(saved,verified,raw) {
   const status=['pending','succeeded','canceled'].includes(raw?.receipt_registration)?raw.receipt_registration:'unknown'
   await call('record_refund_receipt_status',{p_refund_id:saved.refund.id,p_provider_id:verified.refundId,p_status:status})
  },
 }
}
