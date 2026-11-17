// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {prepareRefundAfterSettlement as prepare,sendRefundAfterSettlement as send,REFUND_KEY,REFUND_A_ID,REFUND_A_RECEIPT_ID,SETTLEMENT_RECEIPT_ID,sealProbe,openProbe} from './receipt-after-settlement-probe.mjs'
import {PAYMENT_ID,ORIGINAL_RECEIPT_ID} from './inspect-settlement-probe.mjs'
import {PROBE_ID} from './receipt-settlement-payment-probe.mjs'
import {buildSettlementScenarioDrafts} from './receipt-settlement-scenario.mjs'
const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used',email:'probe@example.test'}
const now=Date.parse('2026-09-28T12:00:00Z')
const plan=()=>prepare(config,now)
const shop={account_id:config.shopId,test:true,status:'enabled'}
const payment={id:PAYMENT_ID,test:true,recipient:{account_id:config.shopId},amount:{value:'990.00',currency:'RUB'},metadata:{receipt_probe_id:PROBE_ID,environment:'sandbox'},status:'succeeded',paid:true,refundable:true,refunded_amount:{value:'317.43',currency:'RUB'},receipt_registration:'succeeded'}
const original={id:ORIGINAL_RECEIPT_ID,payment_id:PAYMENT_ID,type:'payment',status:'succeeded',items:[{...plan().body.receipt.items[0],quantity:1,payment_mode:'full_prepayment'}]}
const first={...original,id:REFUND_A_RECEIPT_ID,type:'refund',refund_id:REFUND_A_ID,items:[{...original.items[0],quantity:0.320636}]}
const settled={...original,id:SETTLEMENT_RECEIPT_ID,items:[{...plan().body.receipt.items[0],quantity:0.679364}],settlements:[{type:'prepayment',amount:{value:'672.57',currency:'RUB'}}]}
const firstRefund={id:REFUND_A_ID,payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'317.43',currency:'RUB'}}
const created={id:'11111111-1111-1111-1111-111111111111',payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'672.57',currency:'RUB'},receipt_registration:'pending',customer:{email:config.email}}
const receipts=[original,first,settled]
function fake(p=payment,list=receipts,r=firstRefund,s=shop){return vi.fn()
 .mockResolvedValueOnce({ok:true,json:async()=>s}).mockResolvedValueOnce({ok:true,json:async()=>p})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:list})}).mockResolvedValueOnce({ok:true,json:async()=>r})}
