// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { reconcilePrepaymentSettlements } from './settlementReconciliation.js'
const operation={orderId:'order',shopId:'123',receiptId:'ra-known'}
function setup(items=[operation]) {
 return {shopId:'123',rpc:vi.fn().mockResolvedValueOnce({data:items}).mockResolvedValue({error:null}),
 provider:{readSettlement:vi.fn().mockResolvedValue({id:'ra-known',status:'succeeded'}),findSettlement:vi.fn().mockResolvedValue(null),createSettlement:vi.fn()}}
}
it('only reads existing operations and stores their results',async()=>{
 const ctx=setup()
 expect(await reconcilePrepaymentSettlements(ctx)).toEqual({checked:1,failed:0,unresolved:0})
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
 expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(['list_pending_prepayment_settlements','record_prepayment_settlement','record_settlement_poll'])
})
it('unknown id is searched without creating another receipt',async()=>{
 const ctx=setup([{...operation,receiptId:null}])
 expect(await reconcilePrepaymentSettlements(ctx)).toEqual({checked:0,failed:0,unresolved:1})
 expect(ctx.provider.findSettlement).toHaveBeenCalledOnce()
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
})
it('one provider failure does not prevent checking the next operation',async()=>{
 const ctx=setup([operation,operation])
 ctx.provider.readSettlement.mockRejectedValueOnce(Error('private provider response'))
 expect(await reconcilePrepaymentSettlements(ctx)).toEqual({checked:1,failed:1,unresolved:0})
})
it.each([null, {...operation,shopId:'999'}, {...operation,orderId:''}, {...operation,orderId:null}])(
 'rejects a malformed batch before processing even its valid first operation: %j',async invalid=>{
 const ctx=setup([operation,invalid])
 await expect(reconcilePrepaymentSettlements(ctx)).rejects.toThrow()
 expect(ctx.provider.readSettlement).not.toHaveBeenCalled()
 expect(ctx.provider.findSettlement).not.toHaveBeenCalled()
 expect(ctx.provider.createSettlement).not.toHaveBeenCalled()
 expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(['list_pending_prepayment_settlements'])
})
it('stops the batch if persisting the poll schedule fails',async()=>{
 const ctx=setup([operation,{...operation,orderId:'next-order'}])
 ctx.rpc.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:{code:'failure'}})
 await expect(reconcilePrepaymentSettlements(ctx)).rejects.toThrow()
 expect(ctx.provider.readSettlement).toHaveBeenCalledTimes(1)
})
it('does not count a failed persistence as success',async()=>{
 const ctx=setup()
 ctx.rpc.mockResolvedValueOnce({error:{code:'failure'}})
 expect(await reconcilePrepaymentSettlements(ctx)).toEqual({checked:0,failed:1,unresolved:0})
})
