// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSandboxRecurringWorker } from './sandboxRecurringWorker.js'
import { runSandboxRecurringBatch } from './sandboxRecurringBatch.js'
import { createSandboxWorkerHandler } from './sandboxWorkerHandler.js'
const order = { providerMethodId: 'saved-method', id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', planVersionId: '33333333-3333-4333-8333-333333333333', idempotencyKey: '44444444-4444-4444-8444-444444444444', amountMinor: 100, currency: 'RUB', shopId: '123', environment: 'sandbox', returnUrl: 'https://stage.qvesta.ru/organization/billing', firstSentAt: '2026-09-16T00:00:00Z' }
const id = '55555555-5555-4555-8555-555555555555'
const config = { enabled: true, shopId: '123', secretKey: 'synthetic-test-value' }
const info = { account_id: '123', test: true, status: 'enabled' }
const payment = { id, test: true, status: 'pending', paid: false, recipient: { account_id: '123' }, amount: { value: '1.00', currency: 'RUB' }, metadata: { order_id: order.id, organization_id: order.organizationId, plan_version_id: order.planVersionId, environment: 'sandbox' } }
const response = value => ({ ok: true, json: async () => value })
function system({lostResponse=false,failedApply=false,zero=false,denied=false}={}) {
 let attempted=false,claimed=false,recorded=null,applied=false,posts=0,applies=0
 const success={...payment,status:'succeeded',paid:true,payment_method:{id:order.providerMethodId,saved:true}}
 const rpc=vi.fn(async(name,args)=>{
  if(name==='prepare_scoped_sandbox_recurring')return {data:{prepared:1,skipped:0}}
  if(name==='list_scoped_sandbox_recurring_work')return {data:applied?[]:[order.id]}
  switch(args.p_action){
   case 'begin': {const state=zero?'zero_amount':attempted?'reconciliation_required':'prepared';attempted=true;return {data:{state}}}
   case 'read':return {data:{...order,providerPaymentId:recorded?.paymentId}}
   case 'claim': {const authorized=!denied&&!claimed;claimed=true;return {data:{authorized}}}
   case 'record':recorded=args.p_payment;return {data:{...recorded,requiresReview:false}}
   case 'apply':
    if(failedApply){failedApply=false;return {error:{message:'synthetic persistence failure'}}}
    if(!applied)applies++;applied=true;return {data:{state:'applied'}}
   default:throw Error('unexpected RPC')
  }
 })
 const fetchImpl=vi.fn(async(url,options)=>{
  if(url.endsWith('/me'))return response(info)
  if(options.method==='POST'){
   expect(claimed).toBe(true);posts++
   if(lostResponse){lostResponse=false;throw Error('synthetic network loss')}
   return response(success)
  }
  if(url.includes('payments?'))return response({items:posts?[success]:[]})
  return response(success)
 })
 const worker=createSandboxRecurringWorker({rpc,config,transport:{fetchImpl,now:()=>Date.parse(order.firstSentAt)+1000}})
 const token='ab'.repeat(32)
 const handler=createSandboxWorkerHandler({token,enabled:true,run:()=>runSandboxRecurringBatch({rpc,worker,shopId:'123',organizationId:'22222222-2222-4222-8222-222222222222'})})
 const request=(authorized=true)=>handler(new Request('https://example.test/worker',{method:'POST',headers:authorized?{'x-qvesta-worker-token':token}:{}}))
 return {request,rpc,fetchImpl,state:()=>({posts,applies})}
}
it('enabled handler applies one paid period and returns aggregate data only',async()=>{
 const x=system();const r=await x.request()
 expect(r.status).toBe(200)
 expect(await r.json()).toEqual({processed:1,failed:0,reconciliationRequired:0,reviewRequired:0})
 await x.request();expect(x.state()).toEqual({posts:1,applies:1})
})
it('lost POST response is recovered by GET with one charge',async()=>{
 const silence=vi.spyOn(console,'error').mockImplementation(()=>{})
 try{
  const x=system({lostResponse:true})
  expect((await (await x.request()).json()).reconciliationRequired).toBe(1)
  expect(x.state()).toEqual({posts:1,applies:0})
  await x.request();expect(x.state()).toEqual({posts:1,applies:1})
 }finally{silence.mockRestore()}
})
it('failed fulfillment resumes without a new POST',async()=>{
 const x=system({failedApply:true})
 expect((await (await x.request()).json()).failed).toBe(1)
 await x.request();expect(x.state()).toEqual({posts:1,applies:1})
})
it('zero price bypasses the payment provider entirely',async()=>{
 const x=system({zero:true});await x.request();await x.request()
 expect(x.state()).toEqual({posts:0,applies:1});expect(x.fetchImpl).not.toHaveBeenCalled()
})
it('denied dispatch cannot charge or apply',async()=>{
 const x=system({denied:true});await x.request()
 expect(x.state()).toEqual({posts:0,applies:0})
})
it('unauthorized call reaches neither database nor provider',async()=>{
 const x=system();expect((await x.request(false)).status).toBe(401)
 expect(x.rpc).not.toHaveBeenCalled();expect(x.fetchImpl).not.toHaveBeenCalled()
})