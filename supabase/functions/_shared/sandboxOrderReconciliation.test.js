// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { reconcileSandboxOrder } from './sandboxOrderReconciliation.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
const id = '11111111-1111-4111-8111-111111111111'
const paymentId = '55555555-5555-4555-8555-555555555555'
const order = { id, organizationId:id, planVersionId:id, idempotencyKey:id, amountMinor:99000, currency:'RUB', shopId:'123', environment:'sandbox', firstSentAt:'2026-10-02T00:00:00Z', providerPaymentId:paymentId }
const payment = { id:paymentId, test:true, status:'succeeded', paid:true, recipient:{account_id:'123'}, amount:{value:'990.00',currency:'RUB'}, metadata:{order_id:id,organization_id:id,plan_version_id:id,environment:'sandbox'}, receipt_registration:'succeeded' }
function setup({ receiptsEnabled, result=payment, recordError=false } = {}) {
  const rpc=vi.fn(async name => {
    if(name==='read_sandbox_reconciliation_order') return {data:order}
    if(name==='record_sandbox_receipt_status') return recordError ? {error:{message:'private'}} : {data:null}
    if(name==='enqueue_sandbox_payment_event') return {data:id}
    if(name==='apply_sandbox_payment_event') return {data:{fulfillmentState:'applied'}}
    throw Error('unexpected_rpc')
  })
  const network=vi.fn(async url => ({ok:true,json:async()=>url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:result}))
  const run=()=>reconcileSandboxOrder({rpc,shopId:'123',orderId:id,receiptsEnabled,createProvider:options=>createSandboxHttpClient({enabled:true,shopId:'123',secretKey:'synthetic'}, {...options,fetchImpl:network})})
  return {rpc,network,run}
}
it('refreshes only the selected receipt through verified GET and applies the existing payment',async()=>{
  const {rpc,network,run}=setup({receiptsEnabled:true})
  expect(await run()).toEqual({checked:1,state:'applied'})
  expect(network.mock.calls.map(([url,o])=>[url,o.method])).toEqual([
    ['https://api.yookassa.ru/v3/me','GET'],
    [`https://api.yookassa.ru/v3/payments/${paymentId}`,'GET'],
  ])
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['read_sandbox_reconciliation_order','record_sandbox_receipt_status','enqueue_sandbox_payment_event','apply_sandbox_payment_event'])
  expect(rpc).toHaveBeenCalledWith('record_sandbox_receipt_status',{p_order_id:id,p_payment_id:paymentId,p_status:'succeeded'})
})
it.each([undefined,false,'true'])('does not persist receipts without explicit boolean enablement: %s',async receiptsEnabled=>{
  const {rpc,run}=setup({receiptsEnabled})
  await run()
  expect(rpc.mock.calls.some(([name])=>name==='record_sandbox_receipt_status')).toBe(false)
})
it.each([{...payment,test:false},{...payment,amount:{value:'1.00',currency:'RUB'}}])('does not record unverified provider results',async result=>{
  const {rpc,run}=setup({receiptsEnabled:true,result})
  await expect(run()).rejects.toThrow()
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('receipt persistence failure stops without applying payment or sending another request',async()=>{
  const {rpc,network,run}=setup({receiptsEnabled:true,recordError:true})
  await expect(run()).rejects.toThrow('receipt_storage_unavailable')
  expect(rpc.mock.calls.map(([name])=>name)).toEqual(['read_sandbox_reconciliation_order','record_sandbox_receipt_status'])
  expect(network.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
})
