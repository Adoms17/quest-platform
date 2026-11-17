// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {prepareRefundB,sendRefundB,REFUND_KEY,REFUND_A_ID,REFUND_A_RECEIPT_ID,sealProbe,openProbe} from './receipt-refund-b-probe.mjs'
import {PAYMENT_ID,ORIGINAL_RECEIPT_ID} from './inspect-receipt-probe.mjs'
import {PROBE_ID} from './receipt-payment-probe.mjs'
import {inspectReceiptQuantity} from '../supabase/functions/_shared/receiptQuantityProbe.js'
const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used',email:'probe@example.test'}
const now=Date.parse('2026-09-28T12:00:00Z')
const shop={account_id:config.shopId,test:true,status:'enabled'}
const payment={id:PAYMENT_ID,test:true,recipient:{account_id:config.shopId},amount:{value:'990.00',currency:'RUB'},metadata:{receipt_probe_id:PROBE_ID,environment:'sandbox'},status:'succeeded',paid:true,refundable:true,refunded_amount:{value:'317.43',currency:'RUB'},receipt_registration:'succeeded'}
const receipt={id:ORIGINAL_RECEIPT_ID,payment_id:PAYMENT_ID,type:'payment',status:'succeeded',items:[{description:'Тест точности частичного возврата услуги',quantity:1,amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}]}
const refund={id:'11111111-1111-1111-1111-111111111111',payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'672.57',currency:'RUB'},receipt_registration:'pending',customer:{email:config.email}}
const receiptA={...receipt,id:REFUND_A_RECEIPT_ID,type:'refund',refund_id:REFUND_A_ID,items:[{...receipt.items[0],quantity:0.320636}]}
const firstRefund={id:REFUND_A_ID,payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'317.43',currency:'RUB'}}
function fake(p=payment,r=receipt,a=receiptA,first=firstRefund,extra=[]){return vi.fn()
 .mockResolvedValueOnce({ok:true,json:async()=>shop})
 .mockResolvedValueOnce({ok:true,json:async()=>p})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:[r,a,...extra]})})
 .mockResolvedValueOnce({ok:true,json:async()=>first})}
const options=fetchImpl=>({persisted:true,fetchImpl,now:()=>now})
it('uses the exact fractional line, unchanged price and a separate immutable key',async()=>{
 const plan=prepareRefundB(config,now),fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>refund})
 const sealed=sealProbe(plan,config.secretKey)
 expect(sealed).not.toContain(config.email);expect(openProbe(sealed,config.secretKey)).toEqual(plan)
 const result=await sendRefundB(plan,config,options(fetchImpl))
 expect(result).toMatchObject({outcome:'identified',refundId:refund.id,receiptRegistration:'pending'})
 expect(JSON.stringify(result)).not.toContain(config.email)
 const [url,request]=fetchImpl.mock.calls[4]
 expect(url).toBe('https://api.yookassa.ru/v3/refunds');expect(request.method).toBe('POST')
 expect(request.headers['Idempotence-Key']).toBe(REFUND_KEY)
 expect(REFUND_KEY).not.toBe(PROBE_ID)
 expect(JSON.parse(request.body)).toEqual(plan.body)
 expect(plan.body.receipt.items[0]).toMatchObject({quantity:'0.679364',amount:{value:'990.00',currency:'RUB'}})
 expect(inspectReceiptQuantity(99000,67257,6).matches).toBe(true)
 expect(fetchImpl.mock.calls.filter(([,r])=>r.method==='POST')).toHaveLength(1)
})
it.each([{refunded_amount:{value:'1.00',currency:'RUB'}},{receipt_registration:'pending'},{refundable:false},{status:'pending',paid:false}])('does not send when payment preconditions changed',async patch=>{
 const fetchImpl=fake({...payment,...patch})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('does not send after a canceled original receipt',async()=>{
 const fetchImpl=fake(payment,{...receipt,status:'canceled'})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('does not send to a live or unknown shop',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({...shop,test:false})})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it.each(['persisted','amount','quantity','payment','contact','key'])('rejects altered or unpersisted request %s before networking',async field=>{
 const plan=prepareRefundB(config,now),fetchImpl=vi.fn(),opts=options(fetchImpl)
 if(field==='persisted')opts.persisted=false
 if(field==='amount')plan.body.amount.value='317.43'
 if(field==='quantity')plan.body.receipt.items[0].quantity='0.32'
 if(field==='payment')plan.body.payment_id='other'
 if(field==='contact')plan.body.receipt.customer.email='other@example.test'
 if(field==='key')plan.key=PROBE_ID
 await expect(sendRefundB(plan,config,opts)).rejects.toThrow('refund_probe_journal_mismatch')
 expect(fetchImpl).not.toHaveBeenCalled()
})
it.each([Date.parse('2026-09-28T05:59:59Z'),Date.parse('2026-09-29T05:00:00Z')])('blocks preparation outside the reviewed window',time=>{
 expect(()=>prepareRefundB(config,time)).toThrow('refund_probe_window_closed')
})
it('rechecks deadline after provider reads',async()=>{
 const fetchImpl=fake(),clock=vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse('2026-09-29T05:00:00Z'))
 await expect(sendRefundB(prepareRefundB(config,now),config,{...options(fetchImpl),now:clock})).rejects.toThrow('refund_probe_window_closed')
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})
it('classifies explicit invalid_request without exposing raw provider text',async()=>{
 const fetchImpl=fake().mockResolvedValueOnce({ok:false,status:400,json:async()=>({code:'invalid_request',parameter:'receipt.items.quantity',description:config.email})})
 expect(await sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).toEqual({outcome:'rejected',key:REFUND_KEY,httpStatus:400,parameter:'receipt.items.quantity'})
 expect(fetchImpl).toHaveBeenCalledTimes(5)
})
it.each(['timeout','500','mismatch'])('never retries an unknown POST outcome: %s',async failure=>{
 const fetchImpl=fake()
 if(failure==='timeout')fetchImpl.mockRejectedValueOnce(new Error(config.email))
 if(failure==='500')fetchImpl.mockResolvedValueOnce({ok:false,status:500,json:async()=>({description:config.email})})
 if(failure==='mismatch')fetchImpl.mockResolvedValueOnce({ok:true,json:async()=>({...refund,payment_id:'other'})})
 const result=await sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))
 expect(result.outcome).toBe('unknown');expect(JSON.stringify(result)).not.toContain(config.email)
 expect(fetchImpl).toHaveBeenCalledTimes(5)
})

