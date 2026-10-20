// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createReceiptPaymentTransport } from './receiptPaymentTransport.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
const order = { id:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',planVersionId:'33333333-3333-4333-8333-333333333333',idempotencyKey:'44444444-4444-4444-8444-444444444444',amountMinor:123,currency:'RUB',shopId:'123',environment:'sandbox',returnUrl:'https://stage.qvesta.ru/organization/billing',firstSentAt:'2026-09-26T00:00:00Z' }
const snapshot = {order_id:order.id,policy_id:order.planVersionId,prepared_at:order.firstSentAt,amount_minor:123,currency:'RUB',email:'receipt@example.test',description:'Test subscription',vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}
const payment = {id:'55555555-5555-4555-8555-555555555555',test:true,status:'pending',paid:false,recipient:{account_id:'123'},amount:{value:'1.23',currency:'RUB'},metadata:{order_id:order.id,organization_id:order.organizationId,plan_version_id:order.planVersionId,environment:'sandbox'},receipt_registration:'pending'}
const response = value => ({ok:true,json:async()=>value})
function setup({saveError=false,readSnapshot=snapshot,result=payment,recordError=false}={}) {
 const events=[]
 const rpc=vi.fn(async(name,args)=>{
  events.push(name)
  if(name==='read_sandbox_receipt_snapshot_internal')return {data:readSnapshot}
  if(name==='save_sandbox_receipt_request')return saveError?{error:{message:'private'}}:{data:{body:args.p_body,key:args.p_key,sha256:'a'.repeat(64)}}
  return recordError?{error:{message:'private'}}:{data:null}
 })
 const network=vi.fn(async(url,options)=>{
  events.push(options.method)
  return response(url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:result)
 })
 const client=createSandboxHttpClient({enabled:true,shopId:'123',secretKey:'synthetic'}, {fetchImpl:network,now:()=>Date.parse(order.firstSentAt),receipts:createReceiptPaymentTransport(rpc),beforeRecurringSend:async()=>true})
 return {client,rpc,network,events}
}
describe('persisted receipt transport',()=>{
 it('saves complete receipt before POST and separately stores fiscal status',async()=>{
  const {client,events,network,rpc}=setup()
  await client.createPayment(order)
  expect(events).toEqual(['GET','read_sandbox_receipt_snapshot_internal','save_sandbox_receipt_request','POST','record_sandbox_receipt_status'])
  const body=JSON.parse(network.mock.calls[1][1].body)
  expect(body.receipt.customer.email).toBe(snapshot.email)
  expect(body.receipt.items[0].amount).toEqual(body.amount)
  expect(rpc.mock.calls.at(-1)[1].p_status).toBe('pending')
 })
 it.each([{saveError:true},{readSnapshot:null},{readSnapshot:{...snapshot,amount_minor:124}}])('fails closed before payment for %j',async options=>{
  const {client,network}=setup(options)
  await expect(client.createPayment(order)).rejects.toThrow()
  expect(network.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
 })
 it('autopayment also persists and includes the receipt',async()=>{
  const {client,network}=setup()
  await client.createRecurringPayment({...order,providerMethodId:'saved-method'})
  expect(JSON.parse(network.mock.calls[1][1].body).receipt).toBeDefined()
 })
 it.each([undefined,'unexpected','succeeded','canceled'])('records fiscal result %s independently of monetary result',async status=>{
  const {client,rpc}=setup({result:{...payment,status:'succeeded',paid:true,receipt_registration:status}})
  const result=await client.readPayment({...order,providerPaymentId:payment.id})
  expect(result.status).toBe('succeeded')
  expect(rpc.mock.calls.at(-1)[1].p_status).toBe(['succeeded','canceled'].includes(status)?status:'unknown')
 })
 it('storage failure after POST does not repeat payment',async()=>{
  const {client,network}=setup({recordError:true})
  await expect(client.createPayment(order)).rejects.toThrow('receipt_storage_unavailable')
  expect(network.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1)
 })
 it('refuses a different body returned by storage',async()=>{
  const rpc=vi.fn(async name=>name==='read_sandbox_receipt_snapshot_internal'?{data:snapshot}:{data:{key:order.idempotencyKey,sha256:'a'.repeat(64),body:{}}})
  await expect(createReceiptPaymentTransport(rpc).prepare(order,{headers:{'Idempotence-Key':order.idempotencyKey},body:{}})).rejects.toThrow('receipt_request_mismatch')
 })
})
