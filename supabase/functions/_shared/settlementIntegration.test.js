// @vitest-environment node
// Integration of production flow + HTTP transport; RPC and provider are in-memory
// fault-injection doubles. Real SQL is covered by checkout-documents-integration.
import { expect, it, vi } from 'vitest'
import { runPrepaymentSettlement } from './prepaymentSettlementFlow.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { buildPrepaymentSettlement } from './prepaymentSettlement.js'
const id='11111111-1111-4111-8111-111111111111'
function harness({lostResponse=false,failedSave=false,liveShop=false}={}) {
 const body=buildPrepaymentSettlement({amountMinor:1000,currency:'RUB',email:'buyer@example.test',description:'Subscription',vatCode:1,paymentSubject:'service',paymentMode:'full_prepayment'},
 {id,status:'succeeded',receiptRegistration:'succeeded',amountMinor:1000,currency:'RUB',refundedAmountMinor:0,reservedRefundAmountMinor:0})
 let claimed=false,record=null,receipt=null,posts=0
 const rpc=vi.fn(async(name,args)=>{
  if(name==='claim_prepayment_settlement') {
   const action=claimed?'reconcile':'send';claimed=true
   return {data:{action,body,shopId:'123',key:id,firstSentAt:'2026-09-26T00:00:00Z',receiptId:record?.id}}
  }
  if(name==='record_prepayment_settlement') {
   if(failedSave){failedSave=false;return {error:{code:'synthetic_storage_failure'}}}
   record={id:args.p_receipt_id,status:args.p_status};return {error:null}
  }
  throw Error('unexpected RPC')
 })
 const fetchImpl=vi.fn(async(url,options)=>{
  const path=new URL(url).pathname
  if(path.endsWith('/me'))return Response.json({account_id:'123',test:!liveShop,status:'enabled'})
  if(path.endsWith('/payments/'+id))return Response.json({id,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:body.items[0].amount,refunded_amount:{value:'0.00',currency:'RUB'}})
  if(path.endsWith('/receipts') && options.method==='POST') {
   posts++;expect(options.headers['Idempotence-Key']).toBe(id)
   expect(JSON.parse(options.body)).toEqual(body)
   receipt={id:'rt-created',type:'payment',payment_id:id,status:'succeeded',items:body.items}
   if(lostResponse){lostResponse=false;throw Error('synthetic connection interrupted')}
   return Response.json(receipt)
  }
  if(path.endsWith('/receipts'))return Response.json({items:receipt?[receipt]:[]})
  if(path.endsWith('/receipts/rt-created'))return Response.json(receipt)
  throw Error('unexpected provider request')
 })
 const provider=createSandboxHttpClient({enabled:true,shopId:'123',secretKey:'synthetic-test-key'},{fetchImpl,now:()=>Date.parse('2026-09-26T00:01:00Z')})
 return {run:()=>runPrepaymentSettlement({orderId:id,rpc,provider}),rpc,fetchImpl,posts:()=>posts,record:()=>record}
}
it('recovers a lost POST response through receipt lookup without another POST',async()=>{
 const h=harness({lostResponse:true})
 await expect(h.run()).rejects.toThrow('payment_outcome_unknown')
 expect(h.record()).toBe(null)
 expect(await h.run()).toEqual({state:'succeeded'})
 expect(h.record()).toEqual({id:'rt-created',status:'succeeded'})
 expect(h.posts()).toBe(1)
 await h.run()
 expect(h.posts()).toBe(1)
})
it('recovers a provider success lost during database persistence',async()=>{
 const h=harness({failedSave:true})
 await expect(h.run()).rejects.toThrow('settlement_storage_unavailable')
 expect(await h.run()).toEqual({state:'succeeded'})
 expect(h.posts()).toBe(1)
})
it('concurrent invocations consume only one send authorization',async()=>{
 const h=harness()
 const outcomes=await Promise.allSettled([h.run(),h.run()])
 expect(outcomes.some(result=>result.status==='fulfilled'&&result.value.state==='succeeded')).toBe(true)
 expect(h.posts()).toBe(1)
})
it('a live shop is refused before any receipt POST',async()=>{
 const h=harness({liveShop:true})
 await expect(h.run()).rejects.toThrow('sandbox_shop_unverified')
 expect(h.posts()).toBe(0)
 expect(h.record()).toBe(null)
})
