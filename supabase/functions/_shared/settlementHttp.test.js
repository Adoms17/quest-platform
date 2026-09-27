// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { settlementHttpMethods } from './settlementHttp.js'
const paymentId='11111111-1111-4111-8111-111111111111'
const item={description:'Subscription',quantity:'1.000',amount:{value:'10.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_payment'}
const operation={shopId:'123',key:paymentId,firstSentAt:'2026-09-26T00:00:00Z',body:{type:'payment',payment_id:paymentId,send:true,items:[item],settlements:[{type:'prepayment',amount:item.amount}]}}
function setup(change={}) {
 const payment={id:paymentId,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:item.amount,refunded_amount:{value:'0.00',currency:'RUB'}}
 const response={id:'rt-test',type:'payment',payment_id:paymentId,status:'pending',items:[{...item,quantity:1}],...change}
 const request=vi.fn().mockResolvedValueOnce(payment).mockResolvedValue(response)
 const verifyShop=vi.fn().mockResolvedValue()
 return {request,verifyShop,client:settlementHttpMethods({request,verifyShop,shopId:'123',now:()=>Date.parse('2026-09-26T01:00:00Z')})}
}
it('creates only a receipt with persisted key after verification',async()=>{
 const {client,request,verifyShop}=setup()
 expect(await client.createSettlement(operation)).toEqual({id:'rt-test',status:'pending'})
 expect(verifyShop).toHaveBeenCalledOnce()
 expect(request).toHaveBeenLastCalledWith('receipts','POST',operation.body,{'Idempotence-Key':operation.key,'Content-Type':'application/json'})
})
it('recovers using GET and never POST',async()=>{
 const {client,request}=setup()
 await client.readSettlement({...operation,receiptId:'rt-test'})
 expect(request).toHaveBeenLastCalledWith('receipts/rt-test')
})
it.each([{payment_id:'wrong'},{type:'refund'},{status:'unknown'},{items:[{...item,amount:{value:'9.00',currency:'RUB'}}]},{items:[{...item,payment_mode:'full_prepayment'}]}])('rejects mismatching provider receipt',async change=>{
 const {client}=setup(change)
 await expect(client.createSettlement(operation)).rejects.toThrow('settlement_provider_mismatch')
})
it('rejects another shop before network',async()=>{
 const {client,request}=setup()
 await expect(client.createSettlement({...operation,shopId:'999'})).rejects.toThrow('settlement_provider_mismatch')
 expect(request).not.toHaveBeenCalled()
})
it('does not send an expired claim',async()=>{
 const {client,request}=setup()
 await expect(client.createSettlement({...operation,firstSentAt:'2026-09-24T00:00:00Z'})).rejects.toThrow('settlement_reconciliation_required')
 expect(request).toHaveBeenCalledTimes(1)
})
it('rejects payment that is no longer refundable in full',async()=>{
 const {client,request}=setup()
 request.mockReset().mockResolvedValue({id:paymentId,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:item.amount,refunded_amount:{value:'1.00',currency:'RUB'}})
 await expect(client.createSettlement(operation)).rejects.toThrow('settlement_provider_mismatch')
 expect(request).toHaveBeenCalledTimes(1)
})

it('finds a settlement on a later page, excluding the original prepayment',async()=>{
 const {client,request}=setup()
 const original={id:'rt-original',type:'payment',payment_id:paymentId,items:[{...item,payment_mode:'full_prepayment'}]}
 request.mockResolvedValueOnce({items:[original],next_cursor:'next'}).mockResolvedValueOnce({items:[{id:'rt-found',type:'payment',payment_id:paymentId,status:'succeeded',items:[item]}]})
 expect(await client.findSettlement(operation)).toEqual({id:'rt-found',status:'succeeded'})
 expect(request.mock.calls.every(call=>call.length===1)).toBe(true)
 expect(request.mock.calls[2][0]).toContain('cursor=next')
})
it('does not accept a match when another page contains a duplicate settlement',async()=>{
 const {client,request}=setup()
 const receipt={id:'rt-first',type:'payment',payment_id:paymentId,status:'succeeded',items:[item]}
 request.mockResolvedValueOnce({items:[receipt],next_cursor:'next'}).mockResolvedValueOnce({items:[{...receipt,id:'rt-second'}]})
 await expect(client.findSettlement(operation)).rejects.toThrow('settlement_reconciliation_required')
})
it('empty search never creates a receipt',async()=>{
 const {client,request}=setup()
 request.mockResolvedValueOnce({items:[]})
 expect(await client.findSettlement(operation)).toBe(null)
 expect(request).toHaveBeenCalledTimes(2)
})
it('rejects repeated cursors rather than accepting a partial scan',async()=>{
 const {client,request}=setup()
 request.mockResolvedValueOnce({items:[],next_cursor:'same'}).mockResolvedValueOnce({items:[],next_cursor:'same'})
 await expect(client.findSettlement(operation)).rejects.toThrow('settlement_provider_mismatch')
})