it.each([
 {status:'pending'}, {status:'canceled'}, {refund_id:'22222222-2222-2222-2222-222222222222'},
 {id:'ra-22222222-2222-2222-2222-222222222222'},
 {items:[{...receiptA.items[0],quantity:0.32}]},
 {items:[{...receiptA.items[0],payment_mode:'full_payment'}]},
])('blocks missing, altered or unconfirmed A receipt %j',async patch=>{
 const fetchImpl=fake(payment,receipt,{...receiptA,...patch})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('blocks additional receipts or settlement before B',async()=>{
 const fetchImpl=fake(payment,receipt,receiptA,firstRefund,[{...receipt,id:'ra-22222222-2222-2222-2222-222222222222'}])
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{status:'canceled'},{payment_id:'other'},{id:'other'},{amount:{value:'1.00',currency:'RUB'}}])('requires the exact successful first refund %j',async patch=>{
 const fetchImpl=fake(payment,receipt,receiptA,{...firstRefund,...patch})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_first_refund_unconfirmed')
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})
it('does not reuse refund A request or key',async()=>{
 const {prepareRefundA,REFUND_KEY:oldKey}=await import('./receipt-refund-a-probe.mjs')
 expect(REFUND_KEY).not.toBe(oldKey)
 const fetchImpl=vi.fn()
 await expect(sendRefundB(prepareRefundA(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_journal_mismatch')
 expect(fetchImpl).not.toHaveBeenCalled()
})
it.each(['http','timeout','malformed'])('stops before POST if GET refund A fails: %s',async kind=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>shop})
  .mockResolvedValueOnce({ok:true,json:async()=>payment})
  .mockResolvedValueOnce({ok:true,json:async()=>({items:[receipt,receiptA]})})
 if(kind==='http')fetchImpl.mockResolvedValueOnce({ok:false,status:503})
 if(kind==='timeout')fetchImpl.mockRejectedValueOnce(new Error(config.email))
 if(kind==='malformed')fetchImpl.mockResolvedValueOnce({ok:true,json:async()=>{throw new Error(config.email)}})
 await expect(sendRefundB(prepareRefundB(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_first_refund_unconfirmed')
 expect(fetchImpl).toHaveBeenCalledTimes(4)
 expect(fetchImpl.mock.calls.every(([,r])=>r.method==='GET')).toBe(true)
})
