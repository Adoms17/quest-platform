// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSandboxRefundReconciler } from './sandboxRefundReconciliation.js'
test('refund webhook trusts only authenticated API result',async()=>{
 const snapshot={refund:{id:'local'}}
 const rpc=vi.fn().mockResolvedValueOnce({data:snapshot}).mockResolvedValueOnce({data:{state:'pending'}})
 const provider={readRefund:vi.fn().mockResolvedValue({refundId:'provider',status:'pending'})}
 await createSandboxRefundReconciler({rpc,provider,shopId:'123'}).webhook({object:{id:'provider',status:'succeeded'}})
 expect(rpc).toHaveBeenLastCalledWith('record_verified_sandbox_refund',{p_refund_id:'local',p_provider_id:'provider',p_status:'pending'})
})
test('unknown refund does not query provider or mutate ledger',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:null}),provider={readRefund:vi.fn()}
 await createSandboxRefundReconciler({rpc,provider,shopId:'123'}).webhook({object:{id:'unknown'}})
 expect(rpc).toHaveBeenCalledTimes(1);expect(provider.readRefund).not.toHaveBeenCalled()
})
test('one failed refund does not prevent checking next',async()=>{
 const rpc=vi.fn(async(name,args)=>({data:name==='list_sandbox_subscription_refund_applications'?[]:name==='list_sandbox_refund_reconciliation'?['one','two']:name==='read_sandbox_refund_reconciliation'?{refund:{id:args.p_provider_id}}:{state:'succeeded'}}))
 const provider={readRefund:vi.fn().mockRejectedValueOnce(Error()).mockResolvedValueOnce({refundId:'two',status:'succeeded'})}
 expect(await createSandboxRefundReconciler({rpc,provider,shopId:'123'}).batch()).toEqual({checked:2,failed:1,access:{checked:0,review:0,failed:0}})
})