const opts=fetchImpl=>({persisted:true,fetchImpl,now:()=>now})
it('sends the remaining refund once with the reviewed full_payment line and separate key',async()=>{
 const p=plan(),fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>created})
 expect(p.body).toEqual(buildSettlementScenarioDrafts(PAYMENT_ID,config.email).refundAfter)
 expect(p.body.amount.value).toBe('672.57')
 expect(p.body.receipt.items[0]).toMatchObject({quantity:'0.679364',amount:{value:'990.00',currency:'RUB'},payment_mode:'full_payment'})
 const sealed=sealProbe(p,config.secretKey);expect(sealed).not.toContain(config.email);expect(openProbe(sealed,config.secretKey)).toEqual(p)
 const result=await send(p,config,opts(fetchImpl))
 expect(result).toMatchObject({outcome:'identified',refundId:created.id,amount:'672.57',status:'succeeded',receiptRegistration:'pending'})
 expect(JSON.stringify(result)).not.toContain(config.email)
 const posts=fetchImpl.mock.calls.filter(([,r])=>r.method==='POST');expect(posts).toHaveLength(1)
 expect(posts[0][0]).toBe('https://api.yookassa.ru/v3/refunds')
 expect(posts[0][1].headers['Idempotence-Key']).toBe(REFUND_KEY)
 expect(JSON.parse(posts[0][1].body)).toEqual(p.body)
 expect(fetchImpl.mock.calls[3][0]).toBe(`https://api.yookassa.ru/v3/refunds/${REFUND_A_ID}`)
})
it.each([{refunded_amount:{value:'990.00',currency:'RUB'}},{refunded_amount:{value:'0.00',currency:'RUB'}},{receipt_registration:'pending'},{refundable:false}])('blocks changed payment %j',async patch=>{
 const f=fake({...payment,...patch});await expect(send(plan(),config,opts(f))).rejects.toThrow('refund_after_settlement_probe_preconditions_failed');expect(f).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{status:'canceled'},{id:ORIGINAL_RECEIPT_ID},{items:[{...settled.items[0],payment_mode:'full_prepayment'}]},
 {items:[{...settled.items[0],quantity:1}]},{items:[{...settled.items[0],amount:{value:'672.57',currency:'RUB'}}]},
 {settlements:undefined},{settlements:[]},{settlements:[{type:'cashless',amount:{value:'672.57',currency:'RUB'}}]},
 {settlements:[{type:'prepayment',amount:{value:'990.00',currency:'RUB'}}]}])('blocks missing or mismatched settlement evidence %j',async patch=>{
 const f=fake(payment,[original,first,{...settled,...patch}])
 await expect(send(plan(),config,opts(f))).rejects.toThrow(/receipt_probe_inspection_failed|refund_after_settlement_probe_preconditions_failed/)
 expect(f).toHaveBeenCalledTimes(3)
})
it.each([[original,first],[original,settled],[first,settled],[...receipts,{...first,id:'ra-22222222-2222-2222-2222-222222222222'}]].map(list=>({list})))('requires exactly all three receipts',async ({list})=>{
 const f=fake(payment,list);await expect(send(plan(),config,opts(f))).rejects.toThrow('refund_after_settlement_probe_preconditions_failed');expect(f).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{refund_id:'other'},{items:[{...first.items[0],quantity:0.32}]}])('requires unchanged first refund receipt',async patch=>{
 const f=fake(payment,[original,{...first,...patch},settled]);await expect(send(plan(),config,opts(f))).rejects.toThrow('refund_after_settlement_probe_preconditions_failed');expect(f).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{id:'other'},{payment_id:'other'},{amount:{value:'1.00',currency:'RUB'}}])('requires succeeded exact first refund',async patch=>{
 const f=fake(payment,receipts,{...firstRefund,...patch});await expect(send(plan(),config,opts(f))).rejects.toThrow('refund_after_settlement_probe_first_refund_unconfirmed');expect(f).toHaveBeenCalledTimes(4)
})
it('blocks live shop',async()=>{
 const f=fake(payment,receipts,firstRefund,{...shop,test:false});await expect(send(plan(),config,opts(f))).rejects.toThrow('receipt_probe_inspection_failed');expect(f).toHaveBeenCalledTimes(1)
})
it.each(['persisted','amount','quantity','mode','key','contact'])('blocks changed or missing journal %s',async field=>{
 const p=plan(),f=vi.fn(),o=opts(f)
 if(field==='persisted')o.persisted=false
 if(field==='amount')p.body.amount.value='317.43'
 if(field==='quantity')p.body.receipt.items[0].quantity='1'
 if(field==='mode')p.body.receipt.items[0].payment_mode='full_prepayment'
 if(field==='key')p.key=PROBE_ID
 if(field==='contact')p.body.receipt.customer.email='other@example.test'
 await expect(send(p,config,o)).rejects.toThrow('refund_after_settlement_probe_journal_mismatch');expect(f).not.toHaveBeenCalled()
})
it.each(['2026-09-28T10:29:59Z','2026-09-29T09:30:00Z'])('blocks outside window %s',date=>{
 expect(()=>prepare(config,Date.parse(date))).toThrow('refund_after_settlement_probe_window_closed')
})
it('rechecks expiry after GET',async()=>{
 const f=fake(),clock=vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse('2026-09-29T09:30:00Z'))
 await expect(send(plan(),config,{...opts(f),now:clock})).rejects.toThrow('refund_after_settlement_probe_window_closed');expect(f).toHaveBeenCalledTimes(4)
})
it.each(['timeout','http','wrong-payment','old-refund','wrong-amount'])('never retries unknown POST %s',async reason=>{
 const f=fake()
 if(reason==='timeout')f.mockRejectedValueOnce(new Error(config.email))
 if(reason==='http')f.mockResolvedValueOnce({ok:false,status:500,json:async()=>({description:config.email})})
 if(reason==='wrong-payment')f.mockResolvedValueOnce({ok:true,json:async()=>({...created,payment_id:'other'})})
 if(reason==='old-refund')f.mockResolvedValueOnce({ok:true,json:async()=>({...created,id:REFUND_A_ID})})
 if(reason==='wrong-amount')f.mockResolvedValueOnce({ok:true,json:async()=>({...created,amount:firstRefund.amount})})
 const result=await send(plan(),config,opts(f));expect(result.outcome).toBe('unknown');expect(JSON.stringify(result)).not.toContain(config.email);expect(f).toHaveBeenCalledTimes(5)
})
it('sanitizes explicit provider rejection',async()=>{
 const f=fake().mockResolvedValueOnce({ok:false,status:400,json:async()=>({code:'invalid_request',parameter:'receipt.items.quantity',description:config.email})})
 expect(await send(plan(),config,opts(f))).toEqual({outcome:'rejected',key:REFUND_KEY,httpStatus:400,parameter:'receipt.items.quantity'});expect(f).toHaveBeenCalledTimes(5)
})
it.each(['pending','succeeded','canceled'])('preserves actual refund status %s',async status=>{
 const f=fake().mockResolvedValueOnce({ok:true,json:async()=>({...created,status})})
 expect(await send(plan(),config,opts(f))).toMatchObject({outcome:'identified',status})
})
it('rejects journals from earlier steps before network calls',async()=>{
 const {prepareSettlement,SETTLEMENT_KEY}=await import('./receipt-settle-remainder-probe.mjs')
 const {prepareRefundBeforeSettlement,REFUND_KEY:beforeKey}=await import('./receipt-before-settlement-probe.mjs')
 expect(REFUND_KEY).not.toBe(SETTLEMENT_KEY);expect(REFUND_KEY).not.toBe(beforeKey)
 for(const p of [prepareSettlement(config,now),prepareRefundBeforeSettlement(config,now)]){
  const f=vi.fn();await expect(send(p,config,opts(f))).rejects.toThrow('refund_after_settlement_probe_journal_mismatch');expect(f).not.toHaveBeenCalled()
 }
})

it('scans later pages before allowing a refund and rejects an extra receipt',async()=>{
 const f=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockResolvedValueOnce({ok:true,json:async()=>payment})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:receipts,next_cursor:'next'})})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:[{...first,id:'ra-33333333-3333-3333-3333-333333333333'}]})})
 await expect(send(plan(),config,opts(f))).rejects.toThrow('refund_after_settlement_probe_preconditions_failed')
 expect(f).toHaveBeenCalledTimes(4);expect(f.mock.calls.every(([,r])=>r.method==='GET')).toBe(true)
})
it('fails closed without exposing a first-refund GET error',async()=>{
 const f=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockResolvedValueOnce({ok:true,json:async()=>payment})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:receipts})}).mockRejectedValueOnce(new Error(config.email))
 await expect(send(plan(),config,opts(f))).rejects.toThrow(/^refund_after_settlement_probe_first_refund_unconfirmed$/)
 expect(f).toHaveBeenCalledTimes(4)
})
