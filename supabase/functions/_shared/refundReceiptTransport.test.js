// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {createRefundReceiptTransport} from './refundReceiptTransport.js'
import {createSandboxHttpClient} from './yookassaSandboxHttp.js'
const id='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',plan='33333333-3333-4333-8333-333333333333',pay='44444444-4444-4444-8444-444444444444',date='2026-09-26T00:00:00Z'
const saved={order:{id,organizationId:org,planVersionId:plan,idempotencyKey:id,environment:'sandbox',shopId:'123',amountMinor:100,currency:'RUB',firstSentAt:date,providerPaymentId:pay},refund:{id:plan,order_id:id,payment_id:pay,amount_minor:100,first_sent_at:date}}
const body={payment_id:pay,amount:{value:'1.00',currency:'RUB'}}
function setup(error=false,registration='pending') {
 const rpc=vi.fn(async name=>name==='prepare_refund_receipt_request'?(error?{error:{}}:{data:body}):{data:null})
 const fetchImpl=vi.fn(async(url)=>({ok:true,json:async()=>url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:url.includes('/payments/')?{id:pay,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:body.amount,metadata:{order_id:id,organization_id:org,plan_version_id:plan,environment:'sandbox'}}:{id:org,payment_id:pay,status:'succeeded',amount:body.amount,receipt_registration:registration}}))
 const client=createSandboxHttpClient({enabled:true,shopId:'123',secretKey:'synthetic'},{fetchImpl,now:()=>Date.parse(date),refundReceipts:createRefundReceiptTransport(rpc)})
 return {client,rpc,fetchImpl}
}
it('full refund sends no duplicate receipt and records its fiscal status separately',async()=>{
 const {client,rpc,fetchImpl}=setup()
 expect(await client.createRefund(saved)).toEqual({refundId:org,status:'succeeded'})
 expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body)).toEqual(body)
 expect(rpc.mock.calls.at(-1)[1].p_status).toBe('pending')
})
it('receipt preparation failure prevents money refund',async()=>{
 const {client,fetchImpl}=setup(true)
 await expect(client.createRefund(saved)).rejects.toThrow('refund_receipt_unavailable')
 expect(fetchImpl.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
})
it.each([null,'canceled'])('known refund is read without POST, fiscal status %s is independent',async status=>{
 const {client,rpc,fetchImpl}=setup(false,status)
 await client.readRefund({...saved,refund:{...saved.refund,provider_refund_id:org}})
 expect(rpc.mock.calls.at(-1)[1].p_status).toBe(status??'unknown')
 expect(fetchImpl.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
})
it('different stored amount blocks refund',async()=>{
 const transport=createRefundReceiptTransport(async()=>({data:{...body,amount:{value:'2.00',currency:'RUB'}}}))
 await expect(transport.prepare(saved,body)).rejects.toThrow('refund_receipt_mismatch')
})
