// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {prepareSettlement,sendSettlement,SETTLEMENT_KEY,REFUND_A_ID,REFUND_A_RECEIPT_ID,sealProbe,openProbe} from './receipt-settle-remainder-probe.mjs'
import {PAYMENT_ID,ORIGINAL_RECEIPT_ID} from './inspect-settlement-probe.mjs'
import {PROBE_ID} from './receipt-settlement-payment-probe.mjs'
const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used',email:'probe@example.test'}
const now=Date.parse('2026-09-28T12:00:00Z')
const shop={account_id:config.shopId,test:true,status:'enabled'}
const payment={id:PAYMENT_ID,test:true,recipient:{account_id:config.shopId},amount:{value:'990.00',currency:'RUB'},metadata:{receipt_probe_id:PROBE_ID,environment:'sandbox'},status:'succeeded',paid:true,refundable:true,refunded_amount:{value:'317.43',currency:'RUB'},receipt_registration:'succeeded'}
const plan=()=>prepareSettlement(config,now)
const original={id:ORIGINAL_RECEIPT_ID,payment_id:PAYMENT_ID,type:'payment',status:'succeeded',items:[{...plan().body.items[0],quantity:1,payment_mode:'full_prepayment'}]}
const first={...original,id:REFUND_A_RECEIPT_ID,type:'refund',refund_id:REFUND_A_ID,items:[{...original.items[0],quantity:0.320636}]}
const refund={id:REFUND_A_ID,payment_id:PAYMENT_ID,status:'succeeded',amount:{value:'317.43',currency:'RUB'}}
const created={...plan().body,id:'ra-11111111-1111-1111-1111-111111111111',status:'pending'}
function fake(p=payment,receipts=[original,first],r=refund,s=shop){return vi.fn()
 .mockResolvedValueOnce({ok:true,json:async()=>s}).mockResolvedValueOnce({ok:true,json:async()=>p})
 .mockResolvedValueOnce({ok:true,json:async()=>({items:receipts})}).mockResolvedValueOnce({ok:true,json:async()=>r})}
