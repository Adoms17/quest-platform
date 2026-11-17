// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSandboxRecurringWorker } from './sandboxRecurringWorker.js'
const order = { providerMethodId: 'saved-method', id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', planVersionId: '33333333-3333-4333-8333-333333333333', idempotencyKey: '44444444-4444-4444-8444-444444444444', amountMinor: 100, currency: 'RUB', shopId: '123', environment: 'sandbox', returnUrl: 'https://stage.qvesta.ru/organization/billing', firstSentAt: '2026-09-16T00:00:00Z' }
const id = '55555555-5555-4555-8555-555555555555'
const config = { enabled: true, shopId: '123', secretKey: 'synthetic-test-value' }
const info = { account_id: '123', test: true, status: 'enabled' }
const payment = { id, test: true, status: 'pending', paid: false, recipient: { account_id: '123' }, amount: { value: '1.00', currency: 'RUB' }, metadata: { order_id: order.id, organization_id: order.organizationId, plan_version_id: order.planVersionId, environment: 'sandbox' } }
const response = value => ({ ok: true, json: async () => value })
function setup(claim = { data: { authorized: true }, error: null }) {
 const events=[]
 const rpc=vi.fn(async (name, args)=>{
  if(name==='read_recurring_receipt_snapshot_internal')return {data:null}
  events.push(args.p_action)
  if(args.p_action==='begin')return {data:{state:'prepared'}}
  if(args.p_action==='read')return {data:order}
  if(args.p_action==='claim')return claim
  return {data:{status:'pending',requiresReview:false}}
 })
 const fetchImpl=vi.fn(async (url,options)=>{events.push(options.method);return response(url.endsWith('/me')?info:payment)})
 const worker=createSandboxRecurringWorker({rpc,config,transport:{fetchImpl,now:()=>Date.parse(order.firstSentAt)+1000,beforeRecurringSend:()=>true}})
 return {worker,rpc,fetchImpl,events}
}
it('records permission before POST and stores only normalized fields',async()=>{
 const x=setup(); expect(await x.worker.run(order.id)).toEqual({status:'pending'})
 expect(x.events).toEqual(['begin','read','GET','claim','POST','record'])
 expect(x.rpc.mock.calls.at(-1)[1].p_payment).toEqual({paymentId:id,status:'pending',paid:false,test:true})
})
it.each([{data:{authorized:false}},{data:null,error:{message:'private detail'}},{data:{authorized:'true'}}])('refusal or uncertain commit blocks POST',async claim=>{
 const x=setup(claim);await expect(x.worker.run(order.id)).rejects.toThrow()
 expect(x.fetchImpl.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
 expect(x.events).not.toContain('record')
})
it('waits for the RPC response before sending',async()=>{
 let release;const pending=new Promise(r=>{release=r});const x=setup(pending)
 const result=x.worker.run(order.id)
 await vi.waitFor(()=>expect(x.events).toContain('claim'))
 expect(x.events).not.toContain('POST')
 release({data:{authorized:true}});await result
 expect(x.events).toContain('POST')
})
it('receipt preparation failure blocks begin and all HTTP requests',async()=>{
 const rpc=vi.fn(async name=>name==='prepare_recurring_receipt'?{error:{message:'private'}}:{data:null})
 const fetchImpl=vi.fn()
 const worker=createSandboxRecurringWorker({rpc,config,receiptsRequired:true,transport:{fetchImpl}})
 await expect(worker.run(order.id)).rejects.toThrow()
 expect(rpc.mock.calls.some(([,args])=>args.p_action==='begin')).toBe(false)
 expect(fetchImpl).not.toHaveBeenCalled()
})
it('saved recurring receipt survives disabled flag and is sent before recording status',async()=>{
 const snapshot={order_id:order.id,policy_id:order.planVersionId,prepared_at:order.firstSentAt,email:'receipt@example.test',description:'Test renewal',amount_minor:100,currency:'RUB',vat_code:1,payment_subject:'service',payment_mode:'full_payment'}
 const events=[]
 const rpc=vi.fn(async(name,args)=>{
  events.push(name==='sandbox_recurring_worker_command'?args.p_action:name)
  if(name==='read_recurring_receipt_snapshot_internal')return {data:snapshot}
  if(name==='save_recurring_receipt_request')return {data:{body:args.p_body,key:args.p_key,sha256:'a'.repeat(64)}}
  if(name==='record_recurring_receipt_status')return {data:null}
  if(args.p_action==='begin')return {data:{state:'prepared'}}
  if(args.p_action==='read')return {data:order}
  if(args.p_action==='claim')return {data:{authorized:true}}
  return {data:{status:'pending',requiresReview:false}}
 })
 const fetchImpl=vi.fn(async(url,options)=>{events.push(options.method);return response(url.endsWith('/me')?info:{...payment,receipt_registration:'pending'})})
 const worker=createSandboxRecurringWorker({rpc,config,transport:{fetchImpl,now:()=>Date.parse(order.firstSentAt)}})
 expect(await worker.run(order.id)).toEqual({status:'pending'})
 expect(events.indexOf('save_recurring_receipt_request')).toBeLessThan(events.indexOf('POST'))
 expect(JSON.parse(fetchImpl.mock.calls[1][1].body).receipt.customer.email).toBe('receipt@example.test')
 expect(events).toContain('record_recurring_receipt_status')
})
