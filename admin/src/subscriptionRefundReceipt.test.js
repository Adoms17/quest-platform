// @vitest-environment node
import {expect,test} from 'vitest'
import {emailReceiptFromLocal,assertSameRefundReceipt} from './subscriptionRefundReceipt'
import {createSubscriptionRefundApi} from './subscriptionRefundApi'
test('local email calendar is explicit, offset-aware and rejects normalized invalid dates',()=>{
 const receipt=emailReceiptFromLocal('2026-09-16T12:30:00')
 expect(receipt.receivedAt).toBe(new Date(2026,8,16,12,30).toISOString())
 expect(()=>emailReceiptFromLocal('2026-02-30T12:00')).toThrow('invalid_receipt_time')
 expect(()=>emailReceiptFromLocal('')).toThrow('invalid_receipt_time')
 expect(()=>assertSameRefundReceipt(receipt,{...receipt,receivedAt:'2026-09-17T00:00:00Z'})).toThrow('receipt_conflict')
})
test('API sends receipt only for registration; reservation/execution retain existing contracts',async()=>{
 const quote={request_id:'request',amount_minor:500,currency:'RUB',period_start:'2026-09-01',period_end:'2026-10-01',received_at:'2026-09-16T00:00:00Z',registered_at:'2026-10-07T00:00:00Z',receipt_source:'email'}
 const calls=[];const client={functions:{invoke:async(name,{body})=>{calls.push([name,body]);return {data:body.action==='request'?quote:body.action==='reserve'?{request_id:'request',refund_id:'refund'}:{refundId:'refund',state:'succeeded',accessEffect:'applied'}}}}}
 const api=createSubscriptionRefundApi(client);await api.requestSubscriptionRefund('org','order','command',{source:'email',receivedAt:'2026-09-16T00:00:00Z'})
 await api.reserveSubscriptionRefund('org','order','request');await api.executeSubscriptionRefund('refund')
 expect(calls[0][1]).toMatchObject({receiptSource:'email',receivedAt:'2026-09-16T00:00:00Z'})
 expect(calls[1][1]).toEqual({action:'reserve',organizationId:'org',orderId:'order',requestId:'request'})
 expect(calls[2][1]).toEqual({refundId:'refund'})
})
test('API preserves explicit conflict from HTTP error response without exposing details',async()=>{
 const api=createSubscriptionRefundApi({functions:{invoke:async()=>({error:{context:new Response(JSON.stringify({error:'receipt_conflict'}),{status:409})}})}})
 await expect(api.requestSubscriptionRefund('org','order','command')).rejects.toThrow('receipt_conflict')
})

test('only confirmed HTTP 400 receipt rejection allows correction',async()=>{
 const api=createSubscriptionRefundApi({functions:{invoke:async()=>({error:{context:new Response(JSON.stringify({error:'invalid_receipt_time'}),{status:400})}})}})
 await expect(api.requestSubscriptionRefund('org','order','command')).rejects.toMatchObject({message:'invalid_receipt_time',definitiveReceiptRejection:true})
})

const legacyQuote={request_id:'legacy-request',amount_minor:417,currency:'RUB',period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z',requested_at:'2026-09-18T00:00:00Z',registered_at:'2026-09-18T00:00:00Z',received_at:null,receipt_source:null,policy:'subscription-prorata-v1',reserved:false,access_effect:'unchanged'}
const receiptApi=data=>createSubscriptionRefundApi({functions:{invoke:async()=>({data})}})
test('explicit legacy NULL receipt is recovered only via inapp with original quote unchanged',async()=>{
 const result=await receiptApi(legacyQuote).requestSubscriptionRefund('org','order','new-command',{source:'inapp',receivedAt:null})
 expect(result).toEqual({...legacyQuote,receiptTimeUnknown:true})
 await expect(receiptApi(legacyQuote).requestSubscriptionRefund('org','order','new-command',{source:'email',receivedAt:'2026-09-16T00:00:00Z'})).rejects.toThrow('invalid_quote')
})
test.each([
 {received_at:'2026-09-18T00:00:00Z'}, {receipt_source:'inapp'}, {received_at:undefined,receipt_source:undefined},
 {registered_at:undefined}, {requested_at:'2026-09-19T00:00:00Z'}, {registered_at:'invalid'},
 {policy:'other'}, {reserved:true}, {access_effect:'applied'}, {amount_minor:-1},
])('partial, missing or inconsistent legacy response rejected: %j',async patch=>{
 await expect(receiptApi({...legacyQuote,...patch,receiptTimeUnknown:true}).requestSubscriptionRefund('org','order','command',{source:'inapp',receivedAt:null})).rejects.toThrow('invalid_quote')
})
test('new inapp response is validated as server-time receipt, ignoring forged unknown marker',async()=>{
 const quote={...legacyQuote,receipt_source:'inapp',received_at:legacyQuote.registered_at,receiptTimeUnknown:true}
 const result=await receiptApi(quote).requestSubscriptionRefund('org','order','command',{source:'inapp',receivedAt:null})
 expect(result.receiptTimeUnknown).toBe(false)
 await expect(receiptApi({...quote,received_at:'2026-09-17T00:00:00Z'}).requestSubscriptionRefund('org','order','command',{source:'inapp',receivedAt:null})).rejects.toThrow('invalid_quote')
})
