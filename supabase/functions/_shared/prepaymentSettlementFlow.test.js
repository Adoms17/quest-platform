// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runPrepaymentSettlement } from './prepaymentSettlementFlow.js'
function setup(data) {
 const rpc=vi.fn().mockResolvedValueOnce({data}).mockResolvedValue({error:null})
 const provider={findSettlement:vi.fn().mockResolvedValue(null),createSettlement:vi.fn().mockResolvedValue({id:'rt-test',status:'pending'}),readSettlement:vi.fn().mockResolvedValue({id:'rt-test',status:'succeeded'})}
 return {orderId:'synthetic-order',rpc,provider}
}
const claim={action:'send',body:{type:'payment'},key:'stable-key',firstSentAt:'2026-09-26T00:00:00Z'}
it('sends the persisted operation and records its result',async()=>{
 const ctx=setup(claim)
 expect(await runPrepaymentSettlement(ctx)).toEqual({state:'pending'})
 expect(ctx.provider.createSettlement).toHaveBeenCalledExactlyOnceWith(claim)
 expect(ctx.rpc).toHaveBeenLastCalledWith('record_prepayment_settlement',{p_order_id:ctx.orderId,p_receipt_id:'rt-test',p_status:'pending'})
})
it('uses GET recovery for a known receipt',async()=>{
 const ctx=setup({action:'reconcile',receiptId:'rt-test'})
 expect(await runPrepaymentSettlement(ctx)).toEqual({state:'succeeded'})
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('requires review when a dispatch has no known provider id',async()=>{
 const ctx=setup({action:'reconcile',receiptId:null})
 expect(await runPrepaymentSettlement(ctx)).toEqual({state:'review_required'})
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
 expect(ctx.provider.readSettlement).not.toHaveBeenCalled()
})
it('does not retry POST after timeout',async()=>{
 const ctx=setup(claim)
 ctx.provider.createSettlement.mockRejectedValue(new Error('timeout'))
 await expect(runPrepaymentSettlement(ctx)).rejects.toThrow('timeout')
 expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
 expect(ctx.rpc).toHaveBeenCalledTimes(1)
})
it('does not retry POST after result storage failure',async()=>{
 const ctx=setup(claim)
 ctx.rpc.mockResolvedValue({error:{code:'storage'}})
 await expect(runPrepaymentSettlement(ctx)).rejects.toThrow('settlement_storage_unavailable')
 expect(ctx.provider.createSettlement).toHaveBeenCalledTimes(1)
})
it('rejects a different receipt returned by GET',async()=>{
 const ctx=setup({action:'reconcile',receiptId:'rt-original'})
 await expect(runPrepaymentSettlement(ctx)).rejects.toThrow('invalid_settlement_result')
 expect(ctx.rpc).toHaveBeenCalledTimes(1)
})

it('persists a recovered receipt without repeating creation',async()=>{
 const ctx=setup({action:'reconcile',receiptId:null})
 ctx.provider.findSettlement.mockResolvedValue({id:'ra-recovered',status:'succeeded'})
 expect(await runPrepaymentSettlement(ctx)).toEqual({state:'succeeded'})
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
 expect(ctx.rpc).toHaveBeenLastCalledWith('record_prepayment_settlement',{p_order_id:ctx.orderId,p_receipt_id:'ra-recovered',p_status:'succeeded'})
})
it('does not automatically recover a flagged conflict',async()=>{
 const ctx=setup({action:'reconcile',requiresReview:true,receiptId:'rt-test'})
 expect(await runPrepaymentSettlement(ctx)).toEqual({state:'review_required'})
 expect(ctx.provider.readSettlement).not.toHaveBeenCalled()
 expect(ctx.provider.findSettlement).not.toHaveBeenCalled()
})
