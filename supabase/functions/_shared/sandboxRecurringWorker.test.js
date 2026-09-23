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
 const rpc=vi.fn(async (_, args)=>{
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