const opts=fetchImpl=>({persisted:true,fetchImpl,now:()=>now})
it('sends exactly one remaining prepayment receipt and no money operation',async()=>{
 const fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>created}),saved=plan()
 const sealed=sealProbe(saved,config.secretKey)
 expect(sealed).not.toContain(config.email);expect(openProbe(sealed,config.secretKey)).toEqual(saved)
 const result=await sendSettlement(saved,config,opts(fetchImpl))
 expect(result).toMatchObject({outcome:'identified',receiptId:created.id,status:'pending',receiptMatches:true})
 expect(JSON.stringify(result)).not.toContain(config.email)
 expect(fetchImpl.mock.calls[3][0]).toBe(`https://api.yookassa.ru/v3/refunds/${REFUND_A_ID}`)
 const posts=fetchImpl.mock.calls.filter(([,r])=>r.method==='POST');expect(posts).toHaveLength(1)
 expect(posts[0][0]).toBe('https://api.yookassa.ru/v3/receipts')
 expect(posts[0][1].headers['Idempotence-Key']).toBe(SETTLEMENT_KEY)
 expect(JSON.parse(posts[0][1].body)).toEqual(saved.body)
 expect(saved.body).toMatchObject({type:'payment',send:true,items:[{quantity:'0.679364',payment_mode:'full_payment',amount:{value:'990.00',currency:'RUB'}}],settlements:[{type:'prepayment',amount:{value:'672.57',currency:'RUB'}}]})
 expect(saved.body).not.toHaveProperty('amount')
})
it.each([{refunded_amount:{value:'0.00',currency:'RUB'}},{refunded_amount:{value:'318.43',currency:'RUB'}},{refundable:false},{receipt_registration:'pending'}])('blocks changed payment %j',async patch=>{
 const fetchImpl=fake({...payment,...patch})
 await expect(sendSettlement(plan(),config,opts(fetchImpl))).rejects.toThrow('settlement_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{refund_id:'other'},{items:[{...first.items[0],payment_mode:'full_payment'}]},{items:[{...first.items[0],quantity:0.32}]}])('blocks unconfirmed or changed refund receipt %j',async patch=>{
 const fetchImpl=fake(payment,[original,{...first,...patch}])
 await expect(sendSettlement(plan(),config,opts(fetchImpl))).rejects.toThrow('settlement_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it.each([[original],[original,first,created],[{...original,status:'canceled'},first]].map(receipts=>({receipts})))('blocks missing, extra or canceled receipts',async ({receipts})=>{
 const fetchImpl=fake(payment,receipts)
 await expect(sendSettlement(plan(),config,opts(fetchImpl))).rejects.toThrow('settlement_probe_preconditions_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(3)
})
it.each([{status:'pending'},{id:'other'},{payment_id:'other'},{amount:{value:'1.00',currency:'RUB'}}])('verifies refund itself %j',async patch=>{
 const fetchImpl=fake(payment,[original,first],{...refund,...patch})
 await expect(sendSettlement(plan(),config,opts(fetchImpl))).rejects.toThrow('settlement_probe_first_refund_unconfirmed')
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})
it('blocks live shop',async()=>{
 const fetchImpl=fake(payment,[original,first],refund,{...shop,test:false})
 await expect(sendSettlement(plan(),config,opts(fetchImpl))).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it.each(['unpersisted','quantity','amount','settlements','mode','key','contact'])('rejects altered journal %s',async field=>{
 const p=plan(),fetchImpl=vi.fn(),o=opts(fetchImpl)
 if(field==='unpersisted')o.persisted=false
 if(field==='quantity')p.body.items[0].quantity='1.000'
 if(field==='amount')p.body.items[0].amount.value='672.57'
 if(field==='settlements')p.body.settlements[0].amount.value='990.00'
 if(field==='mode')p.body.items[0].payment_mode='full_prepayment'
 if(field==='key')p.key=PROBE_ID
 if(field==='contact')p.body.customer.email='other@example.test'
 await expect(sendSettlement(p,config,o)).rejects.toThrow('settlement_probe_journal_mismatch')
 expect(fetchImpl).not.toHaveBeenCalled()
})
it.each(['2026-09-28T08:59:59Z','2026-09-29T08:00:00Z'])('blocks outside window %s',time=>{
 expect(()=>prepareSettlement(config,Date.parse(time))).toThrow('settlement_probe_window_closed')
})
it('rechecks window after GET before POST',async()=>{
 const fetchImpl=fake(),clock=vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse('2026-09-29T08:00:00Z'))
 await expect(sendSettlement(plan(),config,{...opts(fetchImpl),now:clock})).rejects.toThrow('settlement_probe_window_closed')
 expect(fetchImpl).toHaveBeenCalledTimes(4)
})
it.each(['timeout','http','wrong-id'])('does not retry unknown POST %s',async kind=>{
 const fetchImpl=fake()
 if(kind==='timeout')fetchImpl.mockRejectedValueOnce(new Error(config.email))
 if(kind==='http')fetchImpl.mockResolvedValueOnce({ok:false,status:500,json:async()=>({description:config.email})})
 if(kind==='wrong-id')fetchImpl.mockResolvedValueOnce({ok:true,json:async()=>({...created,id:ORIGINAL_RECEIPT_ID})})
 const result=await sendSettlement(plan(),config,opts(fetchImpl))
 expect(result.outcome).toBe('unknown');expect(JSON.stringify(result)).not.toContain(config.email)
 expect(fetchImpl).toHaveBeenCalledTimes(5)
})
it.each([
 {settlements:[{type:'cashless',amount:{value:'672.57',currency:'RUB'}}]},
 {settlements:undefined},{settlements:[{type:'prepayment',amount:{value:'990.00',currency:'RUB'}}]},
 {items:[{...created.items[0],quantity:1}]},
])('retains identity on content mismatch and never retries',async patch=>{
 const fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>({...created,...patch})})
 const result=await sendSettlement(plan(),config,opts(fetchImpl))
 expect(result).toMatchObject({outcome:'identified',receiptId:created.id,receiptMatches:false})
 expect(fetchImpl).toHaveBeenCalledTimes(5)
})
it.each(['pending','succeeded','canceled'])('preserves actual receipt status %s',async status=>{
 const fetchImpl=fake().mockResolvedValueOnce({ok:true,json:async()=>({...created,status})})
 expect(await sendSettlement(plan(),config,opts(fetchImpl))).toMatchObject({status,receiptMatches:true})
})
