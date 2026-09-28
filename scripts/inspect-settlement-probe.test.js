// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { inspectReceiptProbe, PAYMENT_ID, ORIGINAL_RECEIPT_ID } from './inspect-settlement-probe.mjs'
import { PROBE_ID } from './receipt-settlement-payment-probe.mjs'
const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used'}
const shop={account_id:config.shopId,test:true,status:'enabled'}
const payment={id:PAYMENT_ID,test:true,recipient:{account_id:config.shopId},amount:{value:'990.00',currency:'RUB'},
  metadata:{receipt_probe_id:PROBE_ID,environment:'sandbox'},status:'succeeded',paid:true,refundable:true,
  refunded_amount:{value:'0.00',currency:'RUB'},receipt_registration:'succeeded',customer:{email:'private@example.test'}}
const receipt={id:ORIGINAL_RECEIPT_ID,payment_id:PAYMENT_ID,type:'payment',status:'succeeded',customer:{email:'private@example.test'},
  items:[{description:'Тест возврата до и после зачёта услуги',quantity:'1.000',amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_prepayment'}]}
function fake(...values){const f=vi.fn();for(const value of values)f.mockResolvedValueOnce({ok:true,json:async()=>value});return f}
it('checks the exact existing payment and original receipt using GET only, without contact output',async()=>{
 const fetchImpl=fake(shop,payment,{items:[receipt]})
 const result=await inspectReceiptProbe(config,{fetchImpl})
 expect(result.initialRefundPreconditionsMet).toBe(true)
 expect(result.receipts[0].items[0]).toMatchObject({quantity:'1.000',paymentMode:'full_prepayment'})
 expect(JSON.stringify(result)).not.toContain('private@example.test')
 expect(fetchImpl.mock.calls.map(([u])=>u)).toEqual(['https://api.yookassa.ru/v3/me',`https://api.yookassa.ru/v3/payments/${PAYMENT_ID}`,`https://api.yookassa.ru/v3/receipts?payment_id=${PAYMENT_ID}&limit=100`])
 for(const [,request] of fetchImpl.mock.calls){expect(request.method).toBe('GET');expect(request).not.toHaveProperty('body');expect(request.redirect).toBe('error')}
})
it.each([{test:false},{account_id:'123'},{status:'disabled'}])('stops after a mismatched shop',async patch=>{
 const fetchImpl=fake({...shop,...patch})
 await expect(inspectReceiptProbe(config,{fetchImpl})).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
it.each([{id:'other'},{test:false},{recipient:{account_id:'123'}},{metadata:{}},{amount:{value:'990.00',currency:'USD'}}])('rejects mismatched payments before reading receipts',async patch=>{
 const fetchImpl=fake(shop,{...payment,...patch})
 await expect(inspectReceiptProbe(config,{fetchImpl})).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(2)
})
it.each([{refunded_amount:{value:'1.00',currency:'RUB'}},{refunded_amount:undefined},{receipt_registration:'pending'},{refundable:false},{status:'pending',paid:false}])('does not approve initial refund for an ineligible payment',async patch=>{
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,{...payment,...patch},{items:[receipt]})})
 expect(result.initialRefundPreconditionsMet).toBe(false)
})
it('does not equate an empty list with a registered receipt',async()=>{
 expect((await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[]})})).initialRefundPreconditionsMet).toBe(false)
})
it('reads all pages, and detects another receipt before reporting readiness',async()=>{
 const other={...receipt,id:'rt-11111111-1111-1111-1111-111111111111',type:'refund'}
 const fetchImpl=fake(shop,payment,{items:[receipt],next_cursor:'next&cursor'},{items:[other]})
 const result=await inspectReceiptProbe(config,{fetchImpl})
 expect(result.scanComplete).toBe(true);expect(result.receipts).toHaveLength(2);expect(result.initialRefundPreconditionsMet).toBe(false)
 expect(fetchImpl.mock.calls[3][0]).toContain('cursor=next%26cursor')
})
it('rejects cross-payment receipt data',async()=>{
 await expect(inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[{...receipt,payment_id:'other'}]})})).rejects.toThrow('receipt_probe_inspection_failed')
})
it.each(['repeat','limit'])('never accepts a partial receipt scan: %s',async kind=>{
 const pages=Array.from({length:10},(_,i)=>({items:[],next_cursor:kind==='repeat'?'same':String(i)}))
 await expect(inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,...pages)})).rejects.toThrow('receipt_probe_inspection_failed')
})
it('rejects inconsistent duplicate receipt IDs',async()=>{
 await expect(inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[receipt],next_cursor:'next'},
 {items:[{...receipt,status:'pending'}]})})).rejects.toThrow('receipt_probe_inspection_failed')
})
it.each([{quantity:'0.32'},{vat_code:2},{payment_mode:'full_payment'},{description:'private@example.test'},{quantity:undefined}])('does not approve a different or incomplete original line',async patch=>{
 const changed={...receipt,items:[{...receipt.items[0],...patch}]}
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[changed]})})
 expect(result.initialRefundPreconditionsMet).toBe(false)
 expect(JSON.stringify(result)).not.toContain('private@example.test')
})
it('sanitizes network exceptions and does not retry',async()=>{
 const fetchImpl=vi.fn().mockRejectedValue(new Error('private@example.test'))
 await expect(inspectReceiptProbe(config,{fetchImpl})).rejects.toThrow(/^receipt_probe_inspection_failed$/)
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it.each([[1,'1'],[0.320636,'0.320636'],['1.000','1.000'],['0.320636','0.320636']])('reads provider quantity %s preserving its JSON representation type',async(value,expected)=>{
 const changed={...receipt,items:[{...receipt.items[0],quantity:value}]}
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[changed]})})
 expect(result.receipts[0].items[0]).toMatchObject({quantity:expected,quantityEncoding:typeof value})
 expect(result.initialRefundPreconditionsMet).toBe(Number(value)===1)
})
it.each([null,true,{},NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1])('does not coerce an invalid quantity %s',async value=>{
 const changed={...receipt,items:[{...receipt.items[0],quantity:value}]}
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[changed]})})
 expect(result.receipts[0].items[0].quantity).toBeNull()
 expect(result.initialRefundPreconditionsMet).toBe(false)
})

it('preserves only a valid refund ID for matching the receipt to the actual operation',async()=>{
 const refundId='11111111-1111-1111-1111-111111111111'
 const refundReceipt={...receipt,type:'refund',refund_id:refundId}
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[refundReceipt]})})
 expect(result.receipts[0].refundId).toBe(refundId)
 expect(result.initialRefundPreconditionsMet).toBe(false)
})

it.each([
 {id:'324bffbc-000f-5001-a000-16b18fa2cc44'},
 {metadata:{receipt_probe_id:'65b56025-7260-40de-a54e-81a8d074f358',environment:'sandbox'}},
])('rejects payment identity from the completed A/B experiment',async patch=>{
 const fetchImpl=fake(shop,{...payment,...patch})
 await expect(inspectReceiptProbe(config,{fetchImpl})).rejects.toThrow('receipt_probe_inspection_failed')
 expect(fetchImpl).toHaveBeenCalledTimes(2)
})
it('does not treat the old experiment receipt as this original',async()=>{
 const old={...receipt,id:'ra-324c0018-0001-0050-7972-5da070857c1a'}
 const result=await inspectReceiptProbe(config,{fetchImpl:fake(shop,payment,{items:[old]})})
 expect(result.initialRefundPreconditionsMet).toBe(false)
})
