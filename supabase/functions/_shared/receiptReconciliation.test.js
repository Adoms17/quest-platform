// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { reconcileReceiptPayments } from './receiptReconciliation.js'
it('continues independent receipt reads after one failure and never calls create',async()=>{
 const provider={readPayment:vi.fn().mockRejectedValueOnce(Error('private')).mockResolvedValue({}),createPayment:vi.fn()}
 const rpc=vi.fn().mockResolvedValue({data:[{id:'one'},{id:'two'}]})
 expect(await reconcileReceiptPayments({rpc,provider})).toEqual({checked:1,failed:1})
 expect(provider.readPayment).toHaveBeenCalledTimes(2)
 expect(provider.createPayment).not.toHaveBeenCalled()
})
it('failed listing does not query the provider or disclose database text',async()=>{
 const provider={readPayment:vi.fn()}
 await expect(reconcileReceiptPayments({rpc:async()=>({error:{message:'private'}}),provider})).rejects.toThrow('receipt_storage_unavailable')
 expect(provider.readPayment).not.toHaveBeenCalled()
})
it('refund receipt poll uses only readRefund',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:[{refund:{id:'synthetic'}}]})
 const provider={readRefund:vi.fn().mockResolvedValue({}),readPayment:vi.fn(),createRefund:vi.fn()}
 expect(await reconcileReceiptPayments({rpc,provider,refund:true,shopId:'123'})).toEqual({checked:1,failed:0})
 expect(rpc).toHaveBeenCalledWith('list_pending_refund_receipts',{p_limit:25,p_shop_id:'123'})
 expect(provider.readPayment).not.toHaveBeenCalled()
 expect(provider.createRefund).not.toHaveBeenCalled()
})
it('failed read is recorded before moving to next receipt',async()=>{
 const rpc=vi.fn(async name=>name==='list_pending_sandbox_receipts'?{data:[{id:'one'},{id:'two'}]}:{data:null})
 const provider={readPayment:vi.fn().mockRejectedValueOnce(Error('private')).mockResolvedValue({})}
 expect(await reconcileReceiptPayments({rpc,provider})).toEqual({checked:1,failed:1})
 expect(rpc).toHaveBeenCalledWith('record_receipt_poll',{p_kind:'payment',p_operation_id:'one',p_succeeded:false})
 expect(rpc).toHaveBeenCalledWith('record_receipt_poll',{p_kind:'payment',p_operation_id:'two',p_succeeded:true})
})
it('schedule persistence failure stops the batch without another provider call',async()=>{
 const rpc=vi.fn(async name=>name==='list_pending_sandbox_receipts'?{data:[{id:'one'},{id:'two'}]}:{error:{message:'private'}})
 const provider={readPayment:vi.fn().mockResolvedValue({})}
 await expect(reconcileReceiptPayments({rpc,provider})).rejects.toThrow('receipt_storage_unavailable')
 expect(provider.readPayment).toHaveBeenCalledTimes(1)
})
