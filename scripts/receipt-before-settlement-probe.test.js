// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {prepareRefundBeforeSettlement,sendRefundBeforeSettlement,REFUND_KEY,sealProbe,openProbe} from './receipt-before-settlement-probe.mjs'
import {PAYMENT_ID,ORIGINAL_RECEIPT_ID} from './inspect-settlement-probe.mjs'
import {PROBE_ID} from './receipt-settlement-payment-probe.mjs'
import {inspectReceiptQuantity} from '../supabase/functions/_shared/receiptQuantityProbe.js'
const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used',email:'probe@example.test'}
const now=Date.parse('2026-09-28T12:00:00Z')
const shop={account_id:config.shopId,test:true,status:'enabled'}
const payment={id:PAYMENT_ID,test:true,recipient:{account_id:config.shopId},amount:{value:'990.00',currency:'RUB'},metadata:{receipt_probe_id:PROBE_ID,environment:'sandbox'},status:'succeeded',paid:true,refundable:true,refunded_amount:{value:'0.00',currency:'RUB'},receipt_registration:'succeeded'}
const receipt={id:ORIGINAL_RECEIPT_ID,payment_id:PAYMENT_ID,type:'payment',status:'succeeded',items:[{description:'Тест возврата до и после зачёта услуги',quantity:1,amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}]}
const refund={id:'11111111-1111-1111-1111-111111111111',payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'317.43',currency:'RUB'},receipt_registration:'pending',customer:{email:config.email}}
function fake(p=payment,r=receipt){return vi.fn().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockResolvedValueOnce({ok:true,json:async()=>p}).mockResolvedValueOnce({ok:true,json:async()=>({items:[r]})})}
const options=fetchImpl=>({persisted:true,fetchImpl,now:()=>now})
it('uses the exact fractional line, unchanged price and a separate immutable key',async()=>{
 const plan=prepareRefundBeforeSettlement(config,now),fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>refund})
 const sealed=sealProbe(plan,config.secretKey)
 expect(sealed).not.toContain(config.email);expect(openProbe(sealed,config.secretKey)).toEqual(plan)
 const result=await sendRefundBeforeSettlement(plan,config,options(fetchImpl))
 expect(result).toMatchObject({outcome:'identified',refundId:refund.id,receiptRegistration:'pending'})
 expect(JSON.stringify(result)).not.toContain(config.email)
 const [url,request]=fetchImpl.mock.calls[3]
 expect(url).toBe('https://api.yookassa.ru/v3/refunds');expect(request.method).toBe('POST')
 expect(request.headers['Idempotence-Key']).toBe(REFUND_KEY)
 expect(REFUND_KEY).not.toBe(PROBE_ID)
 expect(JSON.parse(request.body)).toEqual(plan.body)
 expect(plan.body.receipt.items[0]).toMatchObject({quantity:'0.320636',amount:{value:'990.00',currency:'RUB'}})
 expect(inspectReceiptQuantity(99000,31743,6).matches).toBe(true)
 expect(fetchImpl.mock.calls.filter(([,r])=>r.method==='POST')).toHaveLength(1)
})
it.each([{refunded_amount:{value:'1.00',currency:'RUB'}},{receipt_registration:'pending'},{refundable:false},{status:'pending',paid:false}])('does not send when payment preconditions changed',async patch=>{
 const fetchImpl=fake({...payment,...patch})
 await expect(sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('does not send after a canceled original receipt',async()=>{
 const fetchImpl=fake(payment,{...receipt,status:'canceled'})
 await expect(sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('does not send to a live or unknown shop',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({...shop,test:false})})
 await expect(sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it.each(['persisted','amount','quantity','payment','contact','key'])('rejects altered or unpersisted request %s before networking',async field=>{
 const plan=prepareRefundBeforeSettlement(config,now),fetchImpl=vi.fn(),opts=options(fetchImpl)
 if(field==='persisted')opts.persisted=false
 if(field==='amount')plan.body.amount.value='672.57'
 if(field==='quantity')plan.body.receipt.items[0].quantity='0.32'
 if(field==='payment')plan.body.payment_id='other'
 if(field==='contact')plan.body.receipt.customer.email='other@example.test'
 if(field==='key')plan.key=PROBE_ID
 await expect(sendRefundBeforeSettlement(plan,config,opts)).rejects.toThrow('refund_probe_journal_mismatch')
 expect(fetchImpl).not.toHaveBeenCalled()
})
it.each([Date.parse('2026-09-28T08:29:59Z'),Date.parse('2026-09-29T07:30:00Z')])('blocks preparation outside the reviewed window',time=>{
 expect(()=>prepareRefundBeforeSettlement(config,time)).toThrow('refund_probe_window_closed')
})
it('rechecks deadline after provider reads',async()=>{
 const fetchImpl=fake(),clock=vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse('2026-09-29T07:30:00Z'))
 await expect(sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,{...options(fetchImpl),now:clock})).rejects.toThrow('refund_probe_window_closed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it('classifies explicit invalid_request without exposing raw provider text',async()=>{
 const fetchImpl=fake().mockResolvedValueOnce({ok:false,status:400,json:async()=>({code:'invalid_request',parameter:'receipt.items.quantity',description:config.email})})
 expect(await sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))).toEqual({outcome:'rejected',key:REFUND_KEY,httpStatus:400,parameter:'receipt.items.quantity'})
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})
it.each(['timeout','500','mismatch'])('never retries an unknown POST outcome: %s',async failure=>{
 const fetchImpl=fake()
 if(failure==='timeout')fetchImpl.mockRejectedValueOnce(new Error(config.email))
 if(failure==='500')fetchImpl.mockResolvedValueOnce({ok:false,status:500,json:async()=>({description:config.email})})
 if(failure==='mismatch')fetchImpl.mockResolvedValueOnce({ok:true,json:async()=>({...refund,payment_id:'other'})})
 const result=await sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))
 expect(result.outcome).toBe('unknown');expect(JSON.stringify(result)).not.toContain(config.email)
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})

it('matches the reviewed offline scenario and cannot reuse A journal',async()=>{
 const {buildSettlementScenarioDrafts}=await import('./receipt-settlement-scenario.mjs')
 const {prepareRefundA,REFUND_KEY:oldKey}=await import('./receipt-refund-a-probe.mjs')
 const plan=prepareRefundBeforeSettlement(config,now),fetchImpl=vi.fn()
 expect(plan.body).toEqual(buildSettlementScenarioDrafts(PAYMENT_ID,config.email).refundBefore)
 expect(REFUND_KEY).not.toBe(oldKey)
 await expect(sendRefundBeforeSettlement(prepareRefundA(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_journal_mismatch')
 expect(fetchImpl).not.toHaveBeenCalled()
})
it('does not send if another receipt appears on a later page',async()=>{
 const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>shop})
  .mockResolvedValueOnce({ok:true,json:async()=>payment})
  .mockResolvedValueOnce({ok:true,json:async()=>({items:[receipt],next_cursor:'next'})})
  .mockResolvedValueOnce({ok:true,json:async()=>({items:[{...receipt,id:'ra-11111111-1111-1111-1111-111111111111',type:'refund'}]})})
 await expect(sendRefundBeforeSettlement(prepareRefundBeforeSettlement(config,now),config,options(fetchImpl))).rejects.toThrow('refund_probe_preconditions_failed')
 expect(fetchImpl.mock.calls.every(([,r])=>r.method==='GET')).toBe(true)
})
