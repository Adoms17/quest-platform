// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {runReceiptCheckout} from './receiptCheckout.js'
it('requires saved receipt before beginning a new payment even without UI',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{order:{id:'one',firstSentAt:null}}})
 const serviceRpc=vi.fn().mockResolvedValue({data:null})
 await expect(runReceiptCheckout('one',{rpc,serviceRpc,required:true})).rejects.toThrow('receipt_contact_required')
 expect(rpc).toHaveBeenCalledTimes(1)
})
it('denied order never reads fiscal contact',async()=>{
 const rpc=vi.fn().mockResolvedValue({error:{message:'private'}}),serviceRpc=vi.fn()
 await expect(runReceiptCheckout('one',{rpc,serviceRpc,required:true})).rejects.toThrow('receipt_access_denied')
 expect(serviceRpc).not.toHaveBeenCalled()
})
it('database failure never falls back to receipt-free payment',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{order:{id:'one'}}}),serviceRpc=vi.fn().mockResolvedValue({error:{}})
 await expect(runReceiptCheckout('one',{rpc,serviceRpc,required:false})).rejects.toThrow('receipt_storage_unavailable')
 expect(rpc).toHaveBeenCalledTimes(1)
})
it.each([true,false])('disabled rollout preserves existing receipt or legacy payment (snapshot=%s)',async prepared=>{
 const id='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',plan='33333333-3333-4333-8333-333333333333',key='44444444-4444-4444-8444-444444444444',paymentId='55555555-5555-4555-8555-555555555555'
 const date='2026-09-26T00:00:00Z'
 const order={id,organizationId:org,planVersionId:plan,idempotencyKey:key,amountMinor:100,currency:'RUB',shopId:'123',environment:'sandbox',firstSentAt:date,returnUrl:'https://stage.qvesta.ru/organization/billing'}
 const snapshot={order_id:id,policy_id:plan,prepared_at:date,amount_minor:100,currency:'RUB',email:'test@example.test',description:'Test',vat_code:1,payment_subject:'service',payment_mode:'full_payment'}
 const rpc=vi.fn(async name=>({data:name==='read_sandbox_payment_order'?{order}:name==='begin_sandbox_payment_send'?{can_send:true,order}:{order_id:id,payment_id:paymentId,status:'pending',requires_review:false}}))
 const serviceRpc=vi.fn(async(name,args)=>({data:name==='read_sandbox_receipt_snapshot_internal'?(prepared?snapshot:null):name==='save_sandbox_receipt_request'?{body:args.p_body,key,sha256:'a'.repeat(64)}:null}))
 const network=vi.fn(async url=>({ok:true,json:async()=>url.endsWith('/me')?{account_id:'123',test:true,status:'enabled'}:{id:paymentId,test:true,status:'pending',paid:false,recipient:{account_id:'123'},amount:{value:'1.00',currency:'RUB'},metadata:{order_id:id,organization_id:org,plan_version_id:plan,environment:'sandbox'},receipt_registration:'pending'}}))
 const result=await runReceiptCheckout(id,{rpc,serviceRpc,required:false,config:{enabled:true,shopId:'123',secretKey:'synthetic'},transport:{fetchImpl:network,now:()=>Date.parse(date)}})
 expect(result.status).toBe('pending')
 const body=JSON.parse(network.mock.calls[1][1].body)
 if(prepared){
  expect(body.receipt.customer.email).toBe('test@example.test')
  expect(serviceRpc.mock.calls.at(-1)[0]).toBe('record_sandbox_receipt_status')
 }else{
  expect(body).not.toHaveProperty('receipt')
  expect(serviceRpc).toHaveBeenCalledTimes(1)
 }
})